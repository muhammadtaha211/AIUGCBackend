---
type: decision
status: verified
verified: 2026-10-07
method: "Founder decisions 4–8 and 12 of the 2026-10-07 task prompt, plus its planning defaults A–C, which the prompt marks as assumed by planning and not ruled; the reasons are his. MEASURED in the tree at feat/service-c-text-block: packages/remotion/src/ServiceC.tsx, packages/remotion/src/render.ts (renderServiceC), packages/remotion/src/text-fit.ts, packages/remotion/src/overlays.tsx:15-22, packages/core/src/text-block.ts, packages/core/src/hook-geometry.ts (DEFAULT_TEXT_BLOCK_RECT), packages/core/src/pipelines/bank.ts (normalizeStoredClip), packages/core/src/media/ffmpeg.ts:182-219 (normalizeVideo), apps/admin/src/lib/text-blocks.ts. The example lengths were counted with a node one-liner over the Appendix A strings (code points, whitespace-split words). Amended 2026-10-07: ruling 4 from the founder's planning chat of 2026-10-07/08 (relayed by the phase 1b task prompt); his clip and screenshots measured with ffprobe and ffmpeg volumedetect, the look compared on ffmpeg frame crops of render:sample:c renders of his clip against the screenshots, all under packages/core/.work/text-block/ (gitignored)."
source: founder
---

# 0090 — The format: the clip once, with its own sound, under one typed-looking text block

Decisions 4–8 and 12 of 2026-10-07, with the three planning defaults the prompt attached to them.
Tags as in [[0089-service-c-text-block-exists-admin-only-phase-1]]: **FOUNDER-REPORTED**,
**MEASURED**, **REASONED**; **PLANNING DEFAULT** marks what the planning assistant assumed and the
founder did not rule, kept apart so a later ruling knows what it overrides.

## 1. Clips are founder-made offline and registered by hand (decision 4)

Never generated at runtime — locked decision #2's rule extends to this bank. One clip at launch.
Hook pickers never list these clips and גוש טקסט never lists hook clips. **FOUNDER-REPORTED.**

**MEASURED, how the two banks stay apart:** `text_block_clips` is its own table (0052). Service A's
hook listings read `hook_clips` only (`apps/web/src/app/api/hooks/route.ts`,
`apps/web/src/lib/persona-catalog.ts`), and `apps/web/test/hooks-never-list-text-blocks.test.ts`
registers one of each and asserts both listings and the A persona catalog never return the text
block clip. The admin register takes 3–60 s, ≤100 MB, near 9:16 (`apps/admin/src/lib/text-blocks.ts`)
— **PLANNING DEFAULT** for the bounds; hooks take 0.5–10 s, ≤50 MB.

**MEASURED, what normalisation does to the clip:** the same job as the hook bank
(`normalizeStoredClip` in `pipelines/bank.ts`, reached through `normalize_text_block_clip`): it
downloads, probes, and re-encodes **only** when the frame rate is more than 0.3 off 30; a clip at
rate is left byte for byte. When it re-encodes, `normalizeVideo` keeps the audio as AAC 128 kb/s
(`-c:a aac -b:a 128k`, `media/ffmpeg.ts:202-205`); nothing in the path drops a track.

## 2. Sound: no voice, no music; the clip's own recorded sound stays in the export (decision 5)

**FOUNDER-REPORTED, his call.** Ambient sound is not music — the same reading as the whoosh under
locked decision #7.

**MEASURED:** `ServiceC.tsx` mounts the clip with `<OffthreadVideo>` **without** `muted`, and
`renderServiceC` calls `runRender` with the default encode (`audioCodec: "aac"`, no `muted`, no
`enforceAudioTrack:false`) — the steps format is the one that passes `muted: true` to drop its
stream. `packages/remotion/test/service-c.test.tsx` pins the unmuted mount and
`test/render-args-c.test.ts` pins the encode arguments. The sample fixture
(`fixtures/text-block.mp4`, `pnpm fixtures`) carries a 440 Hz tone so a silent sample is audible
as a bug.

## 3. No emoji in v1, generated or typed (decision 6)

**FOUNDER-REPORTED.** 0059 stays pending. **MEASURED:** the burn check
(`findIllegalTextBlockChar`, `packages/core/src/text-block.ts`) allows the newline, ASCII, the
Hebrew block and `‘ ’ “ ” … ₪` and refuses everything else, so an emoji is refused at
generation, at edit and at render — not because of a rule about emoji but because it is outside
the set. The prompt also says "no emoji".

## 4. Length aim: 25–40 Hebrew words, one size throughout (decision 7)

**FOUNDER-REPORTED.** No larger first line. **MEASURED:** the aim is a prompt instruction
(`prompts/text_block/v1.md`: "Aim for 25–40 Hebrew words"); no code counts words.

