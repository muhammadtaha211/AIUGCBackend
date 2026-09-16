---
type: decision
status: verified
verified: 2026-09-17
method: "Founder ruling in chat, 2026-09-17: a downgrade takes effect from the next renewal; a cancel at period end, no refund. Built as supabase/migrations/0045_subscriptions_scheduled_plan_code.sql (a nullable FK column), changePlan / cancelSubscription / resumeSubscription and the scheduled branch of processDueRenewals in packages/core/src/pipelines/billing.ts. Pinned on PGlite in packages/core/test/billing.test.ts: the downgrade is scheduled and the renewal charges and grants the NEW plan and clears the schedule; a failed renewal charge leaves the schedule; a last-day upgrade is scheduled; an upgrade clears a pending cancel and a pending downgrade; re-choosing the current plan is the undo and refuses when nothing is pending; cancel clears the schedule; the one-live-subscription index and the new FK both still refuse. Migration replays from empty as part of PORTABLE_MIGRATIONS. 0045 was APPLIED TO PRODUCTION 2026-09-17 (one push with 0044, 0046, 0047) on the founder's explicit instruction for that one push: before-read column and FK absent, subscriptions 0 rows; after-read column present, nullable text, FK subscriptions_scheduled_plan_code_plans_code_fk present, still 0 rows. Ledger 48 rows 0000-0047. Proof: scripts/verify-migration-ledger.sql §RESULTS. The worker box is on origin/main, which does not name the column, so the old renewal keeps working until the merge and box deploy ship this code."
source: founder + code
---

# 0053 — A downgrade is scheduled in its own column, never applied early

## The decision

A downgrade **takes effect at the next renewal**. Until then the customer is on the plan he paid
for, and the database says so: `plan_code` does not move. The pending change lives in a new
nullable column, **`subscriptions.scheduled_plan_code`** (migration 0045, FK to `plans`), which
`processDueRenewals` reads in its success branch — charge THAT plan's price, grant THAT plan's
credits, copy it into `plan_code`, clear it. A failed renewal charge leaves the schedule in place
for the retry.

A **cancel** is `cancel_at_period_end = true` and clears any schedule; it takes effect at period
end and refunds nothing. A **plan change replaces a pending cancel** (`cancel_at_period_end` goes
false). **Re-choosing the current plan is the undo**: it clears both the schedule and the pending
cancel, and is refused (`nothing_pending`) when there was nothing to undo.

An **upgrade on the last day of the period** (`daysRemaining ≤ 1`) is also scheduled rather than
charged — too little of the period is left to charge for ([[0052-upgrade-credits-are-period-credits]]).

Only an `active` subscription may change plan. `past_due` and `suspended` are refused with a typed
`not_active`, which the web tier answers as a Hebrew 409. The row is locked `FOR UPDATE` for the
whole transaction, gateway call included, so two clicks serialize.

## Why a column and not a `plan_code` flip

`docs/05-billing.md` said a downgrade "takes effect at the next renewal (change `plan_code` only)"
— meaning flip `plan_code` now and let the renewal charge the new price. Two things go wrong with
that, and the second is the one that made it a column:

1. **It misreports the current plan** for the rest of the period. Every read of `plan_code` — the
   account page, a support question, the admin console — would say `starter` while the customer is
   still on, and has paid for, `pro`.
2. **An upgrade after a downgrade becomes incoherent.** The proration in
   [[0052-upgrade-credits-are-period-credits]] is computed from the plan the customer is _on_. If
   `plan_code` already said `starter`, an upgrade back to `pro` would quote the starter→pro
   difference and charge it — for a plan he is already on and has already paid for that period.
   With the schedule in its own column, that request is simply the undo.

The alternative of a separate `pending_changes` table was considered and rejected: an account holds
at most one live subscription (0041) and at most one pending change, so a nullable column is the
whole data model. REASONED, not measured.

## What changed

- **Migration 0045** — `ALTER TABLE subscriptions ADD COLUMN scheduled_plan_code text` + FK
  `subscriptions_scheduled_plan_code_plans_code_fk`. Additive; the deployed code selects its
  columns by name and ignores it.
- `changePlan`, `cancelSubscription`, `resumeSubscription`, `liveSubscription`,
  `getAccountBilling` and the typed `PlanChangeError` in `pipelines/billing.ts`.
- `processDueRenewals`: the charge and everything it commits now run in a transaction that
  **re-reads the row `FOR UPDATE`** and takes `planCode = fresh.scheduledPlanCode ?? fresh.planCode`
  from that fresh row; the success branch sets `planCode` and clears `scheduledPlanCode`, and the
  `gateway_events` payload carries `planCode`. The lock is there because the due list is read
  without one: a `changePlan` (which holds `FOR UPDATE` across its own gateway call) that committed
  a schedule, an undo or a cancel during the renewal's gateway round-trip would otherwise be
  overwritten from the stale row after the customer was told 200 — found by the adversarial review
  of this branch, 2026-09-17, and REASONED rather than reproduced: PGlite is one connection, so the
  interleaving cannot be staged in the test suite. A fresh row that is no longer chargeable
  (renewed already, cancelled, not live) is skipped. The cancel, suspend and retry-day branches are
  byte-for-byte what they were.
- Web: `GET /api/account/subscription` reports `scheduledPlanCode`; `POST …/change`, `…/cancel`,
  `…/resume` call the core functions.

## Related

- [[0052-upgrade-credits-are-period-credits]] — the upgrade half of the same ruling
- [[0050-subscriptions-are-keyed-on-the-account]] — one live subscription, so one pending change
- [[0046-billing-ships-as-osek-patur]] — monthly plans only, which is why "next renewal" is
  always at most a month away
