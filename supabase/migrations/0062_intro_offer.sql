-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- The ₪5 intro offer (decision 0109, founder 2026-10-13/14). An account that
-- has never paid buys, once, on its own Sumit payment page, 150 credits that
-- expire 30 days after the payment and never turn into a charge by
-- themselves. "Continue" later charges the card Sumit saved at that payment
-- for an ordinary first month of a plan. Names neither ledger value 0061 adds
-- (0019's rule: 0061 and this file may run in one push).
--
-- 1. checkout_intents learns a KIND. The ₪5 payment rides the same intent row
--    and the same return route as a plan purchase (0062's binding: the intent,
--    the session, a server-to-server read of the payment), so its intent is a
--    row here with kind 'intro' and no plan:
--
--      kind       'plan' | 'intro'. Text with a CHECK, not an enum (0048's
--                 reasoning). The constant DEFAULT fills every existing row
--                 with 'plan' and covers the deployed code, which inserts
--                 without naming it. No table rewrite on PG11+ (the constant
--                 default is stored as metadata); the two CHECKs each validate
--                 the existing rows in one short scan.
--      plan_code  now NULL for an intro intent. The FK to plans stays (a NULL
--                 skips it); checkout_intents_kind_plan_check keeps a plan
--                 intent from losing its plan and an intro intent from
--                 carrying one.
--
-- 2. intro_trials: one row per account that bought the offer, written when the
--    ₪5 payment is verified. user_id is the PRIMARY KEY, so the offer is once
--    per account by construction.
--
--      intent_id            the completed intro intent (its sumit_payment_id
--                           is the ₪5 payment). UNIQUE.
--      sumit_customer_id    the Sumit customer that page created — what a
--                           continue charges (its default card is the card
--                           that paid, aligned at completion as for a plan).
--      price_agorot, credits  what was paid and granted (500, 150 today).
--      balance_before, manual_before, open_debits_before
--                           the account at activation, read in one statement
--                           under the users lock: its balance, its lifetime
--                           grant_manual sum, and the render ids it had been
--                           debited for and not refunded (a jsonb array of
--                           uuid strings, usually empty). The day-30 expiry
--                           takes balance − balance_before − manual granted
--                           since − refunds of those renders, capped at
--                           credits: spend uses trial credits before manual
--                           ones, and no manual credit is ever expired
--                           (packages/core/src/pipelines/credits.ts).
--      started_at, expires_at  the payment's date and 30 days after it.
--      expired_at           set by the sweep (or by a conversion after
--                           expires_at, which expires first).
--      converted_at, subscription_id  set when the account joins a plan —
--                           by a continue or by a hosted checkout.
--      continue_attempt_at/_plan/_agorot  a continue in flight or whose
--                           answer was lost: written BEFORE the saved card is
--                           charged and cleared when the answer is known, so a
--                           lost answer blocks a second charge until
--                           reconcile_continue settles it. All three or none.
--
-- 3. app_config intro_offer = {"enabled": false}: the off switch (0109 §1.7).
--    Seeded off; going live is one founder SQL statement, after the box carries
--    the expire_trials and reconcile_continue handlers and SUMIT_INTRO_PAGE is
--    set (docs/05-billing.md). Absent or unparseable reads as off. Only new
--    intents and the offer's visibility read it: a page already paid, a
--    running trial, the sweep and a continue never do.
--
-- RLS: 0046's server-only pattern — RLS on, zero policies.
-- No ON DELETE CASCADE, matching every other FK in this schema (0010).
-- Every statement is safe to run twice.

ALTER TABLE "checkout_intents" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'plan' NOT NULL CONSTRAINT "checkout_intents_kind_check" CHECK ("kind" IN ('plan', 'intro'));
--> statement-breakpoint
ALTER TABLE "checkout_intents" ALTER COLUMN "plan_code" DROP NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkout_intents" ADD CONSTRAINT "checkout_intents_kind_plan_check" CHECK (("kind" = 'plan') = ("plan_code" IS NOT NULL));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "intro_trials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"intent_id" uuid NOT NULL,
	"sumit_customer_id" text NOT NULL,
	"price_agorot" integer NOT NULL,
	"credits" integer NOT NULL,
	"balance_before" integer NOT NULL,
	"manual_before" integer NOT NULL,
	"open_debits_before" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"expired_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"subscription_id" uuid,
	"continue_attempt_at" timestamp with time zone,
	"continue_attempt_plan" text,
	"continue_attempt_agorot" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intro_trials_intent_id_unique" UNIQUE ("intent_id"),
	CONSTRAINT "intro_trials_attempt_check" CHECK (
		("continue_attempt_at" IS NULL) = ("continue_attempt_plan" IS NULL)
		AND ("continue_attempt_at" IS NULL) = ("continue_attempt_agorot" IS NULL)
	),
	CONSTRAINT "intro_trials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id"),
	CONSTRAINT "intro_trials_intent_id_checkout_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."checkout_intents"("id"),
	CONSTRAINT "intro_trials_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id"),
	CONSTRAINT "intro_trials_continue_attempt_plan_plans_code_fk" FOREIGN KEY ("continue_attempt_plan") REFERENCES "public"."plans"("code")
);
--> statement-breakpoint

-- Server-only: RLS on, no policies -> invisible to browser clients.
ALTER TABLE "intro_trials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

INSERT INTO "app_config" ("key", "value") VALUES ('intro_offer', '{"enabled": false}'::jsonb)
ON CONFLICT ("key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select column_name, is_nullable, column_default from information_schema.columns
--    where table_name = 'checkout_intents' and column_name in ('kind', 'plan_code')
--    order by column_name;
--   select conname from pg_constraint
--    where conrelid = 'public.checkout_intents'::regclass and conname like 'checkout_intents_kind%'
--    order by conname;
--   select kind, count(*) from checkout_intents group by 1;
--   select relrowsecurity from pg_class where oid = 'public.intro_trials'::regclass;
--   select count(*) from pg_policies where tablename = 'intro_trials';
--   select count(*) from information_schema.columns where table_name = 'intro_trials';
--   select count(*) from intro_trials;
--   select value from app_config where key = 'intro_offer';
--
-- BEFORE: only plan_code (NO, no default); no kind constraints; the kind query
-- errors (no such column); intro_trials errors (no such relation); no
-- intro_offer row.
-- AFTER: kind (NO, 'plan'::text) and plan_code (YES); checkout_intents_kind_check
-- and checkout_intents_kind_plan_check; every existing intent counted under
-- 'plan'; intro_trials with relrowsecurity true, 0 policies, 17 columns, 0
-- rows; intro_offer = {"enabled": false}. Nothing is backfilled.
-- ---------------------------------------------------------------------------
