---
type: decision
status: verified
verified: 2026-10-15
method: "Founder decisions 1–6 of B2 of the task prompt 'blur the Service A example footage; rework /pricing with the ₪5 card' (2026-10-15), with his reasons where given, the options weighed for the countdown, and the prompt's planning defaults. MEASURED on branch feat/pricing-intro-card (from origin/main c08697f): apps/web/src/lib/plans.ts (buildPlansView), lib/plans-ui.ts, lib/intro.ts (pricingIntroOffer), components/plans/plan-cards.tsx (IntroCard), app/(marketing)/pricing/page.tsx, the three /home/plan payment pages; apps/web/test/pricing-intro-card.test.ts (10), plans.test.ts (14), plans-ui.test.ts (34); a read-only read of credit_costs, plans and the switch; the claim read back through quoteServiceASteps / quoteServiceB / quoteServiceC at those rates (packages/core/.work/blur-a/intro-arith.ts, gitignored); headless Chrome over CDP against the dev server at localhost:3000 at 1366, 1024 and 375 px, the gate forced by a temporary file check removed before commit; a GET of https://tavnit.ai/pricing."
source: founder
supersedes: "[[0109-a-five-shekel-intro-offer]] §1 planning default 'one line on /pricing, never a fourth card'; [[0055-plan-cards-may-show-computed-ad-counts]] the credit key and the VAT footnote"
---

# 0112 — `/pricing` names all three services, drops the footnote and the credit key, and shows the ₪5 offer as a card

Tags as in [[0099-service-c-phase-2-opens-to-customers]]: **FOUNDER-REPORTED**, **MEASURED**,
**REASONED**, **PLANNING DEFAULT** (the planning assistant's, not struck by him). Decisions 1–6
are FOUNDER-REPORTED, 2026-10-15. Where no reason is given, he gave none.

## 1. The VAT footnote is removed

**FOUNDER-REPORTED.** `המחירים סופיים. אנחנו עוסק פטור, ולכן לא מתווסף מע״מ.` is gone. His reason:
no need for it. Planning put the counter to him (Israeli B2B readers default to "+מע״מ"), and he
kept "remove". Terms §8's VAT sentence is untouched.

**MEASURED, where it went from:** the string was `VAT_FOOTNOTE` in `plans-ui.ts`, drawn under the
cards by the shared `PlanCards` (so `/pricing` and `/home/plan`) and on the checkout, continue and
intro summary pages. Per the planning default "the footnote goes wherever it renders", it is gone
from all five, and the constant is deleted.

## 2. The credit key under each estimate is removed

**FOUNDER-REPORTED.** His reason: unnecessary. `creditKeyLine` is deleted. It was drawn only in
`PlanCards`, so it is gone from `/pricing` and `/home/plan` alike.

## 3. The estimate names גוש טקסט as a third count

**FOUNDER-REPORTED.** His reason: mention the third service. This lifts the `/pricing` half of
[[0099-service-c-phase-2-opens-to-customers]] §9 and
[[0089-service-c-text-block-exists-admin-only-phase-1]] §5; the legal pages stay held.

**MEASURED:** `buildPlansView` prices it through `quoteServiceC`, the same function
`quoteTextBlockRender` charges with (a flat, 25 at HEAD), so `countC = floor(credits / cAd)`
(0 when the flat is 0). The line, the talking head's length still stated:

`לדוגמה: עד N סרטונים עם דמות AI של 20 שנ׳, או עד M מודעות הוק + דמו מהקלטה אחת, או עד K סרטוני גוש טקסט`

At the live plans and rates, starter / pro / studio read 10 / 39 / 40, 25 / 99 / 100 and
50 / 199 / 200. **REASONED:** "סרטוני גוש טקסט" follows the line's own pattern (a count of videos
of a service), and the service's name is `SERVICE_LABELS.c`'s.

## 4. The ₪5 offer is a fourth card, not a line

**FOUNDER-REPORTED.** His reason: shown as a tier it looks desirable.

