import * as Sentry from "@sentry/node";
import { getEnv, logger, type DeadJob } from "@aiugc/core";

/**
 * Error reporting for the one process with no supervisor and no dashboard.
 * Before this existed, a crash wrote one pino line to stdout and exited, and a
 * dead job wrote nothing at all — the founder found out both ways by noticing
 * jobs had stopped moving (docs/vault/defects/worker-exits-on-a-dropped-connection.md,
 * at least 16 deaths).
 *
 * Opt-in, and silence is a supported configuration: with no DSN nothing
 * initialises and every export here is a no-op, so DRY_RUN dev runs behave
 * exactly as they did. The guard is on a NON-EMPTY value, not on `undefined` —
 * every checked-in .env carries a bare `SENTRY_DSN=` line, which dotenv turns
 * into "", not undefined.
 */
const dsn = getEnv().SENTRY_DSN?.trim();

export const reportingEnabled = Boolean(dsn);

if (reportingEnabled) {
  Sentry.init({
    dsn,
    // Manual captures only. The default integrations install Sentry's own
    // uncaughtException/unhandledRejection handlers, which would give the crash
    // path in index.ts a second owner that can exit on its own schedule; the
    // ESM loader hooks and OpenTelemetry patching buy nothing when every event
    // here is captured by hand. Tracing stays off — it needs tracesSampleRate.
    defaultIntegrations: false,
    registerEsmLoaderHooks: false,
  });
}

// Short on purpose: this runs on the crash path, where being slow to die is
// worse than losing the event. Measured against a server that accepts the
// socket and never answers, flush() honours this timeout and resolves false.
const FLUSH_TIMEOUT_MS = 2000;

// Never log the DSN itself — it is a credential.
logger.info(reportingEnabled ? "error reporting on" : "error reporting off — SENTRY_DSN not set");

/**
 * One event per job that exhausted its attempts. `lastError` is the whole
 * point: the route from "a job died" to why, without opening the DB. Grouped
 * by job type so a flapping provider is one issue, not fifty.
 */
export function reportDeadJob(dead: DeadJob): void {
  if (!reportingEnabled) return;
  try {
    Sentry.captureMessage(`job dead: ${dead.type}`, {
      level: "error",
      // workerId so a local run with a DSN can never be mistaken for the box's
      // (`local` vs `hetzner`) — two lanes share this process and the CLI runs
      // the same lanes against the same DB.
      tags: { jobType: dead.type, workerId: getEnv().WORKER_ID },
      extra: {
        jobId: dead.jobId,
        attempts: dead.attempts,
        lastError: dead.lastError,
      },
    });
  } catch {
    // A reporting fault must never become a worker fault.
  }
}

/**
 * The crash path's last act, and the reason it is async: Sentry's transport
 * sends in the background, so `captureException` followed straight by
 * `process.exit(1)` drops the event. Awaiting the flush is what makes a crash
 * visible — but a stalled flush must never make the crash slower to fail or
 * able to hang, hence the outer race and the swallow. Never rejects; callers
 * exit in `.finally` so a rejection could not skip the exit either way.
 */
export async function reportFatal(err: unknown, message: string): Promise<void> {
  if (!reportingEnabled) return;
  try {
    Sentry.captureException(err, { level: "fatal", extra: { message } });
    await Promise.race([
      Sentry.flush(FLUSH_TIMEOUT_MS),
      new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS + 250)),
    ]);
  } catch {
    // Exiting matters more than reporting the exit.
  }
}
