---
type: decision
status: verified
verified: 2026-10-02
method: "Founder decision in chat, 2026-10-02, relayed in that day's task prompt (section 2, D1, 'not up for relitigation'); the reason is his. Recorded on branch feat/analysis-footage-screens. NOT YET BUILT: the helpers exist (packages/core/src/pipelines/analysis-screens.ts analysisMoments, momentHold) and nothing writes a span yet."
source: founder
---

# 0077 — The analysis keeps each moment's real start and end

**DECIDED, NOT YET BUILT.**

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
  a cluster can run straight across one ([[footage-screen-changes-2026-10-02]]). A span has to be
  clipped at the changes on either side of the moment: `momentHold`.
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
- A migration is needed (0050). **Not written yet**; it is pushed only on his instruction.

## Related

- [[0080-a-moment-is-never-dropped-for-a-failed-read]] — the same list carries the failed reads.
- [[0078-screen-changes-come-from-the-footage-first]]
