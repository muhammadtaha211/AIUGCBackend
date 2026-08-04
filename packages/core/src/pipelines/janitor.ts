import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { getConfigValue } from "../appConfig";
import { retentionDaysSchema } from "../config";
import type { Db } from "../db";
import { audioRenders, demos, jobs, videoRenders } from "../db/schema";
import type { Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { getStorage } from "../storage";
import { refundRenderIfNeeded } from "./credits";

/**
 * Daily sweep (Supabase Storage has no native lifecycle rules, so retention is
 * enforced here from DB timestamps): dead-job cleanup + refunds, then
 * retention deletes per app_config.retention_days. Files are removed and path
 * columns nulled; rows are kept.
 */
export async function handleJanitor(_job: Job, ctx: JobContext): Promise<JobResult> {
  const { db, log } = ctx;
  const counts = { refunded: 0, rawDeleted: 0, rendersDeleted: 0, audioDeleted: 0 };

  // 1. Renders whose job died after retries: mark failed + refund credits.
  const deadJobs = await db
    .select()
    .from(jobs)
    .where(and(inArray(jobs.type, ["render_video", "lipsync"]), eq(jobs.status, "dead")));
  for (const dead of deadJobs) {
    const { videoRenderId } = dead.payload as { videoRenderId?: string };
    if (!videoRenderId) continue;
    const render = (
      await db.select().from(videoRenders).where(eq(videoRenders.id, videoRenderId)).limit(1)
    )[0];
    if (render && !["released", "failed", "rejected"].includes(render.status)) {
      await db
        .update(videoRenders)
        .set({ status: "failed", error: dead.lastError, updatedAt: new Date() })
        .where(eq(videoRenders.id, videoRenderId));
    }
    if (await refundRenderIfNeeded(db, videoRenderId)) counts.refunded++;
  }

  // 2. Retention.
  const retention = await getConfigValue(db, "retention_days", retentionDaysSchema);
  const storage = getStorage();
  const cutoff = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rawExpired = await db
    .select()
    .from(demos)
    .where(
      and(
        eq(demos.status, "ready"),
        isNotNull(demos.rawPath),
        lt(demos.updatedAt, cutoff(retention.raw_after_normalize)),
      ),
    );
  for (const demo of rawExpired) {
    try {
      await storage.remove(demo.rawPath!);
      await db.update(demos).set({ rawPath: null }).where(eq(demos.id, demo.id));
      counts.rawDeleted++;
    } catch (err) {
      log.warn({ err, demoId: demo.id }, "janitor: raw delete failed");
    }
  }

  const releasedExpired = await db
    .select()
    .from(videoRenders)
    .where(
      and(
        eq(videoRenders.status, "released"),
        isNotNull(videoRenders.filePath),
        lt(videoRenders.releasedAt, cutoff(retention.released_renders)),
        eq(videoRenders.watermarked, false),
      ),
    );
  const samplesExpired = await db
    .select()
    .from(videoRenders)
    .where(
      and(
        eq(videoRenders.status, "released"),
        isNotNull(videoRenders.filePath),
        lt(videoRenders.releasedAt, cutoff(retention.watermarked_samples)),
        eq(videoRenders.watermarked, true),
      ),
    );
  for (const render of [...releasedExpired, ...samplesExpired]) {
    try {
      await storage.remove(render.filePath!);
      await db
        .update(videoRenders)
        .set({ filePath: null, updatedAt: new Date() })
        .where(eq(videoRenders.id, render.id));
      counts.rendersDeleted++;
    } catch (err) {
      log.warn({ err, renderId: render.id }, "janitor: render delete failed");
    }
  }

  // Unapproved audio previews (approved audio is referenced by renders — kept).
  const audioExpired = await db
    .select()
    .from(audioRenders)
    .where(
      and(
        isNull(audioRenders.approvedAt),
        isNotNull(audioRenders.filePath),
        lt(audioRenders.createdAt, cutoff(retention.audio_previews)),
      ),
    );
  for (const audio of audioExpired) {
    try {
      await storage.remove(audio.filePath!);
      await db.update(audioRenders).set({ filePath: null }).where(eq(audioRenders.id, audio.id));
      counts.audioDeleted++;
    } catch (err) {
      log.warn({ err, audioRenderId: audio.id }, "janitor: audio delete failed");
    }
  }

  log.info(counts, "janitor digest");
  return { kind: "done" };
}
