---
type: decision
status: verified
verified: 2026-09-03
method: "founder instruction in chat 2026-09-03; render path read from packages/remotion/src/ServiceASteps.tsx (COVER style on OffthreadVideo) and apps/admin/src/app/(admin)/hooks/upload-hook.tsx (aspect-[9/16] box + object-cover preview); apps/admin/test/hooks.test.ts passes 13/13"
source: founder + code
---

# 0013 — Hook-clip uploads accept anything close to 9:16, not only exactly 1080×1920

## The decision

The founder's words: _"some of the videos are 1072x1936 which is close enough ... it doesnt
affect rendering in any way right? ... allow videos of those dimensions, you dont have to be so
strict about it, just make sure its 9:16 ratio."_

`hookMetadataError` in `apps/admin/src/lib/hooks.ts` now rejects only clips whose width/height
is more than 3% off 9/16 (`HOOK_ASPECT_TOLERANCE`). Runs client-side before the upload and
server-side in `POST /api/admin/hooks`, as before. The upload hint reads "MP4 ביחס 9:16 (למשל
1080×1920)".

## Why it is safe

The clip never has to be 1080×1920 by the time it reaches the customer:

- The composition draws the hook with `OffthreadVideo` at `width: 100%; height: 100%;
object-fit: cover` inside the 1080×1920 frame (`packages/remotion/src/ServiceASteps.tsx`,
  `ServiceA.tsx`). A 1072×1936 clip is scaled to 1080 wide and loses ~15px top and bottom.
- The safe-area editor shows the same clip in a fixed `aspect-[9/16]` box with `object-cover`
  and stores the rect in 1080×1920 space as percentages, so what the founder draws is what the
  render places.
- `hook_clips` stores no width/height; the frame count is read off the file at render time.

What the tolerance does at the boundaries:

| clip      | off 9:16 | result   |
| --------- | -------- | -------- |
| 1072×1936 | 1.6%     | accepted |
| 720×1280  | 0%       | accepted |
| 1080×2340 | 18%      | rejected |
| 1080×1350 | 42%      | rejected |
| 1920×1080 | 216%     | rejected |

## Options considered

- **Keep exact 1080×1920** — rejected by the founder; his real exports are 1072×1936.
- **Near-9:16 plus a minimum resolution floor** — not asked for. 720×1280 now passes (it was
  rejected before) and is upscaled ~1.5× by cover. Founder-only tool; the bank is curated by hand.
- **Near-9:16 only** — chosen.

## What does not change

`normalizeVideo` still scales+crops to 1080×1920 whenever a clip is re-encoded for frame rate
(`normalize_hook_clip` only runs it when fps ≠ 30). Persona reference images keep their exact
1080×1920 rule in `apps/admin/src/lib/admin.ts` — that path center-crops on a canvas, so it
never sees an odd size.
