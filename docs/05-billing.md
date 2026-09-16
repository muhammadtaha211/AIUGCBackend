# 05 — Billing & Credits

Principle: **the subscription state machine is ours; the gateway only executes charges.**
Implementation: `packages/core/src/pipelines/billing.ts` (state machine, gateway adapter
interface, daily renewal job — tested in `test/billing.test.ts`) and
`pipelines/credits.ts` (ledger). Billing is dormant in the CLI phase (no subscribers; DFY money
moves over Bit with manual `orders` rows) and activates at self-serve launch.

## Gateway choice

Stripe doesn't onboard Israeli businesses and a merchant of record is the wrong shape for a
domestic customer base (~5% fees, foreign checkout, no חשבונית מס). Comparison of the local
candidates:

|                                                                       | Grow (Meshulam)                                                                       | PayPlus                 | Cardcom           | Sumit                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------- | ----------------- | ---------------------------------- |
| Recurring card billing (הוראת קבע)                                    | ✔ API token charges                                                                   | ✔ REST API              | ✔ tokens          | ✔ built-in                         |
| Server callbacks                                                      | ✔                                                                                     | ✔                       | ✔                 | ✔                                  |
| Documents (קבלה / חשבונית עסקה now; חשבונית מס-קבלה after conversion) | via Morning (ex-Green Invoice) — auto per charge; Morning's own clearing runs on Grow | add-on module           | built-in          | built-in (it's an accounting SaaS) |
| Fees                                                                  | ~1.4–2.5%                                                                             | similar                 | similar           | similar + SaaS fee                 |
| Fit for a solo Hebrew-first micro-business                            | **very common choice**                                                                | more developer-oriented | veteran, older DX | fewest vendors                     |

**Reference: Grow + its Green Invoice integration — now a requirement list, not a pick.** The
reference shape is unchanged: a hosted payment page collects the card and creates the recurring
authorization, and documents are auto-issued per charge by the documents vendor (Green Invoice is
now branded **Morning**) — zero document code on our side. What is no longer assumed is that a
given vendor does it the way this design needs. Renewal scheduling stays ours — the worker's daily
job charges a stored token through the gateway's API — so the gateway must support (a) a hosted
page that returns a reusable token, (b) an API-initiated charge on that token for an arbitrary
amount, (c) signed server callbacks carrying a unique event id, and (d) a sandbox with test cards.
A vendor whose recurring runs only on its own scheduler does not fit. (This table used to list
Grow's recurring as "hosted pages" and raise it as a question against (b) — that cell was wrong,
founder correction 2026-09-17: Grow does support API token charges.) The whole design is behind
`interface BillingGateway { chargeRecurring() }`, so switching to PayPlus/Cardcom/Sumit during
merchant onboarding is one adapter class. Final vendor confirmation happens when the founder opens
the merchant account — deliberately not a code dependency.

**The reference stack is Sumit via Upay** — founder decision 2026-09-17,
[`0054`](vault/decisions/0054-payment-stack-is-sumit-via-upay.md). **Sumit** is the API layer
_and_ the documents vendor; **Upay** (יופיי פיננסים בע"מ, ח.פ. 514672575) is the acquirer (מאגד)
behind it. **Our code calls Sumit's API, never Upay.** The four requirements (a)–(d) above are
closed at **capability level** from Sumit's help articles (founder-read, not re-fetched by the
session that recorded it): the hosted first charge is `/billing/payments/beginredirect/` (a); an
arbitrary-amount charge on the saved card is `/billing/payments/charge/`, which auto-issues the
document (b); the sandbox is a free test company, separate from the real org (d); webhooks are
`/triggers/triggers/subscribe/` and need the Growth plan — otherwise poll `/billing/payments/list/`
(c). **Request/response schemas, the refund endpoint and the idempotency key are UNVERIFIED.**
**Sumit's own `/billing/recurring/*` is NOT used, by design** — renewal scheduling stays ours
(`processDueRenewals`), exactly as 0046 §4 requires. Nothing in the tree depends on any of this
yet: every charge still goes through `BillingGateway`, production still runs
`NotConfiguredGateway`, and there is no Sumit adapter. What changed is the default
`subscriptions.gateway` (`'grow'` → `'sumit'`, migration 0044) and the terms-acceptance record at
checkout, a card-company requirement of the acquirer. The Grow row in the table is **retained as
the fallback** and its recurring cell was corrected in the same change.

