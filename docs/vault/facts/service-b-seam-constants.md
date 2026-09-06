---
type: fact
status: verified
verified: 2026-09-06
method: "constants read off packages/remotion/src/timing.ts (SEAM_DISSOLVE_FRAMES), packages/core/src/pipelines/renders.ts (HEAD_BOX, GRADE_SERIES_FRAMES, ALIGN_MAX_PX) and packages/core/src/media/grade.ts (GRADE_STEP_MS, GRADE_LOCK_MS, GRADE_BLEND_MS); the 8px offset measured with a ±4px-step sum-of-absolute-differences search on the quarter-size luma of the two cut frames of the 2026-09-06 re-render (the same search `alignmentOffset` now runs); the overscan headroom for a constant offset measured by packages/remotion/.work/align-margin.ts (the coverage test's inverse transform, 2 seeds × 3600 frames) and pinned in packages/remotion/test/timing.test.ts"
source: code
---

# The Service B seam — what is measured per render, and the one number that is chosen

Retired 2026-09-06 ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]): Service B is one HeyGen clip and has no seam. As it stood: the cut from the opener's reveal frame into the talking head was a hard cut between two things measured per render and applied by the composition; the measurements below stay true and the code stays in the tree until a task removes it. Nothing else moves at it
([[0021-nothing-moves-at-the-service-b-seam]]).

## Measured per render (`buildServiceBProps`) — colour and position only on the opener path, retired 2026-09-06; the range tag still runs on every clip

| what                          | where measured                                                                                     | applied as                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| colour (`talkingHeadGrade`)   | head box, `crop=iw/2:ih*2/5:iw/4:ih/10`; opener reveal frame vs the head's first 180 source frames | per-channel gains every 100ms, locked 2000ms, eased 500ms into the median of the rest — SVG `feColorMatrix` (sRGB) |
| position (`talkingHeadAlign`) | quarter-size luma, ±20px search, 4px grain                                                         | a constant translate on the head for its whole length                                                              |
| range tag                     | `retagIfUntagged`                                                                                  | BT.709 limited on the stored clip                                                                                  |

The alignment answer is used only inside `ALIGN_MAX_PX` = 12px horizontally / 32px vertically —
what `OVERSCAN` 1.06 hides under the sway; a larger answer is a mismatch, not a correction. On
the first real render's take the head sat **8px above** the opener's last frame with the colours
already matched, and that alone read as a jump cut; on the 2026-09-06 assets the search answers
4px.

Because the offset holds for the whole clip, every frame needs that much overscan left after
the sway and its rotation, in picture px (the translate sits inside `scale(OVERSCAN)`, where
1.06 leaves 30.6px horizontally / 54.3px vertically before any motion). Measured 2026-09-06 with
the coverage test's own inverse transform (`packages/remotion/.work/align-headroom-seeds.ts 300
3600`): over **300 random UUID seeds × 3600 frames** the tightest frame left **13.5px
horizontally and 42.3px vertically**; **65 seeds dipped under 16px**, none under 12, none under
32 vertically. The cap was 16 that morning — a legal answer that would have shown ~2px of black
at one edge on those frames — and is **12** since (the search answers in 4px steps, so 12 is the
next legal value). `timing.test.ts` pins ≥12 / ≥32 on three seeds: the two render ids and the
tightest random one (`c1b200d8…`). Found by the 2026-09-06 diff review, reproduced twice.

## Chosen

| constant               | value | what it does                                                                                      | provenance                                                                    |
| ---------------------- | ----- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `SEAM_DISSOLVE_FRAMES` | 0     | frames of opacity ramp on the head while the opener holds its last frame underneath; 0 = hard cut | **founder-decided** 2026-09-06 ([[0021-nothing-moves-at-the-service-b-seam]]) |

`ALIGN_EASE_MS` (1500ms, the alignment slide easing back to 0) was deleted the same day under
the same decision.

## What was tried and zeroed (2026-09-06)

A 4-frame (133ms) soft cut and a 1.5s ease on the alignment — reasoned, never measured — were
rendered once (`.work/seam-handover/last-render-2026-09-06.mp4`) and judged by the founder: "I
still see a jump and there's now a weird transition animation." The soft cut was not the 5-frame
dissolve deleted on 2026-09-05 (that one straddled a moving hand and a punch-in); it blended two
settled, aligned, graded stills — and still read as an animation on top of the jump, not instead
of it.

## Not measured

Answered 2026-09-06: the founder watched the hard-cut re-render, still saw a jump, and retired the opener path ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]) — the residue is closed by construction, one clip and no seam. The founder judges the
hard-cut re-render of the same take (`.work/seam-handover/hardcut/rerender-opener-new-2700.mp4`).

## Related

- [[0021-nothing-moves-at-the-service-b-seam]] — the decision this note now records
- [[heygen-idle-frame-is-darker-than-its-reference-and-its-talking-frames]] — why the colour is a curve
- [[handheld-sway-constants]] — the overscan the alignment offset lives inside
- [[0017-service-b-single-setting-selfie-talking-head]] — the hard cut, restored on 2026-09-06 and retired with the opener the same day ([[0023-hook-is-a-remotion-animation-opener-clips-retired]])
- [[alignment-search-is-whole-frame-and-leaves-the-face-4px-off]] — why the 4px answer still leaves a face jump
- [[heygen-head-moves-before-speech-onset]] — the cut lands on the last still frame of the head
