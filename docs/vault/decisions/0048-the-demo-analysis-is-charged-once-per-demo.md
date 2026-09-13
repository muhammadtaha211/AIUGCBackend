---
type: decision
status: verified
verified: 2026-09-13
method: "Founder decision in chat, 2026-09-13 ('implement, do not re-litigate'). Written as supabase/migrations/0039_demo_analysis_credits.sql, which is NOT yet applied — the founder applies it before the code deploys. Code as landed on feat/demo-analysis-credit: packages/core/src/pricing.ts (creditCostsSchema gains a_demo_analysis_credits, quoteServiceASteps takes firstPaidRenderOfDemo); packages/core/src/pipelines/sets.ts (demoHasPaidRender, RenderQuote.analysisCreditsOncePerSet, quoteTotal exported, createSet's demo row lock + first-cell debit); packages/core/src/pipelines/credits.ts:79-104 (refundRenderIfNeeded refunds the row's own delta); packages/core/src/pipelines/renders.ts:1004-1043 (failRenderAndRefund, and resolveDebitBearingRender above it). Cost basis: docs/vault/facts/analyze-demo-cost.md, verified 2026-08-23 and NOT re-measured for this change. Proved by packages/core/test/credits-wiring.test.ts (describe 'the demo analysis is charged once per demo', 6 cases) and packages/core/test/pricing.test.ts."
source: founder + code
supersedes: "[[credit-costs-row]] (the a_steps_credits = 5 line)"
---

# 0048 — The demo analysis is charged once per demo, at the first render that pays

## The decision

The steps-format flat splits in two:

| key                       | before | after | what it buys                          |
| ------------------------- | ------ | ----- | ------------------------------------- |
| `a_steps_credits`         | 5      | **3** | one Remotion render — every time      |
| `a_demo_analysis_credits` | —      | **2** | the demo analysis — **once per demo** |

The first render of a demo still totals **5**, exactly what it cost before. Every later render of
the **same** demo costs **3**.

## Why

0026 priced the steps format as one flat and justified it as "one analysis amortised over unlimited
variants". The amortisation was never real: the flat is charged per render, so the second, fifth and
twentieth ad off one recording each paid for the analysis again. That is the opposite of what the
format is for. Variants ARE the product — one demo plus one questionnaire into many ads — and the
price was quietly arguing against using it that way.

Splitting the flat lets the price say what actually happens. One recording is analysed once, and it
costs us ₪2.04–₪2.56 on a clean run ([[analyze-demo-cost]]). Every ad after that costs us a Remotion
render on a box we already pay for.

## The mechanism, and the three things that make it not obvious

### 1. It is keyed on the LEDGER, not on the wizard run

`demoHasPaidRender(db, demoId)` (`packages/core/src/pipelines/sets.ts`) is the whole predicate:

> a demo has a paid render **iff** some `video_renders` row of that demo — reached through
> `video_renders.set_id → sets.demo_id` — has a `debit_render` ledger row with **no**
> `refund_failed` row on the same `ref_id`.

A demo analysed yesterday, abandoned, and picked up again today pays exactly what a demo uploaded
and rendered straight through pays. Nothing about the session, the wizard, or "has this demo been
analysed" enters it. The only question is whether the customer has ever actually kept money on this
recording.

**"Not refunded" comes from the ledger and deliberately NOT from `video_renders.refunded_at`.** The
two routes that show a customer a refund (`/api/renders/[id]` and
`/api/businesses/[id]/renders`) read the column, and they are right to: it marks the render the
customer is looking at. But when a refund lands on an **ancestor** — the QC regeneration chain,
`resolveDebitBearingRender` in `pipelines/renders.ts` — the row that actually gave the money back
keeps a null `refunded_at`, and only the failing descendant gets one. For "did this demo ever keep
money", the column would answer wrong. The ledger pairing is the same one `refundRenderIfNeeded`
writes, and migration 0016's two partial unique indexes on `credit_ledger(ref_id)` make it strictly
one debit and one refund per render — so the anti-join is exact, not approximate.

Service B renders have no set and therefore no demo; the joins drop them. A QC-regenerated render
carries no debit of its own (the original is reused), so it neither adds nor removes a claim.

### 2. It is charged at RENDER, never at analysis

The analysis stays free, automatic, and enqueued exactly as it was (`pipelines/demos.ts` is
untouched). Nothing is debited when a demo is analysed.

That is what keeps this from needing a new refund path: **a failed, rejected, or abandoned analysis
costs the customer nothing**, so there is nothing to give back. Charging at analysis time would have
meant a new debit site, a new refund trigger on a job that fails for reasons the customer cannot see,
and money moving on a screen where no price was ever shown. `createSet` and `createBRender` remain
the only two debit sites, which is the invariant the whole ledger design rests on.

The cost is stated plainly: **we eat the analysis of every demo that is never rendered from.** That
is the price of not charging for work the customer did not ask to be billed for.

### 3. It rides on the FIRST cell's debit — still one row per render

A set of N cells still writes N ledger rows, one per render, because refunds key on the render id.
The once-per-set part is simply **added to the first cell's row**. A 2-cell set on a fresh demo
writes −5 and −3, not −3, −3 and a third −2 row.

Refunds needed no change at all: `refundRenderIfNeeded` gives back the row's own delta, so refunding
cell one returns 5 and refunding cell two returns 3 — each cell gives back what it took.

**The documented edge, accepted — and it is sharper than "a small loss".** If the FIRST cell fails
and is refunded while a sibling survives, the analysis for that demo is collected **zero times, for
the life of the demo**. The refund gives back the bearer's whole row, analysis included; the
sibling's debit still stands, so `demoHasPaidRender` stays true and no later render ever quotes the
analysis again. The customer ends up with a delivered ad off an analysed demo having paid 3.

