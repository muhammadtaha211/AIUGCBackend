-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- Soft delete for persona reference images. Hard deletes are forbidden:
-- video_renders.params reference image ids and QC regeneration re-reads them.
-- A retired image leaves the pickers, the avatar-card thumbnail, and the
-- default-image render fallback; existing renders keep working.
ALTER TABLE "persona_images" ADD COLUMN "retired" boolean DEFAULT false NOT NULL;
