-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- The three plans get their Hebrew display names, and the gateway default
-- moves from Grow to Sumit.
--
-- Founder decisions 2026-09-17 (in chat), recorded in
-- docs/vault/decisions/0054-payment-stack-is-sumit-via-upay.md
-- and docs/05-billing.md.
--
-- ---------------------------------------------------------------------------
-- (a) plans.name
-- ---------------------------------------------------------------------------
-- 0043 deliberately left `name` alone: 'Starter' / 'Pro' / 'Studio' in Latin,
-- in a Hebrew-first product, because choosing the Hebrew was the founder's
-- call. He made it:
--
--   starter  'Starter' -> 'התחלה'
--   pro      'Pro'     -> 'מתקדם'
--   studio   'Studio'  -> 'פרימיום'
--
-- The name is a DISPLAY string. Nothing in code selects a plan by name --
-- every lookup is on `code` (billing.ts, the renewal job, the web routes) --
-- so this changes what a customer reads and nothing else. The one place the
-- old name was ever rendered is the renewal charge description in
-- processDueRenewals, which now carries the Hebrew.
--
-- GUARDED on the Latin name each UPDATE replaces, 0043's pattern: a rebuild
-- replays 0001's seed and lands on the Hebrew by construction, and a name the
-- founder has hand-set since is not silently overwritten. A guard that
-- matches nothing exits 0 and still records its version, so this file is
-- read BEFORE it is pushed as well as after (the 0040 lesson).
UPDATE "plans" SET "name" = 'התחלה' WHERE "code" = 'starter' AND "name" = 'Starter';

UPDATE "plans" SET "name" = 'מתקדם' WHERE "code" = 'pro' AND "name" = 'Pro';

UPDATE "plans" SET "name" = 'פרימיום' WHERE "code" = 'studio' AND "name" = 'Studio';

-- ---------------------------------------------------------------------------
-- (b) subscriptions.gateway default
-- ---------------------------------------------------------------------------
-- 0000 defaulted `gateway` to 'grow' when Grow (Meshulam) was the reference
-- vendor. The founder has chosen the stack Sumit-via-Upay: Sumit is the API
-- layer and the documents vendor, Upay (יופיי פיננסים בע"מ) is the acquirer
-- behind it. Our code will call Sumit's API and never Upay, so the gateway
-- name a subscription carries is 'sumit'. The four requirements in decision
-- 0046 §4 are closed at CAPABILITY level from Sumit's help articles (see
-- 0054); the request/response schemas, the refund endpoint and the
-- idempotency key are UNVERIFIED. Nothing depends on them yet: every charge
-- still goes through the BillingGateway interface and production still runs
-- NotConfiguredGateway, so no row is inserted with this default until an
-- adapter exists. A default is the cheapest thing to change if that changes.
ALTER TABLE "subscriptions" ALTER COLUMN "gateway" SET DEFAULT 'sumit';

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER (the UPDATEs are guarded):
--
--   select code, name from plans order by code;
--   select column_default from information_schema.columns
--    where table_name = 'subscriptions' and column_name = 'gateway';
--
-- BEFORE expect 'Pro' / 'Starter' / 'Studio' and 'grow'::text.
-- AFTER  expect 'מתקדם' / 'התחלה' / 'פרימיום' and 'sumit'::text.
-- ---------------------------------------------------------------------------
