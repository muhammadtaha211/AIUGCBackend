---
type: decision
status: verified
verified: 2026-09-06
method: "founder in chat, 2026-09-06: 'in the effect picking step, I want the preview to play a video of the effect, and then a play button appears and the video stops playing until the user clicks the play button again then it plays one more and stops', with 'If you feel you need my opinion on something, just go with whatever you recommend'. Behaviour verified in the running dev server by driving the component's own rAF loop off a controlled clock — see the fact note below."
source: founder
---

# The effect step animates the customer's own selfie, rather than playing a canned clip

The founder asked the effect step to "play a video of the effect", stop, and
offer a play button that replays it. What it plays is **not** a pre-rendered
mp4: it is the real animation, driven in the browser from the real numbers, over
the customer's own persona selfie — which is the ad's actual opening frame.

## Options considered

- **Pre-render one mp4 per effect and ship them as assets.** Rejected on three
  counts: they would show somebody else's face, not the persona the customer
  just picked; the numbers would then be frozen at render time, so a retune
  would silently leave the previews lying; and it adds tracked binaries plus a
  regeneration step for nothing (locked decision #10).
- **A CSS-keyframes approximation.** Rejected: it needs its own copy of the
  easing and the blur-cover scale, which is exactly how a preview starts
  disagreeing with the render.
- **Chosen: run the composition's own state functions in the browser.**
  `@aiugc/remotion/timing` (`hookZoomScale` / `hookFocusState` /
  `hookWhipState`) is pure and imports only `remotion/no-react`, so it bundles
  into a client component; a `requestAnimationFrame` loop feeds it composition
  ms and writes one transform + filter onto the `<img>`.

## What moved so the two cannot drift

`HOOK_ZOOM`, `HOOK_FOCUS`, `HOOK_WHIP` and `HOOK_LANDS_AFTER_SPEECH_MS` moved
out of `packages/core/src/pipelines/renders.ts` into
`packages/core/src/hook-effect.ts` — already the pure, client-safe module the
wizard imports the effect names from — together with a new
`hookAnimation(effect, captionOffsetMs)` that turns a name into the numbers.
`hookAnimationProps` in `renders.ts` is now that call plus the SFX paths and the
opener guard. **A retune is still a deploy, and now it is one edit, not two.**
`packages/core/test/hook-effect.test.ts` pins the values;
`lipsync-chain.test.ts` still pins that the render path reaches for them.

## The honest limits of the preview

- The picture under the move is a **still**, not the talking head. For the
  first ~1s of a Service B ad the head is holding the lead-in silence, so this
  is close — but it is not the same thing.
- The seeded handheld sway is not simulated; only `OVERSCAN` is applied, so the
  settled frame is framed like the ad's.
- Speech onset is taken as `GAP_MS` (250ms), which is `min(leadInMs, GAP_MS)`
  for every render whose lead-in is at least the gap — i.e. all of them at
  `lipsync_lead_in_ms` 800. A future lead-in **below** 250ms would make the
  preview early. Nothing warns about that.
- The burned hook text sits outside the moving layer, exactly as in
  `ServiceB.tsx`, so the line stays put while the picture moves.

## Related

- [[0024-hook-effect-is-a-render-param-the-customer-picks]]
- [[effect-step-placement-previews-frame-0-only]]
- [[focus-hold-phase-is-unreachable-at-the-production-gap]]
