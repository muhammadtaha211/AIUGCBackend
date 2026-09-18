---
type: fact
status: verified
verified: 2026-09-18
method: "join jobs (type='analyze_demo') to usage_events on job_id; packages/core/.work/vault-events-why.ts, read-only (2026-08-23, six jobs). The 85d9ec0b row was measured 2026-09-18 by the same join against production; the file:line cites below were re-read in the tree at f84e931 on that date and several had drifted."
source: db
---

# What one demo analysis actually costs

Each row below is one job, with every `usage_events` row that carries its `job_id`.

| job        | attempts | Claude calls | tokens  | agorot | ILS   |
| ---------- | -------- | ------------ | ------- | ------ | ----- |
| `2e7c6cfb` | 0        | 8            | 140,081 | 235    | ₪2.35 |
| `63c186dd` | 1        | 9            | 155,833 | 256    | ₪2.56 |
| `5e98a9f4` | **3**    | 17           | 287,000 | 435    | ₪4.35 |
| `dbce8d72` | 0        | 9            | 159,161 | 256    | ₪2.56 |
| `50238b84` | 0        | 8            | 137,410 | 218    | ₪2.18 |
| `31f10847` | 0        | 8            | 125,106 | 204    | ₪2.04 |
| `85d9ec0b` | **3**    | 6            | 98,083  | 169    | ₪1.69 |

The first six are every `analyze_demo` job that had run as of 2026-08-23. `85d9ec0b` is 2026-09-18
and is added because it **breaks the pattern of the row above it**: three attempts, and it cost
_less_ than a clean run.

## The number to quote

A **clean** analysis (`attempts = 0`, four of the six) costs:

- **8–9 Claude calls**
- **125,106 – 159,161 platform tokens**
- **₪2.04 – ₪2.56**, mean ₪2.28

Say ~₪2.30, not "₪2.40" — and never a single figure without the range, because the spread is 25%.

## Retries do NOT always re-pay — and the two three-attempt jobs are opposite cases

**`5e98a9f4` re-paid in full.** 3 attempts, 17 calls, ₪4.35 — **2.1× a clean run**, and 17 is above
the per-attempt ceiling of 16 calls, so more than one attempt certainly bought batches.

**`85d9ec0b` did not.** Same attempt count, **6 calls / ₪1.69** — _below_ the clean-run floor,
because the batch checkpoint held across all four executions: five batches were bought once in
attempt 1 and reused, and only the one batch that kept failing was re-bought. Measured 2026-09-18;
the mechanism is in [[analysis-parse-failure-discards-the-whole-attempt]].

**So the attempt count does not predict the cost.** What predicts it is _what killed the attempt_:

| cause                                      | checkpoint | cost                     |
| ------------------------------------------ | ---------- | ------------------------ |
| worker died mid-run, lease sweep reclaimed | lost       | ~2× (`5e98a9f4`)         |
| a batch threw, the handler retried         | held       | ~1× or less (`85d9ec0b`) |

**Read the ledger as the ledger, not the bill.** `recordUsage` runs only _after_ the provider call
returns (`demo-analysis.ts:669-685`), so a call that reached Anthropic and then threw is billed and
recorded nowhere. `85d9ec0b`'s ₪1.69 omits **three** such calls; folding them back in at that job's
own mean puts real spend near ₪2.5. Every figure in this note is the recorded estimate, and every
one of them is a **lower bound** on a job that failed at all.

The trigger is known: that job's `jobs.last_error` reads
`lease expired: worker died mid-run (was locked by local:heavy)`. **The worker died and the lease
sweep reclaimed the job** — no handler decided to retry. See
[[worker-exits-on-a-dropped-connection]]. So this premium is the price of a worker crash, not of a
flaky analysis. Budget for a bad upload at roughly double, but expect the cause to be
infrastructure rather than the demo.

`63c186dd` took 1 attempt and 9 calls, so a single retry does not always double it — that job
evidently failed late enough to have already done most of its work, or early enough to have done
little. Six data points is not enough to model it; the honest statement is **₪2.04 to ₪4.35
observed**.

## When it costs nothing at all

Reaching `ready` is necessary but not sufficient. `analyze_demo` returns before its first Anthropic
call when the per-account `llm_tokens` cap has tripped
(`packages/core/src/pipelines/demo-analysis.ts:543-550`), when the business has no questionnaire
(`:554-560`), or under `DRY_RUN` (`:517-536`).

_(Those three cites read `:368-375` and `:379-385` until 2026-09-18; both had drifted ~175 lines.
Re-read at `f84e931`.)_

## What is NOT true

"Every demo upload spends ₪2.40" — see [[every-upload-spends-2.40]]. Two separate reasons:
an upload rejected at probe spends nothing, and uploads before `79a1dbc` (2026-08-12) were never
analysed at all ([[demo-corpus]]).

## Cost coverage caveat

`cost_estimate_agorot` is what the code estimated at call time, not an invoice:

```ts
// packages/core/src/pipelines/demo-analysis.ts:156-158
Math.ceil(((inputTokens * 3 + outputTokens * 15) / 1_000_000) * 370);
```

A hard-coded $3/$15-per-Mtok rate and a hard-coded 3.70 ILS/USD. The token counts are the API's
own; the shekels are a local guess that nothing revalidates against a bill or a live FX rate.

The same three lines are copy-pasted in `pipelines/copy.ts:21`,
`pipelines/demo-step-plans.ts:242` and `pipelines/tts.ts:139` — **four copies**, tracked in
[[llm-cost-formula-is-copied-four-times]]. The comment above the second still says "2nd use;
extract at the 3rd"; the third and fourth have landed and the extraction has not.

_(This paragraph cited `demo-analysis.ts:113`, `copy.ts:17` and `demo-step-plans.ts:219` until
2026-09-18. All three had drifted, and the count was one short. Re-read at `f84e931`.)_
