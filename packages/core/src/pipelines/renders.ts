import { and, eq, like } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfigValue, getConfigValueOr } from "../appConfig";
import { assertBudget, recordUsage } from "../budget";
import { evenlySpacedCaptions, type CaptionChunk } from "../captions";
import { getEnv } from "../config";
import type { Db } from "../db";
import {
  audioRenders,
  composites,
  demos,
  hookClips,
  personaImages,
  personas,
  scripts,
  sets,
  videoRenders,
} from "../db/schema";
import { PermanentError, TransientError } from "../jobs/errors";
import { assertPollDeadline } from "../jobs/poll";
import { enqueue, type Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { probe, retagBt709Limited, thumbnail, type ProbeResult } from "../media/ffmpeg";
import { WORK_DIR } from "../paths";
import {
  framesForAudio,
  getLipsyncProvider,
  lipsyncResolutionSchema,
  type LipsyncResolution,
} from "../providers/lipsync";
import { renderVideo, type RenderVideoProps, type TextSafeArea } from "../providers/remotion";
import { getUpscaleProvider } from "../providers/upscale";
import { getStorage, storageKey } from "../storage";
import { refundRenderIfNeeded } from "./credits";
import type { VariantParams } from "./sets";

/**
 * ~agorot per GPU second, by the resolution we pin on the submit body (fal.ai
 * infinitalk: $0.20/s @480p, doubled to $0.40/s @720p — verified live
 * 2026-07-25; ≈ ₪3.75/$).
 */
export const GPU_COST_AGOROT_PER_SECOND: Record<LipsyncResolution, number> = {
  "480p": 75,
  "720p": 150,
};

const DEFAULT_LIPSYNC_FPS = 25;
const DEFAULT_LIPSYNC_RESOLUTION: LipsyncResolution = "720p";
/** 80ms @25fps of headroom over fal's "audio must outlast the frames" rule. */
const DEFAULT_LIPSYNC_SAFETY_FRAMES = 2;

/**
 * The three knobs that shape the fal submit body. All are plain app_config
 * rows with no seed, so dropping to 480p — or widening the safety margin after
 * another 422 — is one INSERT, no deploy.
 */
export async function lipsyncSettings(
  db: Db,
): Promise<{ fps: number; resolution: LipsyncResolution; safetyFrames: number }> {
  return {
    fps: await getConfigValueOr(db, "lipsync_fps", z.number().positive(), DEFAULT_LIPSYNC_FPS),
    resolution: await getConfigValueOr(
      db,
      "lipsync_resolution",
      lipsyncResolutionSchema,
      DEFAULT_LIPSYNC_RESOLUTION,
    ),
    safetyFrames: await getConfigValueOr(
      db,
      "lipsync_safety_frames",
      z.number().int().nonnegative(),
      DEFAULT_LIPSYNC_SAFETY_FRAMES,
    ),
  };
}

/**
 * InfiniteTalk requires a text prompt. The one-liner this replaced left the face
 * blank and staring through the pause between sentences — an audio-driven model
 * has nothing to animate while the audio is silent unless the prompt says where
 * the expression should live. Directing it into the face and forbidding head and
 * torso motion outright read markedly more natural on the same image and audio.
 */
export const DEFAULT_LIPSYNC_PROMPT =
  "Talks to the camera like they're telling a friend something exciting — warm, casual, " +
  "enthusiastic. Expression lives entirely in the face: eyes, eyebrows, a small smile " +
  "breaking through. Head stays level and steady — no bobbing, no rhythmic nodding, no " +
  "swaying. Shoulders and torso still, as if the arm holding the phone is bracing them. " +
  "Hands stay down, never near the face. Fixed close camera, no pan, no zoom, no movement. " +
  "Single continuous shot. Casual handheld phone video, not cinematic.";

/** `personas.identity` is free-form jsonb; only this shape is a real override. */
const motionPromptSchema = z.object({ motionPrompt: z.string() });

/**
 * Persona override → app_config `lipsync_prompt` → the default above. Personas
 * differ in how much they should move and the persona row is the only place that
 * knows, but an identity that is null, not an object, or carries a non-string
 * motionPrompt falls through instead of failing a paid render.
 */
export async function resolveLipsyncPrompt(db: Db, personaId?: string): Promise<string> {
  if (personaId) {
    const persona = (
      await db.select().from(personas).where(eq(personas.id, personaId)).limit(1)
    )[0];
    const identity = motionPromptSchema.safeParse(persona?.identity);
    const override = identity.success ? identity.data.motionPrompt.trim() : "";
    if (override) return override;
  }
  return getConfigValueOr(db, "lipsync_prompt", z.string().min(1), DEFAULT_LIPSYNC_PROMPT);
}

/**
 * Service B step 1: InfiniteTalk lip-sync on the hosted provider.
 * Submit checkpoints the provider job id BEFORE polling, so a retry resumes
 * polling instead of paying for a second GPU run.
 */
export async function handleLipsync(job: Job, ctx: JobContext): Promise<JobResult> {
  const { videoRenderId } = job.payload as { videoRenderId: string };
  const render = await loadRender(ctx.db, videoRenderId);
  const params = render.params as VariantParams;
  const provider = getLipsyncProvider();
  const state = job.state as { providerJobId?: string; submittedAt?: number };

  try {
    if (!state.providerJobId) {
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
      // The frame count IS the video length — a missing duration would silently
      // render the wrong ad, so it fails here instead.
      if (!audio.durationMs) throw new PermanentError("audio render has no duration");

      const { fps, resolution, safetyFrames } = await lipsyncSettings(ctx.db);
      const numFrames = framesForAudio(audio.durationMs, fps, safetyFrames);

      // Source image: an approved composite takes precedence (hard gate),
      // then an explicit persona image, then the persona's default image.
      // The persona behind that image also owns the motion prompt, so both
      // travel out of the same branch.
      let imagePath: string;
      let personaId: string | undefined;
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
        personaId = composite.personaId;
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
        personaId = image.personaId;
      } else if (params.personaId) {
        const image = (
          await ctx.db
            .select()
            .from(personaImages)
            .where(
              // A stranded "pending" placeholder (no "/") must never be signed,
              // even if it carries the default flag.
              and(
                eq(personaImages.personaId, params.personaId),
                eq(personaImages.isDefault, true),
                like(personaImages.filePath, "%/%"),
              ),
            )
            .limit(1)
        )[0];
        if (!image) {
          throw new PermanentError(
            "persona has no reference images — add one with `aiugc persona add-image`",
          );
        }
        imagePath = image.filePath;
        personaId = params.personaId;
      } else {
        throw new PermanentError("service B params name no composite, persona image, or persona");
      }

      // Generated exactly once per render and persisted BEFORE the submit, so a
      // retry or a resubmit asks fal for the same take instead of paying for a
      // different one.
      let seed = params.seed;
      if (typeof seed !== "number") {
        seed = Math.floor(Math.random() * 2_147_483_648); // [0, 2147483647]
        await mergeParams(ctx.db, videoRenderId, { seed });
      }

      const { providerJobId } = await provider.submit({
        imageUrl: await storage.signedUrl(imagePath, 3600),
        audioUrl: await storage.signedUrl(audio.filePath, 3600),
        prompt: await resolveLipsyncPrompt(ctx.db, personaId),
        numFrames,
        resolution,
        seed,
      });
      const gpuSeconds = Math.ceil(audio.durationMs / 1000);
      await recordUsage(ctx.db, {
        provider: "fal",
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
      await assertPollDeadline(ctx.db, ctx.log, { providerJobId: state.providerJobId, submittedAt });
      return { kind: "reschedule", delayMs: 30_000, state: { ...state, submittedAt } };
    }
    if (result.status === "failed") throw new PermanentError(`lipsync failed: ${result.reason}`);

    await mergeParams(ctx.db, videoRenderId, { lipsyncUrl: result.videoUrl });
    await enqueue(ctx.db, {
      type: "upscale",
      idempotencyKey: `upscale:${videoRenderId}`,
      payload: { videoRenderId },
    });
    return { kind: "done" };
  } catch (err) {
    await failRenderOnPermanent(ctx.db, videoRenderId, err);
    throw err;
  }
}

/**
 * The lip-sync plate comes back at the resolution we pay for (480p by default),
 * and Remotion composes it into a 1080x1920 frame — so it goes through Topaz
 * Starlight first. `upscale_factor` is computed per clip rather than pinned,
 * and must fit BOTH dimensions: fal bills the "above 1080p" tier ($0.08/s
 * instead of $0.02/s) when EITHER output dimension exceeds it, and the
 * composition is 1080x1920 so anything larger is pure waste Remotion scales
 * back down. Floor, never round up.
 */
// The Remotion ServiceB composition frame — the upscale target, not a video standard.
const UPSCALE_TARGET_WIDTH = 1080;
const UPSCALE_TARGET_HEIGHT = 1920;
const UPSCALE_MAX_FACTOR = 4;

export function upscaleFactorFor(width: number, height: number): number {
  const fit = Math.min(UPSCALE_TARGET_WIDTH / width, UPSCALE_TARGET_HEIGHT / height);
  const factor = Math.floor(fit * 100) / 100;
  return Math.min(Math.max(factor, 1), UPSCALE_MAX_FACTOR);
}

/**
 * DRY_RUN has no ffprobe and the stub copies the plate through unchanged, so one
 * fake describes both probes: a 480-wide plate, i.e. a real 2.25x upscale.
 * Height 848, not 854: at 854 the height would bind (854 * 2.25 > 1920).
 */
const DRY_RUN_PROBE: ProbeResult = {
  width: 480,
  height: 848,
  durationMs: 10_000,
  hasAudio: true,
};

/** Frames added or dropped here would drift the captions against the voiceover. */
const UPSCALE_DURATION_DRIFT_MS = 100;

/**
 * Service B step 2: Topaz Starlight upscale of the lip-sync plate.
 *
 * Both the plate and the upscaled clip are kept: the plate is the input fal
 * fetches over a signed URL (so a resubmit can mint a fresh one) and the
 * fallback if the upscale never lands.
 */
export async function handleUpscale(job: Job, ctx: JobContext): Promise<JobResult> {
  const { videoRenderId } = job.payload as { videoRenderId: string };
  const render = await loadRender(ctx.db, videoRenderId);
  const params = render.params as VariantParams;
  const provider = getUpscaleProvider();
  const state = job.state as {
    providerJobId?: string;
    platePath?: string;
    plateDurationMs?: number;
    submittedAt?: number;
  };
  const storage = getStorage();
  const localDir = path.join(WORK_DIR, "upscale", videoRenderId);
  // From the job's own state, never from params: a QC regeneration copies the
  // rejected render's params, and its plate is not this render's plate.
  let platePath = state.platePath;

  try {
    if (!state.providerJobId) {
      mkdirSync(localDir, { recursive: true });
      const localPlate = path.join(localDir, "plate.mp4");
      if (platePath) {
        await storage.download(platePath, localPlate);
      } else {
        if (!params.lipsyncUrl) throw new PermanentError("render has no lipsync output yet");
        if (params.lipsyncUrl.startsWith("dryrun://")) {
          writeFileSync(localPlate, "DRY_RUN placeholder lipsync clip");
        } else {
          const response = await fetch(params.lipsyncUrl);
          if (!response.ok) throw new PermanentError(`lipsync download failed: ${response.status}`);
          writeFileSync(localPlate, Buffer.from(await response.arrayBuffer()));
        }
        platePath = await storage.put(
          "renders",
          storageKey({
            businessId: render.businessId,
            entity: "video",
            id: videoRenderId,
            filename: "lipsync-plate.mp4",
          }),
          localPlate,
        );
        await mergeParams(ctx.db, videoRenderId, { lipsyncPlatePath: platePath });
      }

      const plate = getEnv().DRY_RUN ? DRY_RUN_PROBE : await probe(localPlate);
      const factor = upscaleFactorFor(plate.width, plate.height);
      ctx.log.info(
        { width: plate.width, height: plate.height, factor },
        "upscale: probed the lipsync plate",
      );
      if (factor <= 1) {
        ctx.log.info("upscale: plate is already at the output size — skipping");
        await mergeParams(ctx.db, videoRenderId, { lipsyncPath: platePath });
        await enqueueRenderVideo(ctx.db, videoRenderId);
        return { kind: "done" };
      }

      const { providerJobId } = await provider.submit({
        videoUrl: await storage.signedUrl(platePath, 3600),
        upscaleFactor: factor,
      });
      const next = {
        providerJobId,
        platePath,
        plateDurationMs: plate.durationMs,
        // Survives a resubmit: the poll deadline measures from the FIRST submit.
        submittedAt: state.submittedAt ?? Date.now(),
      };
      await ctx.checkpoint(next);
      return { kind: "reschedule", delayMs: 15_000, state: next };
    }

    const result = await provider.poll(state.providerJobId);
    if (result.status === "pending") {
      // submittedAt ?? now backfills state written before the deadline existed.
      const submittedAt = state.submittedAt ?? Date.now();
      await assertPollDeadline(ctx.db, ctx.log, { providerJobId: state.providerJobId, submittedAt });
      return { kind: "reschedule", delayMs: 30_000, state: { ...state, submittedAt } };
    }
    if (result.status === "failed") {
      // Deliberately the opposite of handleLipsync: clearing the provider job id
      // makes the retry resubmit with a fresh signed input URL, which is the
      // likeliest thing that went wrong — and a resubmit here costs cents where
      // a lipsync resubmit costs shekels.
      await ctx.checkpoint({
        platePath,
        plateDurationMs: state.plateDurationMs,
        submittedAt: state.submittedAt,
      });
      throw new TransientError(`upscale failed: ${result.reason}`);
    }
    if (!platePath) throw new PermanentError("upscale finished but the plate is missing");

    mkdirSync(localDir, { recursive: true });
    const localUpscaled = path.join(localDir, "upscaled.mp4");
    if (result.videoUrl.startsWith("dryrun://")) {
      await storage.download(platePath, localUpscaled); // stub: input through unchanged
    } else {
      const response = await fetch(result.videoUrl);
      if (!response.ok) throw new PermanentError(`upscale download failed: ${response.status}`);
      writeFileSync(localUpscaled, Buffer.from(await response.arrayBuffer()));
    }

    // The upscaled clip's own metadata is what goes downstream — Remotion reads
    // the frame count off this exact file, never off the plate.
    const upscaled = getEnv().DRY_RUN ? DRY_RUN_PROBE : await probe(localUpscaled);
    const plateDurationMs = state.plateDurationMs;
    if (
      plateDurationMs !== undefined &&
      Math.abs(upscaled.durationMs - plateDurationMs) > UPSCALE_DURATION_DRIFT_MS
    ) {
      ctx.log.warn(
        { plateDurationMs, upscaledDurationMs: upscaled.durationMs },
        "upscale: duration changed — captions may drift against the voiceover",
      );
    }
    ctx.log.info(
      { width: upscaled.width, height: upscaled.height, durationMs: upscaled.durationMs },
      "upscale: probed the upscaled clip",
    );

    // fal returns the clip with every colour field unset, leaving Remotion to
    // guess on its input. Stream-copy retag as BT.709 limited (the measured
    // truth) — best-effort, because a retag failure must never sink a render
    // fal has already been paid for.
    let localFinal = localUpscaled;
    if (!getEnv().DRY_RUN) {
      const localRetagged = path.join(localDir, "upscaled-retagged.mp4");
      try {
        await retagBt709Limited(localUpscaled, localRetagged);
        localFinal = localRetagged;
      } catch (err) {
        ctx.log.warn({ err }, "upscale: colour retag failed — using the untagged clip");
      }
    }

    const lipsyncPath = await storage.put(
      "renders",
      storageKey({
        businessId: render.businessId,
        entity: "video",
        id: videoRenderId,
        filename: "lipsync-upscaled.mp4",
      }),
      localFinal,
    );
    // upscaleError is cleared: a successful upscale is not a degraded render,
    // even if this render inherited the mark from a rejected one.
    await mergeParams(ctx.db, videoRenderId, { lipsyncPath, upscaleError: undefined });
    await enqueueRenderVideo(ctx.db, videoRenderId);
    return { kind: "done" };
  } catch (err) {
    // A failed upscale must not cost the customer the render: fall back to the
    // plate and let the founder look at it (never auto-released).
    if (err instanceof PermanentError && platePath) {
      ctx.log.warn({ err }, "upscale: falling back to the lipsync plate");
      await mergeParams(ctx.db, videoRenderId, {
        lipsyncPath: platePath,
        upscaleError: err.message,
      });
      await enqueueRenderVideo(ctx.db, videoRenderId);
      return { kind: "done" };
    }
    await failRenderOnPermanent(ctx.db, videoRenderId, err);
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

  try {
    await ctx.db
      .update(videoRenders)
      .set({ status: "rendering", updatedAt: new Date() })
      .where(eq(videoRenders.id, videoRenderId));

    const localDir = path.join(WORK_DIR, "render", videoRenderId);
    mkdirSync(localDir, { recursive: true });
    const props =
      render.service === "a"
        ? await buildServiceAProps(ctx.db, render, localDir)
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
    // A degraded render (the upscale failed and we fell back to the plate) always
    // gets a human look, even with auto_release_b on.
    const degraded = Boolean((render.params as VariantParams).upscaleError);
    const released = render.service === "a" || (autoReleaseB && !degraded);
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
    await failRenderOnPermanent(ctx.db, videoRenderId, err);
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

  return {
    kind: "service_a",
    hookClipPath,
    hookLine: hookLine.text,
    hookTextSafeArea: hookClip.textSafeArea as TextSafeArea,
    demoPath,
    demoDurationMs: demo.durationMs ?? 0,
    captions,
    voiceoverPath,
    watermark: render.watermarked,
  };
}

async function buildServiceBProps(
  db: Db,
  render: typeof videoRenders.$inferSelect,
  localDir: string,
): Promise<RenderVideoProps> {
  const params = render.params as VariantParams;
  // Written by handleUpscale: the upscaled clip, or the plate when the upscale
  // was skipped or fell back. Remotion reads the frame count off this file.
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
  // The lip-sync clip's own audio (fal's re-encode of this mp3) is muted.
  const voiceoverPath = path.join(localDir, "vo.mp3");
  await getStorage().download(audio.filePath, voiceoverPath);

  const talkingHeadPath = path.join(localDir, "talking-head.mp4");
  await getStorage().download(params.lipsyncPath, talkingHeadPath);

  return {
    kind: "service_b",
    talkingHeadPath,
    voiceoverPath,
    brollPaths: [], // product B-roll cutaways: wired when the composition lands
    captions,
    watermark: render.watermarked,
  };
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

async function failRenderOnPermanent(db: Db, videoRenderId: string, err: unknown): Promise<void> {
  if (err instanceof PermanentError) {
    await db
      .update(videoRenders)
      .set({ status: "failed", error: err.message, updatedAt: new Date() })
      .where(eq(videoRenders.id, videoRenderId));
    await refundRenderIfNeeded(db, videoRenderId);
  }
}
