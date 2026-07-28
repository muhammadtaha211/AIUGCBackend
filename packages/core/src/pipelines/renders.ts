import { and, eq } from "drizzle-orm";
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
import { PermanentError } from "../jobs/errors";
import { enqueue, type Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { thumbnail } from "../media/ffmpeg";
import { WORK_DIR } from "../paths";
import {
  framesForAudio,
  getLipsyncProvider,
  lipsyncResolutionSchema,
  type LipsyncResolution,
} from "../providers/lipsync";
import { renderVideo, type RenderVideoProps, type TextSafeArea } from "../providers/remotion";
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
  const state = job.state as { providerJobId?: string };

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
              and(eq(personaImages.personaId, params.personaId), eq(personaImages.isDefault, true)),
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

      const { providerJobId } = await provider.submit({
        imageUrl: await storage.signedUrl(imagePath, 3600),
        audioUrl: await storage.signedUrl(audio.filePath, 3600),
        prompt: await resolveLipsyncPrompt(ctx.db, personaId),
        numFrames,
        resolution,
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
      await ctx.checkpoint({ providerJobId });
      return { kind: "reschedule", delayMs: 15_000, state: { providerJobId } };
    }

    const result = await provider.poll(state.providerJobId);
    if (result.status === "pending") return { kind: "reschedule", delayMs: 30_000 };
    if (result.status === "failed") throw new PermanentError(`lipsync failed: ${result.reason}`);

    await ctx.db
      .update(videoRenders)
      .set({
        params: { ...params, lipsyncUrl: result.videoUrl },
        updatedAt: new Date(),
      })
      .where(eq(videoRenders.id, videoRenderId));
    await enqueue(ctx.db, {
      type: "render_video",
      idempotencyKey: `render:${videoRenderId}`,
      payload: { videoRenderId },
    });
    return { kind: "done" };
  } catch (err) {
    await failRenderOnPermanent(ctx.db, videoRenderId, err);
    throw err;
  }
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
  if (!params.lipsyncUrl) throw new PermanentError("service B render has no lipsync output yet");

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
  if (params.lipsyncUrl.startsWith("dryrun://")) {
    writeFileSync(talkingHeadPath, "DRY_RUN placeholder lipsync clip");
  } else {
    const response = await fetch(params.lipsyncUrl);
    if (!response.ok) throw new PermanentError(`lipsync download failed: ${response.status}`);
    writeFileSync(talkingHeadPath, Buffer.from(await response.arrayBuffer()));
  }

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
