# Landing media

Everything the public landing page (`/`) shows in a media slot. Files here are served
statically at `/landing/<filename>`.

A slot whose `src` is `null` draws its own still in its place — the AdFrame with the slot's label
on it. Nothing on screen ever says "placeholder". One slot is the exception: `instagramShot` hides
rather than draws — see its row below.

Filled 2026-09-25: every clip slot (`demoBefore`, `demoAfter`, the four `hookClips`,
`presenterSample`); `textBlockSample` added and filled 2026-10-10 (vault decision 0100);
`demoBefore` (with its poster) and `demoAfter` re-encoded 2026-10-15 with the URL step's browser
text blurred (vault decision 0111); `demoAfter` and `presenterSample` replaced 2026-10-22 with
new ads, the A one unblurred (vault decision 0123). Still empty: the two screenshots,
`hookStudioShot` and `instagramShot`.

The dashboard's service cards (`/home`) have their own clips, in `public/previews/` with its own
README; nothing here is shared with them.

## Replacing a slot

Two steps, one file each:

1. Drop the file into this directory.
2. Set that slot's `src` (and `poster`, where the slot has one) in
   `apps/web/src/lib/landing-media.ts`.

There is no third step: no import, no build config, no page edit.

## Slots

| Slot              | Expected filename                     | Where it appears                                             |
| ----------------- | ------------------------------------- | ------------------------------------------------------------ |
| `demoBefore`      | `demo-before.mp4` + `demo-before.jpg` | The before/after row (left frame) **and** step 1             |
| `demoAfter`       | `demo-after.mp4` + `demo-after.jpg`   | The before/after row (right frame) **and** step 4            |
| `hookClips[0..3]` | `hook-1.mp4` … `hook-4.mp4` + `.jpg`  | Step 2's four-clip strip — that strip only                   |
| `hookStudioShot`  | `hook-studio.png`                     | Step 3 — a screenshot of the hook studio, replacing its mock |
| `presenterSample` | `presenter.mp4` + `presenter.jpg`     | The talking-head section (`#presenter`)                      |
| `textBlockSample` | `text-block.mp4` + `text-block.jpg`   | The גוש טקסט section (`#text-block`)                         |
| `instagramShot`   | `instagram.png`                       | The self-marketing band (`#proof`) — **hidden until set**    |

`.jpg` files are the `poster` — the frame the browser shows before a clip plays.

Step 4 is one frame playing `demoAfter` — the finished ad, as it comes out. (Until 2026-09-25 it
was four tiles of the same clip under four HTML lines; founder's call to show the one real ad.)

## What the files should be

- **Clips**: vertical 9:16, the product's own output shape. They autoplay muted, loop and have no
  controls, so ship them without an audio track. `demoAfter` and `presenterSample` are real
  renders, from the founder's `Desktop\AIassets\serviceAExample.mp4` and `bServiceExample.mp4`
  (2026-10-22). `demoBefore` is the raw phone recording that produced the ad `demoAfter` held
  until 2026-10-22, not the current one (vault 0123). A clip fetches
  nothing until it scrolls near the viewport (`components/landing/landing-video.tsx`) — only its
  poster loads with the page.
- **`demoAfter` is the finished ad, its hook line burned in** — the page draws no line over it.
- **The URL step's browser text is blurred** in `demoBefore` (0–7.37 s, so its poster too): the
  tab title, the bookmarks bar and the address bar's suggestion and history list. The typed
  `tavnit.ai` and the burned step label stay sharp. A re-encode starts from the source and keeps
  the blur, applied at the source's resolution before the recipe below: `demoBefore` from the
  founder's `Desktop\AIassets\finaledited.mp4`. The regions, the method and the checks are in vault 0111. **`demoAfter` is not blurred**: its URL step shows that text on purpose, the founder's call
  (vault 0123). The A wizard's example in storage is still the 2026-10-15 pair
  (`samples/a-steps/recording-v2.mp4`, a 720p `-crf 28` encode of the blurred recording, and
  `ad-v2.mp4`, the `demoAfter` of then).
- **The `hookClips` carry no text, and the page draws none over them.** Step 2 shows the bank
  clips bare, as they sit in the bank.
- **Encode for the web, not the archive.** The sources were 174 MB; these files are 11 MB. The
  recipe (ffmpeg): `-map 0:v:0 -an -map_metadata -1 -c:v libx264 -preset slow -pix_fmt yuv420p
-movflags +faststart`, scaled and centre-cropped to 720×1280 at `-crf 26` (hooks, presenter) or
  `-crf 30` (`demoAfter`); `textBlockSample` is the hooks' 720×1280 at `-crf 26`, which keeps its
  burned text block readable at the 208–256px the page draws it. `demoBefore` is 87 s of a filmed monitor and moiré does not compress,
  so it is 540×960 with `hqdn3d=4:4:8:8` at `-crf 32` — the same picture at the ~200px the page
  draws it. `-map_metadata -1` is not optional: a phone recording carries its creation time
  (and can carry its location). Posters are each clip's first frame (`-frames:v 1 -q:v 4`), except
  `textBlockSample`'s, taken at 5 s (`-ss 5`) where the cut watermelon shows, and
  `presenterSample`'s, taken at 1 s (`-ss 1`): its first frame is mid-whip, a motion blur.
- **Stills**: `hookStudioShot` and `instagramShot` are screenshots. Crop `instagramShot` to a
  phone aspect — its frame is shaped for it.
- **Hook lines** are copy, not assets: they live beside the clips in `landing-media.ts`, but no
  clip shows its line — they appear only in step 3's option-list mock, until `hookStudioShot`
  replaces it.

## Also in that file

`presenterName` (the presenter the `#proof` band names) and `instagramUrl`. Leaving
`instagramUrl` as `null` hides the link and nothing else — the band still renders.

`instagramShot` is the one slot that draws no still: while its `src` is `null` the `#proof` band
renders as a single column and the phone frame is not there at all. Setting its `src` (step 2
above) brings the frame and the two-column layout back — there is no flag to flip.