**PLANNING DEFAULT B — the hard cap.** The prompt proposed 300 characters ("the longest of the 12
reference posts is about 300"). **MEASURED:** the founder's own examples in Appendix A, which he
asked to keep verbatim, run 128–396 code points; `instead` is 396 characters and 76 words,
`reframe` 47 words, `cautionary_confession` 44. **The default taken, pending his ruling:** the cap
is **400** code points (`TEXT_BLOCK_MAX_CHARS`), the examples stay verbatim, and the prompt tells
the model the examples show shape, not length. **REASONED:** the cap is a render rule — at the
40 px floor a 400-character block still fits the default area below — so 400 costs nothing the
300 would have bought.

**PLANNING DEFAULT C — an edited text still gets the character check and the cap, for render
reasons only.** **MEASURED:** `textBlockTextError` is the one check generation, the edit route
and `createTextBlockRender` all run; it has no content rule.

## 5. The look: typed in the app (decision 8)

White or the clip's colour, medium weight, a thin dark edge or soft shadow, no box, centred
lines, clearly lighter and smaller than `HookLine` and the captions. **FOUNDER-REPORTED;** the
reference screenshots were to be attached and were **not found** in the repo, the scratchpad or
any session folder on 2026-10-07, so the numbers below are the build's reading of the words, to
be tuned against the screenshots when they arrive. _(They arrived the same day and the numbers
were tuned: see the amendment, which supersedes the weight, edge, line height and default area
below.)_

**MEASURED, the numbers:** Heebo **500** (a second weight in the one `loadFont` call,
`overlays.tsx:15-22`; `docs/07-worker-box.md` §8 amended), `TEXT_BLOCK_FONT = { base: 54, min: 40,
lineHeight: 1.3 }`, fill white or black from the clip's `text_color` through the same
`HOOK_TEXT_INK` table as the hook line (0073), edge and shadow
`0 0 2px rgba(ink,0.9)` ×2 + `0 2px 12px rgba(ink,0.5)` in the ink's outline rgb, no box,
`text-align: center`, `white-space: pre-wrap`, one `unicode-bidi: isolate` span. Against the hook
line (92 px / 800 / four 5 px hard outline copies) and the captions (82 px / 800) it is lighter
and smaller. The fit is `fitParagraphFontSize`: split on `\n` first (the quiz keeps one question
per line, `founder_ask` its blank lines), greedy-wrap each paragraph, step down by 2 px from 54 to
the 40 px floor. The admin editor previews the same numbers through canvas `measureText` at
weight 500.

**MEASURED, the default area:** `DEFAULT_TEXT_BLOCK_RECT = { x: 80, y: 360, w: 820, h: 1040 }` —
a seed per clip like `DEFAULT_HOOK_TEXT_RECT`; right edge at 900 clear of the TikTok/Reels action
rail, bottom at 1400 clear of the caption band (the captions overlay's own clearance ends at
1480), centre at y 880.

## 6. Texts do not refer to the clip in v1; each clip carries a speaker gender (decision 12)

**FOUNDER-REPORTED.** Hebrew first person is gendered. **MEASURED:** `text_block_clips.speaker_gender`
is `NOT NULL CHECK IN ('female','male')` (0052), set at register and editable per card; it reaches
the prompt as `{{speaker_gender}}` and is pinned on each text's `params.speakerGender`. The prompt
says "The texts never refer to the clip."

## 7. Planning default A — the ad is the clip, once, start to finish

No loop, no cut, no hook animation, nothing stitched. **PLANNING DEFAULT.** **MEASURED:**
`calculateServiceCMetadata` probes the clip and sets `durationInFrames` to its length; the
composition is the one `<OffthreadVideo>` from frame 0 with the block over every frame; no
`Sequence`, no `Freeze`, no hook props.

## Not verified

- ~~The founder's clip … was not attached~~ — superseded 2026-10-07: it was attached and rendered;
  see the amendment below.
- No real render has run on the box; the box needs a pull and a restart for the new handler, the
  composition and the second font weight (`docs/07-worker-box.md` §11).

## Amended 2026-10-07 (founder, planning chat of 2026-10-07/08, relayed by the phase 1b task prompt)

**FOUNDER-REPORTED, ruling 4: the cap is 400 characters**, superseding planning default B's 300
(§4). His reason: it is "the longer end of the wall of text format", and the format is "built to
withstand that kind of length". **MEASURED:** `TEXT_BLOCK_MAX_CHARS = 400` already, now commented
as his ruling, and pinned by `text-block.test.ts`. The prompt's length rule now reads: "Most texts
stay short: around 25 to 40 words … 400 is the ceiling, for a text whose joke needs the room,
never the target". §4's "Aim for 25–40 Hebrew words" wording is gone from the prompt; the aim
stands as "most". §3's character set now also admits `–` and `—` ([[0091-text-block-texts-ten-skeletons-truth-rules-free-edit]], amended: refused
in generated text only).

