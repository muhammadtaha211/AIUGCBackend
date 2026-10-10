import { and, asc, gt, inArray, isNull, sql } from "drizzle-orm";
import { PLATFORM_BUDGET_TRIPPED } from "./budget";
import type { Db } from "./db";
import { events } from "./db/schema";

/**
 * The alert queue: `events` rows that somebody should be told about out of
 * band, and the two functions that drain them.
 *
 * **Core never imports a reporting SDK.** That boundary is
 * decisions/0037-the-worker-reports-to-sentry-the-web-apps-do-not and it is
 * load-bearing: `packages/core` is bundled by `apps/web` and `apps/admin`, which
 * run on Vercel, so a node-only SDK in here would be pulled toward their bundles
 * for no benefit. This module therefore knows only how to READ the queue and
 * MARK it drained. Who reports, and to what, is apps/worker's problem
 * (`apps/worker/src/reporting.ts` + the sweep in `apps/worker/src/index.ts`).
 *
 * `aiugc work --once` stays silent by construction for the same reason it does
 * for terminal jobs: the CLI runs core's lanes and never the worker's own sweep.
 */

/**
 * events.kind: a signup could not complete because the confirmation email was
 * not sent. Written by the web app, which cannot report anything itself.
 *
 * Signup depends on Resend since 2026-09-11, and the real ceiling is 100/day at
 * the provider — not the 100/hour Supabase Rate Limit, which would permit 2,400
 * (docs/vault/facts/auth-email-runs-through-resend.md). When it is spent Resend
 * refuses, `signUp` returns an error, and an account cannot be created.
 *
 * The payload is a bounded reason code and nothing else: the route that writes
 * it is necessarily unauthenticated, so it must never store an email address or
 * any user-supplied text.
 */
export const AUTH_EMAIL_SEND_FAILED = "auth_email_send_failed";

/**
 * Every value an `auth_email_send_failed` payload may carry. Closed on purpose:
 * the route that writes these rows is necessarily unauthenticated — a signup
 * that could not complete has no session — so the only thing standing between
 * a stranger and the founder's alert channel is this list plus the window below.
 * Anything else is rejected before a row is built.
 *
 * Both values are GoTrue error codes, verified against the installed
 * `@supabase/auth-js` `ErrorCode` union
 * (node_modules/.../auth-js/dist/main/lib/error-codes.d.ts). That union has NO
 * email-send-specific member — it has `sms_send_failed` and no email twin — so
 * an SMTP refusal surfaces as the 500 catch-all, `unexpected_failure`.
 */
export const AUTH_EMAIL_FAILURE_REASONS = [
  "unexpected_failure",
  "over_email_send_rate_limit",
] as const;

export type AuthEmailFailureReason = (typeof AUTH_EMAIL_FAILURE_REASONS)[number];

/**
 * How long one recorded failure suppresses the next. The alert's job is to say
 * "the ceiling is hit", which one row says as well as two hundred — and the
 * report carries a 24h count, so nothing is lost by collapsing a burst.
 */
export const AUTH_EMAIL_FAILURE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Record that a signup could not complete because its confirmation email was
 * not sent. Returns whether a row actually landed.
 *
 * **The rate limit is in the DATABASE, not in process memory.** The writer is a
 * Vercel function: there is no shared state across invocations to hold a counter
 * in, and an in-process guard would reset on every cold start — i.e. it would
 * not be a guard at all. One guarded `INSERT ... WHERE NOT EXISTS` gives the
 * same answer to every invocation at once and needs nothing to coordinate them.
 *
 * The row carries the reason code and nothing else. No email address, no
 * password, no user-supplied text of any kind. The timestamp is `created_at` —
 * the column, not a duplicate inside the payload.
 */
export async function recordAuthEmailFailure(
  db: Db,
  reason: AuthEmailFailureReason,
): Promise<boolean> {
  const result = await db.execute(sql`
    insert into events (kind, payload)
    select ${AUTH_EMAIL_SEND_FAILED}, ${JSON.stringify({ reason })}::jsonb
    where not exists (
      select 1 from events
      where kind = ${AUTH_EMAIL_SEND_FAILED}
        and created_at > now() - (${AUTH_EMAIL_FAILURE_WINDOW_MS} * interval '1 millisecond')
    )
    returning id
  `);
  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  return rows.length > 0;
}

/**
 * events.kind: a scheduled social post failed for good (pipelines/social.ts,
 * decision 0101). The customer reads the failure in the app; this row is the
 * founder's side of "nothing fails silently". Payload: the post id, the
 * platform, the closed failure kind and the first 200 characters of the
 * diagnostic — never the caption or any customer text. 0059 rebuilt the
 * partial index with this kind.
 */
export const POST_FAILED = "post_failed";

/**
 * The allowlist. An events kind is reported only if it is in here, so the many
 * kinds that are ordinary bookkeeping — `qc_release`, `refund_resolved_to_ancestor`,
 * `content_policy_flag` and the rest — cost nothing and can never turn into mail.
 *
 * **Adding a kind here is not enough to keep the sweep fast.** The partial index
 * `events_unnotified_alerts_idx` (migration 0037, rebuilt by 0059) repeats this
 * list as an immutable literal, because a partial-index predicate cannot read an
 * array from the application. A kind added here without a migration that
 * rebuilds the index still works — it is just an unindexed scan.
 */
export const ALERT_EVENT_KINDS = [
  PLATFORM_BUDGET_TRIPPED,
  AUTH_EMAIL_SEND_FAILED,
  POST_FAILED,
] as const;

export interface AlertEvent {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  /** Rows of the SAME kind in the trailing 24h, this one included. */
  last24h: number;
}

/**
 * Alert-worthy events nobody has been told about yet, oldest first.
 *
 * `last24h` rides along because it is the difference between "one blip" and
 * "the ceiling", and the reporter must not have to go back to the database to
 * find out which it is looking at. It is computed per kind over the whole table,
 * so it counts reported rows too — the question is how often this has HAPPENED,
 * not how often it has been reported.
 */
export async function pendingAlertEvents(db: Db, limit: number): Promise<AlertEvent[]> {
  const rows = await db
    .select({
      id: events.id,
      kind: events.kind,
      payload: events.payload,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(and(isNull(events.notifiedAt), inArray(events.kind, [...ALERT_EVENT_KINDS])))
    .orderBy(asc(events.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];

  // A second query rather than a correlated subquery: the count must include
  // rows that were already reported, so it cannot be derived from the page
  // above, and one grouped count over at most two kinds is cheaper to read than
  // it is to make a correlated scalar behave.
  const counts = await db
    .select({ kind: events.kind, n: sql<string>`count(*)` })
    .from(events)
    .where(
      and(
        inArray(events.kind, [...ALERT_EVENT_KINDS]),
        gt(events.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    )
    .groupBy(events.kind);
  const last24h = new Map(counts.map((row) => [row.kind, Number(row.n ?? 0)]));

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    last24h: last24h.get(row.kind) ?? 0,
  }));
}

/**
 * Mark rows reported. Called AFTER the report, so a reporter that dies mid-sweep
 * repeats an alert rather than losing one — the cheaper of the two failures for
 * something whose whole job is to be noticed.
 */
export async function markEventsNotified(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.update(events).set({ notifiedAt: new Date() }).where(inArray(events.id, ids));
}
