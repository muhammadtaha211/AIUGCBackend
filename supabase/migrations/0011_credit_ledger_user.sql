-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- Credits belong to the ACCOUNT, not the business: one user with two businesses
-- spends one shared balance (balance = SUM(delta) per user_id). user_id is the
-- ownership key, backfilled from each row's business owner. business_id stays
-- only as context on spend rows — user-level grants have no business, so it
-- drops NOT NULL.
ALTER TABLE "credit_ledger" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "credit_ledger" SET "user_id" = "businesses"."owner_user_id" FROM "businesses" WHERE "credit_ledger"."business_id" = "businesses"."id";--> statement-breakpoint
ALTER TABLE "credit_ledger" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "credit_ledger" ALTER COLUMN "business_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_user_idx" ON "credit_ledger" USING btree ("user_id");