**Billing ships as עוסק פטור** ([`0046`](vault/decisions/0046-billing-ships-as-osek-patur.md)) —
documents at launch are **קבלה** automatically per successful charge and **חשבונית עסקה** on
request, which is what the live terms §8 promises, and whichever documents vendor is chosen must be
configured that way before the first charge. Conversion to עוסק מורשה happens later, before the
payment that crosses the ceiling; only then does חשבונית מס-קבלה become the right document and this
section's original assumption correct — the contradiction this closes is
[`docs/vault/defects/invoicing-plan-cannot-issue-for-an-osek-patur.md`](vault/defects/invoicing-plan-cannot-issue-for-an-osek-patur.md).

### Conversion to עוסק מורשה — runbook

Seven steps, in order, written out in full in
[`0046`](vault/decisions/0046-billing-ships-as-osek-patur.md): verify the current ceiling on gov.il
and set the configured value; register as מורשה at VAT; switch the documents vendor account to
מורשה / חשבונית מס-קבלה; `UPDATE` the `vat_rate` config (to be added with the gateway adapter, not
before); email subscribers 30 days ahead with the penalty-free cancellation right; update terms §1
and §8; confirm the gateway charge amount is net × (1 + `vat_rate`). Plan prices are **net** — on
conversion VAT is added on top, not absorbed.

## Subscription lifecycle

```
checkout (hosted page) ──callback──▶ active ──period end──▶ charge OK ──▶ active (new period)
                                        │                      │
                                        │                 charge FAIL ──▶ past_due
                                        │                                  │ retry day 2, day 5 (config `dunning`)
                                        │                                  ├─ OK ▶ active
                                        │                                  └─ day 7 ▶ suspended
                                        └── cancel_at_period_end ▶ canceled (at period end, leftover credits expired)
```

- **Keyed on the ACCOUNT, not the business** (migration 0041,
  [`0050`](vault/decisions/0050-subscriptions-are-keyed-on-the-account.md)) — `subscriptions.user_id`,
  no `business_id` at all, and a partial unique index (`subscriptions_one_live_per_user`) that lets
  an account hold exactly one live subscription. One owner, one subscription, one credit pool that
  every business he holds spends from. Credits already worked this way since 0011; this is the same
  model, not a second one.
- **Signup**: web app creates the hosted payment page; the gateway callback (unique
  `gateway_event_id` → `gateway_events`, idempotent) creates the subscription **on the signed-in
  account** with `gateway_recurring_ref` and grants the first period's credits. An owner who then
  adds a second business buys nothing further — he is already subscribed.
- **Renewals**: the daily `billing_renewals` job (`processDueRenewals`) finds due subscriptions
  and charges via the adapter. Success → `expire_period` (zero leftover) + `grant_period`
  (plan credits) + period advanced one month (day-clamped). If `scheduled_plan_code` is set, the
  charge and the grant are **that** plan's and it becomes `plan_code` in the same success branch;
  a failed charge leaves the schedule in place. Failure → `past_due`; retried only on configured
  dunning days; `suspend_after_days` → `suspended` (render paths treat only active/past_due as
  live).
- **Cancellation** = `cancel_at_period_end`; service continues to period end, then leftover
  credits expire. **No refund.** A cancel clears a pending plan change, and a plan change clears
  a pending cancel.
