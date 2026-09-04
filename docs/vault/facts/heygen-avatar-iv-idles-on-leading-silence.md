---
type: fact
status: verified
verified: 2026-09-04
method: "founder hand test, by eye, 2026-09-04. One persona, one selfie reference image with the mouth closed. Two HeyGen Avatar IV generations compared: audio as synthesised, then the same audio with ~800ms of silence prepended. First frames watched back; no code, no instrumentation, no frame extraction."
source: founder
---

# HeyGen Avatar IV frame 0 is not the reference image; it idles on leading silence

Submitting a reference image plus audio to HeyGen Avatar IV does **not** produce a video whose
first frame is that image. The model starts animating immediately, so frame 0 is already a
generated frame — and with speech starting at t=0, it is already mid-phoneme.

## What was seen

One persona, one selfie reference image, **mouth closed** in the reference.

| audio submitted             | first frame                                            |
| --------------------------- | ------------------------------------------------------ |
| as synthesised              | **mouth already open**                                 |
| ~800ms of silence prepended | **mouth stays closed, head still** through the silence |

With the silence in front, a **reversed hand-cover clip generated from the same selfie cuts into it
cleanly** — which is the property the opener effect in
[[0017-service-b-single-setting-selfie-talking-head]] depends on. The cut lands on a frame that
still looks like the reference image instead of on a frame caught mid-word.

## Why it matters

The opener hard-cuts from the bank clip into the lipsync output at the reveal. If frame 0 of the
lipsync is a mouth caught open, the cut reads as a glitch rather than a transition — the same
continuity problem that rules out reusing the Service A hook bank for B. Leading silence is what
makes the seam invisible, and it costs nothing but a little audio.

It is also a **billing** consideration, not only a visual one: HeyGen bills per second of output
(`docs/04-integrations.md:202-205`) and generates to the audio's length, so prepended silence is
paid-for output. At ~25 agorot/s (`docs/04-integrations.md:217-218`), 800ms is ~0.2 agorot — real,
and negligible.

## What is NOT measured

Stated explicitly, because this is one person watching two videos.

- **Tolerance is unknown.** ~800ms was the **only value tried**. Nothing here says 800ms is a
  threshold, a minimum, or an optimum — 300ms may work and 2s may be needed. There is no
  measurement of where it starts and stops working.
- **One persona, one image.** No other persona and no other reference image was tested. The
  reference used had the mouth **closed**; nothing is known about a reference with the mouth open,
  which is a different starting condition.
- **The effect of `expressiveness` / `motion_prompt` on the idle is untested.** Both are absent by
  default (`docs/04-integrations.md:222-228`) and both were absent here. A non-default
  `expressiveness` could plausibly move the head during the silence and undo the property — that is
  the obvious next A/B.
- **n=1 per condition, and Avatar IV is non-deterministic.** `docs/04-integrations.md:238-239`
  records that HeyGen exposes no seed and its own guide states identical inputs can differ per
  generation. So "mouth open without silence" is one draw, not a characterisation of the
  distribution. The silence result is the more robust half — a still head through silence is a
  behaviour, not a coincidence — but neither was repeated.
- **By eye, not by frame extraction.** No `ffprobe`, no extracted frame 0, no measurement of how
  many frames the idle actually lasts.

## Re-measure with

Two renders of one persona through `aiugc render-b` (or the B wizard), identical except for
prepended silence on the audio, then compare frame 0:

```
ffmpeg -i out.mp4 -vf "select=eq(n\,0)" -vframes 1 frame0.png
```

Worth doing properly before the opener ships, since the whole effect rests on it — and worth
extending to a second persona and a non-default `expressiveness`.

## Related

[[0017-service-b-single-setting-selfie-talking-head]] — the format decision this measurement
supports; the opener clip's hard cut is the consumer of it.
