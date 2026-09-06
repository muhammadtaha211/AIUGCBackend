---
type: fact
status: verified
verified: 2026-09-06
method: 'constants read off packages/remotion/src/timing.ts (`SWAY`, `OVERSCAN`); coverage pinned by packages/remotion/test/timing.test.ts (every viewport corner inside the overscanned picture, two seeds × 3600 frames); the static baselines measured with `ffprobe -f lavfi -i "movie=<file>,signalstats" -show_entries frame=pts_time:frame_tags=lavfi.signalstats.YAVG,lavfi.signalstats.YDIF` on Downloads/finalselfie.mp4 (video_renders 1397ffcd…) and on its stored HeyGen clip with `crop=250:250:0:0` in front of signalstats'
source: code
---

# The Service B handheld camera — nine chosen numbers, one measured baseline

`packages/remotion/src/timing.ts` `handheld(frame, seed)` moves the whole picture (the one HeyGen clip — and the opener, until that path was retired on 2026-09-06, [[0023-hook-is-a-remotion-animation-opener-clips-retired]]; never the burned text, captions or watermark) along three octaves of smooth
seeded noise per axis — a Catmull-Rom curve through random knots, so it has no period. (The
first version, three summed sines at ±10px, the founder judged "doesn't come off natural … a
bit less and randomized"; v2 was noise at ±6px, which he then judged "not noticeable at all,
dial it up"; this is v3, 2026-09-06, the same noise at twice the amplitude.) It lives in the
remotion package, not core, because it moves no
millisecond of the layout. It is seeded by the render id (`cameraSeed`, `buildServiceBProps`),
so a retry re-renders identical frames; Studio and the sample renders use the fixed seed
`"preview"`.

| axis     | amplitudes (per octave) | knot rate (Hz) | envelope (with the curve's ~1.2× overshoot) |
| -------- | ----------------------- | -------------- | ------------------------------------------- |
| x        | 8, 3, 1 px              | 0.35, 1.1, 3.3 | ≤ ~14 px                                    |
| y        | 6.5, 2.5, 0.8 px        | 0.4, 1.3, 3.7  | ≤ ~12 px                                    |
| rotation | 0.3, 0.12, 0.04 °       | 0.3, 0.9, 2.9  | ≤ ~0.55 °                                   |

`OVERSCAN = 1.06`: the picture is scaled up 6% so the sway never exposes an edge — the far
corner needs ~1.046 at the envelope; the test pins the cover exactly, per frame, over 3600
frames of two seeds.

**Every one of these was chosen by eye on 2026-09-05, none measured against a real handheld
selfie.** The no-opener render's old 1 → 1.025 drift zoom was deleted the same day; this
replaces it on every Service B render, opener or not.

## The baseline it replaces

- Released final of 1397ffcd…: frames 0–72 identical to encoder noise (YAVG 148.28 on every
  frame); the talking head's background crop (250×250 at the top-left) YDIF 0.05–0.5 per
  frame at 4–5s — a locked-off camera. The opener's tail (frames 19–22) 0.1–0.5 — also
  locked off. Nothing in either source clip moves the camera; the sway was the only camera motion until the zoom hook of [[0023-hook-is-a-remotion-animation-opener-clips-retired]] (2026-09-06) added a second, and the opener clip is retired.

## Not measured

Whether these amplitudes read as "held" or as a template wobble at phone size, and whether the
sway makes the HeyGen clip's 25→30fps repeat ([[heygen-clip-is-25fps-in-a-30fps-composition]])
more visible. The founder has watched many re-renders since — v2 drew "not noticeable at all, dial it up" and v3 (2026-09-06) is the result; no decision note exists beyond that chat verdict, and whether v3 reads as held is still his call.

## Measured 2026-09-06 — the envelope over 300 random seeds

`packages/remotion/.work/align-headroom-seeds.ts 300 3600` (the coverage test's inverse
transform over 300 random UUID seeds × 3600 frames): |x| ≤ 12.5px, |y| ≤ 10.2px, |rot| ≤ 0.47°
observed. The Catmull-Rom curve overshoots its knots by up to 1.25, not the "~1.2" the table
above assumed, so the theoretical envelope is 15.0px / 12.3px / 0.575°; the observed one sits
inside it. What this leaves for the alignment offset is in [[service-b-seam-constants]].

## Related

- [[service-b-timeline-constants]] — the layout constants, same provenance
- [[0017-service-b-single-setting-selfie-talking-head]] — the opener file stays byte-identical;
  its rendered frames now vary per render seed
