-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).
--
-- Service B, the customer's own voice (decision 0118).
--
-- voice_recordings: one row per recording a customer records in the browser or
-- uploads, from the upload until its transcript is approved. The row is the
-- recording's life before approval and nothing more: approval does not touch it
-- again, it inserts an ordinary scripts row (the approved transcript) and an
-- ordinary, already-approved audio_renders row with its own copy of the mp3, so
-- every reader downstream of approval sees the same shape as an AI-voice render.
--
--   status       audio_status: queued -> generating -> ready | failed. Reused,
--                not a new enum: the life is the TTS row's life.
--   raw_path     the upload exactly as received, raw/<biz>/recording/<id>/...
--                UNIQUE: registering the same upload twice returns the same row
--                instead of a second transcription. Nullable, like
--                demos.raw_path: the janitor deletes the upload on the raw
--                window and nulls the column (Postgres lets a unique column
--                hold many NULLs).
--   file_path    the processed recording (mono 44.1 kHz mp3 at the TTS
--                loudness, cut to the speech), renders/<biz>/recording/<id>/.
--   source_ms    the decoded length of the upload (what a refusal shows).
--   duration_ms  the processed file's length — what the quote prices.
--   words        Scribe's words on the processed file, [{text, startMs, endMs}],
--                cleaned of every character a caption cannot burn.
--   heard_text   everything Scribe heard, UNcleaned — what the content gate
--                classifies, so a word in a script the captions cannot carry
--                (Arabic, Cyrillic) is still checked.
--   error        the customer-facing Hebrew refusal; never a provider's English.
--
-- Server-only, 0035's shape: RLS on, no policy, so it is deny-all for anon and
-- authenticated; the web routes and the worker reach it over DATABASE_URL.
-- No ON DELETE CASCADE, matching every other FK in this schema (0010).
CREATE TABLE IF NOT EXISTS "public"."voice_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"status" "audio_status" DEFAULT 'queued' NOT NULL,
	"raw_path" text,
	"file_path" text,
	"source_ms" integer,
	"duration_ms" integer,
	"words" jsonb,
	"heard_text" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."voice_recordings" ADD CONSTRAINT "voice_recordings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- The two access paths: the daily preview cap counts a business's rows in the
-- last 24h, and the janitor sweeps by created_at.
CREATE INDEX IF NOT EXISTS "voice_recordings_business_created_idx" ON "public"."voice_recordings" ("business_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "voice_recordings_raw_path_idx" ON "public"."voice_recordings" ("raw_path");
--> statement-breakpoint

ALTER TABLE "public"."voice_recordings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- An approved recording's audio row has no ElevenLabs voice: the persona's
-- voice goes unused on this branch (decision 0118, item 9). Storing it would
-- claim ElevenLabs spoke the audio and skew the words-per-second calibration.
-- Every existing row keeps its voice; DROP NOT NULL is idempotent.
ALTER TABLE "public"."audio_renders" ALTER COLUMN "voice_id" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, AFTER:
--
--   select relrowsecurity from pg_class where oid = 'public.voice_recordings'::regclass;
--     -> true
--   select count(*) from public.voice_recordings;
--     -> 0
--   select is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'audio_renders' and column_name = 'voice_id';
--     -> YES
--   select count(*) from public.audio_renders where voice_id is null;
--     -> 0 (until the first approved recording)
-- ---------------------------------------------------------------------------
