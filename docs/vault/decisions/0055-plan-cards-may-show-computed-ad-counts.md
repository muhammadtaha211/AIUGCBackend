---
type: decision
status: verified
verified: 2026-09-17
method: "Founder decisions in chat, 2026-09-17, for the /pricing and /home/plan build: the only tier differentiator is credit volume and the per-credit rate it buys, shown as the headline of each card; a plan card MAY carry 'עד N' counts for the two example ads, computed live from credit_costs and plans and stated with the length, never as a feature bullet, never hardcoded, never in shekels per video. Built as apps/web/src/lib/plans.ts (buildPlansView, the one place the counts are computed) and the sentences in apps/web/src/lib/plans-ui.ts (estimateLine, creditKeyLine); pinned by apps/web/test/plans.test.ts against the 0043 rates and the three 0043/0044 plans — starter 10 / 39, pro 25 / 99, studio 50 / 199, rates 15 / 12 / 10 agorot, discounts 0 / 20 / 33 — and by a test asserting the card sentences never contain 'סרטונים בחודש' or 'כולל מע״מ'."
source: founder + code
supersedes: "[[0051-the-credit-unit-and-the-three-credit-only-plans]] §5, narrowly"
---

# 0055 — A plan card may show "עד N" ad counts, computed live, with the length stated

## The decision

[[0051-the-credit-unit-and-the-three-credit-only-plans]] §5 said: **never print "N videos per
month" — anywhere**; credits and worked examples only, per ad, never per month.

The founder narrowed that on 2026-09-17, for the pricing surfaces only: a plan card **may** show
how many ads its month of credits buys, under four conditions, all of which must hold:

1. **Computed live** from `credit_costs` and `plans`, through the same quote functions the wizards
   charge with (`quoteServiceB`, `quoteServiceASteps`). A rate change moves the count without a
   deploy, and a card can never quote a count the credits would not buy.
2. **The length is stated** beside the Service B count — "סרטוני דמות AI של 20 שנ׳" — because a
   Service B ad has no count without its length (per-second pricing with a 75-credit floor).
3. **Framed as an estimate**, in the one sanctioned form:
   `לדוגמה: עד N סרטוני דמות AI של 20 שנ׳, או עד M מודעות הוק+דמו מהקלטה אחת`, with the credit key
   under it (`סרטון דמות: 100 קרדיטים ל־20 שנ׳ · הוק+דמו: 25 קרדיטים, ועוד 20 חד־פעמית על ניתוח
ההקלטה`). Every number in both sentences arrives as an argument.
4. **Never** as a feature bullet, never hardcoded, never in shekels per video, and never the phrase
   "סרטונים בחודש". 0051 §5 stands everywhere else — docs, the vault, support copy.

The hook+demo count is per **one recording**: the first ad carries the analysis (45 credits at the
0043 rates), every later ad off the same recording is the render alone (25) —
[[0048-the-demo-analysis-is-charged-once-per-demo]]. So `countA = 1 + floor((credits − 45) / 25)`,
and `countB = floor(credits / 100)` for a 20-second ad. At the 0043 rates and plans:

| plan    | credits | B ads (20s) | hook+demo ads (one recording) | per credit | vs starter |
| ------- | ------- | ----------- | ----------------------------- | ---------- | ---------- |
| starter | 1000    | 10          | 39                            | ₪0.15      | —          |
| pro     | 2500    | 25          | 99                            | ₪0.12      | −20%       |
| studio  | 5000    | 50          | 199                           | ₪0.10      | −33%       |

## The rest of the same ruling

- **Monthly plans only.** No annual toggle, no annual anything — [[0046-billing-ships-as-osek-patur]]
  §3 stands.
- **The only tier differentiator is credit volume and the resulting per-credit rate**, and that is
  the headline of each card. Nothing else is tier-locked; no feature rows are invented.
- **The middle tier (pro) is "הכי פופולרי"**, drawn inverted — ink card, lime pill, paper text —
  so it pops on the paper page. No new hue.
- **Prices are one final number.** VAT stays on top at conversion (0046 §2, reaffirmed). The
  footnote under the cards, matching terms §8: "המחירים סופיים. אנחנו עוסק פטור, ולכן לא מתווסף
  מע״מ." The phrase "כולל מע״מ" appears nowhere — it would be false today and wrong at conversion.
- **Checkout and upgrade are deliberate dead ends** until the Sumit adapter exists
  ([[0054-payment-stack-is-sumit-via-upay]]): the server answers 503 with a Hebrew line and the
  client shows it inline. The client is written for the wired shape — a 200 from
  `POST /api/account/checkout` carrying `{ redirectUrl }` navigates there — so wiring is
  server-only. Cancel, resume, downgrade and undo work for real (no gateway involved).

## Where it lives

- `apps/web/src/lib/plans.ts` — `buildPlansView`, the ONLY place a plan price, rate or count is
  computed; the public page reads it through a one-hour `unstable_cache`, the app page fresh.
- `apps/web/src/lib/plans-ui.ts` — every customer-facing string of the build, COPY PENDING
  FOUNDER REVIEW.
- `apps/web/test/plans.test.ts` — the table above, pinned.

## Related

- [[0051-the-credit-unit-and-the-three-credit-only-plans]] — the rule this narrows; everything
  else in it stands
- [[0048-the-demo-analysis-is-charged-once-per-demo]] — why the hook+demo count is per recording
- [[0052-upgrade-credits-are-period-credits]], [[0053-downgrades-are-scheduled-not-applied]] — the
  dialogs on /home/plan display exactly these mechanics
