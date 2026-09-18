---
type: decision
status: verified
verified: 2026-09-18
method: "session task brief, quoting the founder having seen it twice in one session: 'the founder saw it twice in one session and it read as a fault.' Gate implemented as a new view-only LONG_PARK_THRESHOLD_MS = 10 * 60_000 in apps/web/src/lib/service-a-ui.ts, applied to analysisWaitView's and planWaitView's resumeAtMs branches; core's JOB_DELAY_VISIBLE_MS (packages/core/src/jobs/queue.ts, 60_000) is unchanged, per explicit task constraint. Tests: 'a short retry backoff reads as ordinary waiting' and 'the paused line only fires once the park exceeds the threshold' in apps/web/test/service-a-ui.test.ts."
source: founder
---

# 0060 — A short retry backoff is not a pause; only a genuinely long park is

## The decision

`analysisWaitView` and `planWaitView` only show the "מושהה" (paused, will resume
automatically) sub-line when a queued job's `resumeAtMs` sits more than
`LONG_PARK_THRESHOLD_MS` (10 minutes) in the future. Under that, the job reads as ordinary
waiting — the same queue-position copy (or, for the plan wait, the plain "ממתינה בתור" line)
it would show with no `resumeAtMs` at all.

## Why

Core's `deriveJobProgress` sets `resumeAtMs` whenever a queued job's `run_at` is more than
`JOB_DELAY_VISIBLE_MS` (60s) out — that threshold exists to hide only the first, near-instant
retry attempt, not to distinguish a 90-second transient-failure backoff from an hours-long
budget park. Both `analysisWaitView` and `planWaitView` treated every `resumeAtMs` the same
way: an ordinary retry backoff got the identical "paused" copy a multi-hour park would. The
founder saw this read as a fault twice in one session (2026-09-18).

## This call was already made once, for renders — and diverges here on purpose

[[0009-retry-backoff-is-invisible-to-the-customer]] made the equivalent call for
`renderWaitView` on 2026-09-02: a backoff-parked render says **nothing at all**, ever — no
sentence, bar kept running. That decision never propagated to the analysis/plan wait views,
which is the defect this note and [[0059-the-wait-clock-counts-from-the-request-row-not-the-job]]
close.

This decision does **not** copy 0009's answer exactly. A render's backoff is bounded by its
retry policy (seconds to a few minutes between attempts, exhausting into a terminal failure);
analysis and plan jobs can be parked by the per-account daily LLM budget for HOURS
(`assertAccountBudget`, `platform_budget_tripped`). Saying nothing at all, the way
`renderWaitView` does, would hide a real multi-hour park behind a cheerful, endlessly-spinning
wait card — worse than the flicker it would replace. So the fix here is a threshold, not
silence: short parks read as ordinary waiting, long parks still get the honest "paused" line.
The task brief that commissioned this fix said the same thing explicitly: "Keep the line for
real parks. A four-hour budget park under a cheerful spinner is worse."

## Why a new view-only constant, not JOB_DELAY_VISIBLE_MS itself

`JOB_DELAY_VISIBLE_MS` (`packages/core/src/jobs/queue.ts`) is what makes `resumeAtMs` appear
on the wire at all, for every wait surface — analysis, plan, render, and anything future.
Raising it would also delay when the customer sees the honest "not runnable right this
second" signal on jobs this session never touched, and it lives in `packages/core/src/jobs/queue.ts`,
which this task was explicitly forbidden from editing. `LONG_PARK_THRESHOLD_MS` is a
distinct, larger threshold that decides only whether the VIEW narrates a visible-but-short
park as a pause — the fix belongs there, per the task brief's own instruction.

## Why 10 minutes

Set directly by the task brief ("resumeAtMs more than 10 minutes out"), not independently
derived or measured. No vault fact backs the number itself; it is a founder-specified
threshold, not a calibrated one.

## Options considered

- **Show "מושהה" for any resumeAtMs (status quo).** Rejected — the measured defect.
- **Show nothing for a parked job, mirroring 0009 exactly.** Rejected — analysis/plan parks
  can run hours longer than a render's retry backoff; silence there hides a real park.
- **Raise core's JOB_DELAY_VISIBLE_MS.** Rejected — shared by every surface, would delay
  the "not runnable now" signal broadly, and out of this task's file scope.
- **A new, larger, view-only threshold (LONG_PARK_THRESHOLD_MS) gating only the paused
  sub-line.** Chosen.

## Related

- [[0009-retry-backoff-is-invisible-to-the-customer]] — the render precedent, and where this
  decision diverges from it
- [[0059-the-wait-clock-counts-from-the-request-row-not-the-job]] — the other half of the same
  session's fix
