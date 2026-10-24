-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- demos.name: the short name the customer gives a recording so they can tell
-- their demos apart in the lists and pickers (decision 0125). NULL = unnamed,
-- and an unnamed demo shows exactly as before this column existed.
--
-- Its own column, never the description: description feeds the step-plan
-- prompt and its caption vocabulary, and a name must not change what gets
-- generated. Nothing that builds a model input reads this column.
--
-- Optional, so no default and no backfill. The 40-character cap lives in code
-- (MAX_DEMO_NAME_CHARS, enforced by the route and by setDemoName), as the
-- description's 500 does. No index: it is read with the row, never searched.
ALTER TABLE "demos" ADD COLUMN IF NOT EXISTS "name" text;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select data_type, is_nullable from information_schema.columns
--     where table_name = 'demos' and column_name = 'name';
--   select count(name) from demos;
--
-- BEFORE: no row. AFTER: 'text', 'YES', and 0 — nothing is backfilled.
-- ---------------------------------------------------------------------------
