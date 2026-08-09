import { and, eq, inArray, isNotNull, isNull, lt, notInArray, sql } from "drizzle-orm";
import { getConfigValue } from "../appConfig";
import { retentionDaysSchema } from "../config";
import type { Db } from "../db";
import { audioRenders, demos, jobs, videoRenders } from "../db/schema";
import type { Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { getStorage } from "../storage";
import {
  failRenderAndRefund,
  RENDER_PARK_EXPIRED_MESSAGE,
  RENDER_RETRIES_EXHAUSTED_MESSAGE,
} from "./renders";

export const REAPER_INTERVAL_MS = 60_000;

/**
 * Max park age: how long a render's job may sit parked on BudgetError before
 * we stop holding the customer's money — fail + refund instead. A safety
 * valve, not a policy: it works under any cap design; without it a parked
 * render spins forever with the money already taken. 6h is long enough for a
 * genuine capacity blip to clear (parks recheck hourly) and short enough that
 * a customer's credits are never held hostage overnight.
 */
export const MAX_BUDGET_PARK_MS = 6 * 60 * 60 * 1000;

/**
 * Dead render/lipsync jobs whose render is still non-terminal — i.e. a job
 * that died WITHOUT running its terminal path. In normal operation the last
 * attempt already failed+refunded the render (renders.ts), so this is empty;
 * rows appear only when no handler code ran at all (worker OOM/kill).
 */
export async function findDeadStuckRenders(db: Db): Promise<{ videoRenderId: string }[]> {
  return db
    .select({ videoRenderId: videoRenders.id })
    .from(jobs)
    .innerJoin(videoRenders, sql`${videoRenders.id} = (${jobs.payload}->>'videoRenderId')::uuid`)
    .where(
      and(
        inArray(jobs.type, ["render_video", "lipsync"]),
        eq(jobs.status, "dead"),
        notInArray(videoRenders.status, ["released", "failed", "rejected"]),
      ),
    );
}

/**
 * Renders whose job has sat parked on a budget cap past MAX_BUDGET_PARK_MS.
 * jobs.created_at is the park-age anchor: render jobs are enqueued at confirm
 * and normally live minutes, so a budget-parked job hours old has spent
 * nearly all of that time parked. The job itself is left alone — when its
 * window frees it runs, sees the terminal render, and completes as a no-op.
 */
export async function findOverparkedRenders(db: Db): Promise<{ videoRenderId: string }[]> {
  return db
    .select({ videoRenderId: videoRenders.id })
    .from(jobs)
    .innerJoin(videoRenders, sql`${videoRenders.id} = (${jobs.payload}->>'videoRenderId')::uuid`)
    .where(
      and(
        inArray(jobs.type, ["render_video", "lipsync"]),
        eq(jobs.status, "queued"),
        eq(jobs.errorClass, "budget"),
        lt(jobs.createdAt, new Date(Date.now() - MAX_BUDGET_PARK_MS)),
        notInArray(videoRenders.status, ["released", "failed", "rejected"]),
      ),
    );
}

/**
 * The net under a worker crash/OOM. A singleton job (see ensureReaperJob)
 * rescheduling itself every ~60s, so a customer stuck this way waits a minute,
 * not until tomorrow's janitor. Writes the same fixed Hebrew string as the
 * last-attempt path — the dead job's raw lastError never reaches the customer.
 */
export async function handleReapDeadRenders(_job: Job, ctx: JobContext): Promise<JobResult> {
  const { db, log } = ctx;
  // Swallow sweep errors: the singleton's attempts never reset, so letting a
  // transient DB blip consume one would eventually kill the reaper silently.
  try {
    let repaired = 0;
    for (const { videoRenderId } of await findDeadStuckRenders(db)) {
      if (await failRenderAndRefund(db, videoRenderId, RENDER_RETRIES_EXHAUSTED_MESSAGE)) {
        repaired++;
      }
    }
    // Zero in normal operation — anything else means a job died with no code running.
    if (repaired > 0) log.warn({ repaired }, "reaper: repaired renders stuck behind dead jobs");

    let unparked = 0;
    for (const { videoRenderId } of await findOverparkedRenders(db)) {
      if (await failRenderAndRefund(db, videoRenderId, RENDER_PARK_EXPIRED_MESSAGE)) {
        unparked++;
      }
    }
    if (unparked > 0) {
      log.warn({ unparked }, "reaper: refunded renders parked past the max park age");
    }
  } catch (err) {
    log.warn({ err }, "reaper: sweep failed — retrying next tick");
  }
  return { kind: "reschedule", delayMs: REAPER_INTERVAL_MS };
}

/**
 * Daily retention sweep (Supabase Storage has no native lifecycle rules, so
 * retention is enforced here from DB timestamps) per app_config.retention_days.
 * Files are removed and path columns nulled; rows are kept. Dead-render repair
 * lives in handleReapDeadRenders, not here.
 */
export async function handleJanitor(_job: Job, ctx: JobContext): Promise<JobResult> {
  const { db, log } = ctx;
  const counts = { rawDeleted: 0, rendersDeleted: 0, audioDeleted: 0 };

  // Retention.
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
