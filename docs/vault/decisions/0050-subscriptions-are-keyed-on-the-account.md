---
type: decision
status: verified
verified: 2026-09-16
method: "Founder instruction in chat, 2026-09-16, verbatim in substance: subscriptions are keyed on the ACCOUNT (users.id), not the business — one account, one live subscription, one credit pool, and every business the owner holds spends from it. Built and read back on the working tree: supabase/migrations/0041_subscriptions_keyed_on_user.sql (portable) and 0042_rls_subscriptions_user.sql (Supabase-only), packages/core/src/db/schema.ts:564-585, pipelines/credits.ts:128 (grantPeriod) and :159 (expirePeriodRemainder), pipelines/billing.ts:73/:113/:115. Pinned by packages/core/test/billing.test.ts describe 'subscriptions are keyed on the account (0041)' (2 tests) plus the updated helpers in billing/credit-ledger/terminal-failures; 0041 applies on PGlite as part of PORTABLE_MIGRATIONS (core suite green, 46 files / 562 tests, serial). NEITHER MIGRATION HAS BEEN PUSHED to production."
source: founder
---

# 0050 — Subscriptions are keyed on the account, not the business

Founder decision in chat, **2026-09-16**. `subscriptions` moves from `business_id` to `user_id`.
One account, one live subscription, one credit pool; every business the owner holds spends from it.

This is **not a new model**. Credits already behave exactly this way — migration 0011 moved
`credit_ledger` to `user_id` in 2026-08 and `creditBalance` has summed per account ever since. What
0011 did not do was follow through to `subscriptions`, which kept its `business_id` and its
`subscriptions_one_live_per_business` index. The gap was written down in `docs/05-billing.md` as a
callout — "Deferred to payments — the subscription-keying question" — and deliberately left for
whoever built checkout. This decision closes it before checkout is built, which is the cheap moment.

**Production is believed to hold zero `subscriptions` rows, and that was NOT measured for this
change.** What is known: no production code path inserts one — every insert in the tree is
test-only ([[../facts/no-self-serve-credit-grant-path]], a code read, re-grepped at this commit and
still exhaustive), and `getBillingGateway` returns `NotConfiguredGateway` outside `DRY_RUN`. What is
NOT known: the live row count. The only count anyone ever took is [[../facts/demo-corpus]], and it
is `verified: 2026-08-23` **against the project that has since been deleted** — it predates the
2026-08-27 env flip, so it says nothing about `hyaqydcmwbnbaiqqufow`. The migration does not depend
on the answer: the backfill is written for a non-empty table and is pinned by a test that seeds
business-keyed rows and runs 0041 over them
(`packages/core/test/migrations.test.ts`, "0041: backfills user_id from each subscription's business
owner"). A live `select count(*) from subscriptions` before the push would make this a measurement
instead of an expectation, and costs one query.

## What the alternative would have cost

The rejected shape is the one the schema already had: subscriptions per business, credits per
account. An owner with three businesses would hold three subscriptions and pay three times, while
drawing the three plans' credits out of one shared pool — so the second and third subscriptions buy
credits the first one's pool was already going to hold, and a downgrade on one business silently
reduces the credits available to the other two. There is no coherent reading of that where the
customer is charged for what he gets. The only other way out is to make credits per-business too,
which means reverting 0011 and giving one owner three balances to shuffle between. The founder
picked the direction credits already went.

## What changed

- **Migration `0041_subscriptions_keyed_on_user.sql`** (portable, 0011's style): add `user_id`,
  backfill from `businesses.owner_user_id` through the old `business_id`, `SET NOT NULL`, FK to
  `users` behind the `duplicate_object` guard; swap `subscriptions_one_live_per_business` for
  `subscriptions_one_live_per_user` (same `status IN ('active','past_due','suspended')` predicate);
  swap `subscriptions_business_idx` for `subscriptions_user_idx`; drop `business_id`.
  The backfill is written even though the table is empty — a migration that only works on an empty
  table is not portable, and this one has to run on PGlite in every test process.
- **Migration `0042_rls_subscriptions_user.sql`** (Supabase-only, 0012's style): recreate
  `subscriptions_select_own` as `user_id = (SELECT auth.uid())`. This file exists because of a
  dependency the brief did not anticipate: 0002's policy reads `business_id` through
  `owns_business()`, and Postgres refuses to drop a column a policy depends on. **0041 therefore
  carries a `DROP POLICY IF EXISTS` of its own**, immediately before the `DROP COLUMN` — `IF EXISTS`
  makes it a no-op on PGlite, which never applies 0002. Splitting it any other way would either
  make the portable file un-appliable on Supabase or leave PGlite's schema drifting from
  production's.
- **`grant_period` and `expire_period` rows are now account-level** — `business_id` NULL, the same
  shape `grant_manual` has always had ("user-level grants have none", 0011's header). `business_id`
  survives only on the spend rows, `debit_render` and `refund_failed`, where it is real context:
  which brand the money went on.
- `expirePeriodRemainder`'s manual-outstanding protection is **unchanged in behaviour**. It was
  already summing per user — `creditBalance` and `manualOutstanding` both key on `user_id` — and the
  only difference is that the account now arrives as an argument instead of being looked up from a
  business. `expirable = balance − manualOutstanding` is computed over exactly the same rows.

## What was deliberately not touched

- `subscriptions.gateway` keeps its `'grow'` default. Sumit is not confirmed against
  [[0046-billing-ships-as-osek-patur]]'s four requirements, and that is a separate decision.
- `orders` stays business-keyed. A DFY order is one piece of work for one brand, paid once — not a
  standing relationship with an account.
- `createSet`, `createBRender`, `debitRender` and the two-debit-sites invariant are untouched, as
  are the plans seed and `credit_costs`.

## Status

**Written, NOT pushed.** Neither 0041 nor 0042 has been applied to production; the ledger is still
clean at 0000–0040. Pushing them is a founder call for that one push, like every push before it.
They must go **together and in order** — 0041 drops the policy 0042 recreates — and the push should
add a structural row for 0041 to `scripts/verify-migration-ledger.sql`, which is where every earlier
push recorded its proof. Nothing there mentions `subscriptions` today, so the file stays honest
until then.
