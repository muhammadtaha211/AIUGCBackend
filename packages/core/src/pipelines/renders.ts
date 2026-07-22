import { eq } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfigValue } from "../appConfig";
import { assertBudget, recordUsage } from "../budget";
import { evenlySpacedCaptions, type CaptionChunk } from "../captions";
import { getEnv } from "../config";
import type { Db } from "../db";
import {
  audioRenders,
  composites,
  demos,
  hookClips,
  personaClips,
  scripts,
  sets,
  videoRenders,
} from "../db/schema";
import { PermanentError } from "../jobs/errors";
import { enqueue, type Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { thumbnail } from "../media/ffmpeg";
import { WORK_DIR } from "../paths";
import { getLipsyncProvider } from "../providers/lipsync";
import { renderVideo, type RenderVideoProps, type TextSafeArea } from "../providers/remotion";
import { getStorage, storageKey } from "../storage";
import { refundRenderIfNeeded } from "./credits";
import type { VariantParams } from "./sets";

/** ~agorot per GPU second (fal.ai infinitalk 720p ≈ $0.60/s ≈ ₪2.2/s). */
const GPU_COST_AGOROT_PER_SECOND = 222;

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

      // Source: approved composite (single-image mode) or persona base clip.
      let source: { videoUrl?: string; imageUrl?: string };
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
        source = { imageUrl: await storage.signedUrl(composite.outputPath, 3600) };
      } else {
        const clip = (
          await ctx.db
            .select()
            .from(personaClips)
            .where(eq(personaClips.id, params.personaClipId!))
            .limit(1)
        )[0];
        if (!clip) throw new PermanentError("persona clip not found");
        source = { videoUrl: await storage.signedUrl(clip.filePath, 3600) };
      }

      const { providerJobId } = await provider.submit({
        ...source,
        audioUrl: await storage.signedUrl(audio.filePath, 3600),
      });
      await recordUsage(ctx.db, {
        provider: "fal",
        kind: "gpu_seconds",
        quantity: Math.ceil((audio.durationMs ?? 30_000) / 1000),
        costEstimateAgorot:
          Math.ceil((audio.durationMs ?? 30_000) / 1000) * GPU_COST_AGOROT_PER_SECOND,
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
  const captions = audio.wordTimestamps as CaptionChunk[];

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
