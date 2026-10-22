---
type: decision
status: verified
verified: 2026-10-22
method: "Founder's two task prompts in one session, 2026-10-22: (1) 'replace the service B example video with the one in C:\\Users\\USER\\Desktop\\AIassets\\bServiceExample.mp4, do so for the example video in the landing page and also the home page; also do the same for the service A example video ... serviceAExample.mp4; for the service A video I'm aware that it has sensitive information, thats on purpose, dont blur anything'; (2) 'yes the before and after should match ofcourse, I just rerecorded a new service a demo, the raw upload is at: C:\\Users\\USER\\Desktop\\demos\\newnewserviceA.mp4 and the finished demo made from it is at: C:\\Users\\USER\\Desktop\\demos\\madefromserviceaDemo.mp4; the service B video is good as is, merge when you're done, make sure you do the same for the service a flow in the upload demo step (the before and after there need updating aswell)'. MEASURED on branch feat/new-example-videos (from origin/main 15eb476): ffprobe of every source and encode; contact sheets of every encode; each public file fetched from the dev server at localhost:3000 and hash-compared with the working tree; headless Chrome over CDP against the same server; the storage upload with download read-back and a signed GET (packages/core/.work/upload-a-samples-v3.ts, gitignored)."
source: founder
supersedes: "[[0111-the-a-example-footage-has-its-browser-text-blurred]] §1 and §4's keys, for every copy of the A example"
---

# 0123 — New A and B example clips everywhere they show; the A pair ships unblurred

Tags as in [[0099-service-c-phase-2-opens-to-customers]].

## 1. Both services' examples are replaced, and the A before and after are one pair

**FOUNDER-REPORTED, 2026-10-22.** The sources, read and never edited:

| Service | Source                                   | Copies                                                                                                   |
| ------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A, raw  | Desktop `demos\newnewserviceA.mp4`       | landing `demoBefore` (`demo-before.mp4` + `.jpg`); storage `assets/samples/a-steps/recording-v3.mp4`     |
| A, ad   | Desktop `demos\madefromserviceaDemo.mp4` | landing `demoAfter` (`demo-after.mp4` + `.jpg`); home card `previews/hook-demo`; storage `.../ad-v3.mp4` |
| B       | Desktop `AIassets\bServiceExample.mp4`   | landing `presenterSample` (`presenter.mp4` + `.jpg`); home card `previews/presenter`                     |

The ad is made from the raw recording, so the landing's before/after row, its steps 1 and 4, and
the A wizard's demo step all show one pair. His first A pick, `AIassets\serviceAExample.mp4`, was
replaced in the same session before the merge, when he confirmed the before and after should match.

## 2. The A footage is not blurred

**FOUNDER-REPORTED.** His words: he is aware it has sensitive information, it is there on purpose,
blur nothing. This reverses [[0111-the-a-example-footage-has-its-browser-text-blurred]] §1 for every
copy. **MEASURED:** the URL step in both A files shows the tab bar and the address bar's suggestion
list, and every copy keeps them. Not quoted here, as in 0111.

## 3. The demo step's pair is on new keys

**FOUNDER-REPORTED:** the demo step's before and after are updated too. **MEASURED:** uploaded
2026-10-22 with `upsert: false` (it fails rather than overwrites): `recording-v3.mp4` (16,356,983
bytes) and `ad-v3.mp4` (2,764,246, the same file as the landing's `demo-after.mp4`). Each was
downloaded back and served through a signed URL (`200 video/mp4`), and both matched the uploaded
bytes. New keys for 0111 §4's reason, the hour-long cache. `A_SAMPLE_RECORDING_PATH` and
`A_SAMPLE_AD_PATH` (`apps/web/src/lib/service-a.ts`) name them. Nothing was deleted: the `-v2`
pair and the original pair stay in the bucket (state-of-play's owed list).

## 4. Planning defaults (mine, not his)

- **PLANNING DEFAULT:** the landing's B poster is taken at 1 s, not the first frame. **MEASURED:**
  frame 0 is in the middle of the whip hook effect, a motion blur of the presenter.
- **PLANNING DEFAULT:** the raw recording is encoded at its own 480×854 (the source's size; the
  recipes' 540×960 and 720×1280 would upscale) and at 30 fps (the source is 59.94).
- **PLANNING DEFAULT:** the landing's `demoBefore` at `-crf 34`, not the recipe's 32: 4,649,579
  bytes against 6,652,805, and a frame of on-screen text at 40 s reads the same at both; `-crf 36`
  blurred it.

## 5. The files (MEASURED, 2026-10-22)

| File                       | Encode                                       | Bytes      | Frames / s   |
| -------------------------- | -------------------------------------------- | ---------- | ------------ |
| `landing/demo-before.mp4`  | 480×854, 30 fps, `hqdn3d=4:4:8:8`, `-crf 34` | 4,649,579  | 2680 / 89.33 |
| `landing/demo-after.mp4`   | 720×1280, `-crf 30`                          | 2,764,246  | 451 / 15.03  |
| `landing/presenter.mp4`    | 720×1280, `-crf 26`                          | 3,184,552  | 522 / 17.40  |
| `previews/hook-demo.mp4`   | crop 1080×1248 at y 268 → 540×624, `-crf 28` | 1,842,121  | 451 / 15.03  |
| `previews/presenter.mp4`   | the same                                     | 1,140,356  | 522 / 17.40  |
| storage `recording-v3.mp4` | 480×854, 30 fps, `-crf 28`                   | 16,356,983 | 2680 / 89.33 |

All H.264 High, yuv420p, no audio track (the raw recording and the B source have one; the recipe
drops it), no metadata. Stills: `demo-before.jpg` and `demo-after.jpg` frame 0, landing
`presenter.jpg` 1 s, `hook-demo.jpg` 0.5 s, previews `presenter.jpg` 1 s. Every burned line (A's
hook and step labels, B's captions) falls inside the home card's 268–1516 window on the contact
sheets.

**In a browser:** the dev server served all ten public files byte-identical to the working tree.
Headless Chrome on `/` played `demo-before.mp4` and `demo-after.mp4` in both their places and
`presenter.mp4` in `#presenter` (readyState 4, the sizes and durations above); both `/previews/`
clips played at 540×624, and `recording-v3.mp4` played at 480×854. Not opened signed in: the
`/home` cards and the demo step, whose code is unchanged and which name the files and keys above.

## Related

[[0100-home-cards-show-example-clips-landing-sells-three]] ·
[[0111-the-a-example-footage-has-its-browser-text-blurred]] · [[8d-demo-step-rework]]
