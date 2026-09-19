---
type: defect
status: verified
verified: 2026-09-19
method: 'read renderWaitView''s resumeAtMs branch (apps/web/src/lib/service-a-ui.ts, `if (job?.state === "queued" && job.resumeAtMs !== undefined) return { kind: "waiting", bar: { paused: false } };`) against deriveJobProgress (packages/core/src/jobs/queue.ts:360-361), which sets resumeAtMs from `job.runAt - now > JOB_DELAY_VISIBLE_MS` alone and carries no field saying WHY the job was rescheduled; and against [[0009-retry-backoff-is-invisible-to-the-customer]], whose text rules on retry backoff and never mentions budget parks. Budget attribution and queue consequences added 2026-09-19 from packages/core/src/budget.ts:25-48 and :50-57, jobs/worker.ts:141-143 and :259, jobs/queue.ts:134-135, pipelines/renders.ts:145-154, pipelines/demo-analysis.ts:543-550, :668, :990, and apps/web/src/app/home/renders-strip.tsx:85-86. source: code throughout — every claim in this note is read out of the tree, none of it observed running; see "What has NOT been measured" below.'
source: code
---

# A budget-parked render says nothing, and nobody decided that

`renderWaitView` returns a running bar and no sentence for **any** queued job carrying
`resumeAtMs`. [[0009-retry-backoff-is-invisible-to-the-customer]] put that branch there on
2026-09-02, and for its own subject — a retry backoff, which "resumes by itself within
minutes" — it is right. But `resumeAtMs` does not say why a job was rescheduled:
`deriveJobProgress` derives it from `run_at` alone. So the branch also swallows a **budget
park**, where `BudgetError`'s default `resumeAt` is now + 1h
(`packages/core/src/jobs/errors.ts:42`) and the cap can hold the job far longer.

A customer whose render is parked for hours therefore watches a bar that keeps moving and a
screen that never says anything is wrong. 0009 did not weigh that case — the word "budget"
does not appear in it, and its stated rule is "we report states the customer can act on or
should plan around", which a multi-hour park plainly is.

## Which cap parks it — corrected 2026-09-19

An earlier revision of this note said "a daily account cap". Wrong, and the two caps behave
in opposite ways, so the correction matters. The park comes from `assertBudget`'s
PLATFORM-WIDE rolling-24h cap (`packages/core/src/budget.ts:25-48`) — the file's own header
calls these "Hard platform-wide spend caps, per provider unit, over a rolling 24h window" —
and its query has no account or business predicate anywhere in it:

```ts
const rows = await db
  .select({ used: sql<string>`coalesce(sum(${usageEvents.quantity}), 0)` })
  .from(usageEvents)
  .where(
    and(
      eq(usageEvents.kind, kind),
      gt(usageEvents.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
    ),
  );
```

`budget.ts:46` is the only `throw new BudgetError` in the tree, and `BudgetError` is the only
error that reaches `parkForBudget` (`packages/core/src/jobs/worker.ts:141-143`). The
per-account ceiling throws `AccountBudgetError` instead, which **deliberately never parks**:
`budget.ts:50-57` says "Deliberately NOT a BudgetError: that one parks the job and resumes
when the window frees, which is right for a capacity ceiling and wrong for an abuse ceiling
— a parked TTS job leaves the wizard spinning forever". Both call sites convert it to a
`PermanentError` carrying a Hebrew customer message (`demo-analysis.ts:543-550`,
`renders.ts:145-153`). A render reaches the parking cap at `renders.ts:154`,
`await assertBudget(ctx.db, "gpu_seconds")`.

The defect itself is unchanged by this: a park can hold a render for hours either way.

## What a park actually implies for the rest of the queue

A parked job does **not** block the lane. `claim()` selects
`where status = 'queued' and run_at <= now() … order by run_at`
(`packages/core/src/jobs/queue.ts:134-135`), so a row parked an hour out is simply skipped
and the next runnable job goes.

What propagates instead is the cap itself. Because it is global, every job of the SAME usage
kind parks in turn as it is claimed and throws — `gpu_seconds` for renders
(`renders.ts:154`), `llm_tokens` for `analyze_demo` (`demo-analysis.ts:668`, `:990`). The
lane is mixed: `HEAVY_JOB_TYPES` is `["render_video", "lipsync", "analyze_demo"]`
(`packages/core/src/jobs/worker.ts:259`), so a queued analysis sitting behind a parked render
counts against a different 24h counter and runs normally.

**Observation, recorded not fixed:** `apps/web/src/app/home/renders-strip.tsx:85-86` comments
"The lane is sequential, so a parked or unclaimed head means nothing behind it is moving
either — every tile stops sweeping, not just the head's." That is wrong for the PARKED case,
for the two reasons above: the park does not block the lane, and a same-lane job of another
usage kind keeps running. It is harmless today only because a park returns
`bar: { paused: false }`, so `sweeping` never actually turns off for one — the comment's
other case, an unclaimed (stale-heartbeat) head, is sound. The comment is left as it is;
whoever fixes this defect should revisit it in the same pass.

**Unreviewed, not fixed.** [[0060-a-short-retry-backoff-is-not-a-pause]] made the opposite
call for the analysis and plan waits the same week — short parks say nothing, parks beyond
`LONG_PARK_THRESHOLD_MS` (10 min) get an honest paused line — which is why the render surface
now differs from the other two. Closing the gap would mean splitting renderWaitView's single
`resumeAtMs` branch on the same threshold and giving the long side a sentence; whether
renders should carry one at all is the founder's call, not a defect fix, because 0009 is a
founder decision and its scope stops short of this.

## What has NOT been measured

Every claim above is `source: code` — read in the tree on 2026-09-19, not observed running.
No render was parked and no browser was involved. Specifically unmeasured:

- **That a real budget park produces `resumeAtMs` on the renders payload.** Reasoned from
  `parkForBudget` setting `run_at` to `now + 1h` and `deriveJobProgress` emitting
  `resumeAtMs` past `JOB_DELAY_VISIBLE_MS` (60s). Never seen on a live response body.
- **The `ahead` value a parked render actually reports.** `getJobProgress` counts same-lane
  rows with `run_at < job.runAt` plus everything running
  (`packages/core/src/jobs/queue.ts:433-437`), which for a park an hour out is potentially
  every queued job in the lane — but no such payload has been read.
- **The appearance of any `bar: { paused: true }` state.** The dot, chip text and tile
  shimmer were traced through `renders-strip.tsx` and `render-tile.tsx`, never seen on
  screen. Note this state does not arise from a park at all (a park returns
  `paused: false`); it comes from a stale heartbeat or a missing job.

## Related

- [[0009-retry-backoff-is-invisible-to-the-customer]] — the decision whose scope this falls
  outside
- [[0060-a-short-retry-backoff-is-not-a-pause]] — the analysis/plan ruling this surface has
  not had
- [[render-wait-elapsed-resets-on-reclaim]] — the render wait's other open defect
