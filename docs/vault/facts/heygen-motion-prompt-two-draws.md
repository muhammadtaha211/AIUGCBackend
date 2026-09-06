---
type: fact
status: verified
verified: 2026-09-06
method: "two paid HeyGen Avatar IV renders of the same persona image (8aeddf29…) and approved VO (27b9853e…, 12.0s + 800ms lead-in = 13 GPU-s, 325 agorot each) through `aiugc render-b --motion-prompt … --expressiveness …` and a live local worker (DRY_RUN=0); the stored clips measured with .work/seam-handover/motion/analyze.sh — head-box YDIF per source frame (crop=iw/2:ih*2/5:iw/4:ih/10), whole-frame and lower-half YDIF means over 319 frames — against the 2026-09-05 take (config prompt, expressiveness unset) as baseline; the prop detected as red excess R−(G+B)/2 in a chest crop (crop=iw/2:ih/4:iw/4:ih*0.55, area-averaged) per frame"
source: code
---

# HeyGen's motion prompt changes how much she moves, not when — and it invents props

Two draws on 2026-09-06, one persona, one VO, `expressiveness` set for the first time. Every
HeyGen number is one sample (no seed).

| take | motion prompt (verbatim)                                                                                                                                                                                                   | expr.  | motion onset (head box) | whole-frame YDIF mean | lower-half mean / frames > 8 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------- | --------------------- | ---------------------------- |
| 0    | `gestures casually with one hand while talking, warm smile` (app_config default, 2026-09-05)                                                                                                                               | unset  | 0.60s                   | 1.45                  | 1.32 / 0                     |
| 1    | `Talks to the camera like a close friend sharing a discovery: leans in slightly on emphasis, small natural head tilts and nods, expressive eyebrows, warm smile, relaxed hand gestures near the chest, steady eye contact` | high   | 0.60s                   | 2.92                  | 3.54 / 14                    |
| 2    | `Begins with her palm covering the camera lens, then pulls the hand away to reveal her face with a big smile and starts speaking; casual selfie-video energy with natural head movement`                                   | medium | 0.60s                   | 2.18                  | 2.43 / 0                     |

- **When she starts moving is untouched.** All three takes are still through source frame 14
  (0.56s) and move from 0.60s ([[heygen-head-moves-before-speech-onset]]); the prompt and the
  expressiveness level do not reach into the leading silence.
- **How much she moves doubles at `high`.** Take 1 has twice the baseline's frame-to-frame change
  and the only frames above 8 in the lower half: big smiles, laughs, eyes closing, head tilts, a
  hand up to the chest. Take 2 at `medium` sits between: livelier face, one small wave at
  ~1.4–2.0s.
- **The palm-over-lens opener was ignored.** Take 2 never covers the lens: no frame in the lower
  half exceeds 8, and the strip shows a wave at the chest, not a hand at the camera. HeyGen's
  image mode does not perform staged actions from the prompt.
- **A gesture line conjured a prop.** Take 1's "relaxed hand gestures near the chest" produced a
  hand holding a **red clutch bag** that is not in the reference: chest-crop red excess +10 or
  more on source frames 35–57 (1.40–2.28s, 23 frames, peak +23 against +1–2 on the other takes).
  It appears and vanishes; nothing else in the frame changes. That is a hallucination, and it
  makes the take unshippable as-is.

## Founder verdict

On take 1, 2026-09-06: "that's way too much, I don't like expressiveness set to high." And on the same file a minute later: "the render you sent me
looks way too fake." `high` is out; `medium` (take 2) and unset (take 0) are the candidates.

## Cost and what went wrong on the way

Two earlier pairs were spent on nothing: one eaten by the local dry-run worker (rows
94b79004…, 3a7c0260… released with placeholder clips), one refused by HeyGen for zero API
credits (bf9dc135…, 33e18641… failed; "Insufficient credit. This operation requires 'api'
credits"). Four `usage_events` rows of 325 agorot were recorded for those, none real. The two
real takes are 5f97847f… (take 1, released) and d3fbdd4e… (take 2; its render_video hit a
local Chrome-launch failure while the machine was busy and was rendered by hand from the stored
clip). The Hetzner worker claimed one lipsync job itself — it is alive.

## Not measured

Whether the prop is a `high`-expressiveness effect or a "hand gestures" effect, whether it
recurs on a second draw, and whether a prompt that names no hands avoids it. One draw each.

## Related

- [[heygen-avatar-iv-idles-on-leading-silence]] — the silence is still silence
- [[heygen-head-moves-before-speech-onset]] — the onset these takes confirm, n=3
- [[0021-nothing-moves-at-the-service-b-seam]]
