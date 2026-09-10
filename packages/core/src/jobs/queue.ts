import { desc, eq, like, sql } from "drizzle-orm";
import type { Db } from "../db";
import { jobs } from "../db/schema";

export type Job = typeof jobs.$inferSelect;

export interface EnqueueOptions {
  type: string;
  /**
   * One logical piece of work = one key (e.g. `render:{videoRenderId}`).
   * Enqueueing the same key twice is a no-op that returns the existing job.
   */
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  maxAttempts?: number;
}

export async function enqueue(
  db: Db,
  opts: EnqueueOptions,
): Promise<{ job: Job; created: boolean }> {
  const inserted = await db
    .insert(jobs)
    .values({
      type: opts.type,
      idempotencyKey: opts.idempotencyKey,
      payload: opts.payload ?? {},
      runAt: opts.runAt ?? new Date(),
      ...(opts.maxAttempts !== undefined ? { maxAttempts: opts.maxAttempts } : {}),
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning();

  const job = inserted[0];
  if (job) return { job, created: true };

  const existing = await db
    .select()
    .from(jobs)
    .where(eq(jobs.idempotencyKey, opts.idempotencyKey))
    .limit(1);
  if (!existing[0]) throw new Error(`enqueue: conflict but no row for key ${opts.idempotencyKey}`);
  return { job: existing[0], created: false };
}

/**
 * Atomically claim the next runnable job (oldest run_at first).
 * FOR UPDATE SKIP LOCKED makes this safe with multiple workers — which is a
 * real scenario: the founder's `aiugc work` and the server worker can run
 * against the same database at the same time.
 */
export async function claim(
  db: Db,
  opts: { workerId: string; types?: readonly string[] },
): Promise<Job | undefined> {
  const typeFilter =
    opts.types && opts.types.length > 0
      ? sql` and type = any(array[${sql.join(
          opts.types.map((t) => sql`${t}`),
          sql`, `,
        )}]::text[])`
      : sql``;

  const result = await db.execute(sql`
    update jobs set
      status = 'running',
      locked_at = now(),
      locked_by = ${opts.workerId},
      updated_at = now()
    where id = (
      select id from jobs
      where status = 'queued' and run_at <= now()${typeFilter}
      order by run_at
      limit 1
      for update skip locked
    )
    returning *
  `);

  const rows = rowsOf(result);
  const row = rows[0];
  return row ? rowToJob(row) : undefined;
}

/**
 * How long a claimed job may hold its lock before the lease sweep decides its
 * worker died mid-run. Ceiling measured on prod 2026-08-09: render_video holds
 * the lock for the whole Remotion render — 313s worst observed (avg 137s);
 * every other type is under a minute (lipsync/composites release the lock on
 * each poll hop). 30min errs long on purpose: reclaiming a job that is merely
 * slow double-runs it, while waiting on a dead one costs only latency — the
 * reaper still repairs the render within a minute of the job going dead.
 */
export const JOB_LEASE_MS = 30 * 60_000;

/**
 * The net under a worker killed between claim and completion: without this,
 * a `running` job stays `running` forever — never dead, never requeued,
 * invisible to the reaper (the stuck reaper singleton was one instance).
 * Reclaiming CONSUMES AN ATTEMPT, mirroring failTransient's arithmetic: a job
 * that reliably kills its worker exhausts its attempts and goes dead — into
 * the machinery that already fails-and-refunds — instead of looping forever.
 * Handlers are resumable by design (checkpoint before external spend), so a
 * reclaimed job polls its provider instead of paying twice.
 */
export async function recoverExpiredLeases(
  db: Db,
  leaseMs: number = JOB_LEASE_MS,
): Promise<number> {
  const result = await db.execute(sql`
    update jobs set
      status = (case when attempts + 1 >= max_attempts then 'dead' else 'queued' end)::job_status,
      attempts = attempts + 1,
      error_class = 'transient'::error_class,
      last_error = 'lease expired: worker died mid-run (was locked by ' || coalesce(locked_by, '?') || ')',
      updated_at = now()
    where status = 'running' and locked_at < now() - (${leaseMs} * interval '1 millisecond')
    returning id
  `);
  return rowsOf(result).length;
}

export async function complete(db: Db, jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({ status: "succeeded", updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

/**
 * Put a running job back in the queue to continue later (polling external
 * work, e.g. a fal lip-sync request). Does not consume an attempt.
 */
export async function reschedule(
  db: Db,
  jobId: string,
  opts: { delayMs: number; state?: Record<string, unknown> },
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "queued",
      runAt: new Date(Date.now() + opts.delayMs),
      updatedAt: new Date(),
      ...(opts.state !== undefined ? { state: opts.state } : {}),
    })
    .where(eq(jobs.id, jobId));
}

/**
 * Persist resumable state on a running job. Call BEFORE awaiting an external
 * side effect (e.g. right after a provider accepts a submission), so a crash
 * or retry resumes/polls instead of re-submitting.
 */
export async function checkpoint(
  db: Db,
  jobId: string,
  state: Record<string, unknown>,
): Promise<void> {
  await db.update(jobs).set({ state, updatedAt: new Date() }).where(eq(jobs.id, jobId));
}

export function backoffMs(failureCount: number): number {
  const base = Math.min(30_000 * 2 ** Math.max(0, failureCount - 1), 15 * 60_000);
  return base + Math.floor(Math.random() * 10_000);
}

export async function failPermanent(db: Db, jobId: string, message: string): Promise<void> {
  await db
    .update(jobs)
    .set({ status: "failed", errorClass: "permanent", lastError: message, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

/**
 * True when one more failure kills the job. The single definition of "last
 * attempt" — failTransient and the render handlers' terminal path both call
 * this, so the two can never disagree about when a job dies.
 */
export function isLastAttempt(job: Pick<Job, "attempts" | "maxAttempts">): boolean {
  return job.attempts + 1 >= job.maxAttempts;
}

export async function failTransient(db: Db, job: Job, message: string): Promise<void> {
  const failures = job.attempts + 1;
  const dead = isLastAttempt(job);
  await db
    .update(jobs)
    .set({
      status: dead ? "dead" : "queued",
      attempts: failures,
      errorClass: "transient",
      lastError: message,
      runAt: dead ? job.runAt : new Date(Date.now() + backoffMs(failures)),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, job.id));
}

export async function parkForBudget(
  db: Db,
  jobId: string,
  message: string,
  resumeAt: Date,
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "queued",
      errorClass: "budget",
      lastError: message,
      runAt: resumeAt,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

// ---------------------------------------------------------------------------
// Job progress (read-only): what the customer-facing wait surfaces show.
// The queue has no push channel, so "is anything processing this" is derived
// from two rows the system already maintains: the job itself and the reaper
// singleton, whose ~60s self-reschedule doubles as a worker heartbeat.
// ---------------------------------------------------------------------------

/**
 * How stale the reaper row may be before "no worker is claiming". The reaper
 * reschedules itself every ~60s on the light lane; 3 minutes absorbs a slow
 * cycle and clock skew without leaving a dead worker undetected for long.
 * NB: the light lane claims the reaper, so a wedged HEAVY lane still reads
 * "alive" — the 30min job lease is the backstop for that case.
 */
export const WORKER_HEARTBEAT_STALE_MS = 3 * 60_000;

/**
 * A queued job whose run_at sits further than this in the future is
 * deliberately SCHEDULED (transient backoff, budget park) — "starts soon"
 * would be a lie, so JobProgress carries resumeAtMs instead. First-retry
 * backoff (~30-40s) stays under it and keeps reading as an ordinary wait.
 */
export const JOB_DELAY_VISIBLE_MS = 60_000;

export type WorkerHeartbeat = "alive" | "stale" | "unknown";

export type JobProgress = {
  /** missing = no job row (nothing was ever enqueued, or the janitor purged it). */
  state: "missing" | "queued" | "running" | "failed" | "done";
  /** Same-lane jobs that will run first (claim order = run_at). Only set for
   *  queued jobs when the caller named the lane's types. */
  ahead?: number;
  /** Queued: since enqueue (createdAt — backoff moves runAt, not the wait the
   *  customer has felt). Running: since the claim. */
  elapsedMs?: number;
  /** Running only: the handler's own 0-1 fraction, when it checkpoints one
   *  (state.renderProgress — today only render_video writes it, from
   *  renderMedia's frame loop). Frames only: bundling and the upload after
   *  sit outside it, so elapsedMs stays the primary signal. */
  progress?: number;
  /** Queued jobs pushed meaningfully into the future (backoff, budget park):
   *  when they will next be runnable. Absent = runnable now-ish. */
  resumeAtMs?: number;
  heartbeat: WorkerHeartbeat;
};

/**
 * Pure derivation — exported for tests; getJobProgress feeds it.
 *
 * The heartbeat is TWO signals, either one proves a worker: a fresh reaper
 * row, or ANY running job whose lock is inside the lease. The reaper alone is
 * not enough — it shares the strictly-sequential light lane, so a single long
 * light job (a 1GB demo ingest) starves it past the stale window and the wait
 * surfaces would tell the very customer whose demo IS being processed that
 * nothing is processing it. The lease-bounded running lock closes that hole;
 * the cost is a wedged worker reading "alive" for at most JOB_LEASE_MS.
 */
export function deriveJobProgress(opts: {
  job?: Pick<Job, "status" | "lockedAt" | "createdAt" | "runAt"> & { state?: unknown };
  aheadCount?: number;
  heartbeatAt?: Date;
  /** Newest locked_at across ALL running jobs (any lane), if any. */
  runningLockedAt?: Date;
  now: Date;
}): JobProgress {
  const reaperFresh =
    opts.heartbeatAt !== undefined &&
    opts.now.getTime() - opts.heartbeatAt.getTime() <= WORKER_HEARTBEAT_STALE_MS;
  const leaseFresh =
    opts.runningLockedAt !== undefined &&
    opts.now.getTime() - opts.runningLockedAt.getTime() <= JOB_LEASE_MS;
  const heartbeat: WorkerHeartbeat =
    reaperFresh || leaseFresh ? "alive" : opts.heartbeatAt === undefined ? "unknown" : "stale";
  const job = opts.job;
  if (!job) return { state: "missing", heartbeat };
  if (job.status === "queued") {
    const delayMs = job.runAt.getTime() - opts.now.getTime();
    return {
      state: "queued",
      ...(opts.aheadCount !== undefined ? { ahead: opts.aheadCount } : {}),
      elapsedMs: Math.max(0, opts.now.getTime() - job.createdAt.getTime()),
      ...(delayMs > JOB_DELAY_VISIBLE_MS ? { resumeAtMs: job.runAt.getTime() } : {}),
      heartbeat,
    };
  }
  if (job.status === "running") {
    const since = job.lockedAt ?? job.createdAt;
    // Defensive read off the checkpoint jsonb — anything but a 0-1 number
    // (older rows, other handlers' state shapes) simply doesn't surface.
    const fraction = (job.state as { renderProgress?: unknown } | null | undefined)?.renderProgress;
    return {
      state: "running",
      elapsedMs: Math.max(0, opts.now.getTime() - since.getTime()),
      ...(typeof fraction === "number" && fraction >= 0 && fraction <= 1
        ? { progress: fraction }
        : {}),
      heartbeat,
    };
  }
  if (job.status === "succeeded") return { state: "done", heartbeat };
  return { state: "failed", heartbeat };
}

/**
 * Progress of one job by its idempotency key. `aheadOfTypes` is the job's
 * LANE (e.g. HEAVY_JOB_TYPES for analyze_demo) — passed in by the caller so
 * this module never imports lane policy from worker.ts (cycle). Ahead counts
 * runnable same-lane jobs that claim() would pick first, plus the one running.
 * `newestMatching` treats the key as a PREFIX and reads the newest job under
 * it — for families like analyze:{demoId} / analyze:{demoId}:rN (founder
 * re-runs), where pinning the bare key would report the first attempt's
 * corpse forever while the live retry runs.
 */
export async function getJobProgress(
  db: Db,
  opts: { idempotencyKey: string; aheadOfTypes?: readonly string[]; newestMatching?: boolean },
): Promise<JobProgress> {
  const now = new Date();
  const jobRows = await db
    .select()
    .from(jobs)
    .where(
      opts.newestMatching
        ? like(jobs.idempotencyKey, `${opts.idempotencyKey}%`)
        : eq(jobs.idempotencyKey, opts.idempotencyKey),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  const job = jobRows[0];

  const reaperRows = await db
    .select({ updatedAt: jobs.updatedAt })
    .from(jobs)
    .where(eq(jobs.idempotencyKey, "reap_dead_renders"))
    .limit(1);

  const runningRows = await db.execute(
    sql`select max(locked_at) as m from jobs where status = 'running'`,
  );
  const rawRunning = rowsOf(runningRows)[0]?.m;
  const runningLockedAt = rawRunning == null ? undefined : toDate(rawRunning);

  let aheadCount: number | undefined;
  if (job?.status === "queued" && opts.aheadOfTypes && opts.aheadOfTypes.length > 0) {
    const laneTypes = sql`array[${sql.join(
      opts.aheadOfTypes.map((t) => sql`${t}`),
      sql`, `,
    )}]::text[]`;
    // toISOString, not the Date: raw-sql params skip drizzle's column mappers,
    // and drizzle disables postgres-js's own Date serializer — a Date here
    // reaches the wire encoder unserialized and throws ERR_INVALID_ARG_TYPE.
    // PGlite (tests) serializes Dates fine, so only production sees the throw.
    const result = await db.execute(sql`
      select
        count(*) filter (
          where status = 'queued' and run_at < ${job.runAt.toISOString()} and id <> ${job.id}
        )
        + count(*) filter (where status = 'running') as n
      from jobs where type = any(${laneTypes})
    `);
    aheadCount = Number(rowsOf(result)[0]?.n ?? 0);
  }

  return deriveJobProgress({
    job,
    aheadCount,
    heartbeatAt: reaperRows[0]?.updatedAt,
    runningLockedAt,
    now,
  });
}

// ---------------------------------------------------------------------------
// Raw-row mapping for the claim query (drizzle returns snake_case for raw SQL,
// and the two drivers wrap results differently).
// ---------------------------------------------------------------------------

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const maybe = result as { rows?: Record<string, unknown>[] };
  return maybe.rows ?? [];
}

function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    type: row.type as string,
    status: row.status as Job["status"],
    payload: row.payload as Record<string, unknown>,
    state: row.state as Record<string, unknown>,
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
    runAt: toDate(row.run_at),
    lockedAt: toDate(row.locked_at),
    lockedBy: row.locked_by as string | null,
    idempotencyKey: row.idempotency_key as string,
    lastError: row.last_error as string | null,
    errorClass: row.error_class as Job["errorClass"],
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(v as string);
}
