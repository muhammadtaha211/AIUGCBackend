-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- TikTok inbox posting (PR 4, decision 0115). Two nullable columns, no backfill:
--
--   social_accounts.access_token_expires_at — when the sealed TikTok access
--     token (access_token_enc, 24 h per TikTok) stops working; the worker and
--     the web refresh it inside a row lock when under 10 minutes remain.
--     Instagram rows leave it null (its Page token has no expiry; the User
--     token keeps user_token_expires_at).
--   scheduled_posts.delivered_at — when a TikTok post reached the owner's inbox
--     (status 'delivered', 0064); bounds the daily status poll to a week.
--
-- It goes FIRST, ahead of its code (the 0039 rule, as 0060): drizzle names
-- every column in a bare select, so a build carrying these in schema.ts
-- against tables without them fails every account and post read — the publish
-- job, the orphan sweep, the calendar, the settings page.
ALTER TABLE "social_accounts" ADD COLUMN IF NOT EXISTS "access_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp with time zone;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select table_name, column_name, data_type, is_nullable
--     from information_schema.columns
--    where (table_name, column_name) in (('social_accounts', 'access_token_expires_at'),
--                                         ('scheduled_posts', 'delivered_at'))
--    order by table_name;
--
-- BEFORE: no rows. AFTER: two rows —
--   scheduled_posts | delivered_at            | timestamp with time zone | YES
--   social_accounts | access_token_expires_at | timestamp with time zone | YES
--
--   select count(*) from social_accounts; select count(*) from scheduled_posts;
--
-- AFTER: both counts unchanged from BEFORE.
-- ---------------------------------------------------------------------------
