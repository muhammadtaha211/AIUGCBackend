-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- feedback learns to hold an ANONYMOUS row: the public /contact form.
--
-- 0035 built feedback for the in-app "צור קשר" behind requireUser, so user_id
-- was NOT NULL and the founder answered to the address on the users row. A
-- public contact form (a separate task -- prompt C, 2026-09-17) has no user:
-- the visitor types a name and an email, and the row has to survive with
-- neither a users row nor a business.
--
--   user_id        now NULLABLE. NULL means "written from /contact by someone
--                  not signed in"; a signed-in customer's row still carries it.
--   contact_name   what the visitor typed. NULL on signed-in rows.
--   contact_email  the address to answer to when there is no users row.
--                  Stored verbatim, never validated beyond the form's zod.
--   ip             the first hop of x-forwarded-for, for the founder's spam
--                  triage. NULL on rows written before this migration and on
--                  the in-app path until it starts recording one.
--
-- Additive: the deployed submitFeedback always sets user_id, and the admin
-- inbox's join to users becomes a LEFT join in the same change so an
-- anonymous row is listed rather than silently dropped.
ALTER TABLE "feedback" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN IF NOT EXISTS "contact_name" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN IF NOT EXISTS "contact_email" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN IF NOT EXISTS "ip" text;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select column_name, is_nullable from information_schema.columns
--    where table_name = 'feedback'
--      and column_name in ('user_id', 'contact_name', 'contact_email', 'ip')
--    order by column_name;
--
-- BEFORE expect one row: user_id NO. AFTER expect four rows, all YES.
-- ---------------------------------------------------------------------------
