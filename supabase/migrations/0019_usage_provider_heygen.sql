-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- HeyGen GPU spend has been recorded as provider='fal' since the switch,
-- because the enum had no value for it (see the comment this migration lets us
-- delete, in pipelines/renders.ts).
--
-- ALONE IN THIS FILE ON PURPOSE. Verified against this project's Postgres
-- (17.6): ALTER TYPE ... ADD VALUE may run inside a transaction block, but the
-- new value CANNOT be used in that same transaction —
--   ERROR: unsafe use of new value "heygen" of enum type usage_provider
-- The backfill that uses it is therefore migration 0020.
ALTER TYPE "public"."usage_provider" ADD VALUE 'heygen';
