-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- The ₪5 intro offer (decision 0109, founder 2026-10-13/14): a never-paid
-- account buys, once, 150 credits that expire 30 days after the payment. Two
-- ledger reasons carry it through credit_ledger:
--
--   grant_trial    +credits when the ₪5 payment is verified (ref_id = the
--                  checkout intent). Not grant_manual (never expires) and not
--                  grant_period (has no subscription to hang on).
--   expire_trial   −the unused trial credits at day 30 (ref_id = the same
--                  intent), written by the daily expire_trials sweep.
--
-- ALONE IN THIS FILE ON PURPOSE, 0019's rule: ALTER TYPE ... ADD VALUE may run
-- inside a transaction block, but the new value CANNOT be used in that same
-- transaction. The table that goes with it is 0062, which names neither value.
-- Both statements are idempotent on PG 13+.
ALTER TYPE "public"."ledger_reason" ADD VALUE IF NOT EXISTS 'grant_trial';--> statement-breakpoint
ALTER TYPE "public"."ledger_reason" ADD VALUE IF NOT EXISTS 'expire_trial';

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select enumlabel from pg_enum
--    where enumtypid = 'public.ledger_reason'::regtype order by enumsortorder;
--
-- BEFORE expect grant_period, grant_manual, debit_render, refund_failed,
-- expire_period. AFTER expect the same five, then grant_trial, expire_trial.
-- No row of any table changes.
-- ---------------------------------------------------------------------------
