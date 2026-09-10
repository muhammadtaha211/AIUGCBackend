import type { Db } from "../db";
import { logger, type Logger } from "../logger";
import { BudgetError, PermanentError } from "./errors";
import {
  checkpoint,
  claim,
  complete,
  failPermanent,
  failTransient,
  isLastAttempt,
  parkForBudget,
  recoverExpiredLeases,
  reschedule,
  type Job,
} from "./queue";

export type JobResult =
  { kind: "done" } | { kind: "reschedule"; delayMs: number; state?: Record<string, unknown> };

export interface JobContext {
  db: Db;
  log: Logger;
  /** Persist resumable state BEFORE awaiting an external side effect. */
  checkpoint: (state: Record<string, unknown>) => Promise<void>;
}

export type JobHandler = (job: Job, ctx: JobContext) => Promise<JobResult>;

export type HandlerRegistry = Record<string, JobHandler>;

/**
 * What a caller needs to report a job that has ended for good, without going
 * back to the DB — `lastError` above all, which is the only route from "a job
 * ended" to why. There are exactly two such endings and they are different
 * problems: `dead` is a transient failure that exhausted `max_attempts`,
 * `failed` is a permanent error, which never retries at all.
 *
 * `attempts` is always the value that was WRITTEN to the row, so an event can
 * never disagree with the row it describes. On the `failed` path that means
 * the row's own count, unincremented — `attempts` counts consumed retry
 * budget, not executions, and a permanent error consumes none.
 */
export interface TerminalJob {
  jobId: string;
  type: string;
  status: "dead" | "failed";
  attempts: number;
  lastError: string;
}

/**
 * Hand a terminal job to the caller's reporter. Swallows everything: reporting
 * is out-of-band on a path that must never gain a failure mode of its own.
 */
function reportTerminal(
  onJobTerminal: ((job: TerminalJob) => void) | undefined,
  log: Logger,
  terminal: TerminalJob,
): void {
  try {
    const reported: unknown = onJobTerminal?.(terminal);
    // `=> void` does not stop an async callback — TypeScript assigns a
    // `() => Promise<void>` to it happily — and an unawaited rejection would
    // land on index.ts's unhandledRejection handler, i.e. kill the worker.
    // Catch that shape too; the catch below only sees a synchronous throw.
    if (reported && typeof (reported as PromiseLike<void>).then === "function") {
      void Promise.resolve(reported).catch((asyncErr: unknown) => {
        log.warn({ err: asyncErr }, "terminal-job report failed");
      });
    }
  } catch (reportErr) {
    log.warn({ err: reportErr }, "terminal-job report failed");
  }
}

