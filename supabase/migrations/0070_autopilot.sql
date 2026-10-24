-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).
--
-- The Instagram autopilot (decision 0127): after a one-time setup, every night
-- Tavnit makes the day's הוק + דמו videos for each connected Instagram account
-- and schedules them through today's scheduling path (scheduled_posts,
-- publish_post). Admin-only behind app_config.autopilot (no row = admins), built
-- so customers could use it later. Three new tables; nothing existing altered.
--
-- autopilot_setups — one per Tavnit account.
--   business_id   whose demos and questionnaire the nights use; owned by user_id.
--   sounds        the saved list: the sound picker's snapshot per entry, plus a
--                 server-owned refusedAt once Meta refused it (a JSON array).
--   low_sounds_*  one email per episode of fewer than 3 usable sounds.
--   line_calls*   the night's hook-line generation attempts (a runaway valve).
--
-- autopilot_accounts — one per (Tavnit account, Instagram account). Keyed on
-- Instagram's own id, not social_accounts.id, so a disconnect + reconnect (which
-- makes a new social_accounts row) keeps the settings.
--   enabled, a_per_day, post_times ("HH:MM"[]), persona_ids, demo_ids: his.
--   enabled_at    when it was last switched on or resumed: a day is planned only
--                 for an account that was on before that day's 03:00 Israel.
--   planned_day   the last Israel day planned for it (one plan per day).
--   paused_*      the server's pause: the first cause wins; resumed by hand.
--
-- autopilot_slots — one per planned post. The unique indexes ARE the rules:
-- one row per (account, day, slot); no hook clip twice a day on one account
-- (skipped and cancelled slots excepted); no render on two slots (no file to two
-- accounts); no post on two slots; no hook line on two slots.
--
-- Server-only, 0035's shape: RLS on, no policy; the worker and the web routes
-- reach them over DATABASE_URL with their own owner filter. No ON DELETE
-- CASCADE, matching every other FK in this schema (0010).
CREATE TABLE IF NOT EXISTS "public"."autopilot_setups" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"sounds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"low_sounds_at" timestamp with time zone,
	"low_sounds_emailed_at" timestamp with time zone,
	"line_calls_day" date,
	"line_calls" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autopilot_setups_sounds_array" CHECK (jsonb_typeof("sounds") = 'array')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."autopilot_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ig_user_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"a_per_day" integer DEFAULT 0 NOT NULL,
	"post_times" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"persona_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"demo_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled_at" timestamp with time zone,
	"planned_day" date,
	"paused_cause" text,
	"paused_at" timestamp with time zone,
	"pause_emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autopilot_accounts_a_per_day_range" CHECK ("a_per_day" BETWEEN 0 AND 12),
	CONSTRAINT "autopilot_accounts_arrays" CHECK (
		jsonb_typeof("post_times") = 'array'
		AND jsonb_typeof("persona_ids") = 'array'
		AND jsonb_typeof("demo_ids") = 'array'
	),
	CONSTRAINT "autopilot_accounts_paused_cause" CHECK (
		"paused_cause" IS NULL
		OR "paused_cause" IN ('connection', 'no_sound', 'no_clips', 'file_refused', 'nothing_posted')
	)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public"."autopilot_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ig_user_id" text NOT NULL,
	"social_account_id" uuid NOT NULL,
	"day" date NOT NULL,
	"slot_index" integer NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"persona_id" uuid,
	"hook_clip_id" uuid,
	"demo_id" uuid,
	"step_plan_id" uuid,
	"hook_line_script_id" uuid,
	"sound" jsonb,
	"video_render_id" uuid,
	"scheduled_post_id" uuid,
	"render_attempts" integer DEFAULT 0 NOT NULL,
	"faults" integer DEFAULT 0 NOT NULL,
	"refused_sounds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autopilot_slots_status" CHECK ("status" IN ('planned', 'rendering', 'scheduled', 'skipped', 'cancelled')),
	CONSTRAINT "autopilot_slots_refused_sounds_array" CHECK (jsonb_typeof("refused_sounds") = 'array')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."autopilot_setups" ADD CONSTRAINT "autopilot_setups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."autopilot_setups" ADD CONSTRAINT "autopilot_setups_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."autopilot_accounts" ADD CONSTRAINT "autopilot_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."autopilot_slots" ADD CONSTRAINT "autopilot_slots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."autopilot_slots" ADD CONSTRAINT "autopilot_slots_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."autopilot_slots" ADD CONSTRAINT "autopilot_slots_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."autopilot_slots" ADD CONSTRAINT "autopilot_slots_hook_clip_id_hook_clips_id_fk" FOREIGN KEY ("hook_clip_id") REFERENCES "public"."hook_clips"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."autopilot_slots" ADD CONSTRAINT "autopilot_slots_demo_id_demos_id_fk" FOREIGN KEY ("demo_id") REFERENCES "public"."demos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."autopilot_slots" ADD CONSTRAINT "autopilot_slots_step_plan_id_demo_step_plans_id_fk" FOREIGN KEY ("step_plan_id") REFERENCES "public"."demo_step_plans"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."autopilot_slots" ADD CONSTRAINT "autopilot_slots_hook_line_script_id_scripts_id_fk" FOREIGN KEY ("hook_line_script_id") REFERENCES "public"."scripts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."autopilot_slots" ADD CONSTRAINT "autopilot_slots_video_render_id_video_renders_id_fk" FOREIGN KEY ("video_render_id") REFERENCES "public"."video_renders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "public"."autopilot_slots" ADD CONSTRAINT "autopilot_slots_scheduled_post_id_scheduled_posts_id_fk" FOREIGN KEY ("scheduled_post_id") REFERENCES "public"."scheduled_posts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "autopilot_accounts_user_ig_idx" ON "public"."autopilot_accounts" ("user_id", "ig_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "autopilot_slots_slot_idx" ON "public"."autopilot_slots" ("user_id", "ig_user_id", "day", "slot_index");
CREATE UNIQUE INDEX IF NOT EXISTS "autopilot_slots_clip_day_idx" ON "public"."autopilot_slots" ("ig_user_id", "day", "hook_clip_id") WHERE "status" NOT IN ('skipped', 'cancelled');
CREATE UNIQUE INDEX IF NOT EXISTS "autopilot_slots_render_idx" ON "public"."autopilot_slots" ("video_render_id");
CREATE UNIQUE INDEX IF NOT EXISTS "autopilot_slots_post_idx" ON "public"."autopilot_slots" ("scheduled_post_id");
CREATE UNIQUE INDEX IF NOT EXISTS "autopilot_slots_line_idx" ON "public"."autopilot_slots" ("hook_line_script_id");
CREATE INDEX IF NOT EXISTS "autopilot_slots_open_idx" ON "public"."autopilot_slots" ("scheduled_for") WHERE "status" IN ('planned', 'rendering');

ALTER TABLE "public"."autopilot_setups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."autopilot_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."autopilot_slots" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select to_regclass('public.autopilot_setups'), to_regclass('public.autopilot_accounts'),
--          to_regclass('public.autopilot_slots');
--   select relname, relrowsecurity from pg_class
--    where relname in ('autopilot_setups', 'autopilot_accounts', 'autopilot_slots') order by 1;
--   select count(*) from pg_policies where tablename like 'autopilot_%';
--   select indexname from pg_indexes where tablename like 'autopilot_%' order by 1;
--   select (select count(*) from autopilot_setups), (select count(*) from autopilot_accounts),
--          (select count(*) from autopilot_slots);
--
-- BEFORE expect three NULLs (and the rest empty or erroring: no such tables).
-- AFTER expect the three tables, relrowsecurity true on each, 0 policies, the ten
-- indexes autopilot_accounts_pkey, autopilot_accounts_user_ig_idx,
-- autopilot_setups_pkey, autopilot_slots_clip_day_idx, autopilot_slots_line_idx,
-- autopilot_slots_open_idx, autopilot_slots_pkey, autopilot_slots_post_idx,
-- autopilot_slots_render_idx, autopilot_slots_slot_idx, and 0 rows in each.
