CREATE TYPE "public"."composite_status" AS ENUM('queued', 'generating', 'ready', 'failed');--> statement-breakpoint
ALTER TYPE "public"."usage_kind" ADD VALUE 'images';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "composites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"persona_id" uuid NOT NULL,
	"product_image_path" text,
	"output_path" text,
	"status" "composite_status" DEFAULT 'queued' NOT NULL,
	"approved_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "composites" ADD CONSTRAINT "composites_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "composites" ADD CONSTRAINT "composites_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "composites_business_idx" ON "composites" USING btree ("business_id");