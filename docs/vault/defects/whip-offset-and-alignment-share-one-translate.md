---
type: defect
status: verified
verified: 2026-09-06
method: "read: packages/remotion/src/ServiceB.tsx TalkingHead applies transform `translate(${dx + offsetX}px, ${dy}px) scale(${scale})` where dx is talkingHeadAlign.dx and offsetX is the whip's; packages/remotion/src/timing.ts blurCoverScale is called from hookWhipState with the whip's dx only. Reachability checked in packages/remotion/src/render.ts (the opener guard) and packages/core/src/pipelines/renders.ts (talkingHeadAlign is measured only when an opener is present)."
source: code
---

# The whip's cover math cannot see the alignment offset it shares a translate with

`hookWhipState` derives the scale that keeps the picture covering the frame
while it slides — `(HALF_W + |dx|) / (HALF_W − 2σ)` — from the **whip's** dx
alone. But the composition adds `talkingHeadAlign.dx` into the same
`translate()`. An alignment offset therefore moves the picture without buying
any cover, and eats the handheld sway's spare margin (12px x, 32px y, pinned
in `timing.test.ts` on three seeds). A workflow reviewer put the worst frame at
fromX 140 / align.dx 12 at roughly −1px, i.e. one column of the root
`AbsoluteFill`'s black at the left edge.

## Why it cannot fire today

`talkingHeadAlign` is measured **only when an opener is present**
(`pipelines/renders.ts`), and `renderServiceB` refuses an opener together with
any hook animation. So the two values are mutually exclusive by construction —
through `renderServiceB`. A caller that builds `ServiceBProps` directly (the
scratch re-render script, Remotion Studio) has no such guard.

## The trap

The opener is retired ([[0023-hook-is-a-remotion-animation-opener-clips-retired]])
and its code is scheduled for deletion in its own task. **That deletion removes
the guard that makes this unreachable.** Whoever deletes the opener path should
delete `talkingHeadAlign` and `talkingHeadGrade` with it — they exist only to
match a seam that no longer exists — rather than leaving an offset with no
cover behind.

If either survives, the fix is to feed the composed dx into the cover: pass
`align.dx` into the parent's `hookWhipState` call in `ServiceB.tsx` and add it
to `blurCoverScale`'s first argument.

## Related

- [[service-b-hook-animation-mocks-2026-09-06]]
- [[alignment-search-is-whole-frame-and-leaves-the-face-4px-off]] — the other alignment defect
- [[handheld-sway-constants]] — the margin being spent
