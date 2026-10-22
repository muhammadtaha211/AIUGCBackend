---
type: decision
status: verified
verified: 2026-10-22
method: "Founder's task prompt, 2026-10-22: 'replace the service B example video with the one in C:\\Users\\USER\\Desktop\\AIassets\\bServiceExample.mp4, do so for the example video in the landing page and also the home page; also do the same for the service A example video, the new video is at ...\\serviceAExample.mp4; for the service A video I'm aware that it has sensitive information, thats on purpose, dont blur anything'. MEASURED on branch feat/new-example-videos (from origin/main 15eb476): ffprobe of both sources and the four encodes; contact sheets of every encode; each file fetched from the dev server at localhost:3000 and hash-compared with the commit; headless Chrome over CDP against the same server."
source: founder
supersedes: "[[0111-the-a-example-footage-has-its-browser-text-blurred]] §1, for the two A copies this note replaces"
---

# 0123 — New A and B example clips on the landing and the home cards; the A clip ships unblurred

Tags as in [[0099-service-c-phase-2-opens-to-customers]].

## 1. Both services' example clips are replaced, on the landing and on `/home`

**FOUNDER-REPORTED, 2026-10-22.** Sources, read and never edited:

| Service | Source (Desktop `AIassets\`) | Landing slot (`public/landing/`)             | Home card (`public/previews/`) |
| ------- | ---------------------------- | -------------------------------------------- | ------------------------------ |
| A       | `serviceAExample.mp4`        | `demoAfter` → `demo-after.mp4` + `.jpg`      | `hook-demo.mp4` + `.jpg`       |
| B       | `bServiceExample.mp4`        | `presenterSample` → `presenter.mp4` + `.jpg` | `presenter.mp4` + `.jpg`       |

Same filenames, so no code changed; each copy follows its README's recipe.

## 2. The A clip's browser text is not blurred

**FOUNDER-REPORTED.** His words: he is aware it has sensitive information, it is there on purpose,
blur nothing. This reverses [[0111-the-a-example-footage-has-its-browser-text-blurred]] §1 for the
two copies above. **MEASURED:** the source's URL step shows the tab title, the bookmarks bar and the
address bar's suggestion list, and both copies show them (the home card's crop keeps the list).
Not quoted here, as in 0111.

## 3. Planning defaults (mine, not his)

- **PLANNING DEFAULT:** the landing's B poster is taken at 1 s, not the first frame. **MEASURED:**
  frame 0 is mid-way through the whip hook effect and is a motion blur of the presenter.
- **PLANNING DEFAULT:** only what he named changed. Left as they were: `demoBefore` (the raw
  recording beside the ad in the before/after row and in step 1, still the 2026-09-25 recording with
  0111's blur, so it no longer is the recording the new ad was made from), and the A wizard's
  storage example `samples/a-steps/ad-v2.mp4` (still the old ad).

## 4. The files (MEASURED, 2026-10-22)

| File                     | Source                | Encode                                       | Bytes     | Frames / s  |
| ------------------------ | --------------------- | -------------------------------------------- | --------- | ----------- |
| `landing/demo-after.mp4` | `serviceAExample.mp4` | 720×1280, `-crf 30`                          | 1,594,658 | 391 / 13.03 |
| `landing/presenter.mp4`  | `bServiceExample.mp4` | 720×1280, `-crf 26`                          | 3,184,552 | 522 / 17.40 |
| `previews/hook-demo.mp4` | `serviceAExample.mp4` | crop 1080×1248 at y 268 → 540×624, `-crf 28` | 1,000,396 | 391 / 13.03 |
| `previews/presenter.mp4` | `bServiceExample.mp4` | the same                                     | 1,140,356 | 522 / 17.40 |

All H.264 High, yuv420p, no audio track (the B source has one; the recipe drops it), no
metadata. Stills: `demo-after.jpg` frame 0, `presenter.jpg` (landing) 1 s, `hook-demo.jpg` 0.5 s,
`presenter.jpg` (previews) 1 s. Every burned line (A's hook and step labels, B's captions) falls
inside the home card's 268–1516 window on the contact sheets.

**In a browser:** the dev server served all eight files byte-identical to the commit. Headless
Chrome on `/` played `demo-after.mp4` in both its places and `presenter.mp4` in `#presenter`
(readyState 4, 720×1280, 13.03 s and 17.40 s); both `/previews/` clips played at 540×624. The
`/home` card itself was not opened signed in: `PathwayCards` is unchanged and names the same paths.

## Related

[[0100-home-cards-show-example-clips-landing-sells-three]] · [[0111-the-a-example-footage-has-its-browser-text-blurred]]
