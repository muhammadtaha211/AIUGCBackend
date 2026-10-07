---
type: decision
status: verified
verified: 2026-10-07
method: "Founder decisions 4–8 and 12 of the 2026-10-07 task prompt, plus its planning defaults A–C, which the prompt marks as assumed by planning and not ruled; the reasons are his. MEASURED in the tree at feat/service-c-text-block: packages/remotion/src/ServiceC.tsx, packages/remotion/src/render.ts (renderServiceC), packages/remotion/src/text-fit.ts, packages/remotion/src/overlays.tsx:15-22, packages/core/src/text-block.ts, packages/core/src/hook-geometry.ts (DEFAULT_TEXT_BLOCK_RECT), packages/core/src/pipelines/bank.ts (normalizeStoredClip), packages/core/src/media/ffmpeg.ts:182-219 (normalizeVideo), apps/admin/src/lib/text-blocks.ts. The example lengths were counted with a node one-liner over the Appendix A strings (code points, whitespace-split words)."
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
be tuned against the screenshots when they arrive.

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

- The founder's clip (10 s, Seedance 2.5 on Atlas, a woman in a blue hoodie with a blunt knife
  and a watermelon — **FOUNDER-REPORTED**) was not attached, so the look was judged on the lavfi
  fixture with the tone, not on his footage.
- No real render has run on the box; the box needs a pull and a restart for the new handler, the
  composition and the second font weight (`docs/07-worker-box.md` §11).

## Related

- [[0089-service-c-text-block-exists-admin-only-phase-1]], [[0091-text-block-texts-ten-skeletons-truth-rules-free-edit]].
- [[0059-emoji-in-burned-text-needs-a-second-font]] — still pending; moot for this format while the set refuses emoji.
- [[0061-landing-positioning-two-services-no-results-claims]] §4 — the steps format's muted render, the opposite choice.
- [[0073-hook-text-colour-is-set-per-clip-by-the-founder]] — the colour vocabulary.
