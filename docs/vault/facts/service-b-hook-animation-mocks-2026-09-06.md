---
type: fact
status: verified
verified: 2026-09-06
method: "four free re-renders of the stored HeyGen take at expressiveness medium (.work/seam-handover/motion/take2/talking-head.mp4, copied to .work/seam-handover/hooks/) through packages/core/.work/b-final-rerender.ts with one new env knob each — HOOK_TEXT_MS=auto <knob> apps/cli/node_modules/.bin/tsx packages/core/.work/b-final-rerender.ts .work/seam-handover/hooks 2700 none 800 — each output verified with ffprobe signalstats (YDIF/YAVG per frame on a crop) and an ffmpeg select+tile frame strip before it was sent"
source: code
---

# The four hook-animation mocks sent for judgement, and what each one measures

Round 2 of [[0023-hook-is-a-remotion-animation-opener-clips-retired]]'s "more
animations to judge". One variable each, all on the SAME clip, VO, hook text
("חייבת לספר לכם על משהו") and caption handoff as the zoom hook the founder
already liked — so a verdict is about the animation and nothing else. No paid
call: 73–85s of local render apiece, ₪0.

| mock          | prop             | env knob                      | what moves                                                   |
| ------------- | ---------------- | ----------------------------- | ------------------------------------------------------------ |
| rack focus    | `hookFocus`      | `FOCUS="20,350,850"`          | blur 20px held to 0.35s, sharp by 1.2s; nothing else         |
| whip-in       | `hookWhip`       | `WHIP="140,420,20"` + a swish | 140px slide + horizontal smear, settles 0.42s                |
| kinetic text  | `hookTextReveal` | `TEXT_REVEAL="180,380"`       | words pop across the lead-in; line slides out at the handoff |
| emphasis+push | `hookBeats`      | `BEATS="0.035,200,9800,1.06"` | 3.5% punches on 4 beats; slow push over the last 3s          |

## Verified on the outputs, not asserted

- **Focus.** Frame strip `hooks/focus-strip-0-1400ms.png`: soft through frame
  24, sharp by frame 36. **No edge bleed** — the left 4px column reads YAVG
  101.0 while blurred vs 99.3 sharp (brighter, not darker), so the
  compensating scale covers the blur's transparent falloff.
- **Whip.** `hooks/whip-strip-0-470ms.png` shows the smear on frame 0 and rest
  by frame 4. Edge columns stay 96–142 YAVG through the slide — no black.
  The whoosh is real: max_volume −10.0 dB over the first 450ms vs −91.0 dB
  (digital silence) in the focus render over the same window.
- **Kinetic text.** Words land ~128ms apart (frames 3/6/9/12/15), the line
  completes at ~690ms, before speech at 800ms. `hooks/kinetic-strip-exit.png`
  shows the line sliding down and fading out and the first caption arriving
  **after** it is gone — no frame carries both.
- **Beats.** Corner YDIF (static wall, `crop=200:200:0:0`) at the beat frames
  is 3–5× the same frames of the focus render (f100: 1.06 vs 0.056; f171:
  1.27 vs 0.19) and identical to it away from a beat (f200–208). The tail push
  is visible frame to frame: `hooks/beats-tail-push-f381.png`.

## The beats mock was re-rendered before it was sent

v1 punched on the longest-spoken word of each chunk — nine punches, and the
signal is ~80% letter count ([[emphasis-signal-in-word-timestamps]]). v2 punches
on a word preceded by a ≥200ms gap: four beats, at composition 3320 / 5680 /
9440 / 11840ms. v1 is kept as `hooks/beats-v1-longestword.mp4`.

## Two things the mocks are NOT

- **They run at gap 800**, the scratch script's 5th argument — the head plays
  from its first frame and speech starts 800ms in. The pipeline's `GAP_MS` is
  **250** ([[service-b-timeline-constants]]), which is also the window the
  kinetic reveal pops across. At the product default that reveal would compress
  from ~690ms into ~200ms. Whichever hook is chosen, this is a decision the
  build has to make explicitly.
- **The judged files predate a correctness fix.** `blurCoverScale` bought 2σ of
  blur cover in pre-transform pixels, but a CSS/SVG filter runs in the
  element's local space and the element's own scale is applied to the filtered
  result, so the bleed on screen is 2σ·s. Measured deficit
  (`packages/core/.work/hook-probe.ts`): 3.0px at blur 20, 11.9px at blur 40,
  23.2px at blur 56 — inside the sway's pinned 12px of spare cover at the
  mock's numbers, which is why the outputs show no edge. Fixed the same day to
  `s = (HALF_W + |dx|) / (HALF_W − 2σ)`, which raises the focus mock's opening
  scale 1.0741 → 1.0796 and the whip's 1.3333 → 1.3617 (≤2.9%, below noticing).

## Shape of the code, for whoever builds the winner

Each is an optional, zod-validated prop on `serviceBSchema` with a pure
function in `packages/remotion/src/timing.ts` (`hookFocusState`,
`hookWhipState`, `hookTextRevealState`, `hookBeatsScale`), inert unless passed,
exactly like `hookZoom`. Their scales multiply into the ONE transform on the
talking-head layer. Tests: remotion 76/76 (the whole suite, including the real ServiceASteps
frame-delivery render), typecheck clean. When the founder
picks, the survivors collapse into one `hookEffect` render param and the rest
are deleted.

## Related

- [[emphasis-signal-in-word-timestamps]] — why the beats were re-picked
- [[atomic-inline-words-reverse-a-latin-run-in-rtl]] — a limit on the kinetic text
- [[whip-offset-and-alignment-share-one-translate]]
- [[handheld-sway-constants]] — the 12px/32px spare cover every effect leans on
