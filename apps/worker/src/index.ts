import "dotenv/config";
import {
  buildHandlers,
  ensureDailyJobs,
  ensureReaperJob,
  getDb,
  getEnv,
  HEAVY_JOB_TYPES,
  logger,
} from "@aiugc/core";
import { superviseLane } from "./lanes";
import { reportDeadJob, reportFatal } from "./reporting";

// A crash must leave a pino line, not a bare Node stack — the worker has no
// supervisor, so this log line is what survives on the box. fatal() before
// anything else, and exit(1) is still safe on pino's async default destination
// (SonicBoom sync:false): fatal() flushSync()es before returning (pino
// levels.js) and pino's process-exit hook flushes again. pino.final was removed
// in v7 for exactly this reason — do not "fix" this.
//
// The exit is no longer immediate: Sentry's transport is async, so the event is
// dropped unless it is flushed first (reportFatal, ≤2.25s, and a no-op when
// SENTRY_DSN is unset — an unreported crash exits as fast as it always did).
// `.finally` and not `.then`, so a flush that somehow rejects still exits.
process.on("unhandledRejection", (err) => {
  logger.fatal({ err }, "unhandled rejection — exiting");
  void reportFatal(err, "unhandled rejection").finally(() => process.exit(1));
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception — exiting");
  void reportFatal(err, "uncaught exception").finally(() => process.exit(1));
});

/**
 * The single worker process. Two lanes so a minutes-long Remotion render or
 * lip-sync wait never blocks an audio preview a user is waiting on:
 * - heavy: render_video, lipsync (sequential -> render concurrency is 1)
 * - light: everything else
 */
async function main(): Promise<void> {
  const db = getDb();
  const handlers = buildHandlers();
  const lightTypes = Object.keys(handlers).filter(
    (t) => !(HEAVY_JOB_TYPES as readonly string[]).includes(t),
  );
  const workerId = getEnv().WORKER_ID;
  const abort = new AbortController();

  process.on("SIGINT", () => abort.abort());
  process.on("SIGTERM", () => abort.abort());

  // Enqueue today's janitor/billing jobs (idempotent), repeat hourly. The
  // dead-render reaper is a singleton that reschedules itself — ensure once.
  await ensureDailyJobs(db);
  await ensureReaperJob(db);
  const daily = setInterval(() => void ensureDailyJobs(db).catch(() => {}), 60 * 60 * 1000);

  logger.info({ workerId, dryRun: getEnv().DRY_RUN }, "worker started");
  await Promise.all([
    superviseLane(db, {
      workerId: `${workerId}:heavy`,
      handlers,
      types: HEAVY_JOB_TYPES,
      signal: abort.signal,
      onJobDead: reportDeadJob,
    }),
    superviseLane(db, {
      workerId: `${workerId}:light`,
      handlers,
      types: lightTypes,
      signal: abort.signal,
      onJobDead: reportDeadJob,
    }),
  ]);
  clearInterval(daily);
  logger.info("worker stopped");
}

main().catch((err) => {
  logger.error({ err }, "worker crashed");
  void reportFatal(err, "worker crashed").finally(() => process.exit(1));
});
