-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).
--
-- Service A step-plan format (founder-approved rework of locked decision #1,
-- 2026-08-11). Two objects: demo_analyses is the inventory — distinct UI states
-- extracted from one screen recording, expensive, computed once, never edited.
-- demo_step_plans is the selection — 6-8 states chosen from the inventory,
-- cheap, regenerable, gated by an explicit approval. Renders reference a plan
-- by id exactly like audio_renders.script_id pins approved audio text.

CREATE TYPE "public"."demo_analysis_status" AS ENUM('pending', 'analysing', 'ready', 'failed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."step_plan_status" AS ENUM('pending', 'planning', 'ready', 'failed');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "demo_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"demo_id" uuid NOT NULL,
	"status" "demo_analysis_status" DEFAULT 'pending' NOT NULL,
	"timeline" jsonb,
	"state_count" integer,
	"prompt_version" text,
	"fail_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "demo_step_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"demo_id" uuid NOT NULL,
	"analysis_id" uuid NOT NULL,
	"status" "step_plan_status" DEFAULT 'pending' NOT NULL,
	"steps" jsonb,
	"unexplained_moments" jsonb,
	"prompt_version" text,
	"approved_at" timestamp with time zone,
	"fail_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "demo_analyses" ADD CONSTRAINT "demo_analyses_demo_id_demos_id_fk" FOREIGN KEY ("demo_id") REFERENCES "public"."demos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "demo_step_plans" ADD CONSTRAINT "demo_step_plans_demo_id_demos_id_fk" FOREIGN KEY ("demo_id") REFERENCES "public"."demos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "demo_step_plans" ADD CONSTRAINT "demo_step_plans_analysis_id_demo_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."demo_analyses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "demo_analyses_demo_idx" ON "demo_analyses" USING btree ("demo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "demo_step_plans_demo_idx" ON "demo_step_plans" USING btree ("demo_id");--> statement-breakpoint
-- A demo has at most one READY analysis; failed/rejected attempts may repeat.
CREATE UNIQUE INDEX IF NOT EXISTS "demo_analyses_one_ready_per_demo" ON "demo_analyses" ("demo_id") WHERE "status" = 'ready';--> statement-breakpoint

-- demo_segments shipped empty in V0 as the seam for "a demo becomes an ordered
-- list of segments"; demo_step_plans supersedes it with plan-level status,
-- approval and versioning. Zero rows and zero code references anywhere.
-- Founder-approved drop, 2026-08-11. (On Supabase, its 0002 RLS policy drops
-- with the table.)
DROP TABLE IF EXISTS "demo_segments";
