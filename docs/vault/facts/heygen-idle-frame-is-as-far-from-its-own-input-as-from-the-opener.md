---
type: fact
status: verified
verified: 2026-09-06
method: 'a 2.7333s still of the persona selfie built as a 30fps tv/bt709 "opener" (ffmpeg -loop 1 -framerate 30 -i selfie-8aeddf29.jpg -t 2.7333 -vf "scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,format=yuv420p" -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:v libx264 -crf 12), rendered through the current composition with the stored HeyGen clip of video_renders 1397ffcd… (generated FROM that selfie) via packages/core/.work/b-final-rerender.ts <dir> 2700 opener-selfie.mp4 500, then head-box YDIF per frame across the cut: ffprobe -f lavfi -i "movie=<render>,select=between(n\,78\,92),crop=iw/2:ih*2/5:iw/4:ih/10,signalstats"; compared with the identical measurement on the gap-500 render of the real opener'
source: code
---

# HeyGen's idle frame is as far from the still it was generated from as from the opener's reveal frame

The "generate the HeyGen head from the opener's reveal frame" lever ([[0021-nothing-moves-at-the-service-b-seam]]
option 3) assumes the residue at the cut comes from the opener and the head being two
generations of one selfie. Its best case can be rendered for free: the stored HeyGen clip was
generated from the persona selfie, so cutting from a still of that selfie into it is exactly
"HeyGen from the frame you cut from", with nothing between them but HeyGen's own re-rendering.

| cut (head box, luma, tv scale)                                         | last frame before | cut frame YDIF | frames after (still window) | alignment |
| ---------------------------------------------------------------------- | ----------------- | -------------- | --------------------------- | --------- |
| real opener → HeyGen, gap 500 (`gap500-2026-09-06.mp4`)                | 104.66 → 104.51   | **6.31**       | 0.19–1.32 for 8 frames      | (0, +4)   |
| selfie still → HeyGen, gap 500 (`selfiestill-bestcase-2026-09-06.mp4`) | 104.75 → 104.45   | **5.88**       | 0.22–1.31 for 8 frames      | (0, 0)    |

The pipeline's own instruments see the opener's reveal frame and the selfie still as the same
picture: head-box mean RGB 122.6/93.1/81.5 vs 122.2/92.7/82.4, alignment one 4px grain apart.
So the step at the cut — 6 luma levels against a 0.2–1.3 floor — is HeyGen's rendition of
whatever still it is given: hair sheen, smoothed skin, a re-drawn mouth, a ~0.5% re-scale,
and a −4 to −6% exposure the grade corrects. Feeding it the reveal frame instead of the selfie was predicted to leave the seam where it was (n=1; no seed) — the measurement that retired the opener and its seam on 2026-09-06 ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]); the compressed-frame-vs-photo question below is moot and no take is owed.

## What it does not say

- Whether HeyGen behaves differently on a compressed 1080×1920 video frame than on a
  3072×5504 photo — untested, and only a paid take (₪3.25: 12.8s padded audio → 13 GPU-s ×
  25 agorot, `renders.ts` `GPU_COST_AGOROT_PER_SECOND`) answers it.
- The still removes the real opener's every-third-frame repeat and its settling tail, so this
  best case is slightly optimistic on motion and exact on colour and position.

## Related

- [[0021-nothing-moves-at-the-service-b-seam]] — option 3, now predicted not to help
- [[heygen-idle-frame-is-darker-than-its-reference-and-its-talking-frames]] — the exposure half
- [[alignment-search-is-whole-frame-and-leaves-the-face-4px-off]] — the position half
- [[heygen-head-moves-before-speech-onset]] — the motion half, the one a gap change fixes
