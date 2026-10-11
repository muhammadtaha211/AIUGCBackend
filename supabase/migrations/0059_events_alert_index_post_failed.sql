-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- events_unnotified_alerts_idx gains the third alert kind, 'post_failed'.
--
-- A scheduled post that fails for good (pipelines/social.ts) writes one events
-- row of kind post_failed, carrying the post id and the failure kind and no
-- customer text, so the worker's alert sweep reports it to Sentry and the
-- founder hears of it the way he hears of a tripped platform cap or a failed
-- signup email. The customer is told in the app; this row is the founder's side
-- of "nothing fails silently".
--
-- 0037 said it when it built the index: the kind list in a partial-index
-- predicate is an immutable literal, so a third kind in ALERT_EVENT_KINDS
-- (packages/core/src/alerts.ts) needs a migration that rebuilds the index, or
-- the sweep's query is still correct but no longer an empty index scan on a
-- table that only grows. DROP + CREATE because a partial index's predicate
-- cannot be altered in place; both statements are idempotent.
DROP INDEX IF EXISTS "events_unnotified_alerts_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_unnotified_alerts_idx"
  ON "events" ("created_at")
  WHERE "notified_at" IS NULL
    AND "kind" IN ('platform_budget_tripped', 'auth_email_send_failed', 'post_failed');

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select indexdef from pg_indexes where indexname = 'events_unnotified_alerts_idx';
--
-- BEFORE the predicate names two kinds. AFTER it names three, post_failed last.
-- No row of any table changes.
-- ---------------------------------------------------------------------------
