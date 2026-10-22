---
type: decision
status: verified
verified: 2026-10-15
method: "Founder decisions 1–4 of A2 of the task prompt 'blur the Service A example footage; rework /pricing with the ₪5 card' (2026-10-15), with his reasons where given, and its three planning defaults; his session OK of the same day on the review stills ('OK, encode with these regions. Once the frame checks pass you may upload the two new objects to samples/a-steps/recording-v2.mp4 and ad-v2.mp4 (no delete).'). MEASURED on branch fix/blur-a-example-footage (from origin/main e08a7c2): ffprobe of every copy and source; each committed copy and storage object re-encoded byte-for-byte from its source with its README recipe; a read-only list and download of assets/samples/a-steps; the blur, compare and sharpness scripts (packages/core/.work/blur-a/, gitignored, not committed); the upload with read-back; headless Chrome over CDP against the dev server at localhost:3000."
source: founder
supersedes: "[[0100-home-cards-show-example-clips-landing-sells-three]] §6 S2 ('a ships unedited')"
---

# 0111 — The Service A example footage has its browser text blurred

Tags as in [[0099-service-c-phase-2-opens-to-customers]]: **FOUNDER-REPORTED**, **MEASURED**,
**REASONED**, **PLANNING DEFAULT** (the planning assistant's, not struck by him). Decisions 1–4
are FOUNDER-REPORTED, 2026-10-15. Where no reason is given, he gave none.

## 1. The sensitive text in the URL step is blurred on every copy of the footage

**2026-10-22:** superseded for the home card's `hook-demo.mp4` and the landing's `demo-after.mp4`,
which now hold a new ad that ships unblurred on the founder's call
([[0123-new-a-and-b-example-clips-a-ships-unblurred]]). `demo-before.mp4` and the storage pair keep
this blur.

**FOUNDER-REPORTED.** His reason: the text is sensitive, and the footage is on the public landing.
This reverses [[0100-home-cards-show-example-clips-landing-sells-three]] §6 S2, where he chose to
ship `a` unedited after the session flagged its tab titles and an address bar.

**MEASURED, what the text is:** the browser tab's title (a personal search), the bookmarks bar,
and the address bar's suggestion and history list (personal searches, names and a medication). It
is not quoted anywhere in the repo or the vault. Every copy of the footage showed it:

| Copy                                            | Source                              | Blurred                                                                                                                                                                               |
| ----------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/previews/hook-demo.mp4` (home card)     | Desktop `materialfortavnit\a.mp4`   | 2.93–4.93 s (URL step); 8.93–10.93 s (the wizard's sample recording playing inside the upload step); 10.93–11.07 s (the steps screen's first frames, whose text quotes the tab title) |
| `public/landing/demo-after.mp4`                 | `Downloads\finishedHookAndDemo.mp4` | 2.93–5.93 s                                                                                                                                                                           |
| `public/landing/demo-before.mp4` and its poster | Desktop `AIassets\finaledited.mp4`  | 0–7.37 s (the recording opens on it, so the poster, frame 0, had it)                                                                                                                  |
| storage `assets/samples/a-steps/recording.mp4`  | the same `finaledited.mp4`          | → replaced by `recording-v2.mp4`, 0–7.37 s                                                                                                                                            |
| storage `assets/samples/a-steps/ad.mp4`         | byte-identical to `demo-after.mp4`  | → replaced by `ad-v2.mp4`, 2.93–5.93 s                                                                                                                                                |

**MEASURED, also:** the prompt's "the storage `recording.mp4` is itself full-res" was not so; it is
a 720×1280 `-crf 28` encode of `finaledited.mp4` (2,624 frames, the same as `demo-before`).
Desktop `a` is not the ad in `demo-after` (14.93 s against 17.93 s, a different demo recording).
The home card's crop (rows 268–1516) already hides `a`'s address bar with a production row id at
12.9–14.9 s, so that needed nothing. The two other stills show only the hook clip and came out
byte-identical (`hook-demo.jpg` at 0.5 s, `demo-after.jpg` at frame 0).

## 2. From the sources, never from a committed copy that has one

**FOUNDER-REPORTED.** His reason: no second encode of a 540p file; his files stay untouched (0100
§3). **MEASURED:** every copy reproduces byte-for-byte from the source above with its README's
recipe (the landing's and the previews'; the storage recording is the landing's 720p recipe at
`-crf 28`), so the sources are proven, not guessed. The sources were only read.

## 3. No file came from him

**FOUNDER-REPORTED.** None was needed: every source was on his machine.

## 4. Storage writes waited for his OK in the session; nothing in storage is deleted

**FOUNDER-REPORTED.** His OK came after the review stills, for the two new keys only, with no
delete. **MEASURED, why new keys:** both old objects were written with upsert at
`cacheControl max-age=3600` and had already been overwritten once (2026-09-25), so a replaced
object can serve old bytes for up to an hour. Uploaded 2026-10-15 under
`assets/samples/a-steps/recording-v2.mp4` (18,589,850 bytes) and `ad-v2.mp4` (1,801,336, the
same file as the new `demo-after.mp4`). Each was downloaded back and compared byte for byte, and both
match. `A_SAMPLE_RECORDING_PATH` and `A_SAMPLE_AD_PATH` (`apps/web/src/lib/service-a.ts`) now
name them. The old `recording.mp4` and `ad.mp4` remain in the bucket, unreferenced once this ships;
deleting them is his call (state-of-play's owed list).

## Planning defaults (unstruck)

- **PLANNING DEFAULT:** the home card's copy and its still are included: same footage.
- **PLANNING DEFAULT:** "unreadable" means unreadable at the source's full resolution on every
  frame the text is on screen, the suggestion and history list included.
- **PLANNING DEFAULT:** a still beside a changed clip is regenerated from the blurred encode.
  `demo-before.jpg` changed (37,656 → 7,095 bytes); the other two came out identical.

## 5. The regions (session, 2026-10-15)

**FOUNDER-REPORTED:** he approved the regions on one review still per copy (the frame as the copy
shows it, outlined, beside the blurred result), kept in the session scratchpad and never committed.
**REASONED, the method:**

- **Blur:** a box blur of radius 28 source px, three passes (about a Gaussian of σ 28), on luma,
  and radius 14 on chroma. It runs on the source frames at full resolution, inside each region,
  before the copy's own recipe.
- **Regions:** in the URL steps, the whole browser (the frame below row 380 for `a`, the whole
  frame for the other two). In the inner playback, a box that follows the inner window frame by
  frame (its purple body's edges, ±2 frames, up to the frame's top). In the steps screen, a fixed
  box. The first draft placed that box from a frame one step late; the frame check caught it, and
  it was widened to rows 200–580.
- **Kept sharp:** the typed `tavnit.ai`, because it is what the step tells the viewer to type,
  restored in a box set per time window and checked on every frame to hold the address and
  nothing else. Also kept: the burned step labels (`כנס לכאן`, `כנסו לכאן`, `מעלים סרטון
לאפליקציה`), restored by their own yellow and outline, in proportion to how visible the label is
  in each frame, so nothing behind a label shows while it fades in.
- **Pipe:** frames are decoded to raw yuv420p, changed only inside the regions, and piped into the
  recipe's ffmpeg with the source's colour tags and chroma location. With nothing blurred, this
  reproduces all four files byte-for-byte.

## 6. The checks

All MEASURED, 2026-10-15:

| File (size before → after)                             | Frames changed | Outside the windows: bit-identical | New vs old fidelity to the source, outside the regions | Edge sharpness inside, old → new |
| ------------------------------------------------------ | -------------- | ---------------------------------- | ------------------------------------------------------ | -------------------------------- |
| `hook-demo.mp4` (2,226,382 → 1,755,658)                | 124            | 222 of 324                         | mean −0.05 dB, worst −1.7 dB (31.2 → 31.35 dB worst)   | 39–76 → ≤ 4                      |
| `demo-after.mp4` = `ad-v2.mp4` (2,321,721 → 1,801,336) | 90             | 317 of 448                         | worst −0.1 dB                                          | 38–42 → ≤ 3                      |
| `demo-before.mp4` (4,161,140 → 3,726,755)              | 221            | 2,290 of 2,403                     | worst −0.09 dB                                         | 36–60 → ≤ 3                      |
| `recording-v2.mp4` (20,341,312 → 18,589,850)           | 221            | 2,403 of 2,403                     | —                                                      | 24–44 → ≤ 3                      |

- **Probe parity:** each file keeps its codec (H.264 High, yuv420p), dimensions, crop, exact
  frame count and duration, and has no audio track.
- **Outside the regions:** frames outside the blur windows that differ at all are re-spent bits.
  x264's look-ahead sees the changed frames, so the new copy is as close to the source as the old
  one (the fidelity column).
- **Inside:** "edge sharpness" is the 99.5th percentile of |Laplacian| of luma inside the blurred
  area (less the kept box and the label), on every changed frame. Text gives 24–76; what is left
  gives at most 4. Contact sheets of the changed frames at each copy's own resolution were also
  looked at.
- **In a real browser:** headless Chrome over CDP against the dev server at localhost:3000:
  - the landing plays `demo-before.mp4` and `demo-after.mp4` in all four of their places, with
    their posters;
  - the home card shows `hook-demo.jpg` at rest and plays `hook-demo.mp4` on hover;
  - the A wizard's demo step plays the pair signed from the `-v2` keys.

  The home card and the demo step were mounted in a throwaway public page, with every API call
  mocked: the real `PathwayCards` and `StepDemo`, the samples signed from the two constants as the
  demos route signs them. Nothing was signed in, and the page was deleted afterwards. The dev
  server served all six files byte-identical to the commit.

- **Not rewritten:** the old encodes stay in git history (private repo; accepted in the prompt).

## Related

[[0100-home-cards-show-example-clips-landing-sells-three]] · [[8d-demo-step-rework]] ·
[[storage-census-2026-08-26]] · [[0061-landing-positioning-two-services-no-results-claims]]