**MEASURED, his clip and the screenshots.** He attached `cuttingwatermelown.mp4` and twelve
reference screenshots. Copies sit in `packages/core/.work/text-block/{clip,screenshots}/`,
gitignored and never committed.

- **The clip as he gave it** (ffprobe): 1080×1920, h264 at **24 fps**, video 10.042 s, AAC
  32 kHz stereo at 177 kb/s, 10.080 s. `volumedetect` reads mean −28.8 dB and max −3.1 dB.
- **Through the bank's own normalisation** (`normalizeVideo`, because `needsNormalize(24)` is
  true): 30 fps, video 10.033 s. The AAC stays 32 kHz stereo, re-encoded to 130 kb/s, still
  10.080 s, at mean −28.9 dB and max −3.3 dB. The sound survives, within 0.2 dB.
- **Rendered through `render:sample:c --clip`:** h264 1080×1920 at 30 fps, 10.067 s, plus AAC
  48 kHz stereo at 10.112 s, at mean −28.9 dB and max −3.3 dB. That is the clip's own sound at its
  own level, on every frame.

**MEASURED, the look against the screenshots, before → after** (frame crops and side-by-sides in
`.work/text-block/crops/`). What the screenshots set:

- **The typeface** is TikTok's classic text: a sans at semibold with a crisp dark edge, no box,
  centred.
- **Size.** Lines sit about 60–71 px apart at 1080 wide.
- **Width.** Lines wrap at roughly 55–75% of the frame, median about 63%.
- **Placement.** The block is centred near mid-frame, often over the face.

On his clip the phase 1 look read thinner and its edge went soft over the bright ceiling, the
block was wider than theirs, and lines were set looser. Tuned:

| Constant                                                                                          | Before                                                 | After                                                                                                        |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `TEXT_BLOCK_WEIGHT` (`ServiceC.tsx`), `loadFont` weights (`overlays.tsx`), admin preview `WEIGHT` | 500                                                    | **600**                                                                                                      |
| `textBlockShadow` (render and admin preview)                                                      | `0 0 2px rgba(ink,0.9)` ×2, `0 2px 12px rgba(ink,0.5)` | `0 0 3px rgba(ink,0.95)` ×2, `0 2px 10px rgba(ink,0.6)`                                                      |
| `TEXT_BLOCK_FONT.lineHeight` (`text-fit.ts`)                                                      | 1.3                                                    | **1.2**                                                                                                      |
| `DEFAULT_TEXT_BLOCK_RECT` (`hook-geometry.ts`), the sample and Studio defaults                    | `{x:80, y:360, w:820, h:1040}`                         | `{x:180, y:400, w:720, h:1040}`: 67% wide, centred on x 540, centre y 920, right edge still 900, bottom 1440 |
| `TEXT_BLOCK_FONT` base / min                                                                      | 54 / 40                                                | unchanged                                                                                                    |

**REASONED, what still differs.**

- **The typeface.** It is Heebo, not the app's own; Heebo is the house font and the closest
  geometric Hebrew sans we load.
- **Over a bright background**, a 3 px edge is still lighter than the app's, which reads almost
  as an outline.
- **Placement.** The default area puts a short text across her face, as most screenshots do; the
  area is his to draw per clip at register.

**MEASURED, RTL on crops** (0059's lesson):

- `Sfarimo,` and `ב-Tavnit` sit as LTR islands in their RTL lines.
- The wrapped aside's brackets mirror correctly, at 4× zoom: the opening one at the right end
  encloses to its left, and the closing one sits after the ellipsis at the left end.
- `—` and `–` both burn as real Heebo 600 glyphs (`renders/dash-proof.mp4`).

**The two renders he asked for**, both with the default area:

- `packages/core/.work/text-block/renders/tavnit-shortest.mp4`: Tavnit's `relatable_observation`,
  147 code points.
- `.../tavnit-longest.mp4`: Tavnit's `instead`, 318 code points, with the bracketed aside on its
  own last line.

## Related

- [[0089-service-c-text-block-exists-admin-only-phase-1]], [[0091-text-block-texts-ten-skeletons-truth-rules-free-edit]].
- [[0059-emoji-in-burned-text-needs-a-second-font]] — still pending; moot for this format while the set refuses emoji.
- [[0061-landing-positioning-two-services-no-results-claims]] §4 — the steps format's muted render, the opposite choice.
- [[0073-hook-text-colour-is-set-per-clip-by-the-founder]] — the colour vocabulary.
