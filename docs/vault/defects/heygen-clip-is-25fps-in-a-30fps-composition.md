---
type: defect
status: verified
verified: 2026-09-05
method: "`ffprobe -show_entries stream=r_frame_rate,nb_frames,duration` on the stored HeyGen clip of video_renders 1397ffcd… — r_frame_rate 25/1, 319 frames, 12.76s; the composition FPS is 30 (packages/remotion/src/schema.ts)"
source: code
---

# HeyGen delivers 25fps; the 30fps composition shows one frame in six twice

The talking head is 25fps. Remotion samples it at the composition's 30fps, so every fifth
source frame is shown on two output frames — a 5Hz hitch in any motion of the head or hands.
It was hidden while nothing else moved; with the handheld camera path
([[handheld-sway-constants]]) sweeping smoothly over it, the repeat may become easier to see.

## Not fixed, by scope

- `normalizeVideo`'s `fps=30` (the bank precedent) duplicates frames exactly as Remotion does —
  a re-encode of a paid clip for nothing.
- Motion interpolation (`minterpolate`) invents frames on a face and is a new pipeline step
  under locked decision #10.
- A 25fps Service B composition reopens the "30fps" line pinned in `schema.ts` and shared by
  every composition.

Any of the three is a founder call; none is scheduled.

## Related

- [[handheld-sway-constants]]
- [[opener-bank-clip-dup-frames-and-tight-trim]] — the (retired 2026-09-06) opener's own frame repeats
