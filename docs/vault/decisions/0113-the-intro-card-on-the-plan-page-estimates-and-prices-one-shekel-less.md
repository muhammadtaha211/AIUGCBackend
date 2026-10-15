---
type: decision
status: verified
verified: 2026-10-15
method: "Founder requests in chat, 2026-10-15, after PR #104 merged ('add the חבילת התנסות tile … also in the /home/plan page … make the tile color gradient with the brand colors, and add a tag … ללקוחות חדשים בלבד, and just remove that line … it should be 40 instead of 39 … then say בערך … make each one, one shekel less … i already changed the pricing in sumit'), and his answer in session to the push question ('Push 0063 now'). MEASURED on branch feat/plan-intro-card-prices (from origin/main bef4721): packages/core/src/pipelines/checkout.ts:689 (verifyHostedPayment's amount check), billing.ts:147 and intro.ts:486-521 (the renewal and continue charges read plans.price_agorot); a read-only read of plans, checkout_intents and gateway_events before the push; the 0063 push with read-back (production-migration-push-log); apps/web/src/lib/plans.ts, plans-ui.ts, components/plans/plan-cards.tsx, app/home/plan/plan-manager.tsx; the tests in apps/web/test/plans.test.ts, plans-ui.test.ts, pricing-intro-card.test.ts and packages/core/test/migrations.test.ts, checkout.test.ts; headless Chrome against the dev server at localhost:3000 (/pricing at 1366 and 375 with the gate forced by a temporary file check; /home/plan through a throwaway harness page mounting the real PlanManager behind a mocked subscription read, at 1366, 1600 and 375), both removed before commit."
source: founder
supersedes: "[[0112-pricing-names-three-services-and-shows-the-intro-card]] §3 the 'עד' line and its counts, §4 subtitle and §5 'gradient set aside'; [[0109-a-five-shekel-intro-offer]]'s /home/plan offer box; [[0055-plan-cards-may-show-computed-ad-counts]] the 'עד N' form; [[0051-the-credit-unit-and-the-three-credit-only-plans]] the plan prices"
---

# 0113 — The intro card on `/home/plan` too, a gradient and a pill; the estimates say "בערך"; each plan one shekel less

Tags as in [[0099-service-c-phase-2-opens-to-customers]]: **FOUNDER-REPORTED**, **MEASURED**,
**REASONED**. All five decisions are FOUNDER-REPORTED, 2026-10-15, in chat after PR #104 merged.
Where no reason is given, he gave none.

## 1. `/home/plan` shows the same card in place of the offer box

> **2026-10-15, later** ([[0114-plan-page-cards-in-one-row-of-four]]): the founder asked for one row
> of four instead of two by two; the cards are drawn a size down so they fit.

**FOUNDER-REPORTED.** The box he quoted (`להתחיל בהיכרות ב־₪5`, the credits and once-per-account
line, and the "never a charge by itself" line) is gone. The card from
[[0112-pricing-names-three-services-and-shows-the-intro-card]] is first in the plans' row instead.

**MEASURED:**

- **Gate:** the card shows on exactly the box's gate. That is the subscription read's `intro`, so
  the account must be eligible, and never under a landing that says a payment is in flight.
- **Button:** `לפרטי ההיכרות`, to `/home/plan/intro`.
- **Layout:** the app's row is two by two from `lg` at every width. Four across was tried and
  dropped: the pane is capped at `max-w-5xl`, so each card would be about 218 px wide, and the
  price wrapped away from "לחודש" at 1600 px.
- **REASONED, the narrow line:** `INTRO_NEVER_CHARGES_LINE` ("ההיכרות לא הופכת לחיוב מעצמה…",
  0109 §1.4) is no longer on `/home/plan`. It is still on `/home/plan/intro`, the page the card's
  button opens, above the terms checkbox and before any payment. `introOfferTitle` and
  `introOfferLine` had no other reader and are deleted.

## 2. The card is the brand gradient

**FOUNDER-REPORTED.** This reverses 0112 §5's "gradient set aside" (there he had asked for a
rainbow; this time he asked for the brand's colours).

