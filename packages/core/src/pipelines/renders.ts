import { and, eq, like } from "drizzle-orm";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfigValue, getConfigValueOr } from "../appConfig";
import { AccountBudgetError, assertAccountBudget, assertBudget, recordUsage } from "../budget";
import { evenlySpacedCaptions, type CaptionChunk } from "../captions";
import { getEnv } from "../config";
import type { Db } from "../db";
import {
  audioRenders,
  composites,
  creditLedger,
  demos,
  demoStepPlans,
  events,
  hookClips,
  openerClips,
  personaImages,
  scripts,
  sets,
  textBlockClips,
  videoRenders,
} from "../db/schema";
import { hookAnimation, isHookAnimation } from "../hook-effect";
import { resolveHookTextSafeArea } from "../hook-geometry";
import { HOOK_TEXT_INK, type HookTextColor } from "../hook-text-color";
import { BudgetError, PermanentError, TransientError } from "../jobs/errors";
import { assertPollDeadline } from "../jobs/poll";
import { enqueue, isLastAttempt, type Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { logger } from "../logger";
import {
  padAudioStart,
  probe,
  probeColorTags,
  alignmentOffset,
  meanRgb,
  rgbSeries,
  retagBt709Limited,
  sliceAudioFrom,
  thumbnail,
  type ProbeResult,
} from "../media/ffmpeg";
import { gradeCurve, type GradeCurve } from "../media/grade";
import { SFX_DIR, WORK_DIR } from "../paths";
import {
  getLipsyncProvider,
  lipsyncExpressivenessSchema,
  lipsyncResolutionSchema,
  MAX_LIPSYNC_SECONDS,
  type LipsyncResolution,
} from "../providers/lipsync";
import {
  renderVideo,
  type RenderServiceBProps,
  type RenderVideoProps,
  type TextSafeArea,
} from "../providers/remotion";
import { serviceBTimeline } from "../service-b-timeline";
import { getStorage, storageKey } from "../storage";
import { refundRenderIfNeeded } from "./credits";
import { stepClip } from "../plan-format";
import { planStepsSchema } from "./demo-step-plans";
import type { VariantParams } from "./sets";
import type { TextBlockRenderParams } from "./text-blocks";

/**
 * ~agorot per GPU second, by the resolution we pin on the submit body (HeyGen:
 * $0.0667/s of output video, the SAME price at 720p and 1080p — verified
 * against the published API pricing 2026-08; ≈ ₪3.75/$).
 */
export const GPU_COST_AGOROT_PER_SECOND: Record<LipsyncResolution, number> = {
  "720p": 25,
  "1080p": 25,
};

const DEFAULT_LIPSYNC_RESOLUTION: LipsyncResolution = "1080p";

/**
 * The one knob that shapes the HeyGen submit body — a plain app_config row
 * with no seed, so switching tiers is one INSERT, no deploy. (Both tiers cost
 * the same today; the knob exists for when that changes.)
 */
export async function lipsyncResolution(db: Db): Promise<LipsyncResolution> {
  return getConfigValueOr(
    db,
    "lipsync_resolution",
    lipsyncResolutionSchema,
    DEFAULT_LIPSYNC_RESOLUTION,
  );
}

/**
 * Leading silence prepended to the approved VO before a Service B lip-sync
 * submit. ~800ms is the ONE value the founder hand-tested — HeyGen Avatar IV
 * held the reference still through it; the tolerance is unmeasured
 * (docs/vault/facts/heygen-avatar-iv-idles-on-leading-silence.md). No seed:
 * a plain app_config row overrides it, no deploy.
 */
export const DEFAULT_LIPSYNC_LEAD_IN_MS = 800;

export async function lipsyncLeadInMs(db: Db): Promise<number> {
  return getConfigValueOr(
    db,
    "lipsync_lead_in_ms",
    z.number().int().nonnegative(),
    DEFAULT_LIPSYNC_LEAD_IN_MS,
  );
}

/**
 * DRY_RUN has no ffprobe, so one fake stands in for the stored clip's probe:
 * HeyGen's 1080p 9:16 output — 1080x1920, 25fps native.
 */
const DRY_RUN_PROBE: ProbeResult = {
  width: 1080,
  height: 1920,
  fps: 25,
  durationMs: 10_000,
  hasAudio: true,
};

/**
 * Service B step 1 (of 2): HeyGen lip-sync on the hosted API.
 * Submit checkpoints the provider job id BEFORE polling, so a retry resumes
 * polling instead of paying for a second GPU run. The finished clip is stored
 * as `lipsync.mp4` and goes straight to render_video — HeyGen returns 1080p,
 * so there is no upscale stage.
 */
export async function handleLipsync(job: Job, ctx: JobContext): Promise<JobResult> {
  const { videoRenderId } = job.payload as { videoRenderId: string };
  const render = await loadRender(ctx.db, videoRenderId);
  // A resurrected job (a dead row manually requeued) must not act on a render
  // that already ended — lip-syncing a failed+refunded render spends GPU money
  // on a video nobody is waiting for.
  if (TERMINAL_RENDER_STATUSES.includes(render.status)) return { kind: "done" };
  const params = render.params as VariantParams;
  const provider = getLipsyncProvider();
  const state = job.state as { providerJobId?: string; submittedAt?: number };

  try {
    if (!state.providerJobId) {
      // Backstop for the confirm-to-execution window — the real gate ran at
      // confirm (createSet / createBRender). Account-first, and it FAILS
      // (refund included) rather than parks: an abuse ceiling must never
      // leave the wizard spinning on a parked job.
      try {
        await assertAccountBudget(ctx.db, "gpu_seconds", render.businessId);
      } catch (err) {
        if (err instanceof AccountBudgetError) {
          throw new PermanentError(err.message, {
            customerMessage: "הגעתם למכסת יצירת הסרטונים היומית של החשבון — נסו שוב מחר",
          });
        }
        throw err;
      }
      await assertBudget(ctx.db, "gpu_seconds");
      const storage = getStorage();

      const audio = (
        await ctx.db
          .select()
          .from(audioRenders)
          .where(eq(audioRenders.id, params.audioRenderId!))
          .limit(1)
      )[0];
      if (!audio?.filePath) throw new PermanentError("audio render has no file");
      if (!audio.approvedAt) throw new PermanentError("audio is not approved (hard gate)");
      // HeyGen renders to the audio's length — a missing duration would make
      // the cost and the runaway guard below unknowable, so it fails here.
      if (!audio.durationMs) throw new PermanentError("audio render has no duration");

      // Service A avatar ending: lip-sync only the VO tail past the demo.
      // Slice at the word-gap boundary createSet chose, store the slice, and
      // submit that. Service B submits the whole approved VO behind a
      // lead-in of silence. Either way `audioMs` is the length HeyGen will
      // generate — and bill — so it feeds the runaway guard and the usage
      // row below. The customer's credit quote stays on the unpadded audio
      // (quoteBRender): the lead-in is our cost.
      let audioPath = audio.filePath;
      let audioMs = audio.durationMs;
      if (render.service === "a") {
        if (params.outroMode !== "avatar" || params.voSliceMs === undefined) {
          throw new PermanentError("service A lipsync requires an avatar outro decision");
        }
        audioMs = audio.durationMs - params.voSliceMs;
        if (audioMs <= 0) throw new PermanentError("VO slice is empty — nothing to lip-sync");
        const sliceKey = storageKey({
          businessId: render.businessId,
          entity: "audio",
          id: videoRenderId,
          filename: "vo-outro.mp3",
        });
        if (getEnv().DRY_RUN) {
          audioPath = await storage.put("renders", sliceKey, Buffer.from("DRY_RUN vo outro"));
        } else {
          const sliceDir = path.join(WORK_DIR, "lipsync", videoRenderId);
          const localVo = path.join(sliceDir, "vo.mp3");
          const localSlice = path.join(sliceDir, "vo-outro.mp3");
          await storage.download(audio.filePath, localVo);
          await sliceAudioFrom(localVo, localSlice, params.voSliceMs);
          audioPath = await storage.put("renders", sliceKey, localSlice);
        }
      } else {
        // HeyGen Avatar IV idles on the reference still only while the audio
        // is silent, and the opener's hard cut needs frame 0 to still look
        // like the reference. The value is pinned on params BEFORE submit:
        // Remotion assumes it later, so a config change after this point
        // must not move it — and a retry of this hop reuses the pinned value.
        const leadInMs = params.leadInMs ?? (await lipsyncLeadInMs(ctx.db));
        if (params.leadInMs === undefined) {
          await mergeParams(ctx.db, videoRenderId, { leadInMs });
        }
        audioMs = audio.durationMs + leadInMs;
        if (leadInMs > 0) {
          const paddedKey = storageKey({
            businessId: render.businessId,
            entity: "audio",
            id: videoRenderId,
            filename: "vo-padded.mp3",
          });
          if (getEnv().DRY_RUN) {
            audioPath = await storage.put("renders", paddedKey, Buffer.from("DRY_RUN vo padded"));
          } else {
            const padDir = path.join(WORK_DIR, "lipsync", videoRenderId);
            const localVo = path.join(padDir, "vo.mp3");
            const localPadded = path.join(padDir, "vo-padded.mp3");
            await storage.download(audio.filePath, localVo);
            await padAudioStart(localVo, localPadded, leadInMs);
            audioPath = await storage.put("renders", paddedKey, localPadded);
          }
        }
      }
      if (audioMs > MAX_LIPSYNC_SECONDS * 1000) {
        // Runaway-cost guard, not a product limit (see MAX_LIPSYNC_SECONDS).
        throw new PermanentError(
          `audio is ${Math.ceil(audioMs / 1000)}s — over the ${MAX_LIPSYNC_SECONDS}s runaway-cost guard`,
          { customerMessage: "אורך האודיו חורג מהמגבלה לעיבוד — פנו לתמיכה" },
        );
      }

      const resolution = await lipsyncResolution(ctx.db);
      // Motion knobs: render param (CLI flag) > app_config > unset. Unset
      // means the field is absent from the submit body entirely.
      const motionPrompt =
        params.motionPrompt ??
        (await getConfigValueOr(ctx.db, "lipsync_motion_prompt", z.string(), undefined));
      const expressiveness =
        params.expressiveness ??
        (await getConfigValueOr(
          ctx.db,
          "lipsync_expressiveness",
          lipsyncExpressivenessSchema,
          undefined,
        ));

      // Source image: an approved composite takes precedence (hard gate),
      // then an explicit persona image, then the persona's default image.
      let imagePath: string;
      if (params.compositeId) {
        const composite = (
          await ctx.db
            .select()
            .from(composites)
            .where(eq(composites.id, params.compositeId))
            .limit(1)
        )[0];
        if (!composite?.outputPath) throw new PermanentError("composite has no output image");
        if (!composite.approvedAt) {
          throw new PermanentError("composite is not approved (hard gate)");
        }
        imagePath = composite.outputPath;
      } else if (params.personaImageId) {
        const image = (
          await ctx.db
            .select()
            .from(personaImages)
            .where(eq(personaImages.id, params.personaImageId))
            .limit(1)
        )[0];
        if (!image) throw new PermanentError("persona image not found");
        imagePath = image.filePath;
      } else if (params.personaId) {
        const image = (
          await ctx.db
            .select()
            .from(personaImages)
            .where(
              // A stranded "pending" placeholder (no "/") must never be signed,
              // even if it carries the default flag. Retired images are out of
              // the fallback too (belt over the cannot-retire-default guard).
              and(
                eq(personaImages.personaId, params.personaId),
                eq(personaImages.isDefault, true),
                eq(personaImages.retired, false),
                like(personaImages.filePath, "%/%"),
              ),
            )
            .limit(1)
        )[0];
        if (!image) {
          throw new PermanentError(
            "persona has no reference images — add one with `aiugc persona add-image`",
            { customerMessage: "לדמות שנבחרה אין עדיין תמונות מוכנות — פנו לתמיכה" },
          );
        }
        imagePath = image.filePath;
      } else {
        throw new PermanentError("service B params name no composite, persona image, or persona");
      }

      const { providerJobId } = await provider.submit({
        imageUrl: await storage.signedUrl(imagePath, 3600),
        audioUrl: await storage.signedUrl(audioPath, 3600),
        resolution,
        ...(motionPrompt !== undefined && { motionPrompt }),
        ...(expressiveness !== undefined && { expressiveness }),
      });
      const gpuSeconds = Math.ceil(audioMs / 1000);
      await recordUsage(ctx.db, {
        provider: "heygen",
        kind: "gpu_seconds",
        quantity: gpuSeconds,
        costEstimateAgorot: gpuSeconds * GPU_COST_AGOROT_PER_SECOND[resolution],
        jobId: job.id,
        businessId: render.businessId,
      });
      const submittedAt = Date.now();
      await ctx.checkpoint({ providerJobId, submittedAt });
      return { kind: "reschedule", delayMs: 15_000, state: { providerJobId, submittedAt } };
    }

    const result = await provider.poll(state.providerJobId);
    if (result.status === "pending") {
      // submittedAt ?? now backfills state written before the deadline existed.
      const submittedAt = state.submittedAt ?? Date.now();
      await assertPollDeadline(ctx.db, ctx.log, {
        providerJobId: state.providerJobId,
        submittedAt,
      });
      return { kind: "reschedule", delayMs: 15_000, state: { ...state, submittedAt } };
    }
    if (result.status === "failed") {
      throw new PermanentError(`lipsync failed: ${result.reason}`, {
        customerMessage: "יצירת הדמות המדברת נכשלה — נסו שוב",
      });
    }

    const localDir = path.join(WORK_DIR, "lipsync", videoRenderId);
    mkdirSync(localDir, { recursive: true });
    const localClip = path.join(localDir, "lipsync.mp4");
    if (result.videoUrl.startsWith("dryrun://")) {
      writeFileSync(localClip, "DRY_RUN placeholder lipsync clip");
    } else {
      // HeyGen's video_url is a short-lived presigned URL; on a transient
      // download failure the retry re-polls and gets a freshly signed one.
      const response = await fetch(result.videoUrl);
      if (!response.ok) throw new TransientError(`lipsync download failed: ${response.status}`);
      writeFileSync(localClip, Buffer.from(await response.arrayBuffer()));
    }

    // The clip's own metadata is what goes downstream — Remotion reads the
    // frame count off this exact file. The log is the 1080x1920 sanity check.
    const clip = getEnv().DRY_RUN ? DRY_RUN_PROBE : await probe(localClip);
    ctx.log.info(
      { width: clip.width, height: clip.height, durationMs: clip.durationMs },
      "lipsync: probed the talking head clip",
    );

    const lipsyncPath = await getStorage().put(
      "renders",
      storageKey({
        businessId: render.businessId,
        entity: "video",
        id: videoRenderId,
        filename: "lipsync.mp4",
      }),
      localClip,
    );
    await mergeParams(ctx.db, videoRenderId, { lipsyncPath });
    await enqueueRenderVideo(ctx.db, videoRenderId);
    return { kind: "done" };
  } catch (err) {
    await failRenderOnTerminal(ctx.db, videoRenderId, err, job);
    throw err;
  }
}

async function enqueueRenderVideo(db: Db, videoRenderId: string): Promise<void> {
  await enqueue(db, {
    type: "render_video",
    idempotencyKey: `render:${videoRenderId}`,
    payload: { videoRenderId },
  });
}

/** Merge keys into the render's params jsonb — never replace the object. */
async function mergeParams(
  db: Db,
  videoRenderId: string,
  patch: Partial<VariantParams>,
): Promise<void> {
  const render = await loadRender(db, videoRenderId);
  await db
    .update(videoRenders)
    .set({ params: { ...(render.params as VariantParams), ...patch }, updatedAt: new Date() })
    .where(eq(videoRenders.id, videoRenderId));
}

/**
 * Remotion assembly. Service A releases immediately; Service B lands in the
 * founder QC queue unless app_config.auto_release_b is flipped.
 */
export async function handleRenderVideo(job: Job, ctx: JobContext): Promise<JobResult> {
  const { videoRenderId } = job.payload as { videoRenderId: string };
  const render = await loadRender(ctx.db, videoRenderId);
  // Same resurrection guard as handleLipsync — and here it is also what keeps
  // the release path from overwriting a failed render: a requeued job that
  // "succeeds" on a refunded render would ship a free video.
  if (TERMINAL_RENDER_STATUSES.includes(render.status)) return { kind: "done" };

  try {
    await ctx.db
      .update(videoRenders)
      .set({ status: "rendering", updatedAt: new Date() })
      .where(eq(videoRenders.id, videoRenderId));

    // Clear any renderProgress a FAILED prior attempt checkpointed:
    // failTransient/claim/lease-recovery all keep jobs.state, so without this
    // a retry that died at 95% shows the customer "95%" for the whole
    // re-download/re-bundle window and then collapses to 0 — stale progress
    // presented as current, the exact lie this surface exists to remove.
    await ctx.checkpoint({});

    const localDir = path.join(WORK_DIR, "render", videoRenderId);
    mkdirSync(localDir, { recursive: true });
    const format = (render.params as VariantParams).format;
    const props =
      render.service === "a"
        ? format === "steps"
          ? await buildServiceAStepsProps(ctx.db, render, localDir)
          : await buildServiceAProps(ctx.db, render, localDir)
        : render.service === "c"
          ? await buildServiceCProps(ctx.db, render, localDir)
          : await buildServiceBProps(ctx.db, render, localDir);

    const outPath = path.join(localDir, "final.mp4");
    // Whole percents on the job's state jsonb, throttled — renderMedia calls
    // this many times a second and the customer poll reads every 2.5s.
    // Fire-and-forget with a swallowed error: a DB blip must never sink a
    // paid render. Idempotency holds: render_video keeps no other state and
    // never reads it on entry, so a crash-retry just overwrites the fraction.
    let lastPct = -1;
    let lastWriteAt = 0;
    const onProgress = (fraction: number) => {
      const pct = Math.floor(fraction * 100);
      if (pct <= lastPct || Date.now() - lastWriteAt < 2_000) return;
      lastPct = pct;
      lastWriteAt = Date.now();
      void ctx.checkpoint({ renderProgress: fraction }).catch(() => {});
    };
    await renderVideo(props, outPath, onProgress);

    const storage = getStorage();
    const localThumb = path.join(localDir, "thumb.jpg");
    // The mp4 upload and the thumbnail grab both only READ outPath — run them
    // together so the ffmpeg second rides inside the upload's network time.
    const [filePath] = await Promise.all([
      storage.put(
        "renders",
        storageKey({
          businessId: render.businessId,
          entity: "video",
          id: videoRenderId,
          filename: "final.mp4",
        }),
        outPath,
      ),
      getEnv().DRY_RUN ? Promise.resolve() : thumbnail(outPath, localThumb),
    ]);

    let thumbPath: string | undefined;
    if (!getEnv().DRY_RUN) {
      thumbPath = await storage.put(
        "renders",
        storageKey({
          businessId: render.businessId,
          entity: "thumb",
          id: videoRenderId,
          filename: "thumb.jpg",
        }),
        localThumb,
      );
    }

    const autoReleaseB = await getConfigValue(ctx.db, "auto_release_b", z.boolean());
    // Service A and Service C release unconditionally; only B has a QC gate,
    // and that gate is the config flag (vault 0036; Service C per 0089).
    const released = render.service === "a" || render.service === "c" || autoReleaseB;
    await ctx.db
      .update(videoRenders)
      .set({
        status: released ? "released" : "qc_pending",
        releasedAt: released ? new Date() : null,
        filePath,
        thumbPath,
        updatedAt: new Date(),
      })
      .where(eq(videoRenders.id, videoRenderId));
    return { kind: "done" };
  } catch (err) {
    await failRenderOnTerminal(ctx.db, videoRenderId, err, job);
    throw err;
  }
}

async function buildServiceAProps(
  db: Db,
  render: typeof videoRenders.$inferSelect,
  localDir: string,
): Promise<RenderVideoProps> {
  const params = render.params as VariantParams;
  const storage = getStorage();

  if (!render.setId) throw new PermanentError("service A render has no set");
  const set = (await db.select().from(sets).where(eq(sets.id, render.setId)).limit(1))[0]!;
  const demo = (await db.select().from(demos).where(eq(demos.id, set.demoId!)).limit(1))[0];
  if (!demo?.normalizedPath) throw new PermanentError("demo has no normalized file");

  const hookClip = (
    await db.select().from(hookClips).where(eq(hookClips.id, params.hookClipId)).limit(1)
  )[0];
  if (!hookClip) throw new PermanentError("hook clip not found");

  const hookLine = (
    await db.select().from(scripts).where(eq(scripts.id, params.hookLineScriptId)).limit(1)
  )[0];
  if (!hookLine) throw new PermanentError("hook line script not found");

  const demoPath = path.join(localDir, "demo.mp4");
  const hookClipPath = path.join(localDir, "hook.mp4");
  // Independent files, concurrent fetch — sequential awaits here were pure
  // wall-clock waste on every render.
  await Promise.all([
    storage.download(demo.normalizedPath, demoPath),
    storage.download(hookClip.filePath, hookClipPath),
  ]);

  let captions: CaptionChunk[];
  let voiceoverPath: string | undefined;
  if (params.mode === "voiced") {
    const audio = (
      await db
        .select()
        .from(audioRenders)
        .where(eq(audioRenders.id, params.audioRenderId!))
        .limit(1)
    )[0];
    if (!audio?.approvedAt) throw new PermanentError("audio is not approved (hard gate)");
    if (!audio.filePath || !audio.wordTimestamps) {
      throw new PermanentError("audio render is missing file or word timestamps");
    }
    captions = audio.wordTimestamps as CaptionChunk[];
    voiceoverPath = path.join(localDir, "vo.mp3");
    await storage.download(audio.filePath, voiceoverPath);
  } else {
    const captionScript = (
      await db.select().from(scripts).where(eq(scripts.id, params.captionScriptId!)).limit(1)
    )[0];
    if (!captionScript) throw new PermanentError("caption script not found");
    const lines = (captionScript.params as { lines?: string[] }).lines ?? [];
    captions = evenlySpacedCaptions(lines, demo.durationMs ?? 0);
  }

  // Avatar ending: the stored HeyGen clip becomes the muted outro segment.
  let avatarPath: string | undefined;
  if (params.outroMode === "avatar") {
    if (!params.lipsyncPath) throw new PermanentError("avatar ending has no lipsync clip yet");
    if (params.voSliceMs === undefined) {
      throw new PermanentError("avatar ending has no VO slice offset");
    }
    avatarPath = path.join(localDir, "avatar.mp4");
    await storage.download(params.lipsyncPath, avatarPath);
    avatarPath = await retagIfUntagged(avatarPath, path.join(localDir, "avatar-tagged.mp4"));
  }

  return {
    kind: "service_a",
    outroMode:
      params.outroMode === "avatar" || params.outroMode === "freeze" ? params.outroMode : undefined,
    voSliceMs: params.voSliceMs,
    avatarPath,
    hookClipPath,
    hookLine: hookLine.text,
    hookTextSafeArea: resolveHookTextSafeArea(
      params.textSafeArea,
      hookClip.textSafeArea as TextSafeArea,
    ),
    demoPath,
    demoDurationMs: demo.durationMs ?? 0,
    voiceoverPath,
    watermark: render.watermarked,
    // Last on purpose: the DRY_RUN render echoes a prefix of these props, and
    // captions are the one unbounded field.
    captions,
  };
}

/**
 * Steps format: the approved plan becomes trims + labels over the one
 * normalized demo file. Silent by design — no VO, no captions, no audio
 * lookups at all; the composition mounts the demo N times with different
 * trims, so this downloads exactly two files.
 */
async function buildServiceAStepsProps(
  db: Db,
  render: typeof videoRenders.$inferSelect,
  localDir: string,
): Promise<RenderVideoProps> {
  const params = render.params as VariantParams;
  const storage = getStorage();

  if (!render.setId) throw new PermanentError("service A render has no set");
  const set = (await db.select().from(sets).where(eq(sets.id, render.setId)).limit(1))[0]!;
  const demo = (await db.select().from(demos).where(eq(demos.id, set.demoId!)).limit(1))[0];
  if (!demo?.normalizedPath) throw new PermanentError("demo has no normalized file");

  const hookClip = (
    await db.select().from(hookClips).where(eq(hookClips.id, params.hookClipId)).limit(1)
  )[0];
  if (!hookClip) throw new PermanentError("hook clip not found");

  const hookLine = (
    await db.select().from(scripts).where(eq(scripts.id, params.hookLineScriptId)).limit(1)
  )[0];
  if (!hookLine) throw new PermanentError("hook line script not found");

  if (!params.stepPlanId) throw new PermanentError("steps render has no stepPlanId");
  const plan = (
    await db.select().from(demoStepPlans).where(eq(demoStepPlans.id, params.stepPlanId)).limit(1)
  )[0];
  if (!plan) throw new PermanentError("step plan not found");
  // The hard gate, re-checked at render time exactly like audio approval.
  if (!plan.approvedAt) throw new PermanentError("step plan is not approved (hard gate)");
  // Malformed steps fail identically on every retry — permanent, like any
  // other bad render input (only DB corruption gets here; plans are
  // validated at write).
  const parsedSteps = planStepsSchema.safeParse(plan.steps);
  if (!parsedSteps.success) throw new PermanentError("step plan has malformed steps");
  const steps = parsedSteps.data;

  const demoPath = path.join(localDir, "demo.mp4");
  const hookClipPath = path.join(localDir, "hook.mp4");
  // Independent files, concurrent fetch — same as buildServiceAProps.
  await Promise.all([
    storage.download(demo.normalizedPath, demoPath),
    storage.download(hookClip.filePath, hookClipPath),
  ]);

  return {
    kind: "service_a_steps",
    hookClipPath,
    hookLine: hookLine.text,
    hookTextSafeArea: resolveHookTextSafeArea(
      params.textSafeArea,
      hookClip.textSafeArea as TextSafeArea,
    ),
    // Off the clip row, never params: the founder sets the colour per clip
    // (decision 0073) and nothing on the customer path can carry it. Before
    // demoPath and steps so the DRY_RUN echo's 2000-char prefix keeps it; an
    // unknown name is undefined, which burns today's white.
    hookTextInk: HOOK_TEXT_INK[hookClip.textColor as HookTextColor],
    demoPath,
    // stepClip is the one reading of a stored step, shared with the editor's
    // preview: its 2 s clip, or — a plan stored before steps had clips — its
    // moment and the length it was saved with, exactly as it always rendered.
    steps: steps.map((s) => ({ ...stepClip(s), label: s.label })),
    watermark: render.watermarked,
  };
}

/**
 * Service C, גוש טקסט: the bank clip played once under the text pinned on the
 * render (text-blocks.ts). The clip's colour is read off its row, never
 * params, like the steps hook line (decision 0073).
 */
async function buildServiceCProps(
  db: Db,
  render: typeof videoRenders.$inferSelect,
  localDir: string,
): Promise<RenderVideoProps> {
  const params = render.params as TextBlockRenderParams;
  if (!params.text || !params.textSafeArea) {
    throw new PermanentError("text block render has no text or no rect");
  }
  const clip = (
    await db
      .select()
      .from(textBlockClips)
      .where(eq(textBlockClips.id, params.textBlockClipId))
      .limit(1)
  )[0];
  if (!clip) throw new PermanentError("text block clip not found");
  if (!clip.filePath.includes("/")) throw new PermanentError("text block clip has no file");

  const clipPath = path.join(localDir, "clip.mp4");
  await getStorage().download(clip.filePath, clipPath);

  return {
    kind: "service_c",
    clipPath,
    text: params.text,
    textSafeArea: params.textSafeArea,
    textInk: HOOK_TEXT_INK[clip.textColor as HookTextColor],
    watermark: render.watermarked,
  };
}

async function buildServiceBProps(
  db: Db,
  render: typeof videoRenders.$inferSelect,
  localDir: string,
): Promise<RenderVideoProps> {
  const params = render.params as VariantParams;
  // Written by handleLipsync: the stored HeyGen clip. Remotion reads the frame
  // count off this file.
  if (!params.lipsyncPath) throw new PermanentError("service B render has no lipsync clip yet");

  // Same karaoke chunks the voiced Service A variant burns (chunkWords output
  // stored on the audio render). A talking head without captions is not a
  // shippable ad — missing timestamps fail the render rather than degrade it.
  const audio = (
    await db.select().from(audioRenders).where(eq(audioRenders.id, params.audioRenderId!)).limit(1)
  )[0];
  if (!audio?.approvedAt) throw new PermanentError("audio is not approved (hard gate)");
  if (!audio.wordTimestamps) {
    throw new PermanentError("audio render is missing word timestamps");
  }
  if (!audio.filePath) throw new PermanentError("audio render has no file");
  if (!audio.durationMs) throw new PermanentError("audio render has no duration");
  const captions = audio.wordTimestamps as CaptionChunk[];

  // The opener effect: the bank clip, the FINAL hook text and its rect were
  // all copied onto params at enqueue (vault 0017) — nothing is re-derived.
  let opener: typeof openerClips.$inferSelect | undefined;
  if (params.openerClipId) {
    opener = (
      await db.select().from(openerClips).where(eq(openerClips.id, params.openerClipId)).limit(1)
    )[0];
    if (!opener) throw new PermanentError("opener clip not found");
  }
  // The composition burns the line only with BOTH the text and a rect, and
  // silently shows neither text nor captions without them. createBRender pairs
  // them at enqueue, so this only fires on a row edited by hand.
  if (params.hookText !== undefined && params.hookTextSafeArea === undefined) {
    throw new PermanentError("hook text has no safe area on its params");
  }
  if (params.openerClipId && params.hookText === undefined) {
    throw new PermanentError("opener render has no hook text on its params");
  }

  // The approved mp3 becomes the render's audio track — the same bytes the
  // customer approved and the same file these timestamps were computed against.
  // The lip-sync clip's own audio (HeyGen's re-encode of this mp3) is muted.
  const voiceoverPath = path.join(localDir, "vo.mp3");
  let talkingHeadPath = path.join(localDir, "talking-head.mp4");
  let openerPath = opener ? path.join(localDir, "opener.mp4") : undefined;
  await Promise.all([
    getStorage().download(audio.filePath, voiceoverPath),
    getStorage().download(params.lipsyncPath, talkingHeadPath),
    opener && openerPath ? getStorage().download(opener.filePath, openerPath) : undefined,
  ]);
  // HeyGen generated to the PADDED audio; the layout needs the clip's real
  // length (probed before the stream-copy retag, which does not change it).
  const clip = getEnv().DRY_RUN ? DRY_RUN_PROBE : await probe(talkingHeadPath);
  talkingHeadPath = await retagIfUntagged(
    talkingHeadPath,
    path.join(localDir, "talking-head-tagged.mp4"),
  );
  if (openerPath) {
    openerPath = await retagIfUntagged(openerPath, path.join(localDir, "opener-tagged.mp4"));
  }

  const timeline = serviceBTimeline({
    hasOpener: opener !== undefined,
    openerDurationMs: opener?.durationMs,
    revealAtMs: opener?.revealAtMs,
    hookText: params.hookText,
    // A hook animation's line leaves at the caption handoff, so the layout
    // needs the chunks. Ignored on the opener path, which uses read time.
    captions,
    // Absent on a render lip-synced before the lead-in existed: the clip
    // then starts at 0 with the VO, exactly as it did.
    leadInMs: params.leadInMs ?? 0,
    lipsyncDurationMs: clip.durationMs,
    voDurationMs: audio.durationMs,
  });

  // Colour: the cut leaves the opener's reveal frame and lands on the talking
  // head — two generations of one selfie that never come back at the same
  // exposure, and HeyGen's idle frame is darker and cooler than its own
  // talking frames a second later. A per-channel gain curve (media/grade.ts)
  // holds the head's colour at the opener's through the first seconds and
  // then settles; the composition applies it as a colour matrix. Measured on
  // the head box, where the cut is judged. Best-effort, like the retag above:
  // a measurement failure must never sink a render the GPU has been paid for.
  let talkingHeadGrade: GradeCurve | undefined;
  // Geometry: the two frames the cut joins are near-identical poses, but the
  // generations do not land at the same place — 8px apart on the first real
  // render, which reads as a jump cut. The head is measured against the
  // opener and offset into alignment for its whole length (no ease: a drift
  // after the cut is itself visible).
  let talkingHeadAlign: { dx: number; dy: number } | undefined;
  if (opener && openerPath && !getEnv().DRY_RUN) {
    try {
      const [target, series, align] = await Promise.all([
        meanRgb(openerPath, opener.revealAtMs, HEAD_BOX),
        rgbSeries(talkingHeadPath, timeline.lipsyncStartFromMs, GRADE_SERIES_FRAMES, HEAD_BOX),
        alignmentOffset(
          openerPath,
          opener.revealAtMs,
          talkingHeadPath,
          timeline.lipsyncStartFromMs,
        ),
      ]);
      talkingHeadGrade = gradeCurve(target, series, clip.fps);
      // Inside what the overscan hides under the sway; a bigger answer is a
      // wrong match, not a bigger correction.
      if (Math.abs(align.dx) <= ALIGN_MAX_PX.dx && Math.abs(align.dy) <= ALIGN_MAX_PX.dy) {
        talkingHeadAlign = align;
      }
      logger[talkingHeadGrade ? "info" : "warn"](
        {
          videoRenderId: render.id,
          target,
          first: series[0],
          frames: series.length,
          graded: talkingHeadGrade !== undefined,
          align,
          aligned: talkingHeadAlign !== undefined,
        },
        "render: talking-head grade and alignment against the opener's reveal frame",
      );
    } catch (err) {
      logger.warn(
        { err, videoRenderId: render.id },
        "render: talking-head grade not measured — rendering ungraded",
      );
    }
  }

  return {
    kind: "service_b",
    // The handheld camera path is seeded by the row, so a retry — or a
    // resumed chunk — re-renders the very same frames.
    cameraSeed: render.id,
    talkingHeadPath,
    voiceoverPath,
    brollPaths: [], // product B-roll cutaways: wired when the composition lands
    openerPath,
    hookText: params.hookText,
    hookTextSafeArea: params.hookTextSafeArea,
    timeline,
    talkingHeadGrade,
    talkingHeadAlign,
    ...hookAnimationProps(params.hookEffect, timeline.captionOffsetMs, opener !== undefined),
    watermark: render.watermarked,
    // Last on purpose: the DRY_RUN render echoes a prefix of these props, and
    // captions are the one unbounded field.
    captions,
  };
}

/**
 * Name -> the composition prop: the numbers from @aiugc/core's hook-effect
 * module (one home, shared with the wizard's preview), with the SFX resolved
 * off disk here because only the worker has the files. A name this build does
 * not know renders with no animation and never throws — QC regeneration
 * replays old params wholesale (pipelines/qc.ts), so a renamed effect from an
 * older deploy would otherwise fail a render the customer has already paid
 * HeyGen for. Same reason a missing wav only drops the sound.
 */
function hookAnimationProps(
  effect: string | undefined,
  captionOffsetMs: number,
  hasOpener: boolean,
): Partial<Pick<RenderServiceBProps, "hookZoom" | "hookFocus" | "hookWhip">> {
  if (hasOpener && isHookAnimation(effect)) {
    // Refused at enqueue; a hand-edited row could still get here, and the
    // composition would refuse the pair AFTER the GPU was billed.
    logger.warn({ effect }, "render: hook animation ignored — this render has an opener");
    return {};
  }
  const animation = hookAnimation(effect, captionOffsetMs);
  if (animation.zoom) {
    return { hookZoom: { ...animation.zoom, sfxPath: sfxPath("hook-zoom-whoosh.wav") } };
  }
  if (animation.focus) return { hookFocus: animation.focus };
  if (animation.whip) {
    return { hookWhip: { ...animation.whip, sfxPath: sfxPath("hook-whip-swish.wav") } };
  }
  return {};
}

/**
 * A tracked SFX file, or undefined if it is not on this box. renderServiceB
 * refuses a missing input file, which the worker maps to a PERMANENT failure
 * and a refund — after HeyGen has been billed. A silent whoosh is strictly
 * better than a dead paid render, so a missing wav degrades and says so.
 */
function sfxPath(file: string): string | undefined {
  const full = path.join(SFX_DIR, file);
  if (existsSync(full)) return full;
  logger.warn({ file }, "render: hook SFX missing — rendering the animation silently");
  return undefined;
}

/**
 * Where the talking-head grade is measured: the upper-middle of the frame,
 * where a selfie's head sits. HeyGen and the opener's generator redistribute
 * brightness between head and torso differently (measured 2026-09-05 on the
 * first real render: matched whole-frame, the face still read +2.4% and the
 * founder saw it), and the cut is judged on the face.
 */
const HEAD_BOX = "crop=iw/2:ih*2/5:iw/4:ih/10";
/** Six seconds of the head at 30fps — the lock, the blend and a stretch for the settled level. */
const GRADE_SERIES_FRAMES = 180;
/**
 * The alignment offset the composition can hide for the head's whole length.
 * Measured in picture px (the translate sits inside scale(OVERSCAN)): 1.06
 * leaves 30.6px horizontally / 54.3px vertically before the sway, and the sway
 * plus its rotation take up to ~17px of the horizontal margin on the tightest
 * frame of a random seed (300 seeds × 3600 frames, 2026-09-06: tightest 13.5px
 * x, 42.3px y; 65 seeds dipped under 16, none under 12). The search answers in
 * 4px steps, so 12 is the largest safe answer — vault service-b-seam-constants.
 */
const ALIGN_MAX_PX = { dx: 12, dy: 32 };

/**
 * Provider clips (HeyGen) arrive with every colour field unset (probed on a
 * real released render), leaving Remotion's decoder to guess how to interpret
 * the pixels. Pin the truthful interpretation — BT.709 limited range — with a
 * stream-copy retag. Best-effort: a retag failure must never sink a render
 * the GPU has already been paid for.
 */
async function retagIfUntagged(clipPath: string, retaggedPath: string): Promise<string> {
  if (getEnv().DRY_RUN) return clipPath;
  try {
    const tags = await probeColorTags(clipPath);
    if (!tags.colorRange || !tags.colorSpace || !tags.colorPrimaries || !tags.colorTransfer) {
      await retagBt709Limited(clipPath, retaggedPath);
      return retaggedPath;
    }
  } catch (err) {
    logger.warn({ err }, "render: colour retag failed — using the untagged clip");
  }
  return clipPath;
}

async function loadRender(db: Db, videoRenderId: string) {
  const rows = await db
    .select()
    .from(videoRenders)
    .where(eq(videoRenders.id, videoRenderId))
    .limit(1);
  if (!rows[0]) throw new PermanentError(`video render ${videoRenderId} not found`);
  return rows[0];
}

/**
 * What the customer reads when a render's job exhausts its retries. The raw
 * transient error (stack traces, provider payloads) stays on jobs.last_error —
 * video_renders.error is displayable by construction.
 */
export const RENDER_RETRIES_EXHAUSTED_MESSAGE =
  "יצירת הסרטון נכשלה בגלל תקלה חוזרת בעיבוד — נסו שוב מאוחר יותר.";

/**
 * What the customer reads when a PermanentError carries no customerMessage.
 * Together with the two named strings above, these are the ONLY values that
 * ever reach video_renders.error — Hebrew by construction; diagnostics stay
 * on jobs.last_error.
 */
export const RENDER_FAILED_MESSAGE = "יצירת הסרטון נכשלה — נסו שוב.";

/** What the customer reads when the max-park-age valve kills a parked render. */
export const RENDER_PARK_EXPIRED_MESSAGE =
  "יצירת הסרטון התעכבה מעבר לסביר בגלל תקלה אצלנו — נסו שוב מאוחר יותר.";

/**
 * The same valve, for the work that is NOT a render — a parked analysis, step
 * plan, audio preview or composite (janitor.ts). It lives beside its sibling so
 * the two park messages are edited together, but it never reaches
 * video_renders.error: its targets are demo_analyses.fail_reason,
 * demo_step_plans.fail_reason, audio_renders.error and composites.error, so the
 * closed set documented above is unchanged.
 *
 * One string for four job types on purpose. The customer is told the same true
 * thing in every case — the wait outlived what we will make them wait — and
 * which of our internal steps it was is not information they can act on. Naming
 * the step would also make this the only place in the codebase where a park
 * message has to be kept in step with a job-type list.
 */
export const WORK_PARK_EXPIRED_MESSAGE =
  "העיבוד התעכב מעבר לסביר בגלל תקלה אצלנו — נסו שוב מאוחר יותר.";

/** events.kind: a dying render's refund landed on an ancestor's debit. */
export const REFUND_RESOLVED_TO_ANCESTOR = "refund_resolved_to_ancestor";

const TERMINAL_RENDER_STATUSES = ["released", "failed", "rejected"];

/** Chains are unbounded in principle, empty in practice — 10 is generous. */
const REFUND_WALK_MAX_DEPTH = 10;

/**
 * The debit sits on the chain's root: QC regenerations are never debited
 * (rejectRender), so a dying regeneration must refund through regenerated_from.
 * Walks until a debit turns up; past the depth cap (or on a cycle) it falls
 * back to the render itself — the refund no-ops — and logs, so a silent
 * non-refund is never mistaken for a clean one.
 */
async function resolveDebitBearingRender(
  db: Db,
  render: Pick<typeof videoRenders.$inferSelect, "id" | "regeneratedFrom">,
): Promise<string> {
  let current = render;
  const visited = new Set([render.id]);
  for (let depth = 0; depth < REFUND_WALK_MAX_DEPTH; depth++) {
    const debit = await db
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(and(eq(creditLedger.refId, current.id), eq(creditLedger.reason, "debit_render")))
      .limit(1);
    if (debit[0]) return current.id;
    if (!current.regeneratedFrom) return render.id;

    const parent = (
      await db
        .select({ id: videoRenders.id, regeneratedFrom: videoRenders.regeneratedFrom })
        .from(videoRenders)
        .where(eq(videoRenders.id, current.regeneratedFrom))
        .limit(1)
    )[0];
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);
    current = parent;
  }
  logger.warn(
    { videoRenderId: render.id, depth: visited.size },
    "refund walk gave up (depth cap or cycle) — refunding against the render itself",
  );
  return render.id;
}

