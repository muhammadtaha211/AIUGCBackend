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

|                                            | Grow (Meshulam)                                 | PayPlus                 | Cardcom           | Sumit                              |
| ------------------------------------------ | ----------------------------------------------- | ----------------------- | ----------------- | ---------------------------------- |
| Recurring card billing (הוראת קבע)         | ✔ hosted pages                                  | ✔ REST API              | ✔ tokens          | ✔ built-in                         |
| Server callbacks                           | ✔                                               | ✔                       | ✔                 | ✔                                  |
| Invoicing (חשבונית מס קבלה)                | via Green Invoice integration — auto per charge | add-on module           | built-in          | built-in (it's an accounting SaaS) |
| Fees                                       | ~1.4–2.5%                                       | similar                 | similar           | similar + SaaS fee                 |
| Fit for a solo Hebrew-first micro-business | **very common choice**                          | more developer-oriented | veteran, older DX | fewest vendors                     |

**Reference: Grow + its Green Invoice integration.** Hosted payment page collects the card and
creates the recurring authorization; invoices are auto-issued per charge by the integration —
zero invoice code on our side (Green Invoice API is the fallback if the integration doesn't
cover a case). The whole design is behind `interface BillingGateway { chargeRecurring() }`, so
switching to PayPlus/Cardcom/Sumit during merchant onboarding is one adapter class. Final vendor
confirmation happens when the founder opens the merchant account — deliberately not a code
dependency.

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

Unit: 1 credit ≈ one Service A render. Config (`credit_costs`): A=1, **B=15** (GPU at fal's
verified per-output-second rates: a 30s run ≈ ₪45 at native 720p, ≈ ₪25 on the 480p + Topaz
upscale path — see [04-integrations.md](04-integrations.md)). Placeholder plans (founder tunes before launch):
starter ₪299/40cr (A only), pro ₪599/100cr, studio ₪999/200cr.

Semantics (all in `credits.ts` + `sets.ts:enforceQuota`):

- **Debit per render at enqueue** (reserve) — a Set of 6 cells debits 6 rows, each `ref`ing its
  render. Per-render (not per-set) keeps refunds exact.
- **Refund on terminal failure** (`refund_failed`) — from the render handler on permanent
  failure and from the janitor for dead jobs; idempotent (one refund per debit, ever).
- **QC rejection never double-charges** — regeneration reuses the original debit.
- **No rollover** — `expire_period` zeroes the remainder at renewal; balance stays `SUM(delta)`.
- **Audio previews are free but capped** — `audio_preview_daily_limit` per business per 24h
  (they cost real TTS money but are the UX heart; a cap beats a debit).
- **Admin bypass** — founder-owned (role=admin) businesses skip credits and watermarks: that's
  how outreach samples use the production pipeline.

## Quotas, caps, sample policy

- **Plan quota** = monthly credits (+ `allows_service_b` flag on the plan).
- **Hard platform-wide daily spend caps** (self-serve = strangers): rolling-24h sums of
  `usage_events` vs `app_config.daily_caps` (`tts_chars` 100k, `gpu_seconds` 300, `llm_tokens`
  2M — all tunable). Checked in handlers immediately before the paid call; breach parks the job
  (`BudgetError`, no attempt burned) — work resumes when the window frees. Rolling window
  avoids timezone math and midnight burst-throughs.
- **Watermark policy**: no live subscription → exactly **one** watermarked Service A sample
  render per business, ever (`businesses.sample_used_at`); the watermark is a props-driven
  Remotion layer. The real trial is the founder's cold-outreach sample.

## DFY tier

Same pipeline, founder-driven: an `orders` row tracks status/price/payment (Bit or invoice);
renders run under the founder's admin bypass. WhatsApp stays the channel (no API in V0).
