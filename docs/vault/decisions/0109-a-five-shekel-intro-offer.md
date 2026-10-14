---
type: decision
status: verified
verified: 2026-10-14
method: "Founder decisions of 2026-10-13/14, given in the task prompt '₪5 intro offer' §2 as 'Decided … not up for relitigation', with his reasons; his two answers in plan mode on 2026-10-14 (a lost continue answer is settled automatically; the test-org walkthrough runs off production); and his change at plan review the same day (the credits 145 → 150). The planning defaults of that prompt were approved with the plan unstruck. MEASURED in the tree on feat/intro-offer: supabase/migrations/0061_ledger_reason_trial.sql, 0062_intro_offer.sql; packages/core/src/pipelines/intro.ts, checkout.ts (createIntroIntent, verifyHostedPayment, the kind branch), credits.ts (grantTrial, trialBaseline, unusedTrialCredits, expireTrialRemainder), handlers.ts, jobs/schedule.ts; apps/web routes api/account/intro, api/account/intro/continue, the return route, pages home/plan/intro, home/plan/continue, plan-manager, NoCreditsCard, /pricing, settings, lib/plans-ui.ts, lib/analytics.ts; terms §8 and legal.tsx UPDATED. Pinned by packages/core/test/intro.test.ts (33 cases, PGlite) and migrations.test.ts (0061, 0062), apps/web/test/intro-routes.test.ts, plans-ui.test.ts, sumit-return-route.test.ts, account-routes.test.ts. Test-org walkthrough 2026-10-14 off production (PGlite + the founder's TEST Sumit business, packages/core/.work/intro-walk.ts): partial — see §8. No production query, no migration push, no deploy, no call against the real Sumit organisation."
source: founder
---

# 0109 — A one-time ₪5 intro offer: 150 credits for 30 days, never a charge by itself, continued only by choice

Tags: **FOUNDER-REPORTED** (his ruling, statement or reasoning, not checkable here), **MEASURED**
(read in the tree or run), **REASONED** (inference or arithmetic from what is cited), **CARRIED**
(from an older note, not re-measured), **PLANNING DEFAULT** (proposed in planning, approved with the
plan, never ruled on separately), **OPEN** (nobody has decided).

## 1. What was decided (2026-10-13/14, FOUNDER-REPORTED)

1. **A one-time ₪5 intro offer, not a fourth plan.** [[0051-the-credit-unit-and-the-three-credit-only-plans]]'s
   three plans and prices stand; no ₪75 tier; nothing free or watermarked
   ([[0068-prices-stand-no-free-tier-trials-by-hand]] §2 stands on that). _Reason:_ it lowers the
   first-purchase bar while a card and a real payment still stand in front of every render, and it
   keeps out people with no card.
2. **One of each service, expiring 30 days after the payment.** The prompt set **145** credits — a
   first hook+demo ad off a new recording (45), a talking head at the existing web length (75), a
   text block (25) — and the founder **raised it to 150 at plan review the same day**, giving no
   reason. Unused credits expire 30 days after the payment; the credits are the limit, not the
   month. _Reason (for the shape):_ one run of each; a 10-second talking head is not worth building.
   _REASONED side effect of 150:_ a B voice-over up to 16.0 s (80 credits) still fits one of each
   (45 + 80 + 25); at 145 any second past 15.0 broke it.
3. **The founder absorbs the cost.** Planning's arithmetic from stale vault figures: about ₪7 of
   provider cost per fully used trial against ₪4 or less received; 3DS, clearing and Sumit
   operations are not in the vault (REASONED, his framing). **His own real-org trial is the
   measurement.**
4. **No automatic charge — the trial never becomes a charge on its own.** _Reasons:_ trust with no
   social proof; refunds are by hand and not always possible on a new terminal; the saved-card
   charge is unproven; an auto-charge hides who chose to pay. The customer-facing line is the
   narrow one: the trial never becomes a charge by itself, while paid plans still renew monthly as
   terms §8 says. "Free" and "N videos" are never printed (0051 §5).
5. **Continue is the customer's choice, with no card re-entry.** It charges the card Sumit saved at
   the ₪5 payment and starts an ordinary first month at ₪150 or a higher plan: full credits,
   period from that moment. Leftover trial credits are kept until that month ends; the 30-day
   expiry no longer applies after a continue. Not [[0052-upgrade-credits-are-period-credits]]'s
   proration. _Reason:_ prorating from a ₪5 base gives an odd first charge and keeps the trial's
   dates.
6. **Once per account, and only an account that has never paid** — no completed purchase and no
   subscription ever, cancelled or suspended included. No card or IP check; reconsidered if abuse
   shows. _Reason:_ it can be checked before the money moves, and a repeat costs ₪5 and a full
   redo. An IP check was weighed and rejected: shared addresses block real buyers and mobile data
   defeats it. The address stays as evidence only.
