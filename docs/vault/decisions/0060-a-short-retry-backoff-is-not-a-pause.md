---
type: decision
status: verified
verified: 2026-09-19
method: "session task brief, quoting the founder having seen it twice in one session: 'the founder saw it twice in one session and it read as a fault.' Gate implemented as a new view-only LONG_PARK_THRESHOLD_MS = 10 * 60_000 in apps/web/src/lib/service-a-ui.ts, applied to analysisWaitView's and planWaitView's resumeAtMs branches; core's JOB_DELAY_VISIBLE_MS (packages/core/src/jobs/queue.ts, 60_000) is unchanged, per explicit task constraint. Relationship to 0009 re-read and corrected 2026-09-19 against 0009's own text (it rules on retry backoff; the word 'budget' does not appear in it) and against renderWaitView's single resumeAtMs branch at apps/web/src/lib/service-a-ui.ts, which deriveJobProgress feeds from run_at alone without recording the reschedule's cause. Reopen condition read off failTransient + backoffMs (packages/core/src/jobs/queue.ts:225,246) and jobs.max_attempts default 5 (packages/core/src/db/schema.ts:522). Tests: 'a short retry backoff says nothing at all', 'the paused line fires above the threshold and nowhere else' and 'LONG_PARK_THRESHOLD_MS sits between the two things it separates' in apps/web/test/service-a-ui.test.ts."
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

## This extends 0009 to analysis and plan — it does not reopen it

[[0009-retry-backoff-is-invisible-to-the-customer]] is titled "A job's retry backoff says
nothing to the customer", and that is precisely its scope: it ruled on **retry backoff**, on
the render surface, on 2026-09-02. It closes with "Anything that reintroduces per-attempt
commentary to the customer is reopening this decision." **0009 never ruled on budget parks —
not on renders, not on any surface.** The word does not appear in it; its reasoning is
explicitly about a backoff that "resumes by itself within minutes".

This decision applies 0009's rule to the two surfaces it never reached. After it (and the
routing fix that followed, commit `243c045`), no surface offers per-attempt commentary
anywhere:

- **renders** say nothing and keep the bar running (0009, unchanged);
- **analysis and plan** fall back to their standing queued line — `הסרטון בתור לניתוח…` and
  `התוכנית ממתינה בתור…` respectively.

Note the precise shape of that second case: analysis and plan are not _silent_. The queued
line is still on screen, as it is for any waiting job. What they no longer do is say anything
about the retry — no pause sentence, and (per `243c045`) no queue position or "building now"
either, because a rescheduled job is not in line and is not building. That is 0009's rule,
expressed in the copy these two surfaces already had.

## The one real divergence: long budget parks

`analysisWaitView` and `planWaitView` DO speak about a park beyond `LONG_PARK_THRESHOLD_MS`;
`renderWaitView` does not. This is a genuine difference between the surfaces, and it is
deliberate on the analysis/plan side: those jobs can be parked by the per-account daily LLM
budget for HOURS (`assertAccountBudget`, `BudgetError`'s default `resumeAt` is now + 1h,
`packages/core/src/jobs/errors.ts:42`). Hiding a multi-hour park behind a cheerful,
endlessly-spinning wait card is worse than the flicker 0009 removed. The task brief that
commissioned this fix put it directly: "Keep the line for real parks. A four-hour budget park
under a cheerful spinner is worse."

**`renderWaitView`'s silence on a long park is UNREVIEWED, not a decision.** 0009 removed one
`resumeAtMs` branch, and that single branch catches both causes — `deriveJobProgress` sets
`resumeAtMs` from `run_at` alone and never records why the job was rescheduled. So a
budget-parked render inherited backoff's treatment by construction, without anyone ruling on
it. Recorded as [[render-wait-says-nothing-about-a-long-budget-park]]; it is not fixed here
and this note does not decide it.

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

## What reopens this

The threshold only works while it sits in the gap between the deepest backoff a retry can
reach and the shallowest real park. Today that gap is wide: `failTransient` reschedules only
while `attempts + 1 < max_attempts`, so the deepest reachable failure count is
`max_attempts - 1` = 4, and `backoffMs(4)` is 240s + up to 10s of jitter. Even failure 5
(480s) stays under 10 minutes; failure 6 is the first to breach, because it hits `backoffMs`'s
own 15-minute ceiling.

So: **raising `jobs.max_attempts` to 7 or more reopens this decision** — at that point a
transient backoff becomes reachable above the threshold and would start reading as a pause,
which is exactly what this note forbids. Changing the `backoffMs` curve reopens it for the
same reason. Both are pinned by "LONG_PARK_THRESHOLD_MS sits between the two things it
separates" in `apps/web/test/service-a-ui.test.ts`, which fails if either moves.

## Options considered

- **Show "מושהה" for any resumeAtMs (status quo).** Rejected — the measured defect.
- **Say nothing about a parked job whatever its length, the way renderWaitView does.**
  Rejected — analysis/plan parks can run hours longer than a render's retry backoff, and a
  multi-hour park deserves a sentence. Note this was never 0009's ruling on parks; 0009 ruled
  on backoff only.
- **Raise core's JOB_DELAY_VISIBLE_MS.** Rejected — shared by every surface, would delay
  the "not runnable now" signal broadly, and out of this task's file scope.
- **A new, larger, view-only threshold (LONG_PARK_THRESHOLD_MS) gating only the paused
  sub-line.** Chosen.

## Related

- [[0009-retry-backoff-is-invisible-to-the-customer]] — the render ruling this extends to
  analysis and plan
- [[render-wait-says-nothing-about-a-long-budget-park]] — the unreviewed gap 0009 left on the
  render surface
- [[0059-the-wait-clock-counts-from-the-request-row-not-the-job]] — the other half of the same
  session's fix
