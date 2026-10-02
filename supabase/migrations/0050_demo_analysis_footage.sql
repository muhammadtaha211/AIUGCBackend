-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- demo_analysis_footage: what analyze_demo knows about the recording itself and
-- used to throw away. One row per analysis, written by the analysis job right
-- before the analysis lands (decisions 0077, 0078, 0080, 0083). Nothing reads
-- it yet: the plan rule, the wizard and the render are untouched, and
-- demo_analyses.timeline stays byte-for-byte what it was.
--
-- Why a table and not a column or a key in the timeline: the timeline is a bare
-- JSON array whose positions are identity for plans and sections, so analysis-
-- level data cannot ride in it; and every reader of demo_analyses selects all
-- of its columns, so a new column deployed ahead of its migration would break
-- the wizard's analysis poll, while no web code reads a new table.
--
--   analysis_id  the analysis. PRIMARY KEY and FK: one row per analysis, and a
--                retried job upserts its own row.
--   fps          the rate the recording was sampled at when the moments were
--                found (a_analysis_fps at the time). startMs / endMs / t sit on
--                its grid, round(i * 1000 / fps).
--   file_sha     sha256 of the normalized file that was analysed. Two analyses
--                of one file carry the same value, which is how "the same file
--                gives the same moments and instants" is checked in production.
--   moments      [{ t, startMs, endMs, read }], every kept moment in order.
--                t is the representative sample (the timeline state's
--                timestampMs when read is true); startMs / endMs are the first
--                and last sample the picture held on, inclusive (0077);
--                read = false is a moment whose vision read never came back,
--                which the timeline drops and this list keeps (0080).
--   detector     which detector found `instants` ('screens@1'). NULL with it.
--   instants     [{ atMs, strength, abrupt }], every instant the picture
--                changes and then holds, found from the footage alone on every
--                frame (0078). No model names them (0083). NULL = not computed:
--                the analysis was rejected or failed, or the decode failed —
--                which never fails the analysis.
--   created_at / updated_at  when.
--
-- No index beyond the primary key: the only read is by analysis.
--
-- RLS: 0046 / 0048's pattern exactly. Server-only — RLS on, zero policies,
-- deny-all for anon and authenticated; the only reader and writer is the worker
-- over DATABASE_URL as postgres, which bypasses RLS. A bare ENABLE ROW LEVEL
-- SECURITY is plain Postgres, so the whole migration is one portable file.
--
-- No ON DELETE CASCADE, matching every other FK in this schema (0010). Nothing
-- deletes a demo_analyses row.
CREATE TABLE IF NOT EXISTS "demo_analysis_footage" (
	"analysis_id" uuid PRIMARY KEY NOT NULL,
	"fps" real NOT NULL,
	"file_sha" text NOT NULL,
	"moments" jsonb NOT NULL,
	"detector" text,
	"instants" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "demo_analysis_footage" ADD CONSTRAINT "demo_analysis_footage_analysis_id_demo_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."demo_analyses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- Server-only: RLS on, no policies -> invisible to browser clients, exactly
-- like checkout_intents in 0048 and terms_acceptances in 0046.
ALTER TABLE "demo_analysis_footage" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select relrowsecurity from pg_class where oid = 'public.demo_analysis_footage'::regclass;
--   select count(*) from information_schema.columns where table_name = 'demo_analysis_footage';
--   select conname from pg_constraint where conrelid = 'public.demo_analysis_footage'::regclass order by conname;
--   select count(*) from pg_policies where tablename = 'demo_analysis_footage';
--   select count(*) from demo_analysis_footage;
--
-- BEFORE the first, third and fifth error (no such relation) and the second
-- reads 0. AFTER expect true, 8, [demo_analysis_footage_analysis_id_demo_analyses_id_fk,
-- demo_analysis_footage_pkey], 0 policies and 0 rows: nothing is backfilled, and
-- no existing table is touched.
-- ---------------------------------------------------------------------------
