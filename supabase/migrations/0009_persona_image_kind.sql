-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- Persona image role for the wizard pickers. Values: 'preview' (plain-white
-- avatar-card thumbnail, never a render source picker option) | 'background'
-- (selectable in the wizard's background step). Default 'background' = zero
-- backfill; 'preview' rows and labels are set by hand via SQL.
ALTER TABLE "persona_images" ADD COLUMN "kind" text DEFAULT 'background' NOT NULL;
ALTER TABLE "persona_images" ADD COLUMN "label" text;