- **Title:** `חבילת התנסות` (his, verbatim).
- **Subtitle:** `ללקוחות חדשים בלבד`. His was `למשתמשים חדשים בלבד`; planning adjusted it to the
  never-paid rule of 0109 §1.6, and he accepted.
- **Price:** `₪5 בתשלום חד־פעמי`.
- **Credits:** `150 קרדיטים, בתוקף 30 יום`.
- **Claim:** `מספיקים כדי לנסות כל אחד מהשירותים`.

0109 §1.1 stands: a one-time purchase, so nothing on the card says "לחודש", renews, "חינם",
"לפחות" or a count of videos (pinned in tests).

## 5. The one lime card, ink text

**FOUNDER-REPORTED.** It is the inverse of pro's ink card. **Set aside:** he asked for a rainbow
gradient; planning recommended staying inside the page's palette (0055: no new hue), and he
accepted.

**MEASURED:** `bg-accent` with `text-ink`. Its button is ink with paper text, because the
primary button is itself lime. Contrast on the lime: title 15.6:1, the 14 px lines 7.7:1, the
claim 10.9:1, the button 17.6:1.

## 6. No countdown

**FOUNDER-REPORTED.** Options weighed, in order:

- **(a) A countdown that resets at zero while the offer stays on.** His first ask. Refused by
  planning and not built: a deadline the product itself knows isn't one is a false limited-time
  claim (the general prohibition on misleading in Israel's Consumer Protection Law, and a listed
  banned practice in the EU). Counsel's row T3 is open on sole traders as consumers, and marketer
  customers recognise the trick.
- **(b) A real end time beside the switch.** It would close at zero, be extended only by his hand,
  and come with a reminder email. Offered and declined: he did not want the offer to lapse.

**Chosen:** no timer.

## Planning defaults

All unstruck.

- **PLANNING DEFAULT:** the card's price, credits and days come from `INTRO_OFFER` (core),
  passed in as arguments; it prints no count of videos, no "לפחות", no "חינם".
