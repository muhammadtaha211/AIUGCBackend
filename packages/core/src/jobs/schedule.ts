import type { Db } from "../db";
import { enqueue } from "./queue";

/**
 * Daily maintenance jobs are regular queue rows, deduped by a per-day
 * idempotency key. Only the server worker (apps/worker) calls this — `aiugc
 * work` deliberately does not, so retention deletes never run from a CLI-only
 * machine. ON CONFLICT makes it free to call often.
 */
export async function ensureDailyJobs(db: Db, now: Date = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  await enqueue(db, { type: "janitor", idempotencyKey: `janitor:${day}` });
  await enqueue(db, { type: "billing_renewals", idempotencyKey: `billing_renewals:${day}` });
  // Social posting (0101): one cheap call per connected account marks a lapsed
  // token `expired` before a scheduled post would fail on it.
  await enqueue(db, { type: "check_social_tokens", idempotencyKey: `check_social_tokens:${day}` });
}

/**
 * The dead-render reaper is a SINGLETON: one row under a constant key that
 * reschedules itself every ~60s forever (a dated per-minute key would dump
 * 1,440 noise rows a day into the jobs table, which doubles as the ops
 * dashboard). Unlike the daily jobs this IS called by `aiugc work` too —
 * repairing stuck renders is wanted on every machine that runs jobs, retention
 * deletes are not. maxAttempts is effectively infinite because a singleton's
 * attempts never reset and a dead reaper would stay dead silently.
 */
export async function ensureReaperJob(db: Db): Promise<void> {
  await enqueue(db, {
    type: "reap_dead_renders",
    idempotencyKey: "reap_dead_renders",
    maxAttempts: 1_000_000,
  });
}
