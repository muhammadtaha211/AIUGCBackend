import "dotenv/config";
import {
  buildHandlers,
  ensureDailyJobs,
  getDb,
  getEnv,
  HEAVY_JOB_TYPES,
  logger,
  runLane,
} from "@aiugc/core";

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

  // Enqueue today's janitor/billing jobs (idempotent), repeat hourly.
  await ensureDailyJobs(db);
  const daily = setInterval(() => void ensureDailyJobs(db).catch(() => {}), 60 * 60 * 1000);

  logger.info({ workerId, dryRun: getEnv().DRY_RUN }, "worker started");
  await Promise.all([
    runLane(db, {
      workerId: `${workerId}:heavy`,
      handlers,
      types: HEAVY_JOB_TYPES,
      signal: abort.signal,
    }),
    runLane(db, {
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
