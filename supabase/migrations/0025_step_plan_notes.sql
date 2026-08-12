-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).
--
-- The plan pass may return fewer than a_steps_min steps when the footage holds
-- fewer genuinely distinct ones, and explains itself in `notes` — customer-
-- visible in the wizard's plan step, so it must be stored, not just logged.
ALTER TABLE "demo_step_plans" ADD COLUMN IF NOT EXISTS "notes" text;
