---
type: defect
status: verified
verified: 2026-09-05
method: "hand trace of packages/remotion/src/ServiceB.tsx's ms->frame conversions (msToFrame = round(ms/1000*30)) for the no-opener default (lipsyncStartFromMs 550, captionOffsetMs 250) and the opener fixture (reveal 3600, start 550, captionOffset 3850); surfaced by the 2026-09-05 six-lens review, both skeptics confirmed"
source: code
---

# The VO starts one frame after the lip-sync's speech onset on every default render

`serviceBTimeline` makes speech onset in the video and the mp3's first sample coincide **in
milliseconds**: the clip starts `leadInMs − GAP_MS` in and the VO starts `GAP_MS` after the
reveal. But `GAP_MS = 250` is 7.5 frames at 30fps, and the composition rounds each value to
frames **independently**, so the two half-frames add:

| render                      | clip shows speech onset (abs frame) | `<Audio>` starts (abs frame) |
| --------------------------- | ----------------------------------- | ---------------------------- |
| no opener, lead-in 800      | 7 (550ms → 16.5 → 17 trimmed)       | 8 (250ms → 7.5 → 8)          |
| opener fixture, reveal 3600 | 115                                 | 116 (3850ms → 115.5 → 116)   |

The lips move **one frame (33ms) before** the audio. Video-leads-audio is the less noticeable
direction and 33ms sits inside the ±45ms/−125ms band usually quoted for lip-sync
detectability, so no viewer is expected to see it — but it is systematic, on every render,
in a pipeline whose stated invariant is exact alignment.

## Why it is not fixed here

The two clean fixes are both founder calls, not engine calls:

- pick `GAP_MS` as a whole number of frames (233 or 267ms), which changes a constant chosen in
  chat ([[service-b-timeline-constants]]); or
- snap `lipsyncStartFromMs` to the frame grid inside `serviceBTimeline` before deriving
  `captionOffsetMs`, which puts the file's fps into a module that is fps-agnostic by design
  ("the composition converts to frames and does no timeline arithmetic of its own").

Either way the pin is one test: `msToFrame(captionOffsetMs) − msToFrame(revealAbsMs) ===
msToFrame(leadInMs) − msToFrame(lipsyncStartFromMs)` for the default lead-in.

## Related

- [[service-b-timeline-constants]] — where `GAP_MS` lives and why it is unmeasured
- [[heygen-avatar-iv-idles-on-leading-silence]] — the lead-in the gap is measured against
