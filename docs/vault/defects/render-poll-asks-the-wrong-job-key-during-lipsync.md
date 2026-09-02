---
type: defect
status: verified
verified: 2026-09-02
method: "code trace of the two enqueue sites (packages/core/src/pipelines/sets.ts:252,448 -> lipsync:<id>; packages/core/src/pipelines/renders.ts:313,322-327 -> render:<id>, enqueued only at the END of handleLipsync) against the key asked for in apps/web/src/app/api/renders/[id]/route.ts:45-48"
source: code
---

# GET /api/renders/[id] asks for the wrong job key during the lipsync phase

A render can have two jobs, and only one exists at a time. `createBRender` enqueues
`lipsync:<renderId>` (`sets.ts:448`); a Service A cell with an avatar outro does the same
(`sets.ts:252`). `render:<renderId>` is not enqueued until `handleLipsync` finishes
(`renders.ts:313` -> `enqueueRenderVideo`, `renders.ts:322-327`).

`apps/web/src/app/api/renders/[id]/route.ts:45-48` always asks `getJobProgress` for
`render:<id>`. So for the whole HeyGen phase — the long one — the poll returns
`{ state: "missing" }`, which is indistinguishable from a purged or never-enqueued job.
`handleLipsync` also never writes `video_renders.status`, so the row sits at the schema
default `queued` (`schema.ts:429`) throughout.

Consequences on the B wizard's render screen (`apps/web/src/components/b-wizard/step-render.tsx`):
it does not read `job` at all today, so it spins an unconditional `<Spinner />` (`:316`) over
a job that may be budget-parked for an hour (`BudgetError` default `resumeAt` is now+1h,
`packages/core/src/jobs/errors.ts:42`) or over a dead worker. Wiring `renderWaitView` into
that step without fixing the key would surface `state:"missing"` rather than the truth.

**Fixed in one place only.** `apps/web/src/app/api/businesses/[businessId]/renders/route.ts`
(the dashboard strip) resolves the live key: `render:<id>` first, falling back to
`lipsync:<id>` when the first is missing (`headProgress`). The per-render route was left
alone — it is a different surface with its own consumer, and changing it is its own task.

The client side is now defended either way: `renderWaitView` treats
`state:"missing"` with a heartbeat that is not `alive` as paused rather than as live work
(`apps/web/src/lib/service-a-ui.ts`, pinned by "a missing job with no live worker is paused,
not working" in `apps/web/test/service-a-ui.test.ts`). That stops the dashboard animating
over a dead worker, but it cannot tell a parked lipsync from a running one while a worker is
alive — only the key fix does that.

Related: [[worker-exits-on-a-dropped-connection]].
