# Dashboard previews

The example clip each service card on `/home` shows in place of its description
(`apps/web/src/app/home/pathway-cards.tsx`, vault decision 0100). Served statically at
`/previews/<filename>`.

| Card               | Clip             | Still            | Source (founder's file)                                       |
| ------------------ | ---------------- | ---------------- | ------------------------------------------------------------- |
| `הוק + דמו`        | `hook-demo.mp4`  | `hook-demo.jpg`  | `AIassets\serviceAExample.mp4` (since 2026-10-22, vault 0123) |
| `סרטון עם דמות AI` | `presenter.mp4`  | `presenter.jpg`  | `AIassets\bServiceExample.mp4` (since 2026-10-22, vault 0123) |
| `גוש טקסט`         | `text-block.mp4` | `text-block.jpg` | `c`                                                           |

## How the card uses them

- At rest the card shows only the still. The clip is fetched the first time the cursor enters the
  card, plays silent and looping with no controls while the cursor stays, and starts again from
  the beginning on every hover. Leaving brings the still back.
- On a touch screen (no hover) the clip plays while its card is on screen; a tap opens the wizard.
- The clip is cropped to about 1:1 (founder, vault 0100 S6), in the file itself: the card shows
  the whole file.

## What the files should be

- **No audio track.** The card never plays sound, so the encode drops it.
- **540×624: the 1080×1920 frame less its top 14% and bottom 21%.** He allowed up to 10% off the
  top and 25% off the bottom; the same 65% window sits 4% lower because `b`'s captions and the
  second line of `a`'s step labels cross the 75% line. Check a new clip's text against the window
  before reusing it. The card draws the clip 208 CSS px wide (about 198 on screen under the pane's
  0.95 zoom); 540 covers a 2× screen with margin and keeps the burned text readable.
- **The recipe** (ffmpeg): `-map 0:v:0 -an -map_metadata -1 -vf
"crop=1080:1248:0:268,scale=540:624:flags=lanczos" -c:v libx264 -preset slow -crf 28 -pix_fmt
yuv420p -movflags +faststart`. No denoise: it smears burned text. `-map_metadata -1` drops the
  phone's creation time and location.
- **Stills** are one frame of the encode, `-ss <t> -frames:v 1 -q:v 4`, picked where the burned
  text is on screen: `hook-demo` at 0.5 s, `presenter` at 1 s, `text-block` at 5 s.
- **Size.** Keep each file under the largest clip in `public/landing/` (3.7 MB); `presenter.mp4`
  is the largest here at 1.1 MB.
- **`hook-demo.mp4` is not blurred** (2026-10-22, vault decision 0123): its URL step shows the
  browser's tab title and suggestion list, on purpose — the founder's call. The 2026-10-15 copy it
  replaced had that text blurred (vault 0111).

Replacing a clip is a file drop under the same name plus a new still; there is nothing to edit.
