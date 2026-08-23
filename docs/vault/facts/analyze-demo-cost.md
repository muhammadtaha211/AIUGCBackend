---
type: fact
status: verified
verified: 2026-08-23
method: "join jobs (type='analyze_demo') to usage_events on job_id; packages/core/.work/vault-events-why.ts, read-only"
source: db
---

# What one demo analysis actually costs

Six `analyze_demo` jobs have ever run. Each row below is one job, with every `usage_events` row that
carries its `job_id`.

| job        | attempts | Claude calls | tokens  | agorot | ILS   |
| ---------- | -------- | ------------ | ------- | ------ | ----- |
| `2e7c6cfb` | 0        | 8            | 140,081 | 235    | ₪2.35 |
| `63c186dd` | 1        | 9            | 155,833 | 256    | ₪2.56 |
| `5e98a9f4` | **3**    | 17           | 287,000 | 435    | ₪4.35 |
| `dbce8d72` | 0        | 9            | 159,161 | 256    | ₪2.56 |
| `50238b84` | 0        | 8            | 137,410 | 218    | ₪2.18 |
| `31f10847` | 0        | 8            | 125,106 | 204    | ₪2.04 |

## The number to quote

A **clean** analysis (`attempts = 0`, four of the six) costs:

- **8–9 Claude calls**
- **125,106 – 159,161 platform tokens**
- **₪2.04 – ₪2.56**, mean ₪2.28

Say ~₪2.30, not "₪2.40" — and never a single figure without the range, because the spread is 25%.

## Retries re-pay in full

`5e98a9f4` took 3 attempts and spent 17 calls / ₪4.35 — **2.1× a clean run**, and 17 is above the
per-attempt ceiling of 16 calls, so more than one attempt certainly bought batches. _Why_ a retry
re-buys rather than resuming from its checkpoint is **not established here** — the count is
measured, the mechanism is not. Budget for a bad upload at
roughly double, not at the clean figure.

`63c186dd` took 1 attempt and 9 calls, so a single retry does not always double it — that job
evidently failed late enough to have already done most of its work, or early enough to have done
little. Six data points is not enough to model it; the honest statement is **₪2.04 to ₪4.35
observed**.

## When it costs nothing at all

Reaching `ready` is necessary but not sufficient. `analyze_demo` returns before its first Anthropic
call when the per-account `llm_tokens` cap has tripped
(`packages/core/src/pipelines/demo-analysis.ts:368-375`), when the business has no questionnaire
(`:379-385`), or under `DRY_RUN`.

## What is NOT true

"Every demo upload spends ₪2.40" — see [[every-upload-spends-2.40]]. Two separate reasons:
an upload rejected at probe spends nothing, and uploads before `79a1dbc` (2026-08-12) were never
analysed at all ([[demo-corpus]]).

## Cost coverage caveat

`cost_estimate_agorot` is what the code estimated at call time, not an invoice:

```ts
// packages/core/src/pipelines/demo-analysis.ts:113
Math.ceil(((inputTokens * 3 + outputTokens * 15) / 1_000_000) * 370);
```

A hard-coded $3/$15-per-Mtok rate and a hard-coded 3.70 ILS/USD. The token counts are the API's
own; the shekels are a local guess that nothing revalidates against a bill or a live FX rate.

The same three lines are copy-pasted in `pipelines/copy.ts:17` and
`pipelines/demo-step-plans.ts:219`. The comment above the second copy says "2nd use; extract at the
3rd" — the third has since landed and the extraction has not.
