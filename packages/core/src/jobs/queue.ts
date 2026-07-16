import { eq, sql } from "drizzle-orm";
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

export async function failTransient(db: Db, job: Job, message: string): Promise<void> {
  const failures = job.attempts + 1;
  const dead = failures >= job.maxAttempts;
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
