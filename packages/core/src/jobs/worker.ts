import type { Db } from "../db";
import { logger, type Logger } from "../logger";
import { BudgetError, PermanentError } from "./errors";
import {
  checkpoint,
  claim,
  complete,
  failPermanent,
  failTransient,
  parkForBudget,
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

/** Run one claimed job through its handler and settle its status. */
export async function runJob(db: Db, job: Job, handlers: HandlerRegistry): Promise<void> {
  const log = logger.child({ jobId: job.id, jobType: job.type });
  const handler = handlers[job.type];
  if (!handler) {
    await failPermanent(db, job.id, `no handler registered for job type "${job.type}"`);
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
    if (err instanceof PermanentError) {
      await failPermanent(db, job.id, message);
      log.warn({ err }, "job failed permanently");
    } else if (err instanceof BudgetError) {
      await parkForBudget(db, job.id, message, err.resumeAt);
      log.warn({ resumeAt: err.resumeAt }, "job parked: budget cap");
    } else {
      await failTransient(db, job, message);
      log.warn({ err, attempts: job.attempts + 1 }, "job failed transiently");
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
}

/**
 * A lane claims and runs jobs strictly sequentially. The worker app runs two
 * lanes in one process: "heavy" (render_video, lipsync) and "light"
 * (everything else), so a 5-minute Remotion render never blocks an audio
 * preview the user is waiting on.
 */
export async function runLane(db: Db, opts: WorkerLaneOptions): Promise<void> {
  const pollIntervalMs = opts.pollIntervalMs ?? 2000;
  for (;;) {
    if (opts.signal?.aborted) return;
    const job = await claim(db, { workerId: opts.workerId, types: opts.types });
    if (!job) {
      if (opts.drainAndExit) return;
      await sleep(pollIntervalMs, opts.signal);
      continue;
    }
    await runJob(db, job, opts.handlers);
  }
}

export const HEAVY_JOB_TYPES = ["render_video", "lipsync"] as const;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
