---
type: fact
status: verified
verified: 2026-08-31
method: "code read at f3a6778, NOT a production query: grep of every creditLedger insert (all five live in packages/core/src/pipelines/credits.ts), grep insert(subscriptions) repo-wide, grep 'FOR (INSERT|ALL|UPDATE|DELETE)' over supabase/migrations, callers of grantCredits/grantPeriod; independently re-checked by an adversarial pass that tried to refute it and could not"
source: code
---

# An account that has never paid cannot reach a positive credit balance

**This is a code read at HEAD, not a production query.** Nobody ran a select against the live
database; the claim is about what the code can do, not about what any ledger currently holds.

Every writer of `credit_ledger`, exhaustively — all five live in
`packages/core/src/pipelines/credits.ts`:

| writer                         | delta                 | who can reach it                                                                                          |
| ------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------- |
| `debitRender` (:67)            | negative              | createSet / createBRender, chargeable accounts                                                            |
| `refundRenderIfNeeded` (:94)   | mirrors a prior debit | render failure paths; one refund per render via the 0016 partial unique index — cannot net positive       |
| `expirePeriodRemainder` (:163) | negative              | renewal/cancel, `Math.max(0, …)` guarded                                                                  |
| `grantCredits` (:115)          | positive              | **founder only** — sole caller is `apps/admin/src/app/api/admin/grants/route.ts:24` behind `requireAdmin` |
| `grantPeriod` (:127)           | positive              | **unreachable in production** — see below                                                                 |

## Why `grantPeriod` cannot fire

Its sole caller is `processDueRenewals` (`packages/core/src/pipelines/billing.ts:114`), which
requires an existing `subscriptions` row with `gatewayRecurringRef` and a successful gateway charge.
**No production code inserts `subscriptions` rows** — every insert is test-only
(`packages/core/test/billing.test.ts:36`, `packages/core/test/credit-ledger.test.ts:173`,
`packages/core/test/terminal-failures.test.ts:224` and `:300`). And
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
(the comment above `quoteRerollForRender` in `sets.ts`).

Balance mechanics: [[credit-ledger-is-keyed-to-the-account]]. The one crack in the wall —
non-positive costs flowing through `debitRender` if `credit_costs` is ever mistyped —
is [[debit-render-accepts-non-positive-cost]], SQL-only surface.
