-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- personas.voice_id becomes optional: a character can belong to גוש טקסט alone,
-- with no ElevenLabs voice, no hook clips and no selfie (founder rulings for
-- phase 2, decision 0099 §2 and R1). Service C never speaks, so such a
-- character has no voice to pin.
--
-- Service B keeps needing one: its picker (loadPersonaCatalog("b")) lists only
-- personas with a voice as well as a selfie, so the B wizard never offers a
-- voiceless character even if it later gets a selfie, and tts.ts already
-- refuses a script whose persona has no voice. Every existing row keeps its
-- voice — this only drops the constraint.
ALTER TABLE "personas" ALTER COLUMN "voice_id" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select is_nullable from information_schema.columns
--     where table_name = 'personas' and column_name = 'voice_id';
--   select count(*) filter (where voice_id is null) from personas;
--
-- BEFORE: NO, 0. AFTER: YES, 0 — nothing is backfilled.
-- ---------------------------------------------------------------------------
