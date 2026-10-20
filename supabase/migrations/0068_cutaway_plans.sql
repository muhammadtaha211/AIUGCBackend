-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).
--
-- Service B demo cutaways (decision 0121, building 0120 §4): a customer may cut
-- away from the talking head to stretches of their own analysed demo. This is
-- where the picks live — on their own rows, never on demo_step_plans (founder,
-- 2026-10-20).
--
-- cutaway_plans: one row per (approved audio, demo analysis, structure, hook
-- text). The slots' times come from the audio's caption chunks and the moment
-- the hook text leaves, so a different hook text is a different layout and a
-- new row with a fresh draft (founder, 2026-10-20); going back to an earlier
-- hook text finds its row again, free. The render never points here: enqueue
-- COPIES the slots onto video_renders.params (vault 0017's rule), so an edit
-- after the confirm cannot change a paid render.
--
--   structure     the structure's NAME (cutaway-structure.ts) — data in code,
--                 like the hook effects, so no CHECK: a new structure must not
--                 need a migration.
--   hook_text     the final hook text the slots were laid out from; '' = no
--                 hook text (the "none" effect). Part of the key.
--   slots         CutawaySlot[]: { fromMs, toMs, wordFrom, wordTo,
--                 demoStartMs, stateIndex, draftDemoStartMs, draftStateIndex }
--                 in VO time; the draft's pick is kept beside the customer's,
--                 so how often a draft is corrected is a query.
--   draft_source  model | demo_order — what filled the draft.
--   prompt_version  cutaway_match@vN[+repaired] | ...@dry-run | NULL (no call).
--   edited_at     the customer's last change; NULL = the draft as made.
--
-- Server-only, 0035's shape: RLS on, no policy, so it is deny-all for anon and
-- authenticated; the web routes and the worker reach it over DATABASE_URL and
-- apply the owner filter themselves. No ON DELETE CASCADE, matching every
-- other FK in this schema (0010).
CREATE TABLE IF NOT EXISTS "public"."cutaway_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"audio_render_id" uuid NOT NULL,
	"demo_id" uuid NOT NULL,
	"analysis_id" uuid NOT NULL,
	"structure" text NOT NULL,
	"hook_text" text DEFAULT '' NOT NULL,
	"slots" jsonb NOT NULL,
	"draft_source" text NOT NULL,
	"prompt_version" text,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cutaway_plans_slots_array" CHECK (jsonb_typeof("slots") = 'array'),
	CONSTRAINT "cutaway_plans_draft_source" CHECK ("draft_source" IN ('model', 'demo_order'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."cutaway_plans" ADD CONSTRAINT "cutaway_plans_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."cutaway_plans" ADD CONSTRAINT "cutaway_plans_audio_render_id_audio_renders_id_fk" FOREIGN KEY ("audio_render_id") REFERENCES "public"."audio_renders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."cutaway_plans" ADD CONSTRAINT "cutaway_plans_demo_id_demos_id_fk" FOREIGN KEY ("demo_id") REFERENCES "public"."demos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."cutaway_plans" ADD CONSTRAINT "cutaway_plans_analysis_id_demo_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."demo_analyses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "cutaway_plans_audio_analysis_structure_hook_idx" ON "public"."cutaway_plans" ("audio_render_id", "analysis_id", "structure", "hook_text");
CREATE INDEX IF NOT EXISTS "cutaway_plans_business_idx" ON "public"."cutaway_plans" ("business_id");

ALTER TABLE "public"."cutaway_plans" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select to_regclass('public.cutaway_plans');
--   select relrowsecurity from pg_class where oid = 'public.cutaway_plans'::regclass;
--   select count(*) from pg_policies where tablename = 'cutaway_plans';
--   select indexname from pg_indexes where tablename = 'cutaway_plans' order by 1;
--   select count(*) from cutaway_plans;
--
-- BEFORE expect NULL (and the rest erroring: no such table). AFTER expect the
-- table, relrowsecurity true, 0 policies, the three indexes
-- cutaway_plans_audio_analysis_structure_hook_idx, cutaway_plans_business_idx,
-- cutaway_plans_pkey, and 0 rows.
