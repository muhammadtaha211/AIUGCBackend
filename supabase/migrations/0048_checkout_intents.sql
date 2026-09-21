-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- checkout_intents: one row per "the customer is about to pay for a plan" —
-- written by POST /api/account/checkout BEFORE the browser leaves for the
-- Sumit payment page, and completed by GET /api/billing/sumit/return when the
-- browser comes back. Decision 0062 (hosted checkout via Sumit payment pages).
--
-- Why a table and not a signed query string: the return URL arrives from the
-- customer's browser with nothing we can trust on it (the og-* parameters are
-- plain text, and there is no signature). The intent is the server-side half
-- the return binds on: which account, which plan, at which price — snapshotted
-- at creation so a plan price edited mid-checkout cannot activate a
-- subscription at a price the customer never saw. Sumit's product carries the
-- fixed price; comparing its payment amount to price_agorot is what keeps
-- Sumit and `plans` in agreement.
--
--   user_id              who is buying. NOT NULL: the checkout route is behind
--                        requireUser.
--   plan_code            what is being bought (FK to plans, never deleted).
--   price_agorot         the plan's price at creation. The verify step refuses
--                        a payment whose amount differs.
--   status               'pending' | 'completed' | 'expired'. Text with a
--                        CHECK, not an enum: an enum value is its own migration.
--                        'expired' means "no longer reused by a new click"
--                        (24 h), NOT "no longer payable": the Sumit page
--                        carrying the id stays open as long as the customer
--                        keeps it, and its payment still completes the row.
--   sumit_payment_id     Sumit's payment id, written on completion. UNIQUE so a
--                        replayed return cannot complete two intents with one
--                        payment (Postgres lets NULLs repeat, so pending rows
--                        are unaffected).
--   sumit_customer_id    Sumit's customer id, written on completion — the same
--                        value subscriptions.gateway_recurring_ref carries.
--   terms_acceptance_id  the terms_acceptances row the click recorded; NULL
--                        when a pending intent was reused (queue item 12: one
--                        acceptance row per intent, not per click).
--   created_at / completed_at  when.
--
-- One index on (user_id, status): the only reads are "this account's pending
-- intent for this plan" and "this account's pending intents older than 24h".
--
-- RLS: 0046's pattern exactly. Server-only in 0002's sense — RLS on, zero
-- policies, deny-all for anon and authenticated; the only reader and writer is
-- the web tier over DATABASE_URL as postgres, which bypasses RLS. A bare
-- ENABLE ROW LEVEL SECURITY is plain Postgres, so the whole migration is one
-- portable file (decisions/0035, facts/pglite-accepts-bare-enable-row-level-security).
--
-- No ON DELETE CASCADE, matching every other FK in this schema (0010).
CREATE TABLE IF NOT EXISTS "checkout_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_code" text NOT NULL,
	"price_agorot" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sumit_payment_id" text,
	"sumit_customer_id" text,
	"terms_acceptance_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "checkout_intents_status_check" CHECK ("status" IN ('pending', 'completed', 'expired')),
	CONSTRAINT "checkout_intents_sumit_payment_id_unique" UNIQUE ("sumit_payment_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkout_intents" ADD CONSTRAINT "checkout_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkout_intents" ADD CONSTRAINT "checkout_intents_plan_code_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."plans"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkout_intents" ADD CONSTRAINT "checkout_intents_terms_acceptance_id_terms_acceptances_id_fk" FOREIGN KEY ("terms_acceptance_id") REFERENCES "public"."terms_acceptances"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "checkout_intents_user_status_idx" ON "checkout_intents" ("user_id", "status");
--> statement-breakpoint

-- Server-only: RLS on, no policies -> invisible to browser clients, exactly
-- like terms_acceptances in 0046 and feedback in 0035.
ALTER TABLE "checkout_intents" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select relrowsecurity from pg_class where oid = 'public.checkout_intents'::regclass;
--   select count(*) from information_schema.columns where table_name = 'checkout_intents';
--   select indexname from pg_indexes where tablename = 'checkout_intents' order by indexname;
--   select conname from pg_constraint where conrelid = 'public.checkout_intents'::regclass order by conname;
--
-- BEFORE the first errors (no such relation) and the second reads 0.
-- AFTER expect true, 10, [checkout_intents_pkey, checkout_intents_sumit_payment_id_unique,
-- checkout_intents_user_status_idx] and the six constraints (pkey, unique, check,
-- three FKs). 0 rows before and after: nothing is backfilled.
-- ---------------------------------------------------------------------------
