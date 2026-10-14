---
type: fact
status: verified
verified: 2026-10-01
method: "code read at f3a6778, NOT a production query: grep of every creditLedger insert (all five live in packages/core/src/pipelines/credits.ts), grep insert(subscriptions) repo-wide, grep 'FOR (INSERT|ALL|UPDATE|DELETE)' over supabase/migrations, callers of grantCredits/grantPeriod; independently re-checked by an adversarial pass that tried to refute it and could not. RE-READ 2026-10-01 at origin/main d57b60a, the same method, still code only (no production query): every insert(creditLedger) outside tests is still one of the five in credits.ts (:67, :94, :115, :134, :169); grantCredits' only production caller is still apps/admin/src/app/api/admin/grants/route.ts:24; grantPeriod now has three production callers (packages/core/src/pipelines/checkout.ts:469, billing.ts:176, billing.ts:359) and one dev script (packages/core/scripts/seed-subscription.ts:103); insert(subscriptions) outside tests is checkout.ts:464 and that script's :92; getBillingGateway billing.ts:52-65; handle_new_user is still defined only in supabase/migrations/0002_supabase_rls.sql:11-26 and inserts into public.users alone; all 24 CREATE POLICY statements in supabase/migrations are FOR SELECT (counted with an awk pass over each statement's FOR clause). AMENDED 2026-10-14 on feat/intro-offer (unmerged; code read, no production query): two new production paths to a positive row — completeCheckout -> activateIntroTrial -> grantTrial (packages/core/src/pipelines/intro.ts, credits.ts) and continueFromTrial / settleContinueAttempts -> applyContinuePayment (intro.ts, the subscriptions insert and grantPeriod) — both behind a real payment; every creditLedger insert still lives in credits.ts (grantTrial and expireTrialRemainder added there). verified left at the last read of main until the branch merges."
source: code
---

# An account that has never paid cannot reach a positive credit balance

## Amended 2026-10-14 on `feat/intro-offer` — STILL HOLDS; a ₪5 payment is now the lowest door

Code read on the branch, not a production query, not merged when written. The ₪5 intro offer
([[0109-a-five-shekel-intro-offer]]) adds two production paths to a positive row, both behind a
real payment, so the headline stands — but the table below is no longer complete, its "₪150 at the
least" is now **₪5**, and `completeCheckout` is no longer the only production insert into
`subscriptions`:

| path to a positive row                                                                  | what stands in front of it                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `completeCheckout` → `activateIntroTrial` → `grantTrial` (`intro.ts`, `credits.ts`)     | the same four checks on a Sumit payment as a plan purchase, at the intro intent's 500 agorot; an account that never had a trial or any subscription and never completed a plan purchase, re-checked under the `users` lock; once per account by `intro_trials`' primary key                                                                                                                                              |
| `continueFromTrial` / `settleContinueAttempts` → insert `subscriptions` + `grantPeriod` | an `intro_trials` row (itself bought for ₪5), and a charge on its saved card that the gateway reports ok — or, for the settle, a valid API payment of exactly the plan's price on that Sumit customer between two minutes before the click (clock skew) and ten minutes after it. `getBillingGateway` still refuses `DryRunGateway` against production, and `NotConfiguredGateway` is refused before anything is written |

Every `creditLedger` insert still lives in `packages/core/src/pipelines/credits.ts` (`grantTrial`
and `expireTrialRemainder` were added there). The expiry's `expire_trial` is negative.

## Re-read 2026-10-01 at `d57b60a` — STILL HOLDS, for a different reason

Billing went live on 2026-09-21 ([[0062-hosted-checkout-via-sumit-payment-pages]]), so the
section below headed "Why `grantPeriod` cannot fire" describes the pre-billing tree and is no longer
true. `grantPeriod` fires in production now. **The headline survives, because every production path
to it sits behind a real payment:**

