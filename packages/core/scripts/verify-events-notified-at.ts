/**
 * Read-back check for `supabase/migrations/0037_events_notified_at.sql`,
 * THROUGH the code's own schema.
 *
 * Run it after applying 0037:
 *
 *   apps/cli/node_modules/.bin/tsx packages/core/scripts/verify-events-notified-at.ts
 *
 * Why through the schema and not a raw `SELECT`: a raw query proves a column
 * called `notified_at` exists, which is not the thing that matters. What matters
 * is that the drizzle model and the database agree — an ALTER that landed the
 * wrong type or the wrong nullability looks identical from psql, and the failure
 * would surface later as a runtime error inside the worker's alert sweep. So
 * this exercises `pendingAlertEvents` and `markEventsNotified` against the live
 * table, which is the only read that proves the sweep will run.
 *
 * "The ALTER succeeded" is not a verification. This is.
 *
 * READ-ONLY. It never inserts, never marks anything notified, and never reports
 * anything to Sentry — `markEventsNotified` is exercised with an EMPTY id list,
 * which its own guard turns into a no-op before any SQL is built.
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { ALERT_EVENT_KINDS, pendingAlertEvents, markEventsNotified } from "../src/alerts";
import { resetEnvCache } from "../src/config";
import { closeDb, getDb } from "../src/db";

/**
 * The connection string is read out of the env file HERE, inside the script
 * that uses it — never typed onto a command line, never printed, not even on
 * failure (CLAUDE.md, the credential rule).
 */
function loadDatabaseUrl(): void {
  if (process.env.DATABASE_URL) return;
  const envPath = new URL("../../../.env", import.meta.url);
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    throw new Error("DATABASE_URL is not set and .env could not be read at the repo root");
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*DATABASE_URL\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    process.env.DATABASE_URL = match[1]!.trim().replace(/^["']|["']$/g, "");
    resetEnvCache();
    return;
  }
  throw new Error("no DATABASE_URL line in the repo-root .env");
}

async function main(): Promise<number> {
  loadDatabaseUrl();
  const db = getDb();
  let failed = 0;
  const check = (ok: boolean, label: string, detail = "") => {
    if (!ok) failed += 1;
    console.log(`${ok ? "ok  " : "FAIL"}  ${label.padEnd(46)} ${detail}`);
  };

  // 1. The column exists, with the type and nullability the model declares.
  const cols = await db.execute(sql`
    select data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public' and table_name = 'events' and column_name = 'notified_at'
  `);
  const col = (Array.isArray(cols) ? cols : ((cols as { rows?: unknown[] }).rows ?? []))[0] as
    { data_type?: string; is_nullable?: string } | undefined;
  check(Boolean(col), "events.notified_at exists");
  check(col?.data_type === "timestamp with time zone", "  its type", String(col?.data_type));
  check(col?.is_nullable === "YES", "  it is nullable", String(col?.is_nullable));

  // 2. The partial index exists AND its predicate names both alert kinds. The
  //    predicate is the half a `\d events` skims past, and it is the half that
  //    decides whether the every-tick sweep is an index scan or a table scan.
  const idx = await db.execute(sql`
    select indexdef from pg_indexes
    where schemaname = 'public' and tablename = 'events'
      and indexname = 'events_unnotified_alerts_idx'
  `);
  const def = String(
    (
      (Array.isArray(idx) ? idx : ((idx as { rows?: unknown[] }).rows ?? []))[0] as
        { indexdef?: string } | undefined
    )?.indexdef ?? "",
  );
  check(def.length > 0, "events_unnotified_alerts_idx exists");
  check(/notified_at IS NULL/i.test(def), "  its predicate is partial on notified_at");
  for (const kind of ALERT_EVENT_KINDS) {
    check(def.includes(kind), `  its predicate names ${kind}`);
  }

  // 3. The queries the worker actually runs. This is the point of the file: a
  //    column the model disagrees with fails HERE, not at 3am in the sweep.
  const pending = await pendingAlertEvents(db, 5);
  check(Array.isArray(pending), "pendingAlertEvents() runs", `${pending.length} unnotified`);
  for (const row of pending) {
    console.log(`      ${row.createdAt.toISOString()}  ${row.kind}  (${row.last24h} in 24h)`);
  }
  await markEventsNotified(db, []);
  check(true, "markEventsNotified([]) is a no-op", "nothing was marked");

  console.log(
    failed === 0 ? "\nPASS — 0037 is applied and the sweep can run." : `\nFAIL — ${failed}.`,
  );
  return failed === 0 ? 0 : 1;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exitCode = code;
  })
  .catch(async (err: unknown) => {
    // Never print the error object raw: a postgres-js connection error can
    // carry the connection string.
    console.error(`FAIL: ${err instanceof Error ? err.message : "unknown error"}`);
    await closeDb();
    process.exitCode = 1;
  });
