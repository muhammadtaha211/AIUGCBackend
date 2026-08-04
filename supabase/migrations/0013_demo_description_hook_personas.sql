-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- demos.description: optional founder-visible free text the customer types once
-- per demo ("what the footage shows"), used as soft grounding for the VO script.
ALTER TABLE "demos" ADD COLUMN "description" text;--> statement-breakpoint

-- Persona-swapped hook clips: the founder generates swapped versions offline and
-- uploads them per persona. persona_id NULL = generic/original performer (shown
-- to everyone); source_clip_id records which clip a swap was made from (lineage).
ALTER TABLE "hook_clips" ADD COLUMN "persona_id" uuid;--> statement-breakpoint
ALTER TABLE "hook_clips" ADD COLUMN "source_clip_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hook_clips" ADD CONSTRAINT "hook_clips_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hook_clips" ADD CONSTRAINT "hook_clips_source_clip_id_hook_clips_id_fk" FOREIGN KEY ("source_clip_id") REFERENCES "public"."hook_clips"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
