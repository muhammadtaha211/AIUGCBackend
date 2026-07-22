-- Hand-written companion to 0005_persona_images.sql (drizzle-generated).
-- Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- At most one default reference image per persona (the single-image
-- InfiniteTalk source when a variant names only the persona).
CREATE UNIQUE INDEX "persona_images_one_default_per_persona"
  ON "persona_images" ("persona_id")
  WHERE "is_default";
