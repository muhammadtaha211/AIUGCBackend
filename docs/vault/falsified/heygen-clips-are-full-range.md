---
type: falsified
status: verified
verified: 2026-09-05
method: 'stored-luma extremes and out-of-band pixel shares measured on the raw HeyGen clip of video_renders 1397ffcd… (see [[heygen-output-is-limited-range]]); the released FINAL of the same render measured with `ffprobe -f lavfi -i "movie=finalselfie.mp4,signalstats" -show_entries frame_tags=lavfi.signalstats.YMIN,lavfi.signalstats.YMAX` over all 452 frames'
source: code
---

# Falsified: "lip-sync clips carry full-swing luma, so full range is the truthful label"

## The claim, verbatim

`packages/core/src/media/ffmpeg.ts` (commit b9ac808, 2026-08-03, no vault note), above
`retagBt709Full`:

> Lip-sync clips come back with every colour field unset while carrying full-swing luma
> (measured on a released render: YMIN=3 in every frame, YMAX=241 — outside 16–235), so full
> range is the truthful label; stamping limited would make decoders expand again and crush
> exactly the blacks this exists to protect.

On that reading every untagged provider clip was stamped **full** range before the render, for
Service B's talking head, the opener path, and Service A's avatar outro.

## What killed it

Measured on the raw HeyGen clip itself (2026-09-05): stored Y spans **13–209**, with no
pixel below 16 and none above 235 — the shape of an ordinary limited-range encode, the same
as the tv-tagged Seedance opener of the same room (12–215), nothing like the full-range selfie
both were made from (0–231). Stamping it full made Remotion read stored 16 as grey and stored
235 as off-white: the squeezed, "differently lit" talking head the founder rejected in the
first real opener render.

The original numbers were most likely taken from a **released final**, not from a provider
clip: the final of the same render, though tagged tv on output, spans **0–255** across its
452 frames (burned white captions, the black composition background, pixels passed through
Remotion without range conversion) — so a final always looks "full swing" whatever its
sources were. Inference, stated as such: nobody kept the file the 3/241 figures came from.

## What replaced it

`retagBt709Limited` (same file), applied at the same call sites. Fact note:
[[heygen-output-is-limited-range]]. n=1 clip there too — the finding is structural (an
encoder's range does not vary per generation) but was measured once.
