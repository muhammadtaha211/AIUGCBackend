---
type: defect
status: verified
verified: 2026-09-19
method: 'read renderWaitView''s resumeAtMs branch (apps/web/src/lib/service-a-ui.ts, `if (job?.state === "queued" && job.resumeAtMs !== undefined) return { kind: "waiting", bar: { paused: false } };`) against deriveJobProgress (packages/core/src/jobs/queue.ts:360-361), which sets resumeAtMs from `job.runAt - now > JOB_DELAY_VISIBLE_MS` alone and carries no field saying WHY the job was rescheduled; and against [[0009-retry-backoff-is-invisible-to-the-customer]], whose text rules on retry backoff and never mentions budget parks. source: code — reasoned from these three reads, not observed on a parked render.'
source: code
---

# A budget-parked render says nothing, and nobody decided that

`renderWaitView` returns a running bar and no sentence for **any** queued job carrying
`resumeAtMs`. [[0009-retry-backoff-is-invisible-to-the-customer]] put that branch there on
2026-09-02, and for its own subject — a retry backoff, which "resumes by itself within
minutes" — it is right. But `resumeAtMs` does not say why a job was rescheduled:
`deriveJobProgress` derives it from `run_at` alone. So the branch also swallows a **budget
park**, where `BudgetError`'s default `resumeAt` is now + 1h
(`packages/core/src/jobs/errors.ts:42`) and a daily account cap can hold the job far longer.

A customer whose render is parked for hours therefore watches a bar that keeps moving and a
screen that never says anything is wrong. 0009 did not weigh that case — the word "budget"
does not appear in it, and its stated rule is "we report states the customer can act on or
should plan around", which a multi-hour park plainly is.

**Unreviewed, not fixed.** [[0060-a-short-retry-backoff-is-not-a-pause]] made the opposite
call for the analysis and plan waits the same week — short parks say nothing, parks beyond
`LONG_PARK_THRESHOLD_MS` (10 min) get an honest paused line — which is why the render surface
now differs from the other two. Closing the gap would mean splitting renderWaitView's single
`resumeAtMs` branch on the same threshold and giving the long side a sentence; whether
renders should carry one at all is the founder's call, not a defect fix, because 0009 is a
founder decision and its scope stops short of this.

## Related

- [[0009-retry-backoff-is-invisible-to-the-customer]] — the decision whose scope this falls
  outside
- [[0060-a-short-retry-backoff-is-not-a-pause]] — the analysis/plan ruling this surface has
  not had
- [[render-wait-elapsed-resets-on-reclaim]] — the render wait's other open defect
