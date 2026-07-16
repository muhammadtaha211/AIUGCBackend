import type { Db } from "../db";
import { enqueue } from "./queue";

/**
 * Daily maintenance jobs are regular queue rows, deduped by a per-day
 * idempotency key. Callers (the worker loop, or `aiugc work`) invoke this
 * opportunistically; ON CONFLICT makes it free to call often.
 */
export async function ensureDailyJobs(db: Db, now: Date = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  await enqueue(db, { type: "janitor", idempotencyKey: `janitor:${day}` });
  await enqueue(db, { type: "billing_renewals", idempotencyKey: `billing_renewals:${day}` });
}
