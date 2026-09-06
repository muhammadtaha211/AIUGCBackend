---
type: defect
status: verified
verified: 2026-09-06
method: "two cut frames of the 2026-09-06 assets (opener-9721de19.mp4 frame 80 at 2.667s; talking-head-limited.mp4 source frame 14 at 0.560s, the frame trimBefore 17 shows) extracted by index, luma compared at 1px steps on a face crop and on the quarter-size whole frame `alignmentOffset` searches (packages/core/src/media/ffmpeg.ts:293-319, SCALE 4, RANGE 5); found by a workflow finder and reproduced by an independent verifier with its own script (scratchpad wf/align-verify/verify.py)"
source: code
---

# The alignment search is whole-frame at 4px grain, and its answer leaves the face 4px off at the cut

Retired 2026-09-06 with the opener ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]); kept for the record. `alignmentOffset` (called from `buildServiceBProps` only when a render has an opener) searches a ±20px window at 4px steps on the quarter-size luma of the whole frame. On the 2026-09-06 take:

| what                                   | offset (dx, dy) | face MAD |
| -------------------------------------- | --------------- | -------- |
| unaligned                              | (0, 0)          | 15.31    |
| what the search returns and applies    | (0, +4)         | 12.13    |
| what the face alone needs (1px search) | (−3, +8)        | 9.93     |

The whole-frame minimum is flat — 10.44 at the chosen offset against 10.49 unshifted, 0.5%
better than doing nothing — because the wall and the torso do not want the same shift as the
face, and at quarter size a 4px step is one pixel. After the applied (0, +4) the face still
sits **4px up and 3px right** of the opener's face on the cut frame, above the 1px-per-frame
threshold a viewer notices as a jump cut. The whole-frame residue itself is the two generations
disagreeing region by region; only the face can be made to land, and it is where the cut is
judged (`renders.ts` HEAD_BOX comment).

## Not fixed, and the cheapest fix

Not fixed, and moot: the founder judged the hard cut, still saw a jump, and retired the opener and the alignment with it on 2026-09-06 ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]). The head-box 1px search below was the cheap fix while a seam existed; nothing calls for it now. The cheap fix
is one measurement change, no composition change: search on the head box (`HEAD_BOX`, the crop
the grade already uses) at 1px grain instead of the whole frame at 4px — pass the crop into
`alignmentOffset`, SCALE 1, RANGE ~12 — so the face lands within a pixel; the background then
mismatches by a few pixels more, which is the property of the sources. `ALIGN_MAX_PX` and the
overscan headroom ([[service-b-seam-constants]]) already cover a (−3, +8) answer.

## Related

- [[service-b-seam-constants]] — the 8px/4px whole-frame answers this note explains
- [[heygen-head-moves-before-speech-onset]] — the other confirmed discontinuity on the same frame
- [[0021-nothing-moves-at-the-service-b-seam]]
