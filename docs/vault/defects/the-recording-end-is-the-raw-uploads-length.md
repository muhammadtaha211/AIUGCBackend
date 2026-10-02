---
type: defect
status: verified
verified: 2026-10-02
method: "Read in the code: recordingEndMs in packages/core/src/pipelines/demo-step-plans.ts takes demos.duration_ms, which packages/core/src/pipelines/demos.ts fills from the RAW upload's probe; the render clamps a step at the probed length of the NORMALIZED file (packages/remotion/src/ServiceASteps.tsx calculateServiceAStepsMetadata, packages/remotion/src/timing.ts serviceAStepsTimeline). Measured offline 2026-10-02 on the 7 local files by packages/core/.work/screens/clips-replay.ts and an inline script: Math.round(recordingEndMs*0.03) against the decoded frame count of each normalized file (events-<file>.json `frames`)."
source: code + inference
---

# The recording's end is taken from the raw upload's length, not the normalized file's

Found 2026-10-02 while building the 2 s clips
([[0084-clips-are-placed-from-the-footage-instants]]). **NOT FIXED.**

## What is true

- A clip is never placed past `recordingEndMs`: the raw upload's container length, floored to the
  0.2 s analysis grid, and never earlier than one sample after the last moment.
- The render clamps a step at the end of the **normalized** file. A clamped last step is cut
  short silently (a non-last one is logged).
- Nothing stores the normalized file's length. The footage row has no frame count.

## What was measured

On the 7 files, the recording end the plan code uses falls **0 to 5 frames before** the end of the
decoded normalized file: T1 3, T2 5, T3a 1, T3b 5, T3c 2, T4 0, T5 1. It is never past it. So no
clip placed by the rule is clamped on these recordings.

## What could go wrong

A file whose picture ends before its container says (an audio track that outlasts the video, for
one) would have a recording end past its decoded frames. A step placed at the very end would then
render fewer than 60 frames, and the total the wizard showed would be longer than the ad by the
difference. Not seen on any recording so far.

## What would close it

Storing the decoded frame count where the analysis already decodes every frame
(`frameSignatures`), which needs a column and so a migration, and bounding the placement by it.

## How to see it on real data

`aiugc demo footage-backfill` (report mode, on the box) prints, for every ready analysis it could
verify, the decoded frame count beside the frame the recording end falls on, and says when the
second is past the first. An analysis it skips prints only the reason.

## Related

- [[last-step-renders-shorter-than-the-wizard-promises]] — the earlier defect of the same family,
  fixed 2026-10-01 by flooring to the grid.
- [[clip-placement-replay-2026-10-02]]
