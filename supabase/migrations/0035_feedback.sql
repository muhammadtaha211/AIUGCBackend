-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).
--
-- WHY THERE IS NO SEPARATE RLS FILE HERE
-- decisions/0018-rls-cannot-ride-in-a-portable-migration splits a table from
-- its RLS because CREATE POLICY ... TO authenticated names a Supabase role that
-- PGlite does not have. `feedback` needs NO policy — it is a server-only table
-- in the sense of 0002's "Server-only tables" block: RLS on, zero policies, so
-- it is deny-all for anon and authenticated, and the only readers (the web POST
-- route and the admin page) reach it over DATABASE_URL as postgres, which
-- bypasses RLS. A bare ALTER TABLE ... ENABLE ROW LEVEL SECURITY is plain
-- Postgres, so 0018's blocker never applies and the whole migration is one
-- portable file — one apply step for the founder.
-- Measured 2026-09-08 on a fresh PGlite instance: the bare ENABLE succeeds and
-- pg_class.relrowsecurity reads true; adding `TO authenticated` to a policy on
-- the same table still fails with `role "authenticated" does not exist`.
-- See facts/pglite-accepts-bare-enable-row-level-security.
--
-- The table: in-app "צור קשר". The customer writes one message from
-- /home/feedback and it lands here for the founder to read in the admin
-- console. No email, no Slack, no notification — the founder reads the tab.
--
--   user_id      who wrote it. NOT NULL: the route is behind requireUser.
--   business_id  the business selected in the sidebar cookie at the time.
--                NULLABLE: a user with no business yet can still write, and the
--                message must survive regardless.
--   page         the pathname the form was opened from, for context only.
--
-- No ON DELETE CASCADE, matching every other FK in this schema (0010): rows are
-- never removed, so a cascade would only ever fire on a manual delete.
CREATE TABLE IF NOT EXISTS "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_id" uuid,
	"message" text NOT NULL,
	"page" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback" ADD CONSTRAINT "feedback_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- The admin page reads newest-first and nothing else; the "load more" link
-- pages on created_at. One index, matching that one access path.
CREATE INDEX IF NOT EXISTS "feedback_created_idx" ON "feedback" ("created_at" DESC);
--> statement-breakpoint

-- Server-only: RLS on, no policies -> invisible to browser clients, exactly
-- like jobs/events/app_config in 0002. Deliberately NOT the first table in this
-- schema to skip RLS (facts/every-migrated-table-enables-rls).
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;