- **Plan changes** (founder decisions 2026-09-17,
  [`0052`](vault/decisions/0052-upgrade-credits-are-period-credits.md) and
  [`0053`](vault/decisions/0053-downgrades-are-scheduled-not-applied.md); `changePlan` in
  `billing.ts`, arithmetic in `packages/core/src/plan-change.ts`):
  - **Upgrade (by price) is immediate and prorated.** `quotePlanChange` takes the fraction of the
    period that is left — `daysRemaining = ceil((periodEnd − now) / 1 day)` clamped to
    `[0, daysInPeriod]`, over `daysInPeriod = round((periodEnd − periodStart) / 1 day)` — and
    applies it to **both** numbers: `chargeAgorot = ceil(price difference × fraction)` (money
    rounds up) and `creditsGranted = floor(credit difference × fraction)` (credits round down).
    The gateway charges the difference; on success the credits are written as a **`grant_period`**
    row with the note `upgrade <from>→<to> <daysRemaining>/<daysInPeriod>` and `plan_code`
    switches. **Not `grant_manual`** — `expirePeriodRemainder` spares manual credits, so an
    upgrade granted that way would never expire; as period credits they leave at the next renewal
    with the rest. The period dates never move. A declined charge changes nothing but the
    `gateway_events` row. **An upgrade on the last day** (`daysRemaining ≤ 1`) is scheduled
    instead of charged.
  - **Downgrade is scheduled**: `subscriptions.scheduled_plan_code` (migration 0045) is set and
    `plan_code` stays what was paid for until the renewal applies it. Flipping `plan_code` early
    would misreport the current plan and make an upgrade-after-downgrade prorate from the wrong
    base — that is why it is a column.
  - **Re-choosing the current plan is the undo**: clears the schedule and a pending cancel; a
    typed `nothing_pending` refusal when nothing was pending. Only `active` may change plan;
    `past_due`/`suspended` are refused (`not_active`, a Hebrew 409 on the web).
  - The same `quotePlanChange` is a client-safe subpath (`@aiugc/core/plan-change`), so the
    account page — not built yet; the routes are — will display the number the route charges.
    `GET /api/account/subscription` returns a quote for every active plan the account is not on,
    computed from the plan it is on even if that plan has since been retired.
  - All of it moves the whole account: there is no per-business plan to change.
- **Terms at checkout**: `POST /api/account/checkout` requires `acceptedTerms: true` (a checkbox,
  a card-company requirement of the acquirer, Upay — reverses `docs/legal-review.md` row T1 for the purchase step
  only) and writes a `terms_acceptances` row (migration 0046: user, the terms page's dated
  version, `'checkout'`, first-hop IP, user agent) before answering **503 "התשלום המקוון יופעל
  בקרוב."** — a deliberate dead end until the gateway adapter exists. The acceptance record is
  real; the payment is not yet.
- **Callbacks vs our loop**: the gateway also emits charge events; both paths funnel through
  `gateway_events` with the unique id, so a callback arriving for a charge our renewal loop
  initiated (or vice versa) is a no-op.

## Credits

**Unit: 1000 credits = ₪150, i.e. ₪0.15 per credit on the base tier** (migration 0043,
[`0051`](vault/decisions/0051-the-credit-unit-and-the-three-credit-only-plans.md)). A credit is a
unit of money, not of time. The older rule — "1 credit = 1 second" — is **retired**: nothing in
code ever depended on it, and it stopped being true the moment the steps format priced a render as
a flat. Service B is still **priced per second** of approved VO, now with a floor; Service A steps
is two flats.

> **Migration 0043 was applied to production on 2026-09-17** and these are the live prices. The
> before-read returned the 0039 rates and 0001's placeholder plan prices with all four guards
> matching; the after-read, through `getConfigValue(db, 'credit_costs', creditCostsSchema)`, returned
> the ten rates below and the three plan rows. Ledger **44 rows, 0000–0043**, recorded by `db push`
> itself. Proof: `apps/cli/node_modules/.bin/tsx packages/core/scripts/verify-credit-costs.ts`
> (18 checks, PASS). No restart or deploy was needed — `getConfigValue` reads the row on every quote.

Never marketed in **"videos per month"** — credits and worked examples only. A 35s ad and a 10s ad
are not the same product and must not cost the same, so any count of videos is a number we would
have to break.

