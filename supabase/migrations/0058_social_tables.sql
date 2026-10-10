-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- Social posting (decision 0101): the two tables behind "schedule a finished
-- video and post it". The subsystem is docs/09-social-posting.md.
--
-- social_accounts — a connected platform account, owned by the Tavnit ACCOUNT
-- (users), not by one business: the founder runs three Instagram accounts and
-- one TikTok across his businesses and picks at schedule time.
--
--   external_id            the Instagram user id (an IG professional account),
--                          or the TikTok open_id.
--   username / display_name / picture_url
--                          what the pickers and the Integrations section show;
--                          refreshed on every connect and by the daily check,
--                          because Instagram's picture links expire.
--   page_id / page_name    Instagram only: the Facebook Page the account is
--                          linked to (Meta's Facebook-Login setup needs one
--                          Page per account).
--   fb_user_id             Instagram only: the Facebook user who connected it —
--                          the id Meta's data-deletion callback names.
--   access_token_enc       SEALED (packages/core/src/secret-box.ts, AES-256-GCM
--                          under SOCIAL_TOKEN_KEY, AAD = user/platform/external
--                          id). Instagram: the PAGE token, which Meta documents
--                          as having no expiry; TikTok: the 24-hour access token.
--   user_token_enc / user_token_expires_at
--                          Instagram only: the ~60-day USER token the sound
--                          search is documented against. Publishing never
--                          depends on it.
--   refresh_token_enc / refresh_expires_at
--                          TikTok only.
--   status / last_error    see 0057. 'expired' is written by the daily check
--                          or by a publish that met a token error.
--
-- A reconnect of the same account RESTORES its live row in place (the partial
-- unique index below allows one connected-or-expired row per account); a
-- disconnected or deleted row stays as history and lets a fresh row in.
--
-- scheduled_posts — one row per video × account. A post to three accounts is
-- three rows: each shows its own account on the calendar and can fail alone.
--
--   scheduled_at / timezone  the absolute instant, and the IANA zone the
--                            customer scheduled in (display only).
--   caption / sound          the caption (Instagram's 2,200-character limit is
--                            enforced in code) and a jsonb snapshot of the
--                            catalogue sound picked, Instagram only.
--   provider_container_id    Meta's creation id (TikTok: the publish id).
--   provider_media_id / permalink
--                            written the instant media_publish returns — Meta
--                            documents no way to recover the id later.
--   failure_kind / failure_detail / failure_acknowledged_at
--                            kind is a closed set in code (pipelines/social.ts);
--                            detail is the diagnostic and never reaches a
--                            customer; acknowledged clears the /home notice.
--   deferred_until           set while the publish job waits out Instagram's
--                            daily publishing quota (status stays publishing).
--
-- RLS: 0050/0052's shape. Server-only — RLS on, zero policies, so the browser
-- clients (anon and authenticated) see nothing; every reader and writer is a
-- route handler or the worker over DATABASE_URL as postgres, which bypasses
-- RLS and applies the owner filter itself. A bare ENABLE ROW LEVEL SECURITY is
-- plain Postgres, so the whole migration is one portable file.
CREATE TABLE IF NOT EXISTS "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" "social_platform" NOT NULL,
	"external_id" text NOT NULL,
	"username" text,
	"display_name" text,
	"picture_url" text,
	"page_id" text,
	"page_name" text,
	"fb_user_id" text,
	"access_token_enc" text,
	"user_token_enc" text,
	"user_token_expires_at" timestamp with time zone,
	"refresh_token_enc" text,
	"refresh_expires_at" timestamp with time zone,
	"status" "social_account_status" DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	CONSTRAINT "social_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_accounts_live_idx"
  ON "social_accounts" ("user_id", "platform", "external_id")
  WHERE "status" IN ('connected', 'expired');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_accounts_fb_user_idx" ON "social_accounts" ("fb_user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "scheduled_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"video_render_id" uuid NOT NULL,
	"social_account_id" uuid NOT NULL,
	"platform" "social_platform" NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"sound" jsonb,
	"status" "scheduled_post_status" DEFAULT 'scheduled' NOT NULL,
	"provider_container_id" text,
	"provider_media_id" text,
	"permalink" text,
	"failure_kind" text,
	"failure_detail" text,
	"failure_acknowledged_at" timestamp with time zone,
	"deferred_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id"),
	CONSTRAINT "scheduled_posts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id"),
	CONSTRAINT "scheduled_posts_video_render_id_video_renders_id_fk" FOREIGN KEY ("video_render_id") REFERENCES "public"."video_renders"("id"),
	CONSTRAINT "scheduled_posts_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id")
);
--> statement-breakpoint
-- The calendar: one account's month.
CREATE INDEX IF NOT EXISTS "scheduled_posts_user_time_idx" ON "scheduled_posts" ("user_id", "scheduled_at");
--> statement-breakpoint
-- The grey tag on a tile: is anything pending for this render.
CREATE INDEX IF NOT EXISTS "scheduled_posts_render_pending_idx"
  ON "scheduled_posts" ("video_render_id")
  WHERE "status" IN ('scheduled', 'publishing');
--> statement-breakpoint
-- Disconnect cancels an account's pending posts.
CREATE INDEX IF NOT EXISTS "scheduled_posts_account_scheduled_idx"
  ON "scheduled_posts" ("social_account_id")
  WHERE "status" = 'scheduled';
--> statement-breakpoint

-- Server-only: RLS on, no policies -> invisible to browser clients.
ALTER TABLE "social_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "scheduled_posts" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select relname, relrowsecurity from pg_class
--    where relname in ('social_accounts', 'scheduled_posts') order by relname;
--   select count(*) from pg_policies where tablename in ('social_accounts', 'scheduled_posts');
--   select indexname from pg_indexes
--    where tablename in ('social_accounts', 'scheduled_posts') order by indexname;
--   select count(*) from social_accounts; select count(*) from scheduled_posts;
--
-- BEFORE the first and last error (no such relation) and the policy count is 0.
-- AFTER expect both tables with relrowsecurity true, 0 policies, the two
-- primary keys plus social_accounts_fb_user_idx, social_accounts_live_idx,
-- scheduled_posts_account_scheduled_idx, scheduled_posts_render_pending_idx,
-- scheduled_posts_user_time_idx, and 0 rows in each: nothing is backfilled and
-- no existing table is touched.
-- ---------------------------------------------------------------------------