7. **An off switch** — stopping the offer is a setting, not a deploy.
8. **Built now**, reversing the previous day's "after the current work".

**Options weighed and set aside** (FOUNDER-REPORTED): a fourth plan; a ₪75 tier; a free or
watermarked tier (0068 §2); an automatic charge at the end of the trial; a prorated continue; an
IP check.

### Answers in plan mode (2026-10-14, FOUNDER-REPORTED)

- **A continue whose charge answer is lost is settled automatically**, not by hand: a worker job
  looks the charge up in Sumit's list ten minutes after the click (§3). Options offered: automatic
  (chosen), by hand through a CLI command, both.
- **The test-org walkthrough runs off production** (PGlite + the real TEST Sumit org). Option set
  aside: on production after the migration push, with a throwaway account and cleanup deletes.

### PLANNING DEFAULT (approved with the plan, never ruled on)

- The offer appears on `/home/plan` and in `NoCreditsCard` for an eligible account, and as one line
  on `/pricing` — never a fourth card. The landing is untouched (0061 §2–4).
- Continue is the checkout summary without the card step: price, the auto-renewal line, the terms
  checkbox (0054/0056), one button. A declined charge tells the customer and falls back to today's
  checkout page.
- Continue stays available after the trial ends; leftover credits are kept only when it happens
  before expiry.
- With the switch off, no new trial can start; running trials end normally.
- The expiry runs in the worker's daily loop, beside renewals.
- The existing PostHog events learn to tell a trial from a plan; conversion is read from our tables.
- Every customer-facing string is COPY PENDING FOUNDER REVIEW.

## 2. Where it lives (MEASURED, feat/intro-offer)

- **Numbers in code, the switch in config.** `INTRO_OFFER = { priceAgorot: 500, credits: 150, days:
30 }` (`packages/core/src/pipelines/intro.ts`); only the on/off is a setting (§1.7), so a number
  edited mid-checkout cannot refuse a paid ₪5. The switch is `app_config.intro_offer =
{"enabled": …}`, seeded off by 0062; absent or unparseable reads as off and never throws. It is
  read only where a NEW trial could start — so a ₪5 page paid after the switch went off still
  activates (REASONED: refusing it would keep the money for nothing; this is the one reading of
  "with the switch off, no new trial can start" that does not strand a payment).
- **The page** is `SUMIT_INTRO_PAGE` (one https URL, apps/web only), a key of its own because one
  bad entry in `SUMIT_CHECKOUT_PAGES` nulls every plan's page.
