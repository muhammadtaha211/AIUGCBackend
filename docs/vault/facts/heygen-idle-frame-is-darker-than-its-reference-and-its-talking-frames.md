---
type: fact
status: verified
verified: 2026-09-06
method: "mean luma per region of three frames on one full-range scale (ffmpeg `scale=out_range=pc,format=yuv420p,<crop>,extractplanes=y`, averaged in Python): the persona's selfie.jpg cover-scaled to 1080×1920, the stored HeyGen clip of video_renders 1397ffcd… at 0.55s (tv read), and the founder's re-exported opener at 2.70s; then the HeyGen clip's head-box mean RGB per source frame (`rgbSeries`, `crop=iw/2:ih*2/5:iw/4:ih/10`) over its first 2.4s"
source: code
---

# HeyGen's idle frame is ~9% darker than its reference; its talking frames come back up by ~4%

Both clips in the Service B seam (retired 2026-09-06 — [[0023-hook-is-a-remotion-animation-opener-clips-retired]]) were generations of one selfie, and neither returned at the selfie's exposure; HeyGen's miss, which still opens every ad, moves. — but they miss it by different amounts, and HeyGen's miss moves.

| region (1080×1920 crop)     | selfie | HeyGen idle frame (0.55s) | opener last frame |
| --------------------------- | ------ | ------------------------- | ----------------- |
| head box (x25–75%, y10–50%) | 103.5  | 93.9 (−9.2%)              | 99.2 (−4.2%)      |
| face                        | 118.8  | 108.9 (−8.4%)             | 113.8 (−4.3%)     |
| wall                        | 147.3  | 134.3 (−8.8%)             | 141.3 (−4.1%)     |
| pink top                    | 171.0  | 153.9 (−10.0%)            | 166.6 (−2.6%)     |
| whole frame                 | 138.2  | 125.1 (−9.5%)             | 133.6 (−3.4%)     |

HeyGen's darkening is near-uniform across regions — an exposure shift, not a curve — so a
gain closes it. But it is not constant in time. Head-box mean RGB of the HeyGen clip from its
first shown frame:

| clip time | R / G / B            |
| --------- | -------------------- |
| 0.55s     | 116.4 / 86.3 / 76.0  |
| 0.79s     | 119.0 / 88.6 / 78.4  |
| 1.03s     | 121.2 / 89.9 / 79.5  |
| 1.39s     | 117.4 / 86.8 / 76.7  |
| 2.0–2.5s  | ≈117.5 / 87.5 / 77.3 |
| 2.83s     | 114.2 / 84.6 / 74.9  |

The idle frame is the darkest; as the head starts to move (0.7–1.0s) it brightens ~4% and
reddens, then wanders ±3% around a level ~1% above the idle. A gain matched on the cut frame
alone therefore brightens the whole talking head a further 3–4% half a second after the cut —
what the founder saw as "a jump in brightness" on the 2026-09-05 re-render even though the two
cut frames measured within 1.4% (face) of each other.

## What this changed

The single `talkingHeadGain` became a per-channel gain curve (`grade.ts`), locked to the opener's head-box colour every 100ms for the first 2s, then eased into the median — retired 2026-09-06 with the opener ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]): `buildServiceBProps` measures it only when a render has one, so no render is graded now and the ad opens on the darker idle frame and brightens ~4% with HeyGen at 0.7–1.0s, uncorrected. The code stays until a task removes it., then eased over 0.5s into
one constant taken from the median of the following seconds; applied in the composition as an
SVG `feColorMatrix` in sRGB.

## Not measured

- One persona, one HeyGen generation, one opener. Whether the ~9% and the ~4% are HeyGen
  constants or vary per generation is unknown; the grade is measured per render so it does
  not depend on them being constant.
- HeyGen exposes no parameter for any of this: the `POST /v3/videos` image mode documents
  `motion_prompt` and `expressiveness` only (developers.heygen.com/avatar-iv, read 2026-09-06);
  nothing for colour, brightness, lighting, enhancement or "keep the original look".

## Related

- [[heygen-output-is-limited-range]] — the tag fix that came first
- [[handheld-sway-constants]] — the other seam change of the same day
