---
type: fact
status: verified
verified: 2026-09-06
method: 'per-source-frame luma difference of the stored HeyGen clip of video_renders 1397ffcd… (.work/seam-handover/talking-head-limited.mp4, 25fps, lead-in 800ms) on the head box: ffprobe -f lavfi -i "movie=talking-head-limited.mp4,select=between(n\,0\,37),crop=iw/2:ih*2/5:iw/4:ih/10,signalstats" -show_entries frame=pts_time:frame_tags=lavfi.signalstats.YAVG,lavfi.signalstats.YDIF — and the same with crop=iw/4:ih/8:iw*3/8:ih*0.40 for the mouth; source frames 8–22 extracted as a strip (ffmpeg select + tile, .work/seam-handover/heygen-headbox-320-880ms.png) and looked at'
source: code
---

# HeyGen's head starts moving ~200ms before speech: an 800ms lead-in is still only to 0.56s

The 800ms of prepended silence ([[heygen-avatar-iv-idles-on-leading-silence]]) does not buy
800ms of stillness. On the head box — the crop the seam grade is measured on — the clip is still
through source frame 13 and moves from frame 15:

| clip time  | head-box YDIF | mouth-box YDIF | what the frame shows                   |
| ---------- | ------------- | -------------- | -------------------------------------- |
| 0.00–0.52s | 0.5–1.6       | 0.7–1.6        | idle: encoder noise, no visible change |
| 0.56s      | 1.08          | 1.19           | last still frame                       |
| 0.60s      | 2.58          | 2.38           | the smile begins to widen              |
| 0.64–0.68s | 3.5–3.9       | 1.8–2.3        | smile, teeth showing                   |
| 0.72–0.76s | 6.1–6.7       | 3.7–4.3        | a blink, mouth wide                    |
| 0.80s      | 8.72          | 4.82           | eyes open, mouth opening — speech      |
| 0.92s      | 10.3          | 8.19           | speaking                               |

The head-box mean luma climbs from 96.7 (0.56s) to 99.7 (1.0s), +3.1% — the brightening
already recorded in [[heygen-idle-frame-is-darker-than-its-reference-and-its-talking-frames]];
this note is about _when_ the head moves, not how much it brightens.

## What it means for the cut

`serviceBTimeline` starts the head `leadInMs − GAP_MS` = 550ms into its file; at 30fps that is
`trimBefore` 17 frames = 566ms, which is source frame 14 (560ms) — the **last still frame**. The
next composition frame (600ms) is already the smile. The cut is retired (2026-09-06, [[0023-hook-is-a-remotion-animation-opener-clips-retired]]), but the timing stands for the ad's first frame: the composition still starts the head 550ms in, on the last still frame, so the smile begins 67ms into the ad and the blink at 200ms, under the hook text — no opener tail, and the jump a viewer saw the cut start is what retired the opener., the head is still for one frame, then animates into a toothy smile 67ms after
the cut and blinks 200ms after it, before the first word at 250ms. Measured on the hard-cut
re-render (`.work/seam-handover/hardcut-2026-09-06.mp4`, head box): YDIF 0.71 on the last opener
frame, 6.91 on the cut frame, then 2.1 / 3.0 / 3.6 / 6.8 on the four frames after it. A viewer
sees the cut _start_ the motion — a jump whatever the two stills look like.

The 2026-09-05 re-measurement in [[heygen-avatar-iv-idles-on-leading-silence]] put the onset at
0.72s and the margin at 130ms. That was whole-frame YDIF, where wall and torso dilute a mouth;
on the head box the margin is one source frame (40ms).

## The free lever

The lever was a seam fix — start the head earlier so still frames followed the cut — and is moot since the opener was retired (2026-09-06, [[0023-hook-is-a-remotion-animation-opener-clips-retired]]). `GAP_MS` in core is unchanged ([[service-b-timeline-constants]]) and now only sets how much still head opens the ad before speech; there is no seam A/B to judge. The scratch re-render script takes a 5th argument, the gap in ms:
`apps/cli/node_modules/.bin/tsx packages/core/.work/b-final-rerender.ts .work/seam-handover/gap500 2700 opener-new.mp4 500`
— the head from 300ms, speech 500ms after the cut; the output is
`.work/seam-handover/gap500/rerender-opener-new-2700-gap500.mp4`. `GAP_MS` in core is unchanged:
it is a chosen constant ([[service-b-timeline-constants]]) and the founder judges the A/B.

## Not measured

- One clip, one persona, one motion prompt. Whether the ~200–240ms anticipation is a HeyGen
  constant or varies per generation is unknown; a second generation is the check.
- Whether 500ms of silence after the cut reads as a pause or as a stall.

## Related

- [[heygen-avatar-iv-idles-on-leading-silence]] — corrected by this note (the margin, not the idle)
- [[service-b-seam-constants]] — the seam this sits on
- [[service-b-timeline-constants]] — `GAP_MS`
- [[0021-nothing-moves-at-the-service-b-seam]] — the seam decision, superseded by [[0023-hook-is-a-remotion-animation-opener-clips-retired]] on 2026-09-06 (line 63 likewise: 'the seam this sat on, retired')
