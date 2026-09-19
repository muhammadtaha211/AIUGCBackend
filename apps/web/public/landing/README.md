# Landing media

Everything the public landing page (`/`) shows in a media slot. Files here are served
statically at `/landing/<filename>`.

Every slot ships empty (`src: null`) and the page draws its own still in its place — today's
AdFrame with the slot's label on it. Nothing on screen ever says "placeholder".

## Replacing a slot

Two steps, one file each:

1. Drop the file into this directory.
2. Set that slot's `src` (and `poster`, where the slot has one) in
   `apps/web/src/lib/landing-media.ts`.

There is no third step: no import, no build config, no page edit.

## Slots

| Slot              | Expected filename                     | Where it appears                                              |
| ----------------- | ------------------------------------- | ------------------------------------------------------------- |
| `demoBefore`      | `demo-before.mp4` + `demo-before.jpg` | The before/after row (right frame) **and** step 1             |
| `demoAfter`       | `demo-after.mp4` + `demo-after.jpg`   | The before/after row (left frame) **and** step 4's four tiles |
| `hookClips[0..3]` | `hook-1.mp4` … `hook-4.mp4` + `.jpg`  | Step 2's four-clip strip — that strip only                    |
| `hookStudioShot`  | `hook-studio.png`                     | Step 3 — a screenshot of the hook studio, replacing its mock  |
| `presenterSample` | `presenter.mp4` + `presenter.jpg`     | The talking-head section (`#presenter`)                       |
| `instagramShot`   | `instagram.png`                       | The self-marketing band (`#proof`), in a phone-shaped frame   |

`.jpg` files are the `poster` — the frame the browser shows before a clip plays.

Step 4 is deliberately one file, not four: its point is that the SAME recording carries four
different openers, so all four tiles play `demoAfter` and only the line over them changes. Setting
`demoAfter.src` therefore fills five frames at once.

## What the files should be

- **Clips**: vertical 9:16, the product's own output shape. They autoplay muted and loop, so
  keep them short and keep them silent. `demoAfter`, the `hookClips` and `presenterSample` are
  real renders; `demoBefore` is the raw phone recording that produced `demoAfter`.
- **`demoAfter` must have NO hook line burned into it.** The page draws the line itself, in HTML,
  over every frame that plays this clip — one line in the before/after row and four different ones
  across step 4's tiles. A clip with its own line burned in would show two at once, and step 4's
  four tiles would each contradict the footage. Export it from the ad body, or from a render whose
  hook text is empty.
- **Stills**: `hookStudioShot` and `instagramShot` are screenshots. Crop `instagramShot` to a
  phone aspect — its frame is shaped for it.
- **Hook lines** are copy, not assets: they live beside the clips in `landing-media.ts`, and
  a clip should carry the line stored next to it.

## Also in that file

`presenterName` (the presenter the `#proof` band names) and `instagramUrl`. Leaving
`instagramUrl` as `null` hides the link and nothing else — the band still renders.
