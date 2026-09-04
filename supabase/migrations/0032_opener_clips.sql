-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).
-- RLS for opener_clips is SUPABASE-ONLY and lives in 0033_rls_opener_clips.sql.
--
-- Service B's selfie format (decisions/0017-service-b-single-setting-selfie-talking-head).
--
-- persona_images.kind gains a third value, 'selfie' — the Service B render
-- source and the B card thumbnail. kind is text with no CHECK, so the value
-- needs no DDL; it is documented in schema.ts and docs/01-schema.md, and the
-- two literals are still enforced at the app boundary (apps/admin/src/lib/
-- admin.ts, apps/web/src/lib/service-b.ts), which this migration does not touch.
--
-- source_image_id records which standing image a selfie was derived from
-- (lineage only, exactly like hook_clips.source_clip_id in 0013). No cascade:
-- render params reference image ids, so rows are never removed (0010).
ALTER TABLE "persona_images" ADD COLUMN "source_image_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "persona_images" ADD CONSTRAINT "persona_images_source_image_id_persona_images_id_fk" FOREIGN KEY ("source_image_id") REFERENCES "public"."persona_images"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- The opener-clip bank: the founder generates one short clip per
-- (selfie image x effect) offline and uploads it play-ready — already reversed
-- where the effect is a reveal. Nothing processes it at render time.
--
--   effect          free key for the motion, e.g. 'hand_cover', 'finger_snap'
--   label           Hebrew, shown to the customer in the effect step
--   reveal_at_ms    first frame the face is fully clear, in clip time; the
--                   hook text burns over the palm phase before it and the
--                   render hard-cuts into the HeyGen output there
--   text_safe_area  {x,y,w,h} in 1080x1920 space, same shape as
--                   hook_clips.text_safe_area and required at register
--
-- Soft delete is active=false, like the hook bank.
CREATE TABLE IF NOT EXISTS "opener_clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_image_id" uuid NOT NULL,
	"effect" text NOT NULL,
	"label" text NOT NULL,
	"file_path" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"reveal_at_ms" integer NOT NULL,
	"text_safe_area" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opener_clips_reveal_within_duration" CHECK ("reveal_at_ms" >= 0 AND "reveal_at_ms" <= "duration_ms")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "opener_clips" ADD CONSTRAINT "opener_clips_persona_image_id_persona_images_id_fk" FOREIGN KEY ("persona_image_id") REFERENCES "public"."persona_images"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- One live clip per (selfie image x effect). Partial, so superseded clips stay
-- in the table as active=false and the pair can be re-registered.
CREATE UNIQUE INDEX IF NOT EXISTS "opener_clips_one_active_per_image_effect"
  ON "opener_clips" ("persona_image_id", "effect")
  WHERE "active";
