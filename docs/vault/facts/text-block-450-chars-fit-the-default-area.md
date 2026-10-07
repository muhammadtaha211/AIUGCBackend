---
type: fact
status: verified
verified: 2026-10-07
method: "`node packages/core/.work/text-block/fit-check.mjs` (gitignored scratch, 2026-10-07, branch feat/text-block-v2): packages/remotion/src/text-fit.ts fitParagraphFontSize + paragraphsFit copied verbatim and run inside Remotion's own chrome-headless-shell (node_modules/.remotion/chrome-headless-shell/win64/…, `--headless --dump-dom --virtual-time-budget=10000`), every candidate measured the way @remotion/layout-utils measureText does (an absolutely positioned inline-block span, white-space pre, getBoundingClientRect().width), in Heebo 600 from the two gstatic woff2 files @remotion/google-fonts/Heebo names for weight 600 (hebrew, latin), embedded as data URIs; box 720 x 1040 (DEFAULT_TEXT_BLOCK_RECT, packages/core/src/hook-geometry.ts:57), TEXT_BLOCK_FONT { base 54, min 40, lineHeight 1.2 }. Confirmed on real renders: `pnpm --filter @aiugc/remotion render:sample:c -- --clip <3 s dark lavfi clip> --text <text>`, the 1.5 s frame read as 8-bit gray by packages/core/.work/text-block/fitcheck/extent.mjs (rows and columns with a pixel above 200, the line pitch). The overflow behaviour is read from text-fit.ts:40-54 and ServiceC.tsx (TextBlock)."
source: code
---

# A 450-character text in three paragraphs fits the text block's default area above the 40 px floor

The fit check behind `TEXT_BLOCK_MAX_CHARS = 450`
([[0090-text-block-format-clip-once-with-its-own-sound]], amended for `text_block` v2).

## The fitter, in the render's own browser and font

At 40 px a line is 48 px, so the 1040 px area holds **21 lines**.

| Text                                                      | Code points | Paragraphs        | Size chosen    | Lines | Height  | Lines at 40 px |
| --------------------------------------------------------- | ----------- | ----------------- | -------------- | ----- | ------- | -------------- |
| `instead`'s v2 shape: opener, body, aside                 | 450         | 3                 | **44 px**      | 18    | 950 px  | 16             |
| `founder_ask`: three beats                                | 450         | 3                 | **48 px**      | 17    | 979 px  | 15             |
| three paragraphs of about equal length                    | 450         | 3                 | **46 px**      | 18    | 994 px  | 16             |
| `quiz`: header, three long questions, the pointer         | 450         | 3 blocks, 7 lines | **44 px**      | 18    | 950 px  | 18             |
| one paragraph                                             | 450         | 1                 | **50 px**      | 16    | 960 px  | 13             |
| two of the equal-thirds text, back to back (the overflow) | 902         | 6                 | 40 px, floored | 33    | 1584 px | 33             |

Every 450-character shape fits **above** the floor, at 44 to 48 px, and at 40 px it would take 13
to 18 of the 21 lines.

## On real renders

- **The `instead` shape:** ink from y 458 to 1388 and x 184 to 897, inside the area's 400–1440 and
  180–900. The line pitch is 53 px, which is 44 px × 1.2.
- **The `quiz` shape:** ink from y 451 to 1389.
- **The 902-character text:** the line pitch is 48 px, the floor. Ink runs from y 134 to 1700, so
  it spills 266 px above the area and 260 px below it.

The side-by-side is `packages/core/.work/text-block/crops/fit-450-vs-900.png` (gitignored).

## What the composition does with a text that does not fit

`fitParagraphFontSize` steps down from 54 px in 2 px steps and returns the 40 px floor when no
size above it fits. It never checks the floor itself (`text-fit.ts:50-53`), and an unbreakable
word wider than the area gives the same result. `TextBlock` draws the block in a box the area's
height, centred, with no overflow rule. The excess therefore spills evenly above and below the
area. Nothing is clipped, and nothing is drawn below 40 px.

## Limits of this measurement

- **The texts were built for the check.** Each is real Hebrew from the founder's examples and the
  2026-10-07 fixture run, padded with real words. The last zero to three code points are one
  stretched letter. A generated text's shape will differ.
- **The fake-measure test still pins 400.** `packages/remotion/test/text-fit-paragraph.test.ts`
  asserts that a 400-character block fits above the floor. It was left unchanged, because the task
  stayed inside `packages/core`. Nothing in the test suite measures 450 with the real font.
