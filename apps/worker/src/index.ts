import "dotenv/config";
import {
  buildHandlers,
  ensureAutopilotJob,
  ensureDailyJobs,
  ensureReaperJob,
  getDb,
  failureEmailState,
  getEnv,
  HEAVY_JOB_TYPES,
  logger,
  markEventsNotified,
  pendingAlertEvents,
  sweepAutopilotEmails,
  sweepPostDeliveryEmails,
  sweepPostFailureEmails,
} from "@aiugc/core";
import { sweepAutopilotNights } from "./autopilot-checkin";
import { superviseLane } from "./lanes";
import { reportAlertEvent, reportFatal, reportTerminalJob } from "./reporting";

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
 * How often the alert sweep looks for `events` rows nobody has been told about,
 * and how many it takes at a time. A minute matches the reaper's cadence and is
 * far below anything a human answers an alert in; the cap bounds one tick when a
 * burst got past the writer's own 5-minute window (alerts.ts).
 */
const ALERT_SWEEP_INTERVAL_MS = 60_000;
const ALERT_SWEEP_LIMIT = 20;

/**
 * Report alert-worthy `events` rows the writer could not report itself, then
 * mark them.
 *
 * **It lives here and not in core's lanes on purpose.** Decision 0037 puts the
 * Sentry SDK in apps/worker and nowhere else, so `aiugc work --once` and the
 * Vercel apps stay silent BY CONSTRUCTION rather than by configuration: core
 * knows only how to read and mark the queue, and the only process that owns a
 * DSN is the only process that runs this.
 *
 * Marked AFTER the report, so a worker that dies mid-sweep repeats an alert
 * rather than losing one. Swallows everything the way reportTerminal does — a
 * reporting fault must never become a worker fault, which for this process means
 * it must never reach the unhandledRejection handler above and exit(1).
 */
async function sweepAlerts(db: ReturnType<typeof getDb>): Promise<void> {
  try {
    const pending = await pendingAlertEvents(db, ALERT_SWEEP_LIMIT);
    if (pending.length === 0) return;
    for (const event of pending) reportAlertEvent(event);
    await markEventsNotified(
      db,
      pending.map((event) => event.id),
    );
    logger.warn({ reported: pending.length }, "alert sweep: reported unnotified events");
  } catch (err) {
    logger.warn({ err }, "alert sweep failed — retrying next interval");
  }
}

/**
 * The failure email (decision 0107) and the delivery email (decision 0116): a
 * minute's cadence, like the alert sweep. The rules — the cause, the 24 h, the
 * 2-minute quiet, the 20-a-day ceiling — are core's
 * (pipelines/social-failure-email.ts, social-delivery-email.ts); this only
 * drives the clock.
 * One tick at a time: a tick that finds the last one still sending skips, so
 * the ceiling's count cannot race on this one box. Swallows everything, the way
 * sweepAlerts does — an email fault must never become a worker fault, and it
 * never touches a post.
 */
const FAILURE_EMAIL_SWEEP_INTERVAL_MS = 60_000;
let failureEmailSweepRunning = false;

async function sweepFailureEmails(db: ReturnType<typeof getDb>): Promise<void> {
  if (failureEmailSweepRunning) return;
  failureEmailSweepRunning = true;
  try {
    const workerId = getEnv().WORKER_ID;
    try {
      const failures = await sweepPostFailureEmails(db, { workerId });
      if (failures.sent + failures.refused + failures.heldByCeiling > 0) {
        logger.info(failures, "failure email sweep");
      }
    } catch (err) {
      logger.warn({ err }, "failure email sweep failed — retrying next interval");
    }
    // After the failures: they spend the day's shared ceiling first, and a
    // pause the failure sweep just set holds this one back too. Its own try, so
    // a fault in one sweep never stops the other.
    try {
      const deliveries = await sweepPostDeliveryEmails(db, { workerId });
      if (deliveries.sent + deliveries.refused + deliveries.heldByCeiling > 0) {
        logger.info(deliveries, "delivery email sweep");
      }
    } catch (err) {
      logger.warn({ err }, "delivery email sweep failed — retrying next interval");
    }
    // The autopilot's pause and low-sound emails (decision 0127): third, on the
    // same shared ceiling and pause.
    try {
      const autopilot = await sweepAutopilotEmails(db, { workerId });
      if (autopilot.sent + autopilot.refused + autopilot.heldByCeiling > 0) {
        logger.info(autopilot, "autopilot email sweep");
      }
    } catch (err) {
      logger.warn({ err }, "autopilot email sweep failed — retrying next interval");
    }
  } catch (err) {
    // Only reading the worker's own environment can land here.
    logger.warn({ err }, "email sweep failed — retrying next interval");
  } finally {
    failureEmailSweepRunning = false;
  }
}

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
  // The Instagram autopilot's night (0127): a singleton like the reaper.
  await ensureAutopilotJob(db);
  const daily = setInterval(() => void ensureDailyJobs(db).catch(() => {}), 60 * 60 * 1000);

  // Drain once at startup so a failure written while the worker was down is
  // reported on the next boot rather than waiting out a full interval.
  await sweepAlerts(db);
  const alerts = setInterval(() => {
    void sweepAlerts(db);
    void sweepAutopilotNights(db);
  }, ALERT_SWEEP_INTERVAL_MS);
  // Says once whether failure emails are on, and if not why (no_provider,
  // local_worker) — the sweep's own checks. The key itself is never logged.
  logger.info({ failureEmail: failureEmailState(workerId) }, "failure email");
  const failureEmails = setInterval(
    () => void sweepFailureEmails(db),
    FAILURE_EMAIL_SWEEP_INTERVAL_MS,
  );

  logger.info({ workerId, dryRun: getEnv().DRY_RUN }, "worker started");
  await Promise.all([
    superviseLane(db, {
      workerId: `${workerId}:heavy`,
      handlers,
      types: HEAVY_JOB_TYPES,
      signal: abort.signal,
      onJobTerminal: reportTerminalJob,
    }),
    superviseLane(db, {
      workerId: `${workerId}:light`,
      handlers,
      types: lightTypes,
      signal: abort.signal,
      onJobTerminal: reportTerminalJob,
    }),
  ]);
  clearInterval(daily);
  clearInterval(alerts);
  clearInterval(failureEmails);
  logger.info("worker stopped");
}

main().catch((err) => {
  logger.error({ err }, "worker crashed");
  void reportFatal(err, "worker crashed").finally(() => process.exit(1));
});
