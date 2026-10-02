---
type: decision
status: verified
verified: 2026-10-02
method: "Founder decision in chat, 2026-10-02, relayed in that day's task prompt (section 2, D4); the reason is his. His two rulings on how it is met were given the same day in answer to two questions put to him before the plan was finalised (failed reads: 'Separate list'; the gate: 'Keep the gate'). Recorded on branch feat/analysis-footage-screens. BUILT on that branch 2026-10-02 (demo-analysis.ts recordFootage; pinned by packages/core/test/analysis-seam.test.ts). Migration 0050 was pushed to production 2026-10-02 on the founder's instruction; the worker box is not on the code yet."
source: founder
---

# 0080 — A moment is never dropped because its vision read failed

> **2026-10-02, later:** the box was pulled and restarted the same day (founder-reported), and the
> first production row was read back ([[box-and-local-instants-agree-2026-10-02]]). The line below
> about the box is the state when this note was written.

**DECIDED. BUILT 2026-10-02 (PR #78); migration 0050 pushed the same day; the worker box is not
on the code yet.**

## The decision (FOUNDER-DECIDED, D4)

A moment is never dropped because its vision read failed.

**His reason:** more moments over fewer ([[0075-more-moments-over-fewer]]). Two analyses lost 9
moments each to a collapsed batch, and one has two whole screens with no moment.

## Two rulings on how it is met (FOUNDER-DECIDED, 2026-10-02)

Both were put to him as questions because the brief contradicted itself.

1. **Failed-read moments go in a separate list, not into the `timeline` array.**
   - Options offered: a separate list in the new footage record, or into the timeline array (the
     literal wording of the task's done-when, "leaves every moment in the timeline").
   - **MEASURED in the code, why they cannot both hold with "nothing the customer sees changes":**
     a state with no vision fields inside the array changes its neighbours' clip lengths
     (`isNewScreen` reads a placeholder as a new screen on both sides), the refilm gate's
     fraction, and the plan model's prompt.
   - The done-when test is therefore written against the separate list.
2. **The degraded gate stays.** More than a quarter of the reads failed → the analysis fails with
   today's Hebrew message, as now; the moments are still recorded, on that path too.
   - Options offered: keep it, or lift it so the analysis lands ready with those moments
     unlabelled.
   - Told to him with it: keeping it still burns the recording in that case, which is what 0075
     argues against; lifting it is visible to the customer.

## What was measured for it, 2026-10-02

- **Today's behaviour, MEASURED in the code:** a frame missing after the corrective retry is
  re-sent alone once (the fill round, `175d3f7`, 2026-09-28); only a frame whose fill also fails is
  dropped, and it is then recorded nowhere on `demo_analyses`. The gate is strict:
  `dropped / kept > 0.25` fails the analysis and writes no timeline. No test pins the gate.
  [[a-vision-batch-can-collapse-and-survive-the-retry]] predates the fill round and now says so.
- **MEASURED:** a failed moment's thumbnail is already in storage: every kept frame is uploaded
  before any vision call.

## As built, 2026-10-02

- Every kept moment is in `demo_analysis_footage.moments`, with `read: false` on the ones whose
  vision read never came back. The `timeline` array still drops them, as before: the k-th moment
  with `read: true` is the k-th timeline state (test).
- **The gate is now pinned by tests, at its edge:** exactly a quarter of the reads lost lands
  ready; more fails with the same Hebrew message and no timeline. On both paths the moments are
  recorded.
- A legibility-rejected analysis records its moments too.

## Related

- [[0077-moments-keep-their-real-start-and-end]] — the same list.
- [[a-screen-missing-from-the-timeline-is-invisible-to-the-cut]]