- **PLANNING DEFAULT:** it replaces today's `/pricing` line, shown where the line was shown,
  with its button going where the line's link went. **MEASURED, what the line actually did:**
  - It had **no link at all**: plain text under the cards. Planning's ask of 2026-10-14, that it
    link to plain signup, was never built.
  - Its gate was the switch and `SUMIT_INTRO_PAGE` only, **whoever was reading**. So a signed-in
    account that could not buy (a paid one, say) still saw it.

  **As built**, following B1's "never to an account that can't buy it":
  - **Gate:** `pricingIntroOffer`. A stranger sees the card while the offer is live (switch on and
    page set). A signed-in visitor sees it only when `introEligibility` says `eligible`.
  - **Button:** a stranger goes to `/start` (`מתחילים`, plain signup, like the landing). A
    signed-in account goes to `/home/plan/intro` (`לפרטי ההיכרות`, the offer's page).
  - **Failures:** a failed read of either hides the card, never the page. A failed session read
    counts as signed out, as the plan cards already did.

- **PLANNING DEFAULT:** it sits in the row with the three plans, and pro keeps `הכי פופולרי`.
  **REASONED, position:** first in the row, which in RTL is the right edge, where the reader
  starts, before the cheapest plan. The row is four across from `xl` (1280 px) and two by two from
  `md`; four at `lg` would leave each card about 170 px for its text. Without the card, the row is
  three as before.
- **PLANNING DEFAULT:** the footnote goes wherever it renders, `/home/plan` included (§1).
- **PLANNING DEFAULT:** every new or changed Hebrew string is COPY PENDING FOUNDER REVIEW; his
  title is verbatim.

## 7. The claim, read back

**MEASURED**, 2026-10-15. Rates: `credit_costs` in production, read-only (`a_steps_credits` 25,
`a_demo_analysis_credits` 20, `b_per_second` 5, `b_minimum_credits` 75, `c_text_block_credits`
25). `INTRO_OFFER.credits` = 150. Each figure comes through its quote function at the wizards'
defaults:

| Part                                                                                                       | Credits       |
| ---------------------------------------------------------------------------------------------------------- | ------------- |
| A first hook+demo ad off a new recording (`quoteServiceASteps`, first paid render)                         | 45            |
| A talking head at the B wizard's only preset, 15 s (`quoteServiceB`: 15 s × 5 = 75, equal to the 75 floor) | 75            |
| One גוש טקסט video (`quoteServiceC`)                                                                       | 25            |
| **Total**                                                                                                  | **145 ≤ 150** |

**The edges:** the 15 s preset is a word budget, and its real voice-over runs about 9–16 s
(`step-pointers.tsx`'s note). At 16.0 s the talking head is 80 and the total exactly 150, so it
still fits. At 16.2 s it is 81 (total 151), and at 20 s it is 100 (total 170), and neither fits.
**REASONED:** the claim says the credits suffice to try each service. That holds at the wizards'
defaults, and it is not a promise for any length. A talking head past 16 s, or a second hook+demo
recording, can spend the 150 before all three are tried.

## 8. What else was measured

- **The cache.** `/pricing`'s one-hour `unstable_cache` (0055) covers only the plans view, so the
  counts and prices. The card's gate is read on every request, outside it (the page also reads the
  session). The switch takes the card up or down at once. A `c_text_block_credits` change reaches
  the counts within the hour, as the other two counts already did.
  **The key part is now `["plans-view", "v2"]`.** The cached view gained `countC` and `cAd`, and an
  old-shape entry served to the new code would throw in `estimateLine`. The diff review's refuter
  showed that the hashed key (the minified function's text) changes anyway in a production build,
  so this did not happen. The bump makes it certain, and a comment says to bump it with the shape.
- **The diff review.** Three lenses, with each finding re-checked by a refuter, confirmed seven
  findings: stale comments and doc lines, a lime-card assertion the button's own `bg-accent` made
  vacuous, the pill pinned only as "somewhere on the page", the §7 typo, 0109 §4, and a
  state-of-play line. All were fixed before the PR. It refuted three: the unread example fields (only
  `analysis` was left without a reader, and it is removed), the card's button naming the offer
  `היכרות` (it is the app's name for it everywhere, and the title is his), and the cache crash.
- **The offer is live in production.** **MEASURED 2026-10-15:** a GET of
  `https://tavnit.ai/pricing` returned today's intro line to a signed-out visitor, and a read-only
  read of `app_config.intro_offer` gave enabled. So `SUMIT_INTRO_PAGE` is set on Vercel and the
  switch is on. Once this merges and deploys, the card shows to strangers on the live page at once.
- **In the browser:** headless Chrome at localhost:3000 (the dev server reads production tables,
  0100's method):
  - **Card shown** (the gate forced true by a temporary file check in `pricingIntroOffer`, removed
    before commit): four cards, the lime one first, at 1366 px, at 1024 px (two by two) and at
    375 px (one column, the card on top). No sideways scroll.
  - **Card not shown** (the local env has no `SUMIT_INTRO_PAGE`): three cards, no card and no
    line, at 1366 and 375.
  - **Both states:** no footnote and no credit key.
- **Pinned in tests** (`apps/web/test/pricing-intro-card.test.ts`), with the page rendered:
  - the gate for a stranger, an eligible account, every ineligible verdict, no page, and failed
    reads;
  - the card's markup and its two link targets, and the row of four;
  - no card and no line with the switch off;
  - the three counts on both the public and the app cards, with neither the key nor the footnote.

  `plans.test.ts` pins the three counts, `cAd`, and the line. Its assertions that "סרטונים בחודש"
  and "כולל מע״מ" never appear now cover the card's strings too.

## Related

[[0055-plan-cards-may-show-computed-ad-counts]] · [[0109-a-five-shekel-intro-offer]] ·
[[0099-service-c-phase-2-opens-to-customers]] ·
[[0089-service-c-text-block-exists-admin-only-phase-1]] · [[0046-billing-ships-as-osek-patur]] ·
[[0051-the-credit-unit-and-the-three-credit-only-plans]]
