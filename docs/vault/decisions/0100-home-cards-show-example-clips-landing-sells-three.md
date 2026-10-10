---
type: decision
status: verified
verified: 2026-10-10
method: "Founder decisions 1–5 from the planning chat of 2026-10-10, recorded from that day's task prompt ('example videos on the home boxes, a higher home heading, גוש טקסט on the landing'), which states them as decided; the reasons are his where given. Three more rulings in this task's session (S1–S3), answers to the session's questions. The planning defaults are the planning assistant's; he struck none. MEASURED on branch feat/home-previews-landing-c (from origin/main ecbb9eb) with the dev server at localhost:3000: headless Chrome over CDP, signed in as the founder-owned customer account tavnit.support through a minted magic-link session (S3); ffprobe on the source files and the committed copies; a read-only SELECT on production (text_block_clips) and a GET of /api/personas?withTextBlocks=1. The scripts lived in the session scratchpad and are not committed."
source: founder
---

# 0100 — The home cards show example clips; the heading moves up; the landing sells three services

Tags as in [[0099-service-c-phase-2-opens-to-customers]]: **FOUNDER-REPORTED** (his ruling or
statement), **MEASURED** (read in the tree or run), **REASONED** (the session's inference or choice),
**PLANNING DEFAULT** (the planning assistant's, not struck by him). No options were offered for
decisions 1–5; where no reason is given he gave none.

## 1. The home cards show an example clip in place of the description

**FOUNDER-REPORTED.** The service name stays and the card opens the same wizard.

**MEASURED:** `apps/web/src/app/home/pathway-cards.tsx`: each card is the icon, the name and its
link line (`יצירת מודעה` / `יצירת סרטון`) over the clip. The description is no longer on screen;
it stays in the card as `sr-only` text (PLANNING DEFAULT), so the link's accessible name is
unchanged. The hrefs are unchanged.

## 2. The clip plays only while the cursor is on the card, silent, with no controls

**FOUNDER-REPORTED.** His reason: "this will be just a preview".

**MEASURED** (717×621, mouse):

- Before the first hover the page requests only the three stills; no `<video>` exists.
- Hovering mounts the card's `<video>`: muted, looping, no controls, the only video in the pane.
- Leaving unmounts it and the still is back. Hovering again starts from the beginning (3.49 s on
  the first hover, 0.68 s just after the second).
- At 11 s on the 10 s clip it had looped and was still playing. A click opens its wizard.

**PLANNING DEFAULTS** (kept): the clip loops while hovered and every hover starts from the
beginning; on a touch screen (`hover: none`) the clip plays while its card is on screen and a tap
opens the wizard. **MEASURED** at 375×812 with touch emulation: the cards at least 60% in view
play, swiping the row hands playback to the next ones, and a tap opens `/home/c/new`.

**REASONED:** each card owns its element and uses `autoPlay` rather than a `play()` promise, so the
shape of [[a-failed-preview-play-can-stop-another-clip]] cannot arise here; the clip stays
invisible until its first frame plays, so a blocked start shows the still.

## 3. The sources

**FOUNDER-REPORTED:** `C:\Users\USER\Desktop\materialfortavnit\` `a` for הוק + דמו, `b` for סרטון
עם דמות AI, `c` for גוש טקסט. His files stay untouched; only web copies are committed.

**MEASURED** (ffprobe), all MP4, H.264, exactly 1080×1920 (0% off 9:16, inside
[[0013-hook-clips-near-9-16-not-exact-1080x1920]]'s 3%):

| file | length  | size       | audio            |
| ---- | ------- | ---------- | ---------------- |
| a    | 14.93 s | 27,763,828 | none             |
| b    | 19.03 s | 19,557,380 | AAC stereo 48kHz |
| c    | 10.11 s | 6,211,418  | AAC stereo 48kHz |

The committed copies, all video-only (`-an`, metadata stripped):

| file                             | size      |
| -------------------------------- | --------- |
| `public/previews/hook-demo.mp4`  | 2,713,588 |
| `public/previews/hook-demo.jpg`  | 60,008    |
| `public/previews/presenter.mp4`  | 1,074,438 |
| `public/previews/presenter.jpg`  | 53,756    |
| `public/previews/text-block.mp4` | 543,381   |
| `public/previews/text-block.jpg` | 48,504    |
| `public/landing/text-block.mp4`  | 1,057,139 |
| `public/landing/text-block.jpg`  | 73,476    |

Every file is under the largest clip already in `public/landing/` (`demo-before.mp4`,
4,161,140). The recipes are in the two READMEs.

## 4. The home heading moves up

**FOUNDER-REPORTED.** His reason: the space above it is wasted, and he has to scroll to see the
recent videos in full. **FOUNDER-REPORTED, not repo-verified:** on his screen `/home` needs a
scroll to show the recent strip in full.

**MEASURED:** the page wrapper's top padding went from 40 px to 16 px (20 px at `md`, where the
heading must still clear the credits pill's band). The heading's top below the pane: 38 → 15
screen px at his window, 68 → 49 at desktop widths. The shaped skeleton in `home/page.tsx` moved
with it. `home/loading.tsx` and `home/error.tsx` copy each other's wrapper (`max-w-2xl pt-8`), not
the page's, so they were left as they are.

## 5. The landing sells three services, and גוש טקסט has its own section

**FOUNDER-REPORTED.** This replaces [[0061-landing-positioning-two-services-no-results-claims]]
§1's two-card strip and lifts the landing part of the hold in
[[0089-service-c-text-block-exists-admin-only-phase-1]] §5 and
[[0099-service-c-phase-2-opens-to-customers]] §9. `/pricing` and the legal pages stay held. 0061
§2 to §4 bind the new section: no results claim, no number, no credits or shekels, and the
vocabulary rules. His 200-views post (0099 §1) is not landing copy.

**MEASURED:** `apps/web/src/app/page.tsx`. `#features` is three cards (`#how`, `#presenter`, and the
new `#text-block`) under `שלושה סוגי סרטונים. שאלון אחד.`. The new section comes after
`#presenter` (PLANNING DEFAULT) and plays `textBlockSample` through `MediaSlot` like the landing's
other clips (PLANNING DEFAULT). It fetches nothing until scrolled near, then autoplays muted and
loops with no controls. From `/pricing`, `/terms` and `/about` the shared header's and footer's
`/#features` and `/#how` land on their sections (top at 96 px, the `scroll-mt-24`).

**REASONED, one line outside the sections:** the shared footer's tagline (`site-footer.tsx`) listed
two services as the whole set ("הוק + דמו …, או פרזנטור AI …") right under a strip that now says
three, so it gained גוש טקסט. The same footer renders on `/pricing` and the legal pages; nothing
else on them changed.

**The copy is the session's draft (PLANNING DEFAULT), pending his approval before the merge.** Every
claim it makes, read back:

- One questionnaire feeds all three services: the strip heading.
- Each character has clips of its own: `text_block_clips.persona_id` (0099 §3).
- The clip plays once, start to finish, with its own sound; the text is burned for its whole
  length: [[0090-text-block-format-clip-once-with-its-own-sound]]. `C_CLIP_COPY.sub` already says
  the first part.
- The text is written from the questionnaire, in the character's first person:
  `prompts/text_block/v3.md` lines 24 and 68.
- The business is mentioned in passing and never offered, with no call to action:
  `prompts/text_block/v3.md`, "Never an ad", lines 28–52; it is the founder's ruling of
  2026-10-07. **REASONED:** this is what the generator is told. The customer's free edit can
  change anything, so the copy claims it of what תבנית writes, not of every finished video.
- "טקסט אחר" asks for another text: `C_ANOTHER_TEXT`, served by `serveNextTextBlock` (0099 §4).
- The text can be edited freely and placed on the clip: 0099 §8 and §6.
- "Like text typed on TikTok or Instagram" is the home card's line, approved 2026-10-09.
- No number, no length, no price; the C path says `טקסט`, never `כתוביות` (it is not captions)
  and never `קריינות`.

## 6. Session rulings (2026-10-10)

- **S1, FOUNDER-REPORTED: readable clips over the page fitting his window.** His window is 717×621
  (`innerWidth` × `innerHeight`, read by him on `/home`). Below 768 px wide, `/home` is in its
  phone layout: no sidebar, and a 56 px top bar above a 565 px pane. The burned text is about 52 px
  in a 1920 px frame, so it reads only once a clip is roughly 330 px tall or more. That is most of
  the pane, so the cards could not hold a readable uncropped clip while the page fit. Four options
  were offered, each screenshotted on the signed-in page at his window:
  1. fit with a small clip: 86×152, overflow 0, text unreadable;
  2. **readable, the page scrolls** (chosen): 199×353, overflow 245;
  3. fit, and the clip grows to 188×334 over the page while hovered: overflow 0;
  4. fit with a 16:9 band cropped around the text: 204×114, overflow 0, crops the frame and the
     presenter's face.

  He gave no reason. This supersedes the prompt's goal that the recent strip be fully visible
  without scrolling at his window.

- **S2, FOUNDER-REPORTED: `a` ships unedited.** The session flagged, without quoting them, two
  browser-tab titles that look personal (around 3–5 s and 9 s) and an address bar showing a URL
  with a production row id (around 13–14 s), in a file public at tavnit.ai and shown to every
  customer. The options offered: blur those areas in the web copy (recommended), use it as is
  (chosen), or he sends a new file.
- **S3, FOUNDER-REPORTED: the measuring account.** A magic-link session for tavnit.support (one
  business, one render), over his admin account (66 renders) or no session. A long strip was then
  measured by answering the renders request with that one row copied 30 times, in the browser
  only; that strip gets a 15 px sideways scrollbar.

## 7. What it costs in height

**MEASURED**, `main.scrollHeight - main.clientHeight` on the signed-in `/home` (0 = fits), as
[[0011-dashboard-content-renders-at-95-percent]] defines it:

| window                 | before | after |
| ---------------------- | ------ | ----- |
| 717×621, one render    | 412    | 243   |
| 717×621, a long strip  | 428    | 259   |
| 1366×768, one render   | 0      | 66    |
| 1366×768, a long strip | 0      | 82    |
| 375×812 (touch)        | 457    | 14    |

The smallest window height that fits:

| width                   | before | after |
| ----------------------- | ------ | ----- |
| 1024–1920, one render   | 719    | 830   |
| 1024–1920, a long strip | 734    | 846   |
| 717, one render         | 1013   | 852   |
| 717, a long strip       | 1028   | 867   |

**Before, the third card added a row at his width:** two cards per row at 640–1023 px (cards at 140
and 408). **After**, by a 1 px sweep of the window width at 900 px tall: a swipe row below 640, two
rows at 640–668, one row of three from 669, two rows again at 768–924 (the sidebar arrives at
768), one row from 925.

## 8. Reasoned, not founder-decided

- **The card is at most 208 px wide** (13rem, about 198 px on screen under the 0.95 zoom), the
  width option 2 had at his window. The cap stops a wide pane from blowing the clip up to 512 px
  tall. From `sm` the cards are a grid of at most three `minmax(12rem, 1fr)` columns, so a pane
  between 608 and 656 px shrinks them to 192 rather than wrapping the third. The first build used
  `minmax(12rem, 13rem)`, and the sweep showed it wrapping below a 715 px window, 2 px under his
  717: `auto-fit` counts tracks by their maximum when the maximum is a fixed length. On a phone
  the cards are a swipe row that bleeds to the edges.
- **The hover is a darker ring, not the lift and shadow:** the phone row's scroller would clip a
  shadow. The gradient header band is gone; the icon and the link line moved into a compact
  header.
- **Two encodes of `c`:** 540p for the card (shown about 198 px wide), 720p for the landing (208–256
  px), each checked readable at its size in a 1× and a 2× screenshot. 540p without denoise reads;
  the smear state-of-play recorded was the 540p `demoBefore`, which carries `hqdn3d`.
- **Phase 2's customer path is not empty:** `GET /api/personas?withTextBlocks=1` as a customer lists
  2 characters, and production has 2 active `text_block_clips`, both with a character (read-only,
  2026-10-10). So the new landing section does not send a visitor to an empty picker. A customer
  render in production has still not been seen (0099 "Not verified").

## Related

[[0061-landing-positioning-two-services-no-results-claims]] ·
[[0089-service-c-text-block-exists-admin-only-phase-1]] ·
[[0099-service-c-phase-2-opens-to-customers]] ·
[[0010-where-render-progress-is-shown]] · [[0011-dashboard-content-renders-at-95-percent]] ·
[[0090-text-block-format-clip-once-with-its-own-sound]]
