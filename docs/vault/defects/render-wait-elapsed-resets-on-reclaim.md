---
type: defect
status: verified
verified: 2026-09-18
method: "code trace of renderWaitView's running branch (apps/web/src/lib/service-a-ui.ts:1325, `job.elapsedMs !== undefined ? fmtElapsedHe(job.elapsedMs) : undefined`) against core's deriveJobProgress (packages/core/src/jobs/queue.ts:365-372), which sets a RUNNING job's elapsedMs to `now - (lockedAt ?? createdAt)` — lockedAt is refreshed on every re-claim, so a job that failed transiently and got re-claimed reports elapsed since the NEW claim, not since the render was requested. Same mechanism as the analysisWaitView/planWaitView defect fixed this session ([[0059-the-wait-clock-counts-from-the-request-row-not-the-job]])."
source: code
---

# renderWaitView's "רץ כבר X" also resets on a retry re-claim

`renderWaitView`'s rendering-stage elapsed line reads `job.elapsedMs` directly
(`apps/web/src/lib/service-a-ui.ts:1325`), exactly the field
[[0059-the-wait-clock-counts-from-the-request-row-not-the-job]] stopped
`analysisWaitView`/`planWaitView` from using: core's `deriveJobProgress` computes a RUNNING
job's `elapsedMs` as `now - job.lockedAt`, which is refreshed at every re-claim. A render
that fails transiently and gets picked up again on a third attempt will show a small
elapsed number even if the customer has genuinely been waiting many minutes across the
retries.

**Not fixed here — out of scope for this session's task**, which named only
`analysisWaitView` and `planWaitView`. `video_renders.created_at` is the equivalent
wall-clock anchor (mirroring `demo_analyses.created_at` / `demo_step_plans.created_at`) and
is already available to `apps/web/src/app/api/renders/[id]/route.ts`, which already loads the
render row — the fix shape would be the same `requestedAt` parameter added to
`renderWaitView`, threaded from that route.

One reason this may matter less in practice: `renderWaitView`'s percent (`job.progress`,
the checkpointed frame-loop fraction) is cleared on every retry attempt by
`handleRenderVideo`'s `ctx.checkpoint({})` (see the "percent is never invented and never
latched" test in `apps/web/test/service-a-ui.test.ts`), so a retried render already shows an
indeterminate bar rather than a specific percentage — the elapsed sentence is the one
remaining number that can read smaller than reality.
