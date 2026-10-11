-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- Social posting (decision 0101, founder 2026-10-10): Tavnit schedules a
-- finished render and posts it to the customer's Instagram as a Reel, or sends
-- it to their TikTok inbox. Three enum TYPES carry the two tables of 0058:
--
--   social_platform        'instagram' | 'tiktok' — which platform a connection
--                          or a post belongs to. TikTok is a value from day one
--                          so the schema never moves when it is built (the
--                          plan names it as the next task); nothing writes it yet.
--   social_account_status  'connected' | 'expired' | 'disconnected' | 'deleted'
--                          — expired: the platform refused the stored token and
--                          the customer must reconnect; disconnected: the
--                          customer pressed ניתוק; deleted: Meta's data-deletion
--                          callback. Rows are never deleted (post history keeps
--                          its foreign keys); tokens are erased instead.
--   scheduled_post_status  'scheduled' | 'publishing' | 'posted' | 'failed' |
--                          'cancelled' — the life of one post. 'publishing' is
--                          the point of no return: an edit or a cancel is
--                          refused once the publish job has moved the row there.
--
-- Alone in this file to mirror 0051's shape (one file per enum change). Unlike
-- ALTER TYPE ... ADD VALUE, a freshly CREATEd type may be used in the same
-- transaction, so the split is convention, not necessity. CREATE TYPE has no
-- IF NOT EXISTS, hence the DO blocks: a second apply is a no-op, not a
-- duplicate_object error.
DO $$ BEGIN
  CREATE TYPE "public"."social_platform" AS ENUM ('instagram', 'tiktok');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."social_account_status" AS ENUM ('connected', 'expired', 'disconnected', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."scheduled_post_status" AS ENUM ('scheduled', 'publishing', 'posted', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select t.typname, array_agg(e.enumlabel order by e.enumsortorder)
--     from pg_type t join pg_enum e on e.enumtypid = t.oid
--    where t.typname in ('social_platform', 'social_account_status', 'scheduled_post_status')
--    group by t.typname order by t.typname;
--
-- BEFORE expect 0 rows. AFTER expect the three types with the values above,
-- in that order. No row of any table changes.
-- ---------------------------------------------------------------------------
