# Dashboard previews

The example clip each service card on `/home` shows in place of its description
(`apps/web/src/app/home/pathway-cards.tsx`, vault decision 0100). Served statically at
`/previews/<filename>`.

| Card               | Clip             | Still            | Source (founder's file) |
| ------------------ | ---------------- | ---------------- | ----------------------- |
| `הוק + דמו`        | `hook-demo.mp4`  | `hook-demo.jpg`  | `a`                     |
| `סרטון עם דמות AI` | `presenter.mp4`  | `presenter.jpg`  | `b`                     |
| `גוש טקסט`         | `text-block.mp4` | `text-block.jpg` | `c`                     |

## How the card uses them

- At rest the card shows only the still. The clip is fetched the first time the cursor enters the
  card, plays silent and looping with no controls while the cursor stays, and starts again from
  the beginning on every hover. Leaving brings the still back.
- On a touch screen (no hover) the clip plays while its card is on screen; a tap opens the wizard.
- The whole 9:16 frame is shown, never cropped: the burned text is the point of the example.

## What the files should be

- **No audio track.** The card never plays sound, so the encode drops it.
- **540×960, the whole frame.** The card draws the clip 208 CSS px wide (about 198 on screen under
  the pane's 0.95 zoom); 540 covers a 2× screen with margin and keeps the burned text readable.
- **The recipe** (ffmpeg): `-map 0:v:0 -an -map_metadata -1 -vf scale=540:960:flags=lanczos
-c:v libx264 -preset slow -crf 28 -pix_fmt yuv420p -movflags +faststart`. No denoise: it smears
  burned text. `-map_metadata -1` drops the phone's creation time and location.
- **Stills** are one frame of the encode, `-ss <t> -frames:v 1 -q:v 4`, picked where the burned
  text is on screen: `hook-demo` at 0.5 s, `presenter` at 1 s, `text-block` at 5 s.
- **Size.** Keep each file under the largest clip in `public/landing/` (4.2 MB); `hook-demo.mp4`,
  a filmed monitor whose moiré compresses badly, is the largest at 2.7 MB.

Replacing a clip is a file drop under the same name plus a new still; there is nothing to edit.
