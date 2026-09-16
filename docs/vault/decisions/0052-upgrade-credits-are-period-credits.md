---
type: decision
status: verified
verified: 2026-09-17
method: "Founder rulings in chat, 2026-09-17: an upgrade is immediate and prorated, with the charge AND the credits using the same fraction of the period remaining; a downgrade takes effect at the next renewal; a cancel at period end with no refund; and upgrade credits MUST expire at the next renewal like period credits. Built as packages/core/src/plan-change.ts (quotePlanChange, pure) and changePlan in packages/core/src/pipelines/billing.ts. Pinned by packages/core/test/plan-change.test.ts (pure, no database — 8 cases: the boundaries and the two rounding directions) and on PGlite by packages/core/test/billing.test.ts describe 'plan changes (0045, decisions 0052/0053)', whose second case grants an upgrade, adds a manual grant, renews, and asserts the balance is exactly the new plan's credits plus the manual grant — the property this note exists for. The docs/05 sentence this corrects was read in the same pass and is quoted verbatim below."
source: founder + code
---

# 0052 — Upgrade credits are period credits, prorated by the same fraction as the charge

## The decision

**An upgrade is immediate and prorated.** The customer pays the price difference for the part of
the period that is left, and receives the credit difference for the same part — one fraction, two
numbers. The credits are written as a **`grant_period`** row with a note
(`upgrade starter→pro 10/30`), never as `grant_manual`.

**A downgrade takes effect at the next renewal** ([[0053-downgrades-are-scheduled-not-applied]]).
**A cancel takes effect at period end, with no refund.**

## The sentence this corrects

`docs/05-billing.md` §Subscription lifecycle said, until this change:

> upgrade applies immediately — charge the difference via the gateway, `grant_manual` the credit
> difference, switch `plan_code`

That was wrong, and wrong in a way that would have compounded every month. `expirePeriodRemainder`
(`packages/core/src/pipelines/credits.ts`) expires `balance − manualOutstanding`, and
`manualOutstanding` sums every `grant_manual` row the account has ever received — it is the
founder's goodwill, deliberately immortal. An upgrade granted as `grant_manual` would therefore
**never expire**: a customer who upgraded once would carry the prorated credits forward through
every renewal for the life of the account, and the "no rollover" rule would have a permanent hole
in it that grew with every upgrade. `grant_period` rows are exactly what the renewal expires, so
the upgrade's credits leave with the rest of the period. **Measured on PGlite** (billing.test.ts,
"the upgrade's credits EXPIRE at the next renewal"): grant the lowest plan, upgrade to the highest
mid-period, add a 7-credit manual grant, renew — the balance is the highest plan's credits plus
exactly 7.

## The arithmetic — `quotePlanChange`, one source

`packages/core/src/plan-change.ts` is a client-safe subpath (`@aiugc/core/plan-change`, the same
wiring as `./pricing`), so the account page will display the number `changePlan` charges, from
the same function. There is no second place this is computed.

| term              | rule                                                               |
| ----------------- | ------------------------------------------------------------------ |
| `daysInPeriod`    | `round((periodEnd − periodStart) / 1 day)`                         |
| `daysRemaining`   | `ceil((periodEnd − now) / 1 day)`, clamped to `[0, daysInPeriod]`  |
| `fraction`        | `daysRemaining / daysInPeriod`                                     |
| `chargeAgorot`    | `ceil((to.price − from.price) × fraction)` — money rounds **up**   |
| `creditsGranted`  | `floor((to.credits − from.credits) × fraction)` — credits **down** |
| `scheduleInstead` | `daysRemaining ≤ 1` — a last-day upgrade is scheduled, not charged |
| `kind`            | by **price**, never by code order                                  |

The two rounding directions are a REASONED choice, not a measurement: each rounds against the
customer by less than one agora and one credit, which is the direction that cannot produce an
unpaid-for credit. The product is taken before the division (`diff × daysRemaining / daysInPeriod`)
so that an evenly divisible case lands on the integer exactly and the ceil cannot be pushed over
by a floating-point hair — pinned in plan-change.test.ts with a pair that does not divide (2334
and 233 from 10001 and 1001 at 7/30).

For a downgrade or a same-price change, `chargeAgorot` and `creditsGranted` are **0**: nothing is
charged, nothing is refunded, nothing is granted. The brief's formula would have produced a
negative charge on a downgrade; a negative number in a quote a UI displays is a refund the
product does not give, so the module reports zero and says so in its JSDoc.

## Options considered

- **`grant_manual` for the difference** — what docs/05 said. Rejected for the reason above: those
  credits would never expire.
- **A new ledger reason (`grant_upgrade`)** — rejected. There is no per-lot ledger to make use of
  it; the only thing that matters is whether the renewal expires the row, and `grant_period`
  already has that semantics. The note on the row carries the provenance.
- **No credit grant on upgrade, credits only from the next renewal** — rejected. The customer paid
  the prorated difference; the credits are what the difference buys.
- **Prorate the charge but grant the full credit difference** — rejected by the founder: one
  fraction, both numbers.

## What was deliberately not touched

- The period dates. An upgrade never moves `current_period_start` or `current_period_end`
  (pinned). The next renewal falls exactly when it would have.
- `processDueRenewals`'s dunning logic. The renewal gained one thing — it applies a
  `scheduled_plan_code` in its success branch — and its retry-day and suspend behaviour is
  unchanged.
- `pricing.ts` and the credit-cost quote functions. This is a separate module.

## Related

- [[0053-downgrades-are-scheduled-not-applied]] — the other half of the same ruling
- [[0054-payment-stack-is-sumit-via-upay]] — what executes the charge
- [[0051-the-credit-unit-and-the-three-credit-only-plans]] — the ladder the fraction is taken over
- [[0050-subscriptions-are-keyed-on-the-account]] — why every function here is keyed on the user
