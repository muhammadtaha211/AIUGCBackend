---
type: decision
status: verified
verified: 2026-09-19
method: "session task brief directed the fix and named the source ('demo_analyses.created_at is the obvious source; decide and justify, do not invent a new job field'); confirmed by reading packages/core/src/pipelines/demo-analysis.ts's handleAnalyzeDemo (the demo_analyses row is inserted once, on the first attempt, and its id is checkpointed onto job.state.analysisId — a retry of the SAME job reuses the row and never re-inserts) and demo-step-plans.ts's requestDemoPlan (the demo_step_plans row is inserted synchronously in the POST route handler, before the job is even enqueued). Landed in apps/web/src/lib/service-a-ui.ts (analysisWaitView, planWaitView), apps/web/src/lib/service-a.ts (stepPlanResponse), apps/web/src/app/api/demos/[id]/analysis/route.ts, apps/web/src/app/api/demos/[id]/plan/route.ts and apps/web/src/components/a-wizard/step-plan.tsx; tests in apps/web/test/service-a-ui.test.ts and service-a.test.ts. Server-side-subtraction correction re-verified 2026-09-19 against step-plan.tsx:1 ('use client')."
source: founder
---

# 0059 — The customer-facing wait clock counts from the request row, not the job

## The decision

`analysisWaitView`'s and `planWaitView`'s "רץ כבר X" line now shows wall clock since the
DOMAIN ROW was created — `demo_analyses.created_at` for the analysis wait,
`demo_step_plans.created_at` for the plan wait — instead of core's `JobProgress.elapsedMs`.

**The subtraction happens on the server.** Each route differences the row's `created_at`
against its own `now` and sends the result as a duration — `requestedElapsedMs` on the
analysis GET body, and on `StepPlanWire` via `stepPlanResponse`. The views receive a number,
never a timestamp. The first cut of this fix (commit `4917043`) sent the ISO string and
subtracted in the view, which runs in the browser under `"use client"` — a client clock
behind the server's would have pinned the line at "פחות מדקה" for as long as the skew lasted.
Corrected in `7c93160`.

When the server sends no number, the views show **no number** — there is no fallback to
`job.elapsedMs`. A missing number beats a decreasing one, and `job.elapsedMs` is the
decreasing one. `JobProgressWire` is untouched: core's per-job figure stays exactly as it is
for logs and admin.

## Why job.elapsedMs was wrong

`deriveJobProgress` (`packages/core/src/jobs/queue.ts`) computes a RUNNING job's `elapsedMs`
as `now - (job.lockedAt ?? job.createdAt)`. `lockedAt` is refreshed at every claim — so a job
retried after a transient failure reports elapsed time since its MOST RECENT claim, not
since the customer's request. Measured consequence: a real 8-minute wait, on a job's third
attempt, displayed "רץ כבר פחות מדקה" ("running for less than a minute").

## Why the domain row's createdAt, not job.createdAt

`job.createdAt` (the job row's own insert time) is also stable across retries of the same
job — `failTransient` reschedules `run_at` without touching `created_at`. It looked like the
simpler fix. It was rejected for one concrete reason: **`JobProgress`/`JobProgressWire` never
exposes it.** The wire type carries only the derived, state-dependent `elapsedMs` — there is
no raw `createdAt` field a RUNNING payload could read. Adding one would mean changing core's
`JobProgress` shape and `deriveJobProgress` in `packages/core/src/jobs/queue.ts` — the one
file this task was explicitly forbidden from touching, and for good reason: that type is
shared by every wait surface (analysis, plan, render, ingest), so widening it is not a
one-view change.

The demo_analyses / demo_step_plans rows sidestep this entirely: the analysis and plan routes
already load the row to answer the GET, so `row.created_at` costs nothing extra to expose,
and it needs no core change, no new job field, and no migration.

## Why not a new job field (the option the brief pre-empted)

A dedicated "requested_at" column on `jobs` would duplicate information the domain row
already carries faithfully. It would also need to decide what a manual re-run means (a
founder re-run enqueues a genuinely NEW job under `analyze:{demoId}:r{n}` — see
`requestDemoAnalysis` — with its own fresh row); the domain row already draws that line
correctly by construction, since a re-run also gets a fresh `demo_analyses` row via the same
per-job `job.state.analysisId` checkpoint mechanism that keeps a RETRY's row stable. Nothing
new to invent, nothing new to keep in sync.

## A caveat this decision accepts, deliberately

`demo_analyses.created_at` is stamped when the first attempt STARTS running and inserts the
row — not when the job was originally enqueued. If a demo sits queued for minutes before its
first claim, the customer-facing clock under-counts that wait by that amount once it starts
showing a number. This is judged acceptable: the QUEUED branch shows no elapsed number at all
(only queue position or nothing), so the gap is invisible until the job is actually running,
at which point the row exists and the anchor is exact from then on and never resets again —
which is the property the founder's bug report was actually about.

`demo_step_plans.created_at` has no such gap: `requestDemoPlan` inserts the row synchronously
in the POST route, before the job is enqueued, so it equals the request moment exactly.

## Options considered

- **job.elapsedMs (status quo).** Rejected — the measured defect.
- **job.createdAt, exposed through JobProgress.** Rejected — requires a core/queue.ts change
  out of scope, and widens a type shared by every wait surface for one view's benefit.
- **A new `jobs.requested_at` (or similar) column.** Rejected — duplicates the domain row,
  needs a migration (out of scope), and has to re-solve the "what counts as a new request"
  question the domain row already answers.
- **The domain row's own createdAt (demo_analyses / demo_step_plans), differenced on the
  server and sent as a duration.** Chosen — no core change, no migration, exact for plans,
  close enough for analysis, and immune to the customer's own clock.

## Related

- [[0060-a-short-retry-backoff-is-not-a-pause]] — the other half of the same session's fix
- [[render-wait-elapsed-resets-on-reclaim]] — the same defect, unfixed, in renderWaitView
- [[render-wait-says-nothing-about-a-long-budget-park]] — the render wait's other open gap
