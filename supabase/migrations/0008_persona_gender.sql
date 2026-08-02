-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- Speaker gender for Hebrew first-person agreement in b_script generation.
-- Values: 'female' | 'male'. Nullable, no backfill — set by hand via SQL;
-- the pipeline defaults to 'female' (with a warning) when null.
ALTER TABLE "personas" ADD COLUMN "gender" text;