/**
 * Terminal mark shared by every path that kills a render: the permanent path,
 * the last transient attempt, and the dead-job reaper. One transaction, so the
 * customer can never read `failed` while the balance hasn't moved, and
 * refunded_at can never disagree with the ledger. When the refund lands on an
 * ancestor (QC regeneration chain), an events row records both ids — the money
 * trail is never implicit. Skips renders already terminal. Returns true when
 * it marked the render.
 */
export async function failRenderAndRefund(
  db: Db,
  videoRenderId: string,
  message: string,
): Promise<boolean> {
  const render = (
    await db.select().from(videoRenders).where(eq(videoRenders.id, videoRenderId)).limit(1)
  )[0];
  if (!render || TERMINAL_RENDER_STATUSES.includes(render.status)) return false;
  return db.transaction(async (tx) => {
    const debitBearerId = await resolveDebitBearingRender(tx as Db, render);
    const refunded = await refundRenderIfNeeded(tx as Db, debitBearerId);
    if (refunded && debitBearerId !== videoRenderId) {
      await tx.insert(events).values({
        kind: REFUND_RESOLVED_TO_ANCESTOR,
        businessId: render.businessId,
        subjectType: "video_render",
        subjectId: videoRenderId,
        payload: { refundedRenderId: debitBearerId },
      });
    }
    await tx
      .update(videoRenders)
      .set({
        status: "failed",
        error: message,
        ...(refunded ? { refundedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(videoRenders.id, videoRenderId));
    return true;
  });
}

/**
 * Handler-side terminal mapping, called from the render handlers' catch before
 * rethrowing: a PermanentError fails the render now with its Hebrew customer
 * message (generic when it carries none — the diagnostic stays on
 * jobs.last_error); the LAST transient attempt fails it with the fixed Hebrew
 * string. A budget park or a transient attempt with retries left leaves the
 * render alone — the job isn't dead.
 */
async function failRenderOnTerminal(
  db: Db,
  videoRenderId: string,
  err: unknown,
  job: Job,
): Promise<void> {
  if (err instanceof PermanentError) {
    await failRenderAndRefund(db, videoRenderId, err.customerMessage ?? RENDER_FAILED_MESSAGE);
  } else if (!(err instanceof BudgetError) && isLastAttempt(job)) {
    await failRenderAndRefund(db, videoRenderId, RENDER_RETRIES_EXHAUSTED_MESSAGE);
  }
}
