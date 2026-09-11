import * as Sentry from "@sentry/node";
import { getEnv, logger, type AlertEvent, type TerminalJob } from "@aiugc/core";

/**
 * Error reporting for the one process with no supervisor and no dashboard.
 * Before this existed, a crash wrote one pino line to stdout and exited, and a
 * terminal job wrote nothing at all — the founder found out both ways by noticing
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
 * One event per job that has ended for good, in either of the two ways that
 * happens: `dead` (a transient failure exhausted max_attempts) and `failed` (a
 * permanent error, which never retries). `lastError` is the whole point: the
 * route from "a job ended" to why, without opening the DB.
 *
 * The status is in the TITLE, not only the tag, so the two never group into one
 * issue — an exhausted retry is a flaky provider, a permanent failure is a bug
 * or bad input, and they are answered differently. Within each, grouped by job
 * type so a flapping provider is one issue, not fifty.
 *
 * Reading `attempts: 0` on a `failed` event is not a bug: attempts counts
 * consumed retry budget, and a permanent error consumes none even though the
 * handler ran.
 */
export function reportTerminalJob(job: TerminalJob): void {
  if (!reportingEnabled) return;
  try {
    Sentry.captureMessage(`job ${job.status}: ${job.type}`, {
      level: "error",
      // workerId so a local run with a DSN can never be mistaken for the box's
      // (`local` vs `hetzner`) — two lanes share this process and the CLI runs
      // the same lanes against the same DB.
      tags: { jobType: job.type, workerId: getEnv().WORKER_ID, terminal: job.status },
      extra: {
        jobId: job.jobId,
        attempts: job.attempts,
        lastError: job.lastError,
      },
    });
  } catch {
    // A reporting fault must never become a worker fault.
  }
}

/**
 * One event per alert-worthy `events` row the web app could not report itself —
 * today an `auth_email_send_failed`, written by a Vercel function that must
 * never load the Sentry SDK (decision 0037). The worker is the only process with
 * a DSN, so it polls and reports on the web app's behalf.
 *
 * The KIND is in the TITLE, not only the tag, for the same reason `job dead` and
 * `job failed` are separate titles: two kinds that group into one issue bury
 * whichever is rarer, and these two are answered completely differently — a
 * tripped platform cap is a runaway loop or a leaked key, a failed auth email is
 * a provider ceiling and a blocked signup.
 *
 * `last24h` is the whole point of the extra: it turns "a signup failed" into
 * "the 17th today", which is the difference between a blip and the ceiling — in
 * the email itself, without opening the database.
 */
export function reportAlertEvent(event: AlertEvent): void {
  if (!reportingEnabled) return;
  try {
    Sentry.captureMessage(`alert: ${event.kind}`, {
      level: "error",
      tags: { alertKind: event.kind, workerId: getEnv().WORKER_ID },
      extra: {
        eventId: event.id,
        createdAt: event.createdAt.toISOString(),
        last24h: event.last24h,
        payload: event.payload,
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
