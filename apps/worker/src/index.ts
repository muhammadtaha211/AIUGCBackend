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

// A crash must leave a pino line, not a bare Node stack — the worker has no
// supervisor or error reporting, so this log line is all the founder gets.
// exit(1) straight after fatal() is safe even though pino's default
// destination is async (SonicBoom sync:false): fatal() flushSync()es before
// returning (pino levels.js) and pino's process-exit hook flushes again.
// pino.final was removed in v7 for exactly this reason — do not "fix" this.
process.on("unhandledRejection", (err) => {
  logger.fatal({ err }, "unhandled rejection — exiting");
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception — exiting");
  process.exit(1);
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
    }),
    superviseLane(db, {
      workerId: `${workerId}:light`,
      handlers,
      types: lightTypes,
      signal: abort.signal,
    }),
  ]);
  clearInterval(daily);
  logger.info("worker stopped");
}

main().catch((err) => {
  logger.error({ err }, "worker crashed");
  process.exit(1);
});
