---
type: decision
status: verified
verified: 2026-10-02
method: "Founder decision in chat, 2026-10-02, relayed in that day's task prompt (section 2, D1, 'not up for relitigation'); the reason is his. Recorded on branch feat/analysis-footage-screens. BUILT on that branch 2026-10-02 (packages/core/src/pipelines/demo-analysis.ts recordFootage, analysis-screens.ts analysisMoments; pinned by packages/core/test/analysis-seam.test.ts 'the footage row at the production seam'). Migration 0050 was pushed to production 2026-10-02 on the founder's instruction (facts/production-migration-push-log.md); the worker box is not on the code yet."
source: founder
---

# 0077 — The analysis keeps each moment's real start and end

**DECIDED. BUILT 2026-10-02 (PR #78); migration 0050 pushed the same day. The box was pulled and
restarted the same day (founder-reported), and the first production row was read back
([[box-and-local-instants-agree-2026-10-02]]).**

> **2026-10-02, later:** the 2 s clip rule that was to need the spans does not read them
> ([[0084-clips-are-placed-from-the-footage-instants]] places from the instants). The spans are
> stored for every new analysis and read by nothing yet. The backfill for older analyses is built
> (`aiugc demo footage-backfill`) and not yet run
> ([[0081-existing-demos-keep-working-no-paid-re-analysis]]).

## The decision (FOUNDER-DECIDED, D1)

The analysis keeps each moment's real start and end.

**His reason:** they are computed and dropped today, and the fixed 2 s window
([[0076-every-step-is-a-fixed-2s-window-inside-its-screen]]) needs them.

## What was measured for it, 2026-10-02

- **MEASURED in the code:** `clusterStates` returns `startMs` and `endMs`
  (`packages/core/src/media/ffmpeg.ts`); `assembleTimeline` copies only `representativeMs`; the job
  checkpoint's `resumeKey` lists representatives only. So the bounds exist in memory at the final
  write and are stored nowhere.
- **MEASURED:** the bounds are the first and last 5 fps sample the cluster held, inclusive. The
  picture really stops up to one sample after `endMs`.
- **MEASURED:** a cluster span is not always where the picture holds. 12 of the 57 real screen
  changes move the shipped hash by 14 bits or fewer, the clustering's own same-state threshold, so
  a cluster can run straight across one ([[footage-screen-changes-2026-10-02]]). A reader that
  wants where the picture really holds has to cut the span at the instants either side of the
  moment; nothing does that yet.
- **MEASURED:** the box gives every re-upload of one file the identical kept list, in all 16
  production jobs; off the box the clustering does not reproduce
  ([[analysis-clustering-does-not-reproduce-across-machines]]). So the spans can only be captured
  on the box, at analysis time.

## Options

There was no menu. The founder decided it in chat and the day's task prompt relayed it.

## Proposed with it, approved 2026-10-02

Put to the founder in the plan and approved with it:

- The spans go in a new server-only table, `demo_analysis_footage`, one row per analysis, as
  `moments: { t, startMs, endMs, read }[]`, with the analysis `fps`. `demo_analyses.timeline` stays
  byte for byte what it is: it is a bare array that seven code paths parse and that plans index by
  position.
- A migration is needed (0050). Written 2026-10-02 on his approval
  ([[0083-no-model-names-the-instants-for-now]]). Later that day he instructed the session to
  push it and run the read-back; it was pushed and read back
  ([[production-migration-push-log]]).

## As built, 2026-10-02

- A new analysis writes one `demo_analysis_footage` row right before it lands ready, rejected or
  failed by the degraded gate: `fps`, `file_sha`, and `moments` with every kept moment's
  `startMs` and `endMs`, the first and last sample its picture held on.
- **Pinned by tests:** start ≤ timestamp ≤ end and no two spans overlap, for any hash sequence and
  at the handler; the same file analysed twice gives the same row; a failed write (the table not
  pushed yet) leaves the analysis ready exactly as before.
- Existing analyses have no row ([[0081-existing-demos-keep-working-no-paid-re-analysis]]).

## Related

- [[0080-a-moment-is-never-dropped-for-a-failed-read]] — the same list carries the failed reads.
- [[0078-screen-changes-come-from-the-footage-first]]