/** Run one claimed job through its handler and settle its status. */
export async function runJob(
  db: Db,
  job: Job,
  handlers: HandlerRegistry,
  onJobTerminal?: (job: TerminalJob) => void,
): Promise<void> {
  const log = logger.child({ jobId: job.id, jobType: job.type });
  const handler = handlers[job.type];
  if (!handler) {
    const message = `no handler registered for job type "${job.type}"`;
    try {
      await failPermanent(db, job.id, message);
      // Terminal too, and the most invisible of the three: no handler ran, so
      // no domain row was touched and nothing else will ever mention this job.
      reportTerminal(onJobTerminal, log, {
        jobId: job.id,
        type: job.type,
        status: "failed",
        attempts: job.attempts,
        lastError: message,
      });
    } catch (writeErr) {
      // `err` key on purpose: pino only serializes Errors under that key.
      log.error({ err: writeErr }, "recovery write failed — lease sweep will reclaim the job");
    }
    log.error("no handler for job type");
    return;
  }

  try {
    const result = await handler(job, {
      db,
      log,
      checkpoint: (state) => checkpoint(db, job.id, state),
    });
    if (result.kind === "reschedule") {
      await reschedule(db, job.id, { delayMs: result.delayMs, state: result.state });
      log.info({ delayMs: result.delayMs }, "job rescheduled");
    } else {
      await complete(db, job.id);
      log.info("job succeeded");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The settle write can hit the same dead DB that failed the job. Swallow:
    // the row stays `running` and the lease sweep reclaims it (consuming an
    // attempt) — a delayed retry must not become a lane crash.
    try {
      if (err instanceof PermanentError) {
        await failPermanent(db, job.id, message);
        log.warn({ err }, "job failed permanently");
        // `failed` is terminal exactly like `dead`, and costs more: a permanent
        // error never retries, and the handler may already have paid a provider
        // before throwing (two lipsync jobs burned a HeyGen charge each on
        // 2026-09-06 and settled here in silence). AFTER the write, like the
        // dead path — a settle that threw leaves the row `running` for the
        // sweep, and nothing has ended.
        reportTerminal(onJobTerminal, log, {
          jobId: job.id,
          type: job.type,
          status: "failed",
          attempts: job.attempts,
          lastError: message,
        });
      } else if (err instanceof BudgetError) {
        await parkForBudget(db, job.id, message, err.resumeAt);
        log.warn({ resumeAt: err.resumeAt }, "job parked: budget cap");
      } else {
        await failTransient(db, job, message);
        log.warn({ err, attempts: job.attempts + 1 }, "job failed transiently");
        // The same predicate failTransient just used, on the same snapshot, so
        // the two can never disagree about whether that was the last attempt.
        // AFTER the write on purpose: a settle that threw leaves the row
        // `running` for the lease sweep, and nothing has died yet. Swallowed
        // like every other out-of-band call on this path — a reporting fault
        // must not become a job fault (apps/worker passes its Sentry hook).
        if (isLastAttempt(job)) {
          reportTerminal(onJobTerminal, log, {
            jobId: job.id,
            type: job.type,
            status: "dead",
            attempts: job.attempts + 1,
            lastError: message,
          });
        }
      }
    } catch (writeErr) {
      // writeErr as a string: pino only serializes Errors under the `err` key,
      // which stays on the job failure — the context the founder needs first.
      log.error(
        { err, writeErr: writeErr instanceof Error ? writeErr.message : String(writeErr) },
        "recovery write failed — lease sweep will reclaim the job",
      );
    }
  }
}

export interface WorkerLaneOptions {
  workerId: string;
  handlers: HandlerRegistry;
  /** Restrict this lane to specific job types (undefined = all types). */
  types?: readonly string[];
  pollIntervalMs?: number;
  /** Process until the queue is empty, then return (CLI `work --once`). */
  drainAndExit?: boolean;
  signal?: AbortSignal;
  /**
   * Called once per job that has just been written to a terminal status —
   * `dead` (attempts exhausted) or `failed` (a permanent error, including a
   * job whose type has no registered handler). apps/worker passes its Sentry
   * reporter here; the CLI passes nothing, so `aiugc work --once` stays
   * silent. A plain function type on purpose — core is bundled by the Next.js
   * apps and must never import a node-only reporting SDK.
   *
   * One terminal write is still not covered: the lease sweep
   * (`recoverExpiredLeases`) also writes `dead`, in one set-based UPDATE that
   * returns a count rather than rows, so it has no per-job hook to fire.
   */
  onJobTerminal?: (job: TerminalJob) => void;
}

/**
 * A lane claims and runs jobs strictly sequentially. The worker app runs two
 * lanes in one process: "heavy" (render_video, lipsync) and "light"
 * (everything else), so a 5-minute Remotion render never blocks an audio
 * preview the user is waiting on.
 */
export async function runLane(db: Db, opts: WorkerLaneOptions): Promise<void> {
  const pollIntervalMs = opts.pollIntervalMs ?? 2000;
  let lastLeaseSweep = 0;
  let claimFailures = 0;
  for (;;) {
    if (opts.signal?.aborted) return;
    // Lane-level on purpose: a stuck job can only be healed from OUTSIDE the
    // job system's running state — the reaper is itself a job and was the
    // first victim. Swallowed errors: a sweep blip must not add a crash path.
    if (Date.now() - lastLeaseSweep > LEASE_SWEEP_INTERVAL_MS) {
      lastLeaseSweep = Date.now();
      try {
        const reclaimed = await recoverExpiredLeases(db);
        if (reclaimed > 0) {
          logger.warn({ reclaimed, workerId: opts.workerId }, "lease sweep: reclaimed stuck jobs");
        }
      } catch (err) {
        logger.warn({ err }, "lease sweep failed — retrying next interval");
      }
    }
    // Same shape as the sweep guard, for the poll that runs every 2s forever:
    // a fault on an in-flight claim (recycled pooler socket) killed the worker
    // twice — docs/vault/defects/worker-exits-on-a-dropped-connection.md.
    // Drain mode (`work --once`) still fails fast on a PERSISTENT fault: it
    // promises to exit, so it must not warn-spin forever on a dead DB.
    let job: Job | undefined;
    try {
      job = await claim(db, { workerId: opts.workerId, types: opts.types });
      claimFailures = 0;
    } catch (err) {
      claimFailures += 1;
      if (opts.drainAndExit && claimFailures >= DRAIN_CLAIM_FAILURE_LIMIT) throw err;
      logger.warn({ err, workerId: opts.workerId }, "claim failed — retrying after poll interval");
      await sleep(pollIntervalMs, opts.signal);
      continue;
    }
    if (!job) {
      if (opts.drainAndExit) return;
      await sleep(pollIntervalMs, opts.signal);
      continue;
    }
    await runJob(db, job, opts.handlers, opts.onJobTerminal);
  }
}

const LEASE_SWEEP_INTERVAL_MS = 60_000;

// Three consecutive claim failures (~4s of retrying) before a draining lane
// gives up and lets the error propagate: one pooler blip recovers, a wrong
// DATABASE_URL exits non-zero instead of hanging the CLI.
const DRAIN_CLAIM_FAILURE_LIMIT = 3;

// analyze_demo is heavy on purpose: minutes of ffmpeg + batched vision calls
// serialise behind Remotion renders rather than blocking Service B's audio
// previews on the strictly-sequential light lane.
export const HEAVY_JOB_TYPES = ["render_video", "lipsync", "analyze_demo"] as const;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  // An already-aborted signal never fires "abort" — don't wait out the timer.
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
