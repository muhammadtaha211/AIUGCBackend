---
type: fact
status: verified
verified: 2026-09-05
method: "stored luma extremes per frame with `ffprobe -f lavfi -i \"movie=talking-head.mp4:seek_point=0.55,select=gte(t\\,0.55),signalstats\" -show_entries frame_tags=lavfi.signalstats.YMIN,lavfi.signalstats.YMAX -read_intervals %+#1` on the HeyGen clip of video_renders 1397ffcd-4c2c-4cc0-9afd-692c23f5f772 (renders/…/lipsync.mp4, downloaded as stored, colour_range unset), and the same on the tv-tagged opener f8f7b2cc… and on the persona's selfie.jpg (full-range JPEG); share of pixels outside 16–235 with `-vf extractplanes=y,lutyuv=y='if(lt(val,16),255,0)',scale=1:1:flags=area -f rawvideo` (and gt(val,235))"
source: code
---

# HeyGen Avatar IV clips are limited-range video, delivered with no colour tags

The stored luma of a HeyGen clip spans the limited (16–235) band like any ordinary encoder
output. It does not use the full 0–255 swing.

| file                                         | tag on file | YMIN | YMAX | pixels < 16 | pixels > 235 |
| -------------------------------------------- | ----------- | ---- | ---- | ----------- | ------------ |
| HeyGen clip, frame at 0.55s                  | none        | 13   | 209  | 0.00%       | 0.00%        |
| HeyGen clip, frame at 6.0s                   | none        | 13   | 207  | 0.00%       | 0.00%        |
| opener clip (Seedance, same scene), 0.733s   | tv / bt709  | 12   | 215  | 0.00%       | 0.00%        |
| selfie.jpg (the reference both were made of) | pc          | 0    | 231  | —           | —            |

The HeyGen clip and the tv-tagged opener of the same room have the same span; the full-range
selfie of that room reaches 0 and 231. A full-range encode of this scene would show blacks near
0 in the hair and the wall near 230; the clip shows neither. Untagged, ffmpeg and Remotion's
decoder read it as limited by default — which is also the truthful reading.

## Why it matters

`retagIfUntagged` (`packages/core/src/pipelines/renders.ts`) stamps every untagged provider clip
before the render. Until 2026-09-05 it stamped **full** range
([[heygen-clips-are-full-range]], falsified), so Remotion read stored 16 as a dark grey and
stored 235 as an off-white: lifted blacks, dimmed whites, the squeezed-contrast talking head the
founder saw in the first real opener render. It now stamps limited (`retagBt709Limited`,
`packages/core/src/media/ffmpeg.ts`). The same call sits on the retired Service A avatar-outro
path (`format: "full"`, CLI-only), which would change colour the same way — correctly.

## Not measured

- One clip, one persona, 1080p. Other generations, other resolutions and the API's other
  output settings were not sampled.
- Whether Remotion's compositor honours the tv tag exactly as ffmpeg does: the first re-render
  after the retag is the check (a wall-region step across the reveal cut of a few levels, not
  ten or more).

## Related

- [[heygen-clips-are-full-range]] — the claim this replaces
- [[service-b-timeline-constants]] — the first real render that surfaced it
