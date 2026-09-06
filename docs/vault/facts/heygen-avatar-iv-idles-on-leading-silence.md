---
type: fact
status: verified
verified: 2026-09-06
method: 'founder hand test, by eye, 2026-09-04 (one persona, one selfie with the mouth closed; audio as synthesised vs the same audio with ~800ms of silence prepended; first frames watched back). Re-measured 2026-09-05 on the stored HeyGen clip of video_renders 1397ffcd… (lead-in 800ms, motion_prompt set): `ffprobe -f lavfi -i "movie=talking-head.mp4,signalstats" -show_entries frame=pts_time:frame_tags=lavfi.signalstats.YDIF` — YDIF 0.5–1.3 per frame through 0.68s, 2.5–5 from 0.72s.'
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
cleanly** — the property the opener effect of 0017 depended on until it was retired on 2026-09-06 ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]); the ad now opens on this still frame itself. The cut lands on a frame that
still looks like the reference image instead of on a frame caught mid-word.

## Why it matters

Until 2026-09-06 the opener hard-cut from the bank clip into the lipsync output at the reveal; that path is retired ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]). The ad now opens on the clip itself (`leadInMs − GAP_MS` in) under the hook text (and the zoom hook when chosen), so its frame 0 must be a still, closed-mouth head — the same property, no seam. Leading silence is what puts that still head at frame 0, and it costs nothing but a little audio. — the same
continuity problem that rules out reusing the Service A hook bank for B. Leading silence is what
makes the seam invisible, and it costs nothing but a little audio.

It is also a **billing** consideration, not only a visual one: HeyGen bills per second of output
(`docs/04-integrations.md:213-216`) and generates to the audio's length, so prepended silence is
paid-for output. At ~25 agorot/s (`docs/04-integrations.md:238-239`), 800ms is ~20 agorot (≈₪0.20)
per render — corrected 2026-09-05, the original said ~0.2, an arithmetic slip; the usage row also
rounds the padded length up to whole seconds, so it lands as 0 or 25 — real,
and negligible.

## What is NOT measured

Stated explicitly, because this is one person watching two videos.

- **Tolerance is unknown.** ~800ms was the **only value tried**. Nothing here says 800ms is a
  threshold, a minimum, or an optimum — 300ms may work and 2s may be needed. There is no
  measurement of where it starts and stops working.
- **One persona, one image.** No other persona and no other reference image was tested. The
  reference used had the mouth **closed**; nothing is known about a reference with the mouth open,
  which is a different starting condition.
- **The effect of `expressiveness` / `motion_prompt` on the idle is untested.** Both were absent by default at the time — since 2026-09-06 `lipsync_expressiveness` is `medium` and `lipsync_motion_prompt` is generic and hand-free (migration 0034, [[0022-heygen-expressiveness-medium-generic-motion-prompt]]) — and both were absent here. A non-default
  `expressiveness` could plausibly move the head during the silence and undo the property — that is
  the obvious next A/B. **Done 2026-09-06:** `medium` and `high`, each with a different motion
  prompt, both idle through the silence exactly like unset — head-box motion onset 0.60s in all
  three ([[heygen-motion-prompt-two-draws]]). The property holds at every level tried (n=3, one
  persona).
- **n=1 per condition, and Avatar IV is non-deterministic.** `docs/04-integrations.md:269-270`
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

The opener is retired ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]) and the expressiveness half is done — the idle holds at unset, `medium` and `high` ([[heygen-motion-prompt-two-draws]]); a second persona is the one open extension, since the ad now opens on this idle frame.

## Re-measured 2026-09-05, with instrumentation

The first real opener render (video_renders 1397ffcd…, lead-in 800ms, `lipsync_motion_prompt`
"gestures casually with one hand while talking, warm smile") gave a second generation to look
at by the numbers: frame-to-frame luma difference on the whole frame stays at 0.5–1.3 through
0.68s and jumps to 2.5–5 from 0.72s — the head idles through the padded silence and starts
moving 80–120ms before the 800ms mark (the clip is 25fps; the onset sits between the 0.68 and
0.72 frames). Speech in the clip's own audio track starts at ~0.82s, so the head leads the voice
by ~100–140ms — anticipation, not a lip out of sync. So the property held once more, this time
**with a motion prompt** (the bullet above said that was untested; `expressiveness` still is).
n=2 for the idle, still one persona. The layout's `GAP_MS = 250` starts the clip 550ms in and
cuts at that frame, 130ms before the head begins to move — the margin any lead-in tuning has to
respect.

## Corrected 2026-09-06 — on the head box the margin is one frame, not 130ms

The whole-frame series above dilutes a mouth with wall and torso. Measured on the head box (and
on a mouth box), the motion starts at **0.60s**: a widening smile at 0.60–0.68, a blink at
0.72–0.76, the mouth opening for speech at 0.80. The composition's first shown frame (550ms → `trimBefore` 17 → source frame 14, 560ms; the cut frame until the opener was retired 2026-09-06) is the last still frame, 40ms before the smile —
[[heygen-head-moves-before-speech-onset]] has the per-frame numbers and the strip. The "130ms
before the head begins to move" line above is therefore wrong by ~90ms; it stands as written for
the record. The idle itself (a still head through the silence) is unchanged, n=2.

## Related

[[0017-service-b-single-setting-selfie-talking-head]] — the format decision this measurement
supports; the opener clip's hard cut is the consumer of it.
[[heygen-head-moves-before-speech-onset]] — where the still window actually ends.
