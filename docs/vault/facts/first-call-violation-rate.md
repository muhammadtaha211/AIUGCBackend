---
type: fact
status: verified
verified: 2026-08-23
method: "count and time usage_events per plan_demo_steps job id (packages/core/.work/vault-firstcall.ts and vault-audit-followup.ts, read-only), read against the one-call-plus-one-retry structure at packages/core/src/pipelines/demo-step-plans.ts:1035-1082"
source: db
---

# No plan job on record has ever passed the validator on its first model call

## Why the call count is the measurement

`generateStepPlan` makes **at most two model calls, ever**. `callOnce`
(`packages/core/src/pipelines/demo-step-plans.ts:1035-1047`) is the only thing that calls Claude in
this path, and it writes exactly one `usage_events` row per call. The flow is: call 1 →
`findPlanViolations` → if non-empty, **one** corrective re-request naming the violations → check
again → `PermanentError`. There is no third call; the code comment at `:1057-1062` says so
explicitly.

So the number of `llm_tokens` rows carrying a job's id tells you what happened:

- **1 row** → the first call satisfied the validator.
- **2 rows** → the first call violated it and the corrective retry ran.

Row count alone is _not_ airtight: `demo-step-plans.ts:1031-1034` documents that a `BudgetError` on
the second call parks the job, and the resume re-runs the **first** call — which would also leave two
rows, across two executions. What closes it is the timing (below).

## The count

16 `plan_demo_steps` jobs have run. **Zero recorded one call.**

| calls | jobs |
| ----- | ---- |
| 2     | 15   |
| 3     | 1    |

The 15 two-call jobs all have `attempts = 0`, so each is one clean pass through
`generateStepPlan`: **15 of 15 first calls violated the validator.** The sixteenth (`50f676a7`)
has `attempts = 1` and 3 calls — a job-level retry, so its calls do not decompose cleanly, but its
final attempt also needed a corrective call.

### The timing rules out the park-and-resume alternative

For all 15 single-attempt jobs the two calls are **5.4 to 14.1 seconds apart**. A parked job
rechecks hourly, so a park-and-resume would show a gap of at least an hour, not eight seconds. The
outlier proves the contrast: `50f676a7`, the one `attempts = 1` job, spans **1,855.7 s** across its
three calls — and its `jobs.last_error` says why:
`lease expired: worker died mid-run (was locked by cli:light)`
([[worker-exits-on-a-dropped-connection]]).

Second confirmation: **every second call is larger than its first**, in all 15 — e.g.
22,540 → 23,287 and 29,063 → 30,226 tokens. That is what the corrective prompt predicts, because it
re-sends the base text _plus_ the rejected plan _plus_ the violation list
(`demo-step-plans.ts:1064-1067`). A re-run of the first call would be the same size, not larger.

It holds across prompt versions and across outcomes. Successful plans recorded `@v2`, `@v9`, `@v10`
and `@v12`; all nine failed plans record `prompt_version = NULL` and are dated across the same
span. Every one of them, success and failure alike, took the retry.

### The qualifier that matters

"Every plan on record took the retry" is true of every **model-generated** plan — 7 of the
7 succeeded jobs. It is _not_ true of every `ready` row. Three of the ten
(`3cf2cc65`, `e57b3887`, `51d1ca47` — all `@v12`, all 2026-08-21, all approved) have **no job row
and zero `usage_events`**. They never made a first call to violate.

The table has only two insert sites: `demo-step-plans.ts:1155`, which always enqueues a job, and the
fork at `:1301`, a human edit to an approved plan that copies the parent's `promptVersion` and calls
no model. Barring hand-insertion — which this project has a history of — those three are forks.

## What this means

**The corrective retry is not a safety net, it is the mechanism.** Every plan the model has ever
produced went through it; the only `ready` rows that did not are human forks of a plan that did.
Any change that removes the retry, shortens it, or treats it as an exceptional path removes the only
thing that has ever produced a valid plan from scratch.

It also means the retry costs are not contingency — they are the baseline. A plan is ~2 calls and
~46k tokens, not ~23k.

## The 18/18 figure this replaces

An earlier session reported **18 of 18** first calls violating, across v10, v11 and v12, and
[[v10-is-the-last-working-prompt]] cites that number. It counted live `aiugc plan
regress` runs as well as job-backed ones. **The regress half is not re-derivable today**:
`generateStepPlan` takes `jobId` as an optional field (`:961`), and a regress run passes none, so
those `usage_events` rows land among the 291 with `job_id = NULL` and cannot be attributed. The
18/18 figure itself is therefore `carried`. What is measured here is the 16 job-backed runs, which
agree with it and were gathered independently.

## Nothing records which rule the first call broke

The _fact_ of the violation is reconstructible from the call count. **The violation text is not.**
`demo_step_plans` has no attempt column and no violation column; a plan that succeeded on the retry
is indistinguishable from one that succeeded outright.

There is one exception, and it only covers failures: a plan that violates _again_ after the retry
throws `PermanentError` at `demo-step-plans.ts:1076` with the violation list in the message, and
that lands in `jobs.last_error`. So for the nine failed plans the second-round violations are
durable; for the seven successes the entire violation history is gone.

Two consequences:

- This measurement exists by accident — each model call happens to write its own `usage_events`
  row. **If usage accounting is ever batched per job, the 15/15 becomes unrecoverable.**
- The cheap fix, if these numbers should be re-derivable in future, is a `retry_violations jsonb`
  column on `demo_step_plans` written on both the success and failure paths. Not more log lines:
  the failure text is already logged and the success text is what is missing.

## Re-measure with

```
apps/cli/node_modules/.bin/tsx packages/core/.work/vault-firstcall.ts
```
