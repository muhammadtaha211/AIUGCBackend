-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- text_block_clips: the גוש טקסט bank (Service C, decisions 0089 and 0090).
-- Founder-made 9:16 clips, registered by hand in the admin console, each
-- played once, start to finish, with its own recorded sound, under one Hebrew
-- text block. Its own table rather than a kind on hook_clips: Service A's hook
-- listings (persona-catalog.ts, /api/hooks) read hook_clips and can therefore
-- never return one of these, and the speaker gender is a typed column here
-- where hook_clips carries it as a free tag.
--
--   id              the clip.
--   file_path       '<bucket>/<key>' of the stored mp4
--                   (assets/bank/text_block_clip/<uuid>/clip.mp4).
--   duration_ms     the browser's reading at register (display only; the
--                   composition probes the stored file itself).
--   speaker_gender  'female' | 'male' — Hebrew first person is gendered
--                   (0090 §12), so the prompt is told whose voice the text is in.
--   text_safe_area  {x, y, w, h} in 1080x1920 space where the block is fitted.
--   text_color      'white' | 'black', a NAME never a hex — the same vocabulary
--                   as hook_clips.text_color (0049, decision 0073); the ink
--                   behind each name lives in packages/core/src/hook-text-color.ts.
--   active          the retire mechanism — rows are never deleted, because
--                   video_renders.params references clip ids.
--   created_at      when.
--
-- Text with a CHECK, not an enum, for both vocabularies (0049's reasoning): an
-- enum value is its own migration.
--
-- RLS: 0050's pattern. Server-only in phase 1 — RLS on, zero policies, so the
-- browser clients (anon and authenticated) see nothing; every reader and writer
-- is the admin app and the worker over DATABASE_URL as postgres, which bypasses
-- RLS. Phase 2 (the customer wizard) was to add the SELECT-active policy
-- hook_clips has; it added none (decision 0099): the wizard reads the bank
-- through the server too, so the table stays server-only. A bare
-- ENABLE ROW LEVEL SECURITY is plain Postgres, so the whole migration is one
-- portable file.
--
-- No FK, no index beyond the primary key: a clip belongs to no persona and no
-- business, and the only reads are by id and the admin's full listing. (Phase
-- 2's 0054 gave each clip a character: persona_id, with its FK to personas.)
CREATE TABLE IF NOT EXISTS "text_block_clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_path" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"speaker_gender" text NOT NULL CONSTRAINT "text_block_clips_speaker_gender_check" CHECK ("speaker_gender" IN ('female', 'male')),
	"text_safe_area" jsonb NOT NULL,
	"text_color" text DEFAULT 'white' NOT NULL CONSTRAINT "text_block_clips_text_color_check" CHECK ("text_color" IN ('white', 'black')),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Server-only: RLS on, no policies -> invisible to browser clients, exactly
-- like demo_analysis_footage in 0050.
ALTER TABLE "text_block_clips" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select relrowsecurity from pg_class where oid = 'public.text_block_clips'::regclass;
--   select count(*) from information_schema.columns where table_name = 'text_block_clips';
--   select conname from pg_constraint where conrelid = 'public.text_block_clips'::regclass order by conname;
--   select count(*) from pg_policies where tablename = 'text_block_clips';
--   select count(*) from text_block_clips;
--
-- BEFORE the first, third and fifth error (no such relation) and the second
-- reads 0. AFTER expect true, 8, [text_block_clips_pkey,
-- text_block_clips_speaker_gender_check, text_block_clips_text_color_check],
-- 0 policies and 0 rows: nothing is backfilled, and no existing table is touched.
-- ---------------------------------------------------------------------------
