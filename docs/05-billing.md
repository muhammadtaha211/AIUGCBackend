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

|                                                                       | Grow (Meshulam)                                 | PayPlus                 | Cardcom           | Sumit                              |
| --------------------------------------------------------------------- | ----------------------------------------------- | ----------------------- | ----------------- | ---------------------------------- |
| Recurring card billing (הוראת קבע)                                    | ✔ hosted pages                                  | ✔ REST API              | ✔ tokens          | ✔ built-in                         |
| Server callbacks                                                      | ✔                                               | ✔                       | ✔                 | ✔                                  |
| Documents (קבלה / חשבונית עסקה now; חשבונית מס-קבלה after conversion) | via Green Invoice integration — auto per charge | add-on module           | built-in          | built-in (it's an accounting SaaS) |
| Fees                                                                  | ~1.4–2.5%                                       | similar                 | similar           | similar + SaaS fee                 |
| Fit for a solo Hebrew-first micro-business                            | **very common choice**                          | more developer-oriented | veteran, older DX | fewest vendors                     |

**Reference: Grow + its Green Invoice integration — now a requirement list, not a pick.** The
reference shape is unchanged: a hosted payment page collects the card and creates the recurring
authorization, and documents are auto-issued per charge by the documents vendor (Green Invoice is
now branded **Morning**) — zero document code on our side. What is no longer assumed is that a
given vendor does it the way this design needs. Renewal scheduling stays ours — the worker's daily
job charges a stored token through the gateway's API — so the gateway must support (a) a hosted
page that returns a reusable token, (b) an API-initiated charge on that token for an arbitrary
amount, (c) signed server callbacks carrying a unique event id, and (d) a sandbox with test cards.
A vendor whose recurring runs only on its own scheduler does not fit. The table above lists Grow's
recurring as hosted pages, which may not satisfy (b) — a question for the onboarding call
([`0046`](vault/decisions/0046-billing-ships-as-osek-patur.md)). The whole design is behind
`interface BillingGateway { chargeRecurring() }`, so switching to PayPlus/Cardcom/Sumit during
merchant onboarding is one adapter class. Final vendor confirmation happens when the founder opens
the merchant account — deliberately not a code dependency.

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

- **Signup**: web app creates the hosted payment page; the gateway callback (unique
  `gateway_event_id` → `gateway_events`, idempotent) creates the subscription with
  `gateway_recurring_ref` and grants the first period's credits.
- **Renewals**: the daily `billing_renewals` job (`processDueRenewals`) finds due subscriptions
  and charges via the adapter. Success → `expire_period` (zero leftover) + `grant_period`
  (plan credits) + period advanced one month (day-clamped). Failure → `past_due`; retried only
  on configured dunning days; `suspend_after_days` → `suspended` (render paths treat only
  active/past_due as live).
- **Cancellation** = `cancel_at_period_end`; service continues to period end, then leftover
  credits expire.
- **Plan changes** (launch scope): upgrade applies immediately — charge the difference via the
  gateway, `grant_manual` the credit difference, switch `plan_code`; downgrade takes effect at
  the next renewal (change `plan_code` only). Both are single UPDATEs + ledger rows on the
  existing machinery.
- **Callbacks vs our loop**: the gateway also emits charge events; both paths funnel through
  `gateway_events` with the unique id, so a callback arriving for a charge our renewal loop
  initiated (or vice versa) is a no-op.

## Credits

**Unit: 1 credit = 1 second.** Marketed in seconds, never in "videos per month" — a 35s ad and a
10s ad are not the same product and must not cost the same.

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
Never ceil per component — a 34s demo with a 6.5s ending quotes 15 that way and 16 the wrong way,
and any drift between the displayed quote and the debit is the failure this module exists to
prevent.

### `credit_costs` (app_config, migrations 0017 + 0026 + 0039)

```json
{
  "a_assembly_flat": 3,
  "a_demo_per_second": 0.15,
  "a_outro_per_second": 1,
  "a_minimum_credits": 5,
  "b_per_second": 1,
  "b_minimum_credits": 0,
  "a_ending_reroll_per_second": 1,
  "a_remix_assembly_credits": 2,
  "a_steps_credits": 3,
  "a_demo_analysis_credits": 2
}
```

**Every key is required by `creditCostsSchema`** — restoring this row from an older copy of this
block (without `a_steps_credits`, or without `a_demo_analysis_credits`) makes every quote path
throw. The migration that adds a key must be applied before any build carrying the schema key
deploys: that was true of 0026 and it is true of 0039.

Rates are `z.number()`, **not** `.int()` — whole-credit-per-second steps make tuning impossible.
The charge is always an integer because of the single ceil. Tuning any of this is an `UPDATE` on
this row, never a deploy; the code does not know which pricing model won.

- A 35s demo + 6s avatar ending = `3 + 5.25 + 6` = **15 credits**, the same as a 15s Service B ad.
- The same demo with a freeze or clean ending = **9** — a frozen frame spends no GPU, so
  `outroMode: "freeze" | "none"` bills zero outro seconds. The quote can never contradict the
  shape summary printed beside it.
- `a_minimum_credits` and `b_minimum_credits` express "no video costs less than X" as config.
- `a_remix_assembly_credits` is **floor-exempt by design**: a remix that changes only the hook
  clip, the hook line, or the text rect re-runs assembly and nothing else, at near-zero marginal
  cost. It still goes through `createSet`, so a naive floor would silently price it like a fresh
  video and kill the volume play.
- `a_steps_credits` (0026, **lowered 5 → 3 by 0039**) is the flat price of one steps-format
  **render**, floor-exempt. The full-format quote would bill the UPLOADED duration — a 3-minute
  recording would price ~31 credits for a ~20s output, at a rate calibrated to subsidise a TTS
  funnel the steps format doesn't use.
- `a_demo_analysis_credits` (0039) is the demo analysis, **charged once per demo** and also
  floor-exempt. 0026 folded the analysis into the flat and called it "amortised over unlimited
  variants", which it never was: the flat is per render, so every variant paid for the analysis
  again — the opposite of the reuse the format exists for. Split, the price says what happens. **The
  first render of a demo still totals 5**; every later render of the same demo is 3.
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
    first is simply larger (`5, 3, 3, …`). Refunds are unchanged: each row gives back its own delta.
    Inside `createSet`'s transaction the demo row is locked `FOR UPDATE` before the predicate is
    re-read, so two confirms racing on one demo cannot both charge the analysis.
  - The 2 is reasoned from `docs/vault/facts/analyze-demo-cost.md` (₪2.04–₪2.56 for a clean run,
    `verified: 2026-08-23` and **not** re-measured for this change).
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

> **Deferred to payments — the subscription-keying question.** Subscriptions are business-keyed
> (`subscriptions.business_id`) while credits are account-keyed (`credit_ledger.user_id`). One
> owner with three businesses has one balance but would have three subscriptions. Do not resolve
> this here; decide it when checkout is built.

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
  rather than measured. **0040 is written and NOT pushed — the live row still reads 50.**
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
