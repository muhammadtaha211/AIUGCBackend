-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- text_block_clips.persona_id: every גוש טקסט clip belongs to a character
-- (founder ruling for phase 2, decision 0099 §3). The customer wizard opens on
-- the characters and lists only the clips of the one picked — decision 0012's
-- persona-first rule, the same shape as hook_clips.persona_id (0013).
--
-- Nullable, like hook_clips.persona_id: the clips registered in phase 1 have
-- none, and the admin card flags an active clip with none ("לא משויך לדמות —
-- לא מוצג ללקוחות") until the founder assigns it. NULL = listed to no customer.
-- The clip's speaker_gender stays a stored column; every write path sets it
-- from the character's gender (admin register and reassign, and a persona's
-- gender edit), so a clip's speaker is its character's (decision 0099 §3).
--
-- No index: hook_clips.persona_id has none either, and the bank is tens of rows.
ALTER TABLE "text_block_clips" ADD COLUMN IF NOT EXISTS "persona_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "text_block_clips" ADD CONSTRAINT "text_block_clips_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select count(*) from information_schema.columns where table_name = 'text_block_clips';
--   select conname from pg_constraint where conrelid = 'public.text_block_clips'::regclass
--     and contype = 'f';
--   select count(*), count(persona_id) from text_block_clips;
--
-- BEFORE: 8, no rows, and the third query errors (no persona_id column yet).
-- AFTER: 9, text_block_clips_persona_id_personas_id_fk, (N, 0) — every existing
-- clip unassigned, for the founder to assign in admin.
-- ---------------------------------------------------------------------------