| path to a positive row                                       | what stands in front of it                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grantCredits` (`credits.ts:108`)                            | unchanged — the admin grant route, `requireAdmin`                                                                                                                                                                                                                                |
| `completeCheckout` → `grantPeriod` (`checkout.ts:469`)       | a Sumit payment that Sumit reports valid, whose amount equals the intent's plan price (₪150 at the least), whose customer matches, and whose `ExternalIdentifier` is our intent id (`checkout.ts:384-401`). The only production insert into `subscriptions` (`:464`) is here too |
| `processDueRenewals` → `grantPeriod` (`billing.ts:176`)      | an existing live subscription with a recurring ref, and a charge the gateway reports ok                                                                                                                                                                                          |
| `changePlan` upgrade → `grantPeriod` (`billing.ts:359`)      | an `active` subscription, and a charge the gateway reports ok                                                                                                                                                                                                                    |
| `packages/core/scripts/seed-subscription.ts` (`:92`, `:103`) | DEV ONLY and founder-run: a local script that refuses without `DRY_RUN`. It can write to production, because every local `.env` points there, so it is a founder action like the admin grant, not a customer path                                                                |

`DryRunGateway`, the one gateway that reports a charge ok without money, now refuses to be built
against the production database (`billing.ts:52-65`). A subscription for the renewal and upgrade
rows to act on comes only from a paid checkout or the dev script. The signup trigger and the RLS
picture are unchanged: `handle_new_user` inserts into `public.users` only, and all 24 policies the
migrations create are `FOR SELECT`, so no client can write the ledger or a subscription directly.

**What moved in "What this means" below:** the rates it cites are the pre-0043 ones. They are now
`a_steps_credits` 25, `a_demo_analysis_credits` 20 and `b_minimum_credits` 75
([[credit-costs-row]], carried, not re-queried), all positive, so a zero balance is still refused
at confirm. `assertAffordable` is `packages/core/src/pipelines/sets.ts:975`. What the balance does
not bound — the Claude calls behind the wizard pages, capped per account instead — is in
[[0068-prices-stand-no-free-tier-trials-by-hand]] §4.

## The 2026-08-31 read, kept as written

**This is a code read at HEAD, not a production query.** Nobody ran a select against the live
database; the claim is about what the code can do, not about what any ledger currently holds.

Every writer of `credit_ledger`, exhaustively — all five live in
`packages/core/src/pipelines/credits.ts`:

| writer                         | delta                 | who can reach it                                                                                          |
| ------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------- |
| `debitRender` (:67)            | negative              | createSet / createBRender, chargeable accounts                                                            |
| `refundRenderIfNeeded` (:94)   | mirrors a prior debit | render failure paths; one refund per render via the 0016 partial unique index — cannot net positive       |
| `expirePeriodRemainder` (:166) | negative              | renewal/cancel, `Math.max(0, …)` guarded                                                                  |
| `grantCredits` (:115)          | positive              | **founder only** — sole caller is `apps/admin/src/app/api/admin/grants/route.ts:24` behind `requireAdmin` |
| `grantPeriod` (:132)           | positive              | **unreachable in production** — see below                                                                 |

## Why `grantPeriod` cannot fire

Its sole caller is `processDueRenewals` (`packages/core/src/pipelines/billing.ts:114`), which
requires an existing `subscriptions` row with `gatewayRecurringRef` and a successful gateway charge.
**No production code inserts `subscriptions` rows** — every insert is test-only
(`packages/core/test/billing.test.ts:36`, `:200`, `:243`, `:246-248`, `:255`,
`packages/core/test/credit-ledger.test.ts:173`, `packages/core/test/migrations.test.ts:476`, `:509`, `:514`,
`packages/core/test/terminal-failures.test.ts:228` and `:304`). And
outside `DRY_RUN`, `getBillingGateway` returns `NotConfiguredGateway`, whose `chargeRecurring`
throws (`billing.ts:26-31`).

## Nothing else creates ledger rows

- The `handle_new_user` trigger (0002) inserts into `public.users` only — there is no signup grant.
- No migration seeds `credit_ledger` rows (seed INSERTs touch `plans`, `app_config`, `users`).
- RLS on `credit_ledger` is SELECT-only (0002:84-86, rewritten 0012:8-10); no INSERT/UPDATE/DELETE/ALL
  policy exists in any migration, so a Supabase client cannot write the ledger directly.
- There is no CLI grant command (`apps/cli/src/index.ts` — the closest thing is the `--admin` role
  flag, which touches `users`, not the ledger).

## What this means

A self-serve stranger's balance is 0 until the founder manually grants credits or billing is
actually wired. Any chargeable render quote is positive (`a_minimum_credits` = 5 since 0017;
`a_steps_credits` = 3 since **0039**, which on a demo's first paid render is joined by
`a_demo_analysis_credits` = 2 for the same 5 the steps flat used to be on its own —
[[0048-the-demo-analysis-is-charged-once-per-demo]]), so `assertAffordable`
(`packages/core/src/pipelines/sets.ts`, re-cited 2026-09-13; the `:579-583` here was already stale)
refuses before a single row is written. **The
credit balance is the binding bound on stranger spend; the per-account daily caps are the
backstop, not the bound.** This holds for every present route and every future one that debits
through `createSet`/`createBRender` — which are deliberately the only two debit sites
(the comment above `quoteRerollForRender` in `sets.ts`). _(Amended 2026-10-09, code read at
`feat/service-c-phase-2`: `createTextBlockRender` in `pipelines/text-blocks.ts` is the third,
for Service C's customer wizard ([[0099-service-c-phase-2-opens-to-customers]]). It debits through
the same `debitRender` behind the same `assertAffordable`, so no `creditLedger` insert was added
outside `credits.ts` and the bound above holds for it too.)_

Balance mechanics: [[credit-ledger-is-keyed-to-the-account]]. The one crack in the wall —
non-positive costs flowing through `debitRender` if `credit_costs` is ever mistyped —
is [[debit-render-accepts-non-positive-cost]], SQL-only surface.
