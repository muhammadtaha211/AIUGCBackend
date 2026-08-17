import { and, eq, like } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
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
  personaImages,
  scripts,
  sets,
  videoRenders,
} from "../db/schema";
import { resolveHookTextSafeArea } from "../hook-geometry";
import { BudgetError, PermanentError, TransientError } from "../jobs/errors";
import { assertPollDeadline } from "../jobs/poll";
import { enqueue, isLastAttempt, type Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { logger } from "../logger";
import {
  probe,
  probeColorTags,
  retagBt709Full,
  sliceAudioFrom,
  thumbnail,
  type ProbeResult,
} from "../media/ffmpeg";
import { WORK_DIR } from "../paths";
import {
  getLipsyncProvider,
  lipsyncExpressivenessSchema,
  lipsyncResolutionSchema,
  MAX_LIPSYNC_SECONDS,
  type LipsyncResolution,
} from "../providers/lipsync";
import { renderVideo, type RenderVideoProps, type TextSafeArea } from "../providers/remotion";
import { getStorage, storageKey } from "../storage";
import { refundRenderIfNeeded } from "./credits";
import { planStepsSchema } from "./demo-step-plans";
import type { VariantParams } from "./sets";

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
 * DRY_RUN has no ffprobe, so one fake stands in for the stored clip's probe:
 * HeyGen's 1080p 9:16 output — 1080x1920, 25fps native.
 */
const DRY_RUN_PROBE: ProbeResult = {
  width: 1080,
  height: 1920,
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
      // submit that. Service B submits the whole approved VO.
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

    const localDir = path.join(WORK_DIR, "render", videoRenderId);
    mkdirSync(localDir, { recursive: true });
    const format = (render.params as VariantParams).format;
    const props =
      render.service === "a"
        ? format === "steps"
          ? await buildServiceAStepsProps(ctx.db, render, localDir)
          : await buildServiceAProps(ctx.db, render, localDir)
        : await buildServiceBProps(ctx.db, render, localDir);

    const outPath = path.join(localDir, "final.mp4");
    await renderVideo(props, outPath);

    const storage = getStorage();
    const filePath = await storage.put(
      "renders",
      storageKey({
        businessId: render.businessId,
        entity: "video",
        id: videoRenderId,
        filename: "final.mp4",
      }),
      outPath,
    );

    let thumbPath: string | undefined;
    if (!getEnv().DRY_RUN) {
      const localThumb = path.join(localDir, "thumb.jpg");
      await thumbnail(outPath, localThumb);
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
    const released = render.service === "a" || autoReleaseB;
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
  await storage.download(demo.normalizedPath, demoPath);
  await storage.download(hookClip.filePath, hookClipPath);

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
  await storage.download(demo.normalizedPath, demoPath);
  await storage.download(hookClip.filePath, hookClipPath);

  return {
    kind: "service_a_steps",
    hookClipPath,
    hookLine: hookLine.text,
    hookTextSafeArea: resolveHookTextSafeArea(
      params.textSafeArea,
      hookClip.textSafeArea as TextSafeArea,
    ),
    demoPath,
    steps: steps.map((s) => ({ startMs: s.timestampMs, durationMs: s.durationMs, label: s.label })),
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
  const captions = audio.wordTimestamps as CaptionChunk[];

  // The approved mp3 becomes the render's audio track — the same bytes the
  // customer approved and the same file these timestamps were computed against.
  // The lip-sync clip's own audio (HeyGen's re-encode of this mp3) is muted.
  const voiceoverPath = path.join(localDir, "vo.mp3");
  await getStorage().download(audio.filePath, voiceoverPath);

  let talkingHeadPath = path.join(localDir, "talking-head.mp4");
  await getStorage().download(params.lipsyncPath, talkingHeadPath);
  talkingHeadPath = await retagIfUntagged(
    talkingHeadPath,
    path.join(localDir, "talking-head-tagged.mp4"),
  );

  return {
    kind: "service_b",
    talkingHeadPath,
    voiceoverPath,
    brollPaths: [], // product B-roll cutaways: wired when the composition lands
    captions,
    watermark: render.watermarked,
  };
}

/**
 * Provider clips (HeyGen) arrive with every colour field unset (probed on a
 * real released render), leaving Remotion's decoder to guess how to interpret
 * the pixels. Pin the truthful interpretation — BT.709 full range — with a
 * stream-copy retag. Best-effort: a retag failure must never sink a render
 * the GPU has already been paid for.
 */
async function retagIfUntagged(clipPath: string, retaggedPath: string): Promise<string> {
  if (getEnv().DRY_RUN) return clipPath;
  try {
    const tags = await probeColorTags(clipPath);
    if (!tags.colorRange || !tags.colorSpace || !tags.colorPrimaries || !tags.colorTransfer) {
      await retagBt709Full(clipPath, retaggedPath);
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
