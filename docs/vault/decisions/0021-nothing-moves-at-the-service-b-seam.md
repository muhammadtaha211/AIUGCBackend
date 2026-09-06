---
type: decision
status: superseded
verified: 2026-09-06
method: "founder in chat, 2026-09-06, on .work/seam-handover/last-render-2026-09-06.mp4: 'I still see a jump and there's now a weird transition animation' — he asked whether HeyGen's dimensions differ from the opener's (they do not: both probe 1080×1920) — then the instruction to set SEAM_DISSOLVE_FRAMES to 0 and make the alignment a constant offset, no ease"
source: founder
---

# 0021 — Nothing moves at the Service B seam but the camera

> **Superseded later the same day by [[0023-hook-is-a-remotion-animation-opener-clips-retired]]** — the opener clip is retired, so there is no
> seam: no cut, no grade, no alignment. The measurements ([[service-b-seam-constants]]) stay true; the
> constants below stay in the tree until a task removes them.

**Founder-decided.** The cut from the opener's reveal frame into the HeyGen talking head is a
hard cut. The talking head is colour-graded and pixel-aligned to the opener's reveal frame
(both measured per render — [[service-b-seam-constants]]), and that offset is constant for the
head's whole length. No dissolve, no opacity ramp, no ease, no punch-in: the only motion
crossing the cut is the shared handheld camera path ([[handheld-sway-constants]]).

## The options as they stood

1. Keep the 4-frame soft cut and the 1.5s alignment ease added that morning and tune their
   lengths.
2. Zero both — hard cut, constant offset — and judge the plain aligned, graded cut. **Chosen.**
3. Generate the HeyGen clip from the opener's reveal frame instead of the selfie, so both
   sides of the cut start from the same pixels. One paid HeyGen render (~₪3) to judge. Held as
   the next lever that morning; overtaken the same day — the founder's verdict on 2 was to retire the opener entirely ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]). Never built, never spent. Its best case was
   rendered for free the same night — a still of the selfie cut into the HeyGen clip generated
   from that selfie — and measured 5.9 luma levels at the cut against 6.3 for the real opener
   ([[heygen-idle-frame-is-as-far-from-its-own-input-as-from-the-opener]]): predicted not to
   close the seam. Not built, not spent.

## Why

The soft cut and the ease were added to hide the residue left after colour and position
matching (hair sheen, skin texture, a few levels of regional difference — measured in
[[heygen-idle-frame-is-darker-than-its-reference-and-its-talking-frames]]). The founder saw
them as an added "weird transition animation" on top of a jump that was still visible: motion
at the seam is itself the tell, whatever it is meant to cover. His earlier line stands — "if
there is not a way to turn [HeyGen's brightness change] off this whole service might not work,
I won't launch it like this" — and that is what ended the stitch: rather than keep matching, the founder retired the opener the same day ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]). The seam is gone, not fixed, and no longer blocks anything.

## Consequences in the tree

- `packages/remotion/src/timing.ts`: `SEAM_DISSOLVE_FRAMES` 4 → 0 (the plumbing — one prop and
  one opacity line in `ServiceB.tsx` — stays, at 0); `ALIGN_EASE_MS` deleted.
- `packages/remotion/src/ServiceB.tsx`: `talkingHeadAlign` is a constant translate.
- `packages/remotion/test/timing.test.ts`: the overscan coverage test also requires 12px / 32px
  of headroom on every frame for the constant offset, on three seeds; `ALIGN_MAX_PX.dx` went
  16 → 12 the same day once 300 random seeds showed 65 of them under 16px
  ([[service-b-seam-constants]]).
- The same HeyGen take re-rendered for free through this composition:
  `.work/seam-handover/hardcut/rerender-opener-new-2700.mp4` (gitignored), the file the founder
  judges next.

## Related

- [[service-b-seam-constants]] — the constants, and what was tried and zeroed
- [[0017-service-b-single-setting-selfie-talking-head]] — amended that morning (hard cut stands), then its opener half retired the same day by [[0023-hook-is-a-remotion-animation-opener-clips-retired]].
- [[0019-hook-text-outlives-the-reveal]] — the earlier half of the same rule: nothing is frozen
- [[heygen-idle-frame-is-darker-than-its-reference-and-its-talking-frames]] — why the grade is
  a curve, not a gain
