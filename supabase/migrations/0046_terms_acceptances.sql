-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- terms_acceptances: the record that a signed-in customer ticked the terms box
-- at checkout.
--
-- Founder decision 2026-09-17: terms acceptance at purchase is a checkbox plus
-- a stored record. The card company behind the Sumit-on-Upay stack (Upay is
-- the acquirer) requires it at onboarding, which reverses
-- docs/legal-review.md row T1 (browse-wrap acceptance) for the PURCHASE step
-- only -- the rest of the site keeps "use is acceptance". The record is what
-- the card company can ask for: who, which version of the text, from where,
-- when.
--
--   user_id        who accepted. NOT NULL: the checkout route is behind
--                  requireUser, and an anonymous acceptance proves nothing.
--   terms_version  the date string the terms page shows at its head (UPDATED
--                  in apps/web/src/app/(legal)/legal.tsx, '11.09.2026' at the
--                  time of writing). Stored as text, not parsed: it is a label
--                  matching the page, not a timestamp.
--   context        where it was accepted -- 'checkout' today. Text, not an
--                  enum, so a second surface is a new string and not a
--                  migration.
--   ip / user_agent  what the request carried. ip is the first hop of
--                  x-forwarded-for; both nullable, both stored verbatim,
--                  neither trusted for anything but the record.
--   accepted_at    when.
--
-- One index, on user_id: the only read is "did this account accept, and
-- when" -- there is no admin list yet.
--
-- WHY THERE IS NO SEPARATE RLS FILE HERE -- 0035's pattern, followed exactly.
-- decisions/0018-rls-cannot-ride-in-a-portable-migration splits a table from
-- its RLS because CREATE POLICY ... TO authenticated names a Supabase role
-- PGlite does not have. This table needs NO policy: server-only in 0002's
-- sense, RLS on, zero policies, deny-all for anon and authenticated; the only
-- writer is the checkout route over DATABASE_URL as postgres, which bypasses
-- RLS. A bare ENABLE ROW LEVEL SECURITY is plain Postgres, so the whole
-- migration is one portable file
-- (facts/pglite-accepts-bare-enable-row-level-security,
-- decisions/0035-a-policyless-table-keeps-its-rls-in-the-portable-file).
--
-- No ON DELETE CASCADE, matching every other FK in this schema (0010).
CREATE TABLE IF NOT EXISTS "terms_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"terms_version" text NOT NULL,
	"context" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "terms_acceptances_user_idx" ON "terms_acceptances" ("user_id");
--> statement-breakpoint

-- Server-only: RLS on, no policies -> invisible to browser clients, exactly
-- like feedback in 0035 and jobs/events/app_config in 0002.
ALTER TABLE "terms_acceptances" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select relrowsecurity from pg_class where oid = 'public.terms_acceptances'::regclass;
--   select count(*) from information_schema.columns where table_name = 'terms_acceptances';
--   select indexname from pg_indexes where tablename = 'terms_acceptances';
--
-- BEFORE the first errors (no such relation) and the second reads 0.
-- AFTER expect true, 7, and [terms_acceptances_pkey, terms_acceptances_user_idx].
-- ---------------------------------------------------------------------------