### Tiers

The three plans differ by **credit volume only**. No founder-time benefit, no support level, no
feature gate: all three unlock Service B, and `plans.config` is empty on all three. You get more
credits per shekel the higher you go, steeply — the price per credit falls ₪0.15 → ₪0.12 → ₪0.10,
a third off between the bottom tier and the top — and that is the entire pull upward. The one differentiator that is **named and not built** is **queue priority** for higher
tiers: `jobs` has no priority column and the claim query has no plan awareness, so it is a core
change if and when it comes.

| code      | name    | price      | credits/mo | per credit | Service B |
| --------- | ------- | ---------- | ---------- | ---------- | --------- |
| `starter` | התחלה   | ₪150 (net) | 1000       | ₪0.15      | ✔         |
| `pro`     | מתקדם   | ₪300 (net) | 2500       | ₪0.12      | ✔         |
| `studio`  | פרימיום | ₪500 (net) | 5000       | ₪0.10      | ✔         |

Prices are **net** — we ship as עוסק פטור, so no VAT is added today and on conversion it goes on
top. The Hebrew display names are the founder's (2026-09-17) and live in `plans.name` since
migration 0044; the `code` is what every lookup uses and it does not change.

> **Migrations 0044–0047 were applied to production on 2026-09-17** (the Hebrew names and the
> `'sumit'` gateway default; `subscriptions.scheduled_plan_code`; `terms_acceptances`; nullable
> `feedback.user_id` with the contact columns). 0044's guarded UPDATEs were read at both ends: the
> before-read returned the Latin names with all three guards matching, the after-read the three
> Hebrew names and `'sumit'::text`. Ledger **48 rows, 0000–0047**, recorded by `db push` itself.
> Proof: `scripts/verify-migration-ledger.sql` §RESULTS (38 structural rows, 36 true). No restart
> was needed for the names; **the renewal change ships to the worker box only with the merge and a
> box deploy** (`docs/07-worker-box.md` §11).

The whole credits bundle — `pricing.ts`, the ledger rework, the wizard gate, migrations
0016–0020 and their tests — landed in one commit: **`d8df728`** (2026-08-06).

### The one pricing source of truth

Every credit figure — the estimate in the wizard, the quote on the advisory screen, and the
integer written to the ledger — comes from **one call** into `@aiugc/core/pricing`
(`packages/core/src/pricing.ts`). It is a client-safe subpath (pure math + zod, no db, no env,
same wiring as `@aiugc/core/hook-geometry`), so the browser and the server literally run the same
function. A second place that computes a price is a bug, not an optimisation.

```
quoteServiceA({ demoSeconds, outroMode, outroSeconds, costs })
quoteServiceASteps({ costs, firstPaidRenderOfDemo })
quoteServiceB({ durationMs, costs })
quoteEndingReroll({ sliceSeconds, costs })
quoteAssemblyRemix({ costs })
```

Order of operations, exactly: **sum the components → clamp to the minimum → `Math.ceil` once.**
Never ceil per component — a 34s demo with a 6.5s ending quotes 73 that way and 74 the wrong way,
and any drift between the displayed quote and the debit is the failure this module exists to
prevent.

### `credit_costs` (app_config, migrations 0017 + 0026 + 0039 + 0043)

```json
{
  "a_assembly_flat": 15,
  "a_demo_per_second": 0.75,
  "a_outro_per_second": 5,
  "a_minimum_credits": 25,
  "b_per_second": 5,
  "b_minimum_credits": 75,
  "a_ending_reroll_per_second": 5,
  "a_remix_assembly_credits": 10,
  "a_steps_credits": 25,
  "a_demo_analysis_credits": 20
}
```

