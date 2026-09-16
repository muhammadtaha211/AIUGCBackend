-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- A downgrade is SCHEDULED, not applied: subscriptions.scheduled_plan_code.
--
-- Founder decision 2026-09-17: an upgrade is immediate and prorated, a
-- downgrade takes effect at the next renewal, a cancel takes effect at period
-- end. docs/05-billing.md used to say a downgrade "changes plan_code only" --
-- meaning flip plan_code now and let the renewal charge the new price. That
-- misreports the current plan for the rest of the period: a customer on pro
-- who schedules a downgrade to starter is STILL on pro until renewal (that is
-- what he paid for), but every read of plan_code would say starter, and an
-- upgrade requested after the downgrade would compute its proration from the
-- wrong "from" plan and charge the wrong difference. The pending change has to
-- be a separate fact.
--
--   scheduled_plan_code  NULL when nothing is pending. Set by a downgrade, or
--                        by an upgrade requested on the last day of the period
--                        (too little left to charge -- quotePlanChange's
--                        scheduleInstead). processDueRenewals charges THAT
--                        plan's price, grants THAT plan's credits, copies it
--                        into plan_code and clears it, all in the success
--                        branch; a failed charge leaves it in place. A
--                        successful immediate upgrade clears it; so does
--                        cancelSubscription (a cancel replaces a pending
--                        change) and re-choosing the current plan (the undo).
--
-- Nullable, additive, FK to plans like plan_code. The deployed code selects
-- its columns by name through drizzle, so a column it does not know about
-- changes nothing until the build that reads it ships.
--
-- Recorded in docs/vault/decisions/0053-downgrades-are-scheduled-not-applied.md.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "scheduled_plan_code" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_scheduled_plan_code_plans_code_fk" FOREIGN KEY ("scheduled_plan_code") REFERENCES "public"."plans"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select column_name, is_nullable from information_schema.columns
--    where table_name = 'subscriptions' and column_name = 'scheduled_plan_code';
--   select conname from pg_constraint
--    where conrelid = 'public.subscriptions'::regclass
--      and conname = 'subscriptions_scheduled_plan_code_plans_code_fk';
--
-- BEFORE expect no rows from either. AFTER expect one row each, nullable YES.
-- ---------------------------------------------------------------------------
