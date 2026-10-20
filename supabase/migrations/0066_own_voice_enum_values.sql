-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- Service B, the customer's own voice (decision 0118): a customer may speak the
-- ad themselves. The recording is transcribed by ElevenLabs speech-to-text
-- (Scribe), which needs two enum values:
--   alignment_source 'scribe'      the word times of an approved recording came
--                                  from Scribe, not from the TTS alignment.
--                                  Nothing in the tree reads this column; the
--                                  value is written for the record.
--   usage_kind       'stt_seconds' one usage_events row per Scribe call,
--                                  quantity = seconds of audio transcribed.
--
-- ALONE IN THIS FILE ON PURPOSE, 0019's rule (and 0061's, 0064's): ALTER TYPE
-- ... ADD VALUE may run inside a transaction block, but the new value CANNOT be
-- used in that same transaction. 0067 names neither value. Idempotent on PG 13+.
--
-- It goes FIRST, ahead of its code: nothing in the tree before the own-voice
-- build writes either value, so both are inert until that build deploys.
ALTER TYPE "public"."alignment_source" ADD VALUE IF NOT EXISTS 'scribe';
ALTER TYPE "public"."usage_kind" ADD VALUE IF NOT EXISTS 'stt_seconds';

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select enumlabel from pg_enum
--    where enumtypid = 'public.alignment_source'::regtype order by enumsortorder;
--   select enumlabel from pg_enum
--    where enumtypid = 'public.usage_kind'::regtype order by enumsortorder;
--
-- BEFORE expect elevenlabs, whisperx and llm_tokens, tts_chars, gpu_seconds,
-- images. AFTER expect elevenlabs, whisperx, scribe and llm_tokens, tts_chars,
-- gpu_seconds, images, stt_seconds. No row of any table changes.
-- ---------------------------------------------------------------------------
