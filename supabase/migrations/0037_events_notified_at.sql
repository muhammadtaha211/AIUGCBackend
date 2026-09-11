-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- events.notified_at — the "already reported" marker that makes a poll-the-table
-- reporter safe.
--
-- WHY THIS COLUMN EXISTS AT ALL
-- Signup now depends on Resend (docs/vault/facts/auth-email-runs-through-resend.md).
-- The real ceiling is 100/day at the provider, not the 100/hour Supabase Rate
-- Limit; when it is spent Resend refuses, `signUp` returns an error and the
-- signup cannot complete. Nothing alerted on that. The web app writes an
-- `auth_email_send_failed` row and the WORKER reports it to Sentry, because
-- decisions/0037 puts the Sentry SDK in apps/worker and nowhere else — apps/web
-- and apps/admin run on Vercel and must never load it.
--
-- That makes the reporter a table poller, which is exactly the option 0037's
-- own table REJECTED: "Worker polls the jobs table for dead rows — needs a
-- 'reported' marker (a migration) or re-reports everything on restart." The
-- objection was correct and this file is the marker it named. It is chosen here
-- and was rejected there because the writer is on the other side of the SDK
-- boundary: a job ends inside the worker's own process, where a callback is
-- free, while a failed signup happens in a Vercel function that can never
-- report anything itself.
--
-- WHY A TIMESTAMP AND NOT A BOOLEAN
-- Same shape as approved_at / released_at / refunded_at everywhere else in this
-- schema: NULL means "not yet", and a value answers "when" for free. A boolean
-- would need a second column the first time anyone asks how long the gap was.
--
-- THE INDEX IS PARTIAL, AND THAT IS THE POINT
-- The sweep runs every worker tick and asks one question: "any unnotified rows
-- of the alert kinds?". In steady state the answer is none, and `events` grows
-- forever (platform_budget_tripped writes one row per refused attempt). A
-- partial index indexes only the rows that can match, so it stays a handful of
-- entries no matter how large the table gets, and the steady-state sweep is an
-- empty index scan rather than a filter over the whole table.
--
-- The kind list in the WHERE is duplicated from ALERT_EVENT_KINDS
-- (packages/core/src/alerts.ts). It is a partial-index predicate, so it must be
-- an immutable literal — it cannot read the application's list. Adding a third
-- alert kind therefore needs a migration that rebuilds this index, and
-- alerts.ts says so at its definition. Until then a new kind simply does not use
-- the index; the query is still correct, just unindexed.
--
-- Verify by READ-BACK, never by "the ALTER succeeded", and read it back through
-- the code's own schema rather than raw SQL — an ALTER that lands a column the
-- drizzle model does not agree with (wrong type, wrong nullability) looks
-- identical to a correct one from psql. The check is
-- packages/core/scripts/verify-events-notified-at.ts.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "notified_at" timestamp with time zone;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "events_unnotified_alerts_idx"
  ON "events" ("created_at")
  WHERE "notified_at" IS NULL
    AND "kind" IN ('platform_budget_tripped', 'auth_email_send_failed');