**MEASURED:** `bg-gradient-to-br from-accent to-emerald-300`. It is the app's existing brand
gradient, the one on the sidebar's avatar (`home/sidebar.tsx`), so no new hue. Ink text holds at
both ends: at least 12.4:1 for full ink, 9.0:1 for ink/85, and 6.8:1 for ink/75 at the emerald
end (computed for #b6ff00 and #5ee9b5).

## 3. A pill on top, `ללקוחות חדשים בלבד`; the line under the title goes

**FOUNDER-REPORTED.** It sits like pro's `הכי פופולרי`, centred over the top edge.
**MEASURED:** ink, with lime text (15.6:1). It is the inverse of pro's pill, as the card is the
inverse of pro's card. The string is the same one 0112 had as the subtitle (`INTRO_CARD_BADGE`).

## 4. The estimates are 40 / 100 / 200 and say "בערך"

**FOUNDER-REPORTED.** His figures: 40, 100 and 200 hook+demo ads in place of 39, 99 and 199. His
reason for "בערך": it is an estimate, not a guarantee.

**MEASURED:** `countA` is now `floor(credits / aNext)`, the render price alone (25 at HEAD), still 0
for a plan that cannot pay one first ad (45). The line, with "בערך" leading the list and "עד" gone:

`לדוגמה: בערך N סרטונים עם דמות AI של 20 שנ׳, או M מודעות הוק + דמו מהקלטה אחת, או K סרטוני גוש טקסט`

**REASONED, what the number now means:** one recording's first ad also carries the one-time
analysis (20, [[0048-the-demo-analysis-is-charged-once-per-demo]]). So starter's 1000 credits buy
39 hook+demo ads off one recording, with 5 credits left, not 40. "בערך" covers that gap, as he
asked. The talking-head and גוש טקסט counts are exact, as before. This narrows 0055's "a card can
never quote a count the credits would not buy" to an estimate within one ad at the current
rates (analysis 20, render 25).

## 5. Each plan one shekel less: ₪149 / ₪299 / ₪499

**FOUNDER-REPORTED.** He had already set the three Sumit payment pages to the new prices.

**MEASURED, why this was not display only:** `plans.price_agorot` is what every amount reads.

- The checkout intent snapshots it, and `verifyHostedPayment` refuses a payment whose amount differs
  (`amount_mismatch`, `checkout.ts:689`). So a ₪149 payment for starter would have been paid at
  Sumit and then refused.
- The renewal charge (`billing.ts:147`), the ₪5 trial's continue charge (`intro.ts:486-521`) and
  the upgrade proration read it too, so they would still have charged ₪150 / ₪300 / ₪500.

**MEASURED, the state before the fix:** no plan purchase in the five days before the push (one ₪5
intro, completed 2026-10-14), no refusal event, and no pending checkout intent.

**Applied:** migration `0063_plan_prices_minus_one_shekel.sql`, guarded on the old price.

- **Pushed** on his answer in session ("Push 0063 now"), before this branch merged.
- **Read back:** 15000 / 30000 / 50000 → 14900 / 29900 / 49900, with credits 1000 / 2500 / 5000
  unchanged; ledger 0000–0063 ([[production-migration-push-log]]).
- **What prints:** the rates still print ₪0.15 / ₪0.12 / ₪0.10 (14.9 / 11.96 / 9.98 agorot) and the
  discounts stay 20% and 33%.
- **When it shows:** `/home/plan` reads fresh. `/pricing` reads through a one-hour cache, so after
  the push it could show ₪150 for up to an hour. This branch bumps the cache key (`plans-view`,
  `v2` → `v3`), so the deploy shows the new prices and counts at once.
- **Pinned in tests:** `migrations.test.ts` (the guards, idempotence, a hand-set price left alone,
  the whole chain) and `checkout.test.ts`, whose fixture payment is now ₪149 and whose wrong-price
  cases are now ₪150.

## 6. Checked

- **Gate:** green.
- **`/pricing` in the browser:** four cards at 1366 and 375, the gradient card first with its pill,
  ₪149 / ₪299 / ₪499 read from production, the "בערך" lines, no sideways scroll.
- **`/home/plan` in the browser:** the same card, first in a two-by-two row at 1366 and 1600, on top
  at 375, its button to `/home/plan/intro`, and no offer box.
- **Every new or changed string** except his title and his pill text is COPY PENDING FOUNDER REVIEW.

## Related

[[0112-pricing-names-three-services-and-shows-the-intro-card]] · [[0109-a-five-shekel-intro-offer]] ·
[[0055-plan-cards-may-show-computed-ad-counts]] · [[0051-the-credit-unit-and-the-three-credit-only-plans]] ·
[[0068-prices-stand-no-free-tier-trials-by-hand]] · [[0062-hosted-checkout-via-sumit-payment-pages]] ·
[[production-migration-push-log]]