Reachability today is narrow and worth stating exactly: the web route builds a **1×1** steps grid
(`a-sets/steps/route.ts`), where the single cell IS the bearer and a refund correctly flips the demo
back to unpaid. The multi-cell shape is reachable from **`aiugc set` with more than one `--hooks`
or `--hook-lines`**, and from any future multi-cell steps grid in the wizard — which is the format's
stated point, so this will not stay narrow.

It is accepted anyway, and for the reason the founder gave when naming this edge: the platform eats
one analysis **on its own failure**. A render that dies is our fault, not the customer's, and the
alternatives are worse — re-billing the analysis onto a surviving sibling means a debit outside
`createSet`, and a second ledger row for the analysis breaks "one row per render", which is what
makes refunds exact. Pinned by a test so it stays a decision rather than becoming a surprise
(`credits-wiring.test.ts`, "refunding the cell that CARRIED the analysis leaves the demo paid — by
design"). Revisit if and when the wizard grows a multi-cell grid.

### The lock

Two confirms racing on one demo would both read "first" outside the transaction. So inside
`createSet`'s existing transaction the demo row is taken `FOR UPDATE` **before** the predicate is
re-evaluated; the loser blocks, and its re-read — taken after the lock is granted, therefore against
a fresh READ COMMITTED snapshot — sees the winner's committed debit and charges no analysis. The
advisory quote supplies the **price**; the lock decides whether the set **owes** it.

The one asymmetry, stated because it is real: if a refund lands between the quote and the
transaction and makes a demo unpaid again, that set undercharges by the analysis part — the locked
re-read can only cancel the charge, never apply one, because the AMOUNT still comes from the quote.
It is a 2-credit undercharge on a race nobody will hit, and it errs toward the customer.

### The price is now mutable state, and the wizard had to learn that

Under 0026 a steps quote was a pure config flat: the number the render step fetched on mount could
not go stale. It can now, because the price depends on the ledger. The reachable path was the retry
after a failed render — `createSet` always re-quotes server-side, so a cached "3 קרדיטים" on the
confirm button could be followed by a debit of 5 once the failure's refund flipped the demo back to
unpaid. Found in adversarial review of this change and fixed in it: the failed-render retry in
`step-render.tsx` clears the quote along with the render, so the step re-fetches instead of showing
a number the ledger has moved out from under.

That leaves only the window between that fetch and the click — the same window `assertAffordable`
already lives with, and one a customer can only enter by having just been refunded more than the
2 credits at stake.

## What was considered and not chosen

- **Charge at analysis time.** Rejected above: a third debit site, and a bill for work that failed.
- **Keep one flat and just lower it.** That prices the analysis at zero and lets a customer who
  uploads a new recording per ad pay the same as one who reuses — the behaviour we want to steer
  away from, priced identically to the behaviour we want.
- **Amortise over a fixed N variants.** A guess about a number we have no data for, and it still
  overcharges the customer who makes one ad and undercharges the one who makes twenty.
- **A separate ledger row for the analysis.** Would have broken "one debit row per render", which
  is what makes refunds exact.

## The 2 is reasoned from a stale measurement, and that is on the record

[[analyze-demo-cost]] measured six `analyze_demo` jobs against `usage_events`: a clean run
(`attempts = 0`, four of six) is ₪2.04–₪2.56, mean ₪2.28; the one three-attempt run cost ₪4.35 and
its `last_error` shows a worker crash, not a flaky analysis. That note is `verified: 2026-08-23`,
which is **past the 14-day re-measure rule** in [[CONVENTIONS]], and it was **not** re-measured for
this change. Six jobs is also not a distribution. The 2 covers a clean analysis with its retry tail
folded into the first render's total rather than sitting beside it — an argument, not a calibration.
Revisit with a fresh `aiugc costs` run once real steps traffic exists.

## What the customer sees

- The render step's confirm button keeps carrying the price (`stepsConfirmLabel`, founder ruling
  from the 8e walkthrough). On a recording nobody has rendered from yet, a line above the balance
  explains the number and sells the reuse: `5 קרדיטים: 3 לסרטון + 2 על ניתוח ההקלטה. כל מודעה נוספת
מאותה הקלטה תעלה 3.` On a reused recording that line is **absent** — the button says 3 and there is
  nothing to break down.
- The demo step's reuse nudge now names the cost of a new recording, with the number fetched from
  the same quote route called with **no** `demoId` (a demo that does not exist yet). Never a literal:
  the price is config and moves without a deploy.

## Deploy order — not optional

`creditCostsSchema` makes `a_demo_analysis_credits` **required**, like every other key, and
`quoteContext` parses the whole row on every quote path. A build carrying the schema key against a
row that lacks it does not mis-price — it **throws**, and steps, full, silent and Service B stop
together. Same hazard 0026's header named and [[credit-costs-row]] calls "a hand-edit that drops a
key breaks every format at once". **Migration 0039 is applied to production first; the commit
deploys second.**

Required rather than optional deliberately: an optional key would default the analysis to a silent
zero, which is precisely the failure `creditCostsSchema` exists to prevent.

## Related

- [[credit-costs-row]] — the row, decoded; updated with both new values
- [[analyze-demo-cost]] — the ₪2.04–₪2.56 the 2 is reasoned from
- [[no-self-serve-credit-grant-path]] — why the balance is the binding bound on stranger spend
- [[debit-render-accepts-non-positive-cost]] — the one crack: a mistyped row makes renders free
