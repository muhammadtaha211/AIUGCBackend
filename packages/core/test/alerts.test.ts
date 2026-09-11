import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALERT_EVENT_KINDS,
  AUTH_EMAIL_FAILURE_REASONS,
  AUTH_EMAIL_FAILURE_WINDOW_MS,
  AUTH_EMAIL_SEND_FAILED,
  markEventsNotified,
  pendingAlertEvents,
  recordAuthEmailFailure,
} from "../src/alerts";
import { PLATFORM_BUDGET_TRIPPED } from "../src/budget";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { createTestDb } from "./helpers/pglite";

/**
 * The alert queue, and migration 0037 read back through the code's own schema.
 *
 * The migration is in PORTABLE_MIGRATIONS, so createTestDb applies it — which
 * makes this file the proof that `events.notified_at` and the partial index are
 * what the drizzle model says they are. A column the model disagrees with fails
 * here rather than at 3am inside the worker's sweep.
 */
describe("alert events (real DB, migration 0037 applied)", () => {
  let db: Db;
  let pg: { close(): Promise<void> };

  beforeEach(async () => {
    ({ db, pg } = await createTestDb());
  });
  afterEach(async () => {
    await pg.close();
  });

  const insertEvent = async (kind: string, ageMs = 0, notifiedAt: Date | null = null) =>
    (
      await db
        .insert(dbSchema.events)
        .values({
          kind,
          payload: {},
          notifiedAt,
          createdAt: new Date(Date.now() - ageMs),
        })
        .returning({ id: dbSchema.events.id })
    )[0]!.id;

  it("0037 landed the column the model declares — nullable timestamptz", async () => {
    const rows = await db.execute(sql`
      select data_type, is_nullable from information_schema.columns
      where table_name = 'events' and column_name = 'notified_at'
    `);
    const col = (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []))[0] as {
      data_type: string;
      is_nullable: string;
    };
    expect(col.data_type).toBe("timestamp with time zone");
    expect(col.is_nullable).toBe("YES");
  });

  it("0037 landed the partial index, and its predicate names every alert kind", async () => {
    const rows = await db.execute(sql`
      select indexdef from pg_indexes
      where tablename = 'events' and indexname = 'events_unnotified_alerts_idx'
    `);
    const def = String(
      (
        (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []))[0] as {
          indexdef?: string;
        }
      )?.indexdef ?? "",
    );
    expect(def).toMatch(/notified_at IS NULL/i);
    // The predicate repeats ALERT_EVENT_KINDS as an immutable literal — a
    // partial index cannot read the application's array. This is what catches
    // the two drifting apart.
    for (const kind of ALERT_EVENT_KINDS) expect(def).toContain(kind);
  });

  it("returns unnotified alert rows oldest first, with the 24h count of their kind", async () => {
    await insertEvent(PLATFORM_BUDGET_TRIPPED, 3 * 60_000);
    await insertEvent(AUTH_EMAIL_SEND_FAILED, 60_000);
    await insertEvent(AUTH_EMAIL_SEND_FAILED, 30_000);

    const pending = await pendingAlertEvents(db, 10);
    expect(pending.map((e) => e.kind)).toEqual([
      PLATFORM_BUDGET_TRIPPED,
      AUTH_EMAIL_SEND_FAILED,
      AUTH_EMAIL_SEND_FAILED,
    ]);
    expect(pending[0]!.last24h).toBe(1);
    // The count is per KIND — one blip vs the ceiling is the whole point of it.
    expect(pending[1]!.last24h).toBe(2);
  });

  it("counts reported rows in last24h too — it asks how often this HAPPENED", async () => {
    await insertEvent(AUTH_EMAIL_SEND_FAILED, 2 * 60_000, new Date());
    await insertEvent(AUTH_EMAIL_SEND_FAILED, 60_000);

    const pending = await pendingAlertEvents(db, 10);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.last24h).toBe(2);
  });

  it("ignores kinds that are not in the allowlist", async () => {
    await insertEvent("qc_release");
    await insertEvent("refund_resolved_to_ancestor");
    await insertEvent("content_policy_flag");
    expect(await pendingAlertEvents(db, 10)).toHaveLength(0);
  });

  it("markEventsNotified drains the queue, and an empty list is a no-op", async () => {
    const id = await insertEvent(AUTH_EMAIL_SEND_FAILED);
    await markEventsNotified(db, []);
    expect(await pendingAlertEvents(db, 10)).toHaveLength(1);

    await markEventsNotified(db, [id]);
    expect(await pendingAlertEvents(db, 10)).toHaveLength(0);
    const row = (await db.select().from(dbSchema.events).where(eq(dbSchema.events.id, id)))[0]!;
    expect(row.notifiedAt).not.toBeNull();
  });

  it("records an auth-email failure with the reason code and nothing else", async () => {
    expect(await recordAuthEmailFailure(db, "unexpected_failure")).toBe(true);

    const rows = await db.select().from(dbSchema.events);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe(AUTH_EMAIL_SEND_FAILED);
    // Bounded: the payload is the reason and NOTHING else. The route that
    // writes these is unauthenticated, so no address and no user text may
    // survive into the row.
    expect(rows[0]!.payload).toEqual({ reason: "unexpected_failure" });
    expect(rows[0]!.businessId).toBeNull();
    expect(rows[0]!.actorUserId).toBeNull();
    expect(rows[0]!.subjectId).toBeNull();
    expect(rows[0]!.notifiedAt).toBeNull();
  });

  it("rate-limits itself in the DATABASE — a second failure inside the window writes nothing", async () => {
    expect(await recordAuthEmailFailure(db, "unexpected_failure")).toBe(true);
    expect(await recordAuthEmailFailure(db, "over_email_send_rate_limit")).toBe(false);
    expect(await recordAuthEmailFailure(db, "unexpected_failure")).toBe(false);
    expect(await db.select().from(dbSchema.events)).toHaveLength(1);
  });

  it("writes again once the window has passed", async () => {
    await insertEvent(AUTH_EMAIL_SEND_FAILED, AUTH_EMAIL_FAILURE_WINDOW_MS + 60_000);
    expect(await recordAuthEmailFailure(db, "unexpected_failure")).toBe(true);
    expect(await db.select().from(dbSchema.events)).toHaveLength(2);
  });

  it("every reason code round-trips, so the route's allowlist cannot drift", async () => {
    for (const reason of AUTH_EMAIL_FAILURE_REASONS) {
      await db.delete(dbSchema.events);
      expect(await recordAuthEmailFailure(db, reason)).toBe(true);
      expect((await db.select().from(dbSchema.events))[0]!.payload).toEqual({ reason });
    }
  });
});
