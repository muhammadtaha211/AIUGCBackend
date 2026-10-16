-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- TikTok inbox posting (PR 4, decision 0115): a TikTok post goes
--   scheduled → publishing → delivered → posted
-- where `delivered` means TikTok put the video in the owner's inbox (status
-- SEND_TO_USER_INBOX, or the post.publish.inbox_delivered webhook) and is
-- waiting for the owner to finish it in the app, and `posted` means TikTok said
-- the owner posted it (post.publish.complete). Instagram never uses `delivered`.
--
-- ALONE IN THIS FILE ON PURPOSE, 0019's rule (and 0061's): ALTER TYPE ... ADD
-- VALUE may run inside a transaction block, but the new value CANNOT be used in
-- that same transaction. 0065 names no status. Idempotent on PG 13+.
--
-- It goes FIRST, ahead of its code: nothing in the tree before PR 4 writes or
-- reads 'delivered', so the value is inert until that build deploys.
ALTER TYPE "public"."scheduled_post_status" ADD VALUE IF NOT EXISTS 'delivered' AFTER 'publishing';

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select enumlabel from pg_enum
--    where enumtypid = 'public.scheduled_post_status'::regtype order by enumsortorder;
--
-- BEFORE expect scheduled, publishing, posted, failed, cancelled. AFTER expect
-- scheduled, publishing, delivered, posted, failed, cancelled. No row of any
-- table changes.
-- ---------------------------------------------------------------------------