- **Schema.** 0061: `ledger_reason` gains `grant_trial`, `expire_trial` (alone, 0019's rule). 0062:
  `checkout_intents.kind` (`plan|intro`) with `plan_code` NULL exactly for an intro;
  `intro_trials` with `user_id` as its PRIMARY KEY (once per account, structurally); the switch
  row.
- **The purchase rides the hosted checkout** ([[0062-hosted-checkout-via-sumit-payment-pages]]): the
  intro intent, the same return route, the same server-to-server verification (except that an
  intro needs no saved card — only the optional continue does). Eligibility is checked **before
  anything is written**, and again under the `users` lock at completion.
- **One lock order** on every path that touches an account's purchases: intent → `users` →
  `intro_trials` → `subscriptions`.

## 3. The expiry and the continue (MEASURED; the formula's safety REASONED and pinned)

- **Day 30** (`expire_trials`, daily beside `billing_renewals`): unused trial credits =
  `min(credits, balance − balance_before − manual granted since − refunds of the renders open at
activation)`. Spend uses trial credits before manual ones. Everything subtracted is non-trial, so
  **no manual grant is ever expired** — including a hand grant spent before the trial (the
  lifetime-manual rule `expirePeriodRemainder` uses would have shielded those trial credits) and a
  render in flight at the ₪5 payment refunded after it (an adversarial plan review found the first
  draft of this formula took those back). Credits stay spendable until the sweep runs (≤ ~25 h).
- **Continue** writes the attempt **before** charging, charges outside any transaction, records the
  answer at once, then activates under the locks. A lost answer or a killed function leaves the
  attempt: a new continue and a new hosted checkout both refuse until `reconcile_continue` settles
  it (found → the month activates; not found → the attempt clears). A hosted page opened before the
  click can still be paid and complete; the attempt then survives the conversion, and the settle
  records the continue's charge `continue_charge_orphaned` if it went through. The job settles only
  its own attempt and, when Sumit's list cannot be read, retries every five minutes for an hour
  before leaving it to the daily backstop. A continue the settle activates starts its month at the
  settle, not at the click (customer-favourable). A trial-only customer has no subscription, so
  nothing else charges it and the narrow list look is safe here as it is not for renewals (0062).
  A continue decided at or after the 30 days expires the leftover first; a hosted plan purchase
  converts the trial the same way.

## 4. Accepted edges (REASONED; the first two and the late-listing one pinned in packages/core/test/intro.test.ts, the /pricing and DFY ones not tested)

- A trial-era render refunded **after** the sweep keeps its credits (≤ 150, customer-favourable).
- After a continue, an account that spent a hand grant before the trial keeps up to that grant past
  the first renewal: `expirePeriodRemainder` subtracts the lifetime manual sum. Pre-existing for any
  hand-granted account that buys a plan; renewal logic was left untouched by instruction.
- Signing up through a `/pricing` plan card goes straight to that plan's hosted checkout and skips
  the offer box (the `/pricing` line names the offer; no extra surface was added).
- A charge Sumit lists more than ten minutes after the click is 0062's accepted residual: the
  attempt clears, a retry charges again, visibly, refunded by hand.
- DFY `orders` do not count as "paid" (no code writes them).

## 5. Legal (MEASURED)

Terms §8 "רכישה מקוונת ומנוי" gains one bullet opening "על אף האמור לעיל", nothing renumbered.
`UPDATED` moved 11.10 → 14.10.2026 — one constant, so `/privacy`'s displayed date moved with it while
its text did not (the 11.10 move set that precedent the other way). `docs/legal-review.md` row
**E12** asks counsel: (a) is the bullet a material change under §14's 14-day notice (**the
founder's question, recorded, not answered; no email was sent**); (b) does s.14ג(ד)(3) cover a
one-time pack (T3, T13); (c) does a 30-day expiry of paid credits survive T16. `/privacy` needs no
change for the analytics codes: §3 already promises codes only, including the payment outcome.

## 6. Cost (REASONED, stale inputs named)

Per fully used trial, provider cost: the analysis ₪1.38 (one Sonnet 5.5 run, 2026-10-08) to ₪1.82
(Sonnet 4.6 mean, 2026-10-02); the B ad's HeyGen ₪3.75 for 15 s at 25 agorot/s (**stale, 2026-08**)
plus its TTS previews at 30 agorot per 1k characters (**stale, 2026-08**) and a few agorot of
Claude; the C batch 13–15 agorot; the box renders on a monthly box. Roughly ₪6–6.5 **for one of
each** — consistent with planning's ~₪7. The costliest way to spend 150 credits is all on Service B
(two 15 s ads, or one of 30 s): ≈ ₪7.5 of HeyGen plus TTS, about ₪8 (same stale rates). Received: ₪5 less clearing (not in the vault), 3DS (an untagged ₪1-per-attempt
line in state-of-play's queue, unverified) and Sumit operations (a charge and its document are two
operations; the price per extra operation is not recorded). The founder's real trial is the
measurement (§1.3); `aiugc costs --business <id>` reads it back.

## 7. OPEN

- Whether a ₪5 buyer starts 0051's sixty-day review clock ("the first real paying customer").
- Counsel, E12.
- AUTH-03 (CAPTCHA on signup) fires "before any paid ads or signup campaign"; promoting the offer
  likely meets it. Not built here.

## 8. The test-org walkthrough, 2026-10-14 (MEASURED, partial)

Off production, PGlite + the founder's TEST Sumit business (guarded: `listquotas` reported the test
org's Operations quota of 100). Shown: the ₪5 catalogue renders under testbusiness at ₪5 with the
test-terminal notice and the product name "תבנית - היכרות"; the intro intent (`kind intro`, no
plan, 500 agorot) travels as `externalidentifier` and **comes back on the payment as its
ExternalIdentifier on the new catalogue**; a decline stays on the page; `completeCheckout` on that
declined payment refuses `payment_invalid` and writes nothing (the route would land on
`?checkout=intro_failed`). **Not shown:** the test terminal declined every card that day — two of
Sumit's published MasterCards on the ₪5 page and the card it approved on 2026-09-21, also on the
₪150 starter page (code 004) — so the approved ₪5, the second-attempt refusal after a real trial,
the continue on the saved card and the receipt lines are still owed, on a day the terminal approves.

## Related

- [[0068-prices-stand-no-free-tier-trials-by-hand]] — §2's "no self-serve tier" stands; this is a
  paid offer, and its pointer says so.
- [[0051-the-credit-unit-and-the-three-credit-only-plans]] — the plans, and the 45 and 75 the 150
  rests on; [[0099-service-c-phase-2-opens-to-customers]] §7 — its 25 for a text block.
- [[0062-hosted-checkout-via-sumit-payment-pages]] — the checkout this rides, and the saved card
  the continue charges.
- [[0052-upgrade-credits-are-period-credits]], [[0053-downgrades-are-scheduled-not-applied]] —
  untouched.
- [[no-self-serve-credit-grant-path]] — gains the two new paths.
