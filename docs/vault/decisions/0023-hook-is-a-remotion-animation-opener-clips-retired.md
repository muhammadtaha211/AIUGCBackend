---
type: decision
status: verified
verified: 2026-09-06
method: "founder in chat, 2026-09-06, after watching the zoom-hook mock (.work/seam-handover/zoomhook-A3-2026-09-06.mp4): 'I want to retire the opening hook thing entirely, no more opening hooks stitched up to the heygen video, instead I want to replace that with remotion animation, I like the one you showed me with the zoom in, and I want to explore other animations as well … these animation options will appear to the user in the step where we suggested opening hooks with no effects being one of the options, now that screen will be animation effects'"
source: founder
supersedes: "[[0019-hook-text-outlives-the-reveal]], [[0021-nothing-moves-at-the-service-b-seam]]; amends [[0017-service-b-single-setting-selfie-talking-head]]"
---

# 0023 — The Service B hook is a Remotion animation over the one HeyGen clip; opener clips are retired

**Founder-decided.** A Service B ad is one HeyGen clip, start to finish: the persona selfie plus
the approved VO with its leading silence, at expressiveness `medium` with the generic prompt
([[0022-heygen-expressiveness-medium-generic-motion-prompt]]). The hook is an **animation the
composition performs on that clip** under the burned hook text — the first one is the zoom
hook: a tight opening at 1.35× creeping to 1.42×, then a 450ms ease-in-out pull-back to full
frame at 1.2s with a soft wind whoosh. Nothing is ever stitched in front of the HeyGen clip.

The wizard step that offered opener effects offers **animation effects** instead, with "none"
as one option. The hook text stays centred until speech has passed its last word and the
captions take over from the next caption line — the founder's correction on the first mock
("the same line shown in the center and a part of the captions at the bottom").

## What is retired

- The opener-clip bank (`opener_clips`, `aiugc bank add-opener`), the founder-made Seedance
  reveal clips, and the hard cut at `reveal_at_ms` — [[0017-service-b-single-setting-selfie-talking-head]]'s
  opener half. The single-setting selfie talking head, the lead-in silence and the single
  reference image in that decision all stand.
- The seam machinery that tried to make the cut invisible: the colour-grade curve, the pixel
  alignment, the soft cut and its zeroing ([[0021-nothing-moves-at-the-service-b-seam]]),
  [[service-b-seam-constants]]. The measurements stay true; the product no longer has a seam.
- The "hook text outlives the reveal" rule ([[0019-hook-text-outlives-the-reveal]]) — there is
  no reveal; the text's life is now tied to speech, as above.
- The wizard's opener/effect step and the render route's "live selfie or an opener made from
  it" rule, in favour of an effects step.

The code for all of it stays in the tree until a task removes it, like Service A's retired
"full" format ([[0020-service-a-is-hook-and-steps-only]]).

## Why

Two generations of one face never come back as the same pixels: with brightness matched to
0.5% and position to 4px the cut still read as a jump, and HeyGen's own rendition of any still
it is given differs from that still by as much as the opener did
([[heygen-idle-frame-is-as-far-from-its-own-input-as-from-the-opener]]). A hook that lives
inside the one clip has no seam by construction. The founder watched the first such mock and
said "I like it".

## The options as they stood

1. Keep stitching and keep matching — dead on the measurements above.
2. Generate the whole ad in one take with a video model plus a lip-sync model — length caps,
   a second paid step, identity drift, lip-sync on moving faces; the founder weighed it and
   chose 3.
3. One HeyGen clip with Remotion animation hooks — **chosen**.
4. Selfie mode with a text hook only — the fallback; superseded by 3.

## Consequences in the tree (as of this note)

- `packages/remotion`: optional `hookZoom` prop end to end, `hookZoomScale` in `timing.ts`,
  the whoosh as a served audio file, tests 56/56. Not yet set by the pipeline.
- Still to build (next session): the caption-handoff rule in `serviceBTimeline`, the effects
  step in the wizard (`apps/web/src/components/b-wizard`) replacing the opener step, the render
  route and `createBRender` params for an effect, more animations to judge, and the vault notes
  for each.

## Related

- [[0022-heygen-expressiveness-medium-generic-motion-prompt]] — the engine settings
- [[heygen-motion-prompt-two-draws]] — why staged actions cannot come from HeyGen
- [[heygen-head-moves-before-speech-onset]] — the still window the animation opens on
