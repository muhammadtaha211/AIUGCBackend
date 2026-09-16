-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- Subscriptions belong to the ACCOUNT, not the business: one owner, one live
-- subscription, one credit pool that every business he holds spends from.
-- Credits already worked this way (0011 re-keyed credit_ledger to user_id and
-- left subscriptions behind); this closes that gap. user_id is backfilled from
-- each row's business owner, then business_id goes entirely — unlike a ledger
-- spend row, a subscription has no per-business context worth keeping.
ALTER TABLE "subscriptions" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "subscriptions" SET "user_id" = "businesses"."owner_user_id" FROM "businesses" WHERE "subscriptions"."business_id" = "businesses"."id";--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- An ACCOUNT holds at most one live subscription (canceled ones may pile up),
-- replacing 0001's per-business index. Strictly stricter than what it
-- replaces, so it can only fail on an owner who already holds two live
-- subscriptions across two businesses — which is exactly the state this
-- decision outlaws, and must fail loudly rather than be picked for him.
DROP INDEX IF EXISTS "subscriptions_one_live_per_business";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_one_live_per_user"
  ON "subscriptions" ("user_id")
  WHERE "status" IN ('active', 'past_due', 'suspended');--> statement-breakpoint
DROP INDEX IF EXISTS "subscriptions_business_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint

-- 0002's subscriptions_select_own reads business_id through owns_business(),
-- and Postgres refuses to drop a column a policy depends on. Dropping the
-- policy here keeps THIS file the one that applies everywhere; 0042 recreates
-- it on user_id, as 0012 did for the ledger after 0011. IF EXISTS makes it a
-- no-op on PGlite, which never applies 0002.
DROP POLICY IF EXISTS "subscriptions_select_own" ON "subscriptions";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP COLUMN "business_id";