**0043 (2026-09-16) multiplied seven of the ten rates by 5** — a re-denomination into the ₪0.15
credit. **Three moved further, so it also re-prices**, and it does so on the two Service A charges a
customer can actually reach. First, `b_minimum_credits` goes **0 → 75**:
Service B had no floor at all, and 75 credits is 15 seconds at the new `b_per_second`. The floor
exists because the per-ad costs that do **not** scale with seconds — the script call, the audio
previews, the composite when there is one — are the same for a 6-second ad as for a 30-second one,
and a seconds-only price hands those away free at the short end.

The other two are the live Service A charges: `a_steps_credits` **3 → 25** (×8.3, where ×5 would be 15) and `a_demo_analysis_credits` **2 → 20** (×10, where ×5 would be 10). Measured against
`b_per_second`, which is ×5 and so survives the change of unit, a steps render goes from 3× a
Service B second to 5× (**+67%**) and the analysis from 2× to 4× (**+100%**). That is a deliberate
price rise, not a change of unit.

The six dormant keys (the retired full format, the re-roll, the remix) were scaled ×5 too, so that a
re-enabled path never quotes at a fifth of cost.

**Every key is required by `creditCostsSchema`** — restoring this row from an older copy of this
block (without `a_steps_credits`, or without `a_demo_analysis_credits`) makes every quote path
throw. The migration that adds a key must be applied before any build carrying the schema key
deploys: that was true of 0026 and it is true of 0039. **0043 adds no key**, so it carries no deploy
order — it moves ten numbers the deployed code already reads live on every quote.

Rates are `z.number()`, **not** `.int()` — whole-credit-per-second steps make tuning impossible.
The charge is always an integer because of the single ceil. Tuning any of this is an `UPDATE` on
this row, never a deploy; the code does not know which pricing model won.

- A 35s demo + 6s avatar ending = `15 + 26.25 + 30` = **72 credits** (₪10.80 at the base tier).
  Under 0017 this was the same price as a 15s Service B ad; it no longer is, because a 15s B ad is
  75 — exactly the new floor. Retired full format — CLI only.
- The same demo with a freeze or clean ending = **42** — a frozen frame spends no GPU, so
  `outroMode: "freeze" | "none"` bills zero outro seconds. The quote can never contradict the
  shape summary printed beside it.
- **Service B, 20s of approved VO** = `20 x 5` = **100 credits**, ₪15 at the base tier. A 30s ad is 150. A 12s, 10s or 8s ad is **75 alike** — the floor binds everywhere below 15s.
- **Service A steps, first ad off a new recording** = `25 + 20` = **45 credits**, ₪6.75 at the base
  tier. Every later ad off the same recording is **25**, ₪3.75.
- `a_minimum_credits` and `b_minimum_credits` express "no video costs less than X" as config, and
  since 0043 **both are active** — 25 for the full format, 75 for Service B. `b_minimum_credits` was
  `0`, i.e. off, from 0017 until then. A consequence worth stating: the wizard's **15s duration
  preset now prices flat at the floor**, since 15 × 5 = 75 and an approved VO almost always lands
  just under its preset.
- `a_remix_assembly_credits` is **floor-exempt by design**: a remix that changes only the hook
  clip, the hook line, or the text rect re-runs assembly and nothing else, at near-zero marginal
  cost. It still goes through `createSet`, so a naive floor would silently price it like a fresh
  video and kill the volume play.
