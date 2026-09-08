---
type: defect
status: verified
verified: 2026-09-08
method: 'read apps/web/src/lib/service-a-ui.ts:191-230 (analysisWaitView, no `missing` branch — the fallthrough at :228-229 returns ANALYSIS_QUEUED_LINE), apps/web/src/app/api/demos/[id]/analysis/route.ts:59-61 (no analysis row -> 200 {status:"missing", job}), and packages/core/src/pipelines/demos.ts:136,190 (enqueueAnalysis is called ONLY on the two ingest->ready transitions)'
source: code
---

# A demo with no analysis row reads as "queued for analysis" forever

`analysisWaitView` has branches for `failed`, `stale`, `running` and `queued`, then falls through:

```ts
// missing/done: enqueue race or a just-finished job — the next poll resolves.
return { kind: "waiting", line: ANALYSIS_QUEUED_LINE };
```

`ANALYSIS_QUEUED_LINE` is `"הסרטון בתור לניתוח — זה לוקח כמה דקות."` The comment states the
assumption exactly: `missing` is treated as a _transient_ state that the next 3s poll will resolve.

That assumption holds for a **ready** demo — `enqueueAnalysis` runs inside the same handler that
flips a demo to `ready` (`demos.ts:136` for the dry-run path, `:190` for the real one), so a ready
demo always has an analyze job, and `missing` there really is a race.

It does not hold for a demo that is **rejected or still ingesting**. Such a demo has no analysis row
and no analyze job — nothing ever enqueued one. The route answers `200 {status:"missing"}`, the job
lookup answers `state:"missing"`, `analysisWaitView` returns the queued line, and the surface polls
every 3 seconds forever showing a sentence that will never come true.

## Why this was invisible until 2026-09-08

`StepPlan` is the only consumer, and the A wizard only ever mounts it for a demo it just walked to
`ready` — the unreachable branch. `/home/demos/[demoId]` made the same component **URL-addressable**,
where a hand-typed id for a rejected or mid-ingest demo reaches it directly.

## Not fixed — worked around one level up

`apps/web/src/app/home/demos/[demoId]/demo-plan-editor.tsx` reads `status` from its header GET and
renders an honest card (the Hebrew reject reason, or "still processing") **instead of** mounting
`StepPlan` when the demo is not ready. The demo library's own button is gated on `status === "ready"`
(`demo-library.tsx`), so the URL was the only way in, and the guard closes it.

The guard is on the demo's KNOWN status, and the third state is what makes it hold: if that header
GET fails with anything other than 403/404 the status is unknown, and the page renders the header's
retry INSTEAD of `StepPlan` rather than mounting it on a guess. Mounting on unknown-status was the
hole — it would have reopened this defect through a transient network failure.

The defect itself is untouched, deliberately: fixing it means giving `analysisWaitView` a `missing`
branch, and that branch cannot be written honestly without knowing **why** it is missing — an enqueue
race (wait) versus a demo that will never have one (stop). Distinguishing them needs the demo's
status at the call site, which is a signature change on a function the wizard also calls. Not worth
it while the page-level guard covers every reachable path.

If a third surface ever mounts `StepPlan`, it must make the same check or re-open this.

## Related

- [[a-failed-businesses-query-reads-as-no-businesses]] — the same shape of bug: an absent thing
  rendered as a benign, self-resolving state.