- `a_steps_credits` (0026, **split 5 → 3 by 0039, then taken to 25 by 0043** — an ×8.3 move, not
  that file's ×5 re-denomination) is the flat price of one steps-format **render**, floor-exempt. The full-format quote would bill the UPLOADED duration — a 3-minute
  recording would price **150** credits for a ~20s output (`15 + 180 × 0.75`), at a rate
  calibrated to subsidise a TTS funnel the steps format doesn't use.
- `a_demo_analysis_credits` (0039) is the demo analysis, **charged once per demo** and also
  floor-exempt. 0026 folded the analysis into the flat and called it "amortised over unlimited
  variants", which it never was: the flat is per render, so every variant paid for the analysis
  again — the opposite of the reuse the format exists for. Split, the price says what happens. **The
  first render of a demo totals 45**; every later render of the same demo is 25. Under 0039 it was
  5 and 3, and a straight ×5 would have been 25 and 15 — the extra is the price rise above.
  - **"First" is a fact about the LEDGER, not the wizard run.** `demoHasPaidRender`
    (`pipelines/sets.ts`): a demo has a paid render iff some `video_renders` row of that demo
    (through `sets.demo_id`) carries a `debit_render` row with no `refund_failed` row on the same
    `ref_id`. Not `video_renders.refunded_at` — an ancestor refund (the QC chain) leaves the row
    that gave the money back with a null column. So a demo analysed yesterday, abandoned and reused
    today pays exactly what a fresh upload pays, and a first render that failed and was refunded
    leaves the demo unpaid, as it should.
  - **Charged at render, never at analysis.** Nothing is debited when a demo is analysed, so a
    failed analysis costs the customer nothing and needs no refund path — and `createSet` /
    `createBRender` stay the only two debit sites. The platform eats the analysis of every demo
    nobody renders from; that is the price of not billing for work the customer never saw a price
    for.
  - **It rides on the FIRST cell's debit**, so a set of N cells still writes N ledger rows and the
    first is simply larger (`45, 25, 25, …`). Refunds are unchanged: each row gives back its own delta.
    Inside `createSet`'s transaction the demo row is locked `FOR UPDATE` before the predicate is
    re-read, so two confirms racing on one demo cannot both charge the analysis.
  - The analysis charge is reasoned from `docs/vault/facts/analyze-demo-cost.md` (₪2.04–₪2.56 for
    a clean run, mean ₪2.28, `verified: 2026-08-23` and **not** re-measured since) — 20 credits is
    ₪3 at the base tier.
    Full reasoning: [`0048`](vault/decisions/0048-the-demo-analysis-is-charged-once-per-demo.md).

### Semantics (`credits.ts` + `sets.ts`)

- **Two debit sites, ever** — `createSet` and `createBRender`. Never at TTS, never at audio
  approval, never at enqueue of a downstream job. A tab closed after audio approval loses exactly
  zero credits, and that property is structural.
- **One charge, at confirm** — the moment of full information. Soft estimate at script approval →
  exact quote at the advisory (audio is approved first, so `planAOutro` runs pre-confirm and the
  ending is known) → single debit at confirm.
- **Debit per render, inside a transaction** — a Set of 6 cells writes 6 rows, each `ref`ing its
  render (per-render keeps refunds exact). The one once-per-set charge — the demo analysis above —
  is ADDED to the first row rather than given a row of its own, precisely so this stays true. The set row, the render rows, the debits and the jobs
  commit together or not at all.
- **Atomic** — the balance is re-read inside the transaction behind a row lock on the owner
  account, so two tabs confirming at once serialize instead of overdrawing.
- **Structurally idempotent** — partial unique indexes on `credit_ledger (ref_id)` for
  `debit_render` and `refund_failed` (migration 0016). Double-debit and double-refund are
  impossible rather than merely unlikely.
- **Typed refusal** — `InsufficientCreditsError` carries `{needed, balance, shortfall}`, so the
  wizard renders the shortfall in Hebrew instead of a generic string.
- **Refund on terminal failure** (`refund_failed`) — from the render handler on permanent failure
  and from the janitor for dead jobs, including Service A's freeze/none shapes, which never
  enqueue a lipsync job. A conflict on the unique index means the other caller won: success, not
  an error.
- **QC rejection never double-charges** — regeneration reuses the original debit.
- **Period rows are account-level** — `grant_period` and `expire_period` carry `user_id` and a
  NULL `business_id`, the same shape `grant_manual` has always had, because the subscription they
  come from belongs to the account (0041). `business_id` stays only on the spend rows
  (`debit_render` / `refund_failed`), where it is real context.
- **No rollover, but `grant_manual` survives** — `expire_period` expires only
  `balance − manualOutstanding`. That encodes "spend consumes period credits first, manual credits
  last" without a per-lot ledger, so a founder goodwill grant is never deleted by the customer's
  next renewal.
- **Admin bypass** — founder-owned (`role=admin`) businesses skip credits, watermarks and the
  per-account caps: that is how cold-outreach samples run on the production pipeline, and they
  come out un-watermarked deliberately.

### No subscription, no free tier

**A positive credit balance is the only door.** There is no subscription lookup in the render path
and no in-product free video of any kind, watermarked or not. Credits are granted today (admin
console) and purchased once payments exist.

Kept dormant, not deleted, because payments will want them: the Remotion watermark layer and
`video_renders.watermarked`, `businesses.sample_used_at`, the `subscriptions` table, and
`grantPeriod` / `expirePeriodRemainder`.

## Quotas and caps

- **Wizard entry gate** — `/home/a/new` and `/home/b/new` refuse a zero balance server-side, so
  nobody walks the whole flow (upload, scripts, previews — all of which cost us money) only to be
  refused at the last screen. Spam control, not enforcement: the 402 at confirm is the real
  boundary.
- **Per-ACCOUNT caps** (`daily_caps.per_account`, migrations 0018 + 0022 + 0027, tightened by 0036) — **the real
  mechanism, checked first**, keyed on `users.id`. `tts_chars: 25000` ≈ 2000 seconds of Hebrew
  speech a day (~50 full previews, ~₪7.50/account/day). `gpu_seconds: 2000` mirrors that ceiling
  on purpose — every lip-synced second is a second of approved TTS audio, so an account cannot
  legitimately lip-sync more than it can synthesize in the same window (~65 thirty-second
  renders/day, ~₪500/account/day worst case; the busiest day ever recorded across ALL accounts
  is 127 gpu-seconds). `llm_tokens: 500000` — **tightened from 1,500,000 by 0036**, which is the
  one per-account value that changed: at 1.5M a single account could legitimately consume 75% of
  the whole platform's daily LLM budget and two ordinary heavy users tripped it. 500k is roughly
  three demo uploads plus several plan generations in a day, calibrated on figures that are
  REASONED, not measured, and stale past the 14-day rule — see 0036's header. GPU is checked
  **pre-debit at confirm** (`createBRender`, and `createSet`
  when the outro decision is avatar) with an in-handler backstop in `handleLipsync` for the
  confirm-to-execution window — the backstop fails-and-refunds, never parks. Keyed on the
  account and not the business because business creation is self-serve and unlimited — a
  per-business cap is farmable at N businesses. A breach throws `AccountBudgetError` and is
  rejected **immediately**, never parked: a parked job leaves the wizard spinning forever,
  because `useJobPoll` only gives up after consecutive _failures_ and a parked job never fails.
- **Platform-wide daily caps** — a **runaway backstop only**, for what no account cap can stop
  (a loop across accounts, a leaked key): rolling-24h sums of `usage_events` vs
  `app_config.daily_caps`, set in **migrations, never a hand `UPDATE`** — the live `gpu_seconds`
  had once drifted to a hand-set, recorded-nowhere 36,000, and that drift is the reason for the
  rule. **0036 (2026-09-11) made every platform cap exactly 16x its per-account pair** —
  `tts_chars: 400000`, `llm_tokens: 8000000`, `gpu_seconds: 32000` (~8.9h of video/day, ~₪8,000
  worst case at 25 agorot/s), plus `images: 400`, which has no per-account pair and is not covered
  by the rule. Sixteen accounts each spending a full day's allowance is what it now takes to reach
  the ceiling, which is the point: the parking behaviour below makes this cap unsafe to trip, so it
  has to be a runaway detector and not a budget
  (`docs/vault/decisions/0040-the-hard-ceiling-moves-to-the-providers.md`, implemented by
  `supabase/migrations/0036_daily_caps_runaway_detector.sql`). Checked in handlers
  immediately before the paid call; a breach parks the job (`BudgetError`, no attempt burned),
  resumes when the window frees, **and writes a `platform_budget_tripped` events row** — with
  account caps absorbing legitimate load, a platform trip means something is broken, not that we
  are busy. **Nothing surfaces it.** Corrected 2026-09-10: there is no admin events feed — `events`
  has never held a row, `apps/admin` has four surfaces (feedback, hooks, personas, users) and none
  of them queries the table, and the worker's Sentry reporting fires only on terminal statuses while
  a parked job is not terminal. `select * from events where kind = 'platform_budget_tripped'` is the
  only real half of this. Today a platform trip is discovered by a customer complaining about a
  stuck wizard — see `docs/vault/decisions/0040-the-hard-ceiling-moves-to-the-providers.md`.
- **Max-park-age valve** (`MAX_BUDGET_PARK_MS`, 6h, reaper sweep) — a render whose job has sat
  budget-parked past the threshold is failed and refunded through `failRenderAndRefund` instead
  of holding the customer's money indefinitely. A safety valve, not a policy: it works under any
  cap design. **It is also render-only, verified 2026-09-10**: `findOverparkedRenders`
  (`janitor.ts:54-68`) is gated on `jobs.type IN ('render_video','lipsync')` plus an inner join to
  `video_renders`, and is the only reader of `jobs.error_class = 'budget'` in the tree. A
  budget-parked `synth_tts` — or `analyze_demo`, `plan_demo_steps`, copy or composite job — has **no
  exit**: it re-queues at +1h indefinitely, with `audio_renders` left on `generating`.
- **Audio previews are free but capped** — `audio_preview_daily_limit` (**20/24h**), also keyed on
  the owner account. TTS is absorbed cost of sale (ElevenLabs bills **$0.10/1k chars**, which at
  USD/ILS 3.00 is the **30 agorot/1k** that `pipelines/tts.ts` bills every `usage_events` row at) and
  a cap beats a debit; absorbed does not mean unbounded. This is the **queue** bound, not the money
  bound: `per_account.tts_chars` above is the money bound at 25,000 chars/24h, which migration 0018
  prices at ~₪7.50/account/day, and it is unchanged. At 20 attempts and a ~375-char script the attempt cap binds first, at ~₪2.25/day.
  Migration 0038 took this to 50 on 2026-09-13; **migration 0040 takes it back to 20** — founder
  decision 2026-09-16, [vault 0049](vault/decisions/0049-audio-preview-attempt-cap-back-to-20.md),
  superseding [vault 0047](vault/decisions/0047-audio-preview-attempt-cap-moves-to-50.md): Service B
  is an occasional format, a good voice needs 2–3 retries rather than 50, and the 50 was reasoned
  rather than measured. **0040 was applied to production 2026-09-16** — read back through the code's
  own parse as the number 20, with a before-read of 50 proving its guard matched.
  **Reasoned, not measured** — in both directions; no usage data was ever consulted. Revisit only
  with real `audio_renders` counts once billing is wired. Charging credits per preview was considered
  and rejected in 0047, and that ruling stands.
- **Paid overage is the escalation path, not built** — letting an account keep generating past the
  free allowance by debiting credits is the better long-term answer, but it breaks the
  two-debit-sites invariant and no real user has hit the ceiling. Revisit only when telemetry says
  legitimate accounts are hitting it.

### Knowing what it really costs

`aiugc costs --from YYYY-MM-DD [--to …] [--business …]` reports actual agorot per delivered video,
split by provider (`packages/core/src/pipelines/costs.ts`). Rates above were set from estimates;
two weeks of real traffic through this query replaces the guesswork. Every paid call records
`business_id`, so a suspicious bill can be narrowed to one account.

## DFY tier

Same pipeline, founder-driven: an `orders` row tracks status/price/payment (Bit or invoice);
renders run under the founder's admin bypass. WhatsApp stays the channel (no API in V0).

`orders` stays **business-keyed** and that is not an oversight: a DFY order is one piece of work
for one brand, paid once, not a standing relationship with an account. Subscriptions and credits
are the account-level things (0041); an order is not one of them, and a DFY customer has no
subscription at all.
