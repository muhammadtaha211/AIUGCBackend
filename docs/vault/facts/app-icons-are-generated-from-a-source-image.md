---
type: fact
status: verified
verified: 2026-09-08
method: "Generated with sharp 0.34 + a hand-written ICO writer (scratchpad script, not in the repo). Validated by parsing the emitted file: for each directory entry, 40 + W*H*4 + ceil(W/8/4)*4*H compared against the entry's byte length — 16x16=1128, 32x32=4264, 48x48=9640, all exact, all bpp=32. Rendered end-to-end in Chrome against production: new Image() on https://tavnit.ai/favicon.ico resolves 48x48; drawn to canvas the four corners read rgba(0,0,0,0) and the edge midpoint rgba(176,243,3,255)."
source: code
---

# The app icons are generated from one source image, and `to-ico` cannot be used

`apps/web/src/app/` carries three icon files, all derived from a single founder-supplied
source (`~/Desktop/AIUGC notes/favicon.*`, which has changed format several times —
png, jpg, jfif):

| File             | Size            | Corners                                       |
| ---------------- | --------------- | --------------------------------------------- |
| `favicon.ico`    | 16 + 32 + 48 px | transparent, 20% radius                       |
| `icon.png`       | 512 px          | transparent, 20% radius                       |
| `apple-icon.png` | 180 px          | **opaque, square**                            |
| `brand-mark.png` | 256 px          | transparent, 20% radius, **art inset to 76%** |

`apple-icon.png` is deliberately not rounded: iOS applies its own corner mask and paints
any transparency black, so rounding it here double-rounds it and puts black wedges in the
corners.

`brand-mark.png` is the in-page logo mark, and it is deliberately a SEPARATE file from the
three favicon assets — it lives in `apps/web/src/components/`, is imported statically by
`brand.tsx`, and is served fingerprinted from `/_next/static/media/`. It is not a favicon
and nothing declares it as one.

It exists because the two jobs want different optical sizing. The favicon art runs to ~80%
of its tile, which is right for a 16px tab icon but reads as cramped at the 24px the header
lockup renders at — the wand crowds the rounded corners (founder call, 2026-09-08). The
mark's copy is inset to 76%, putting the wand at roughly 65% of the tile. Editing the
favicon files does not change the header lockup, and vice versa.

## `to-ico` produces a file browsers render as colored stripes

The first attempt used the `to-ico` package. It writes a DIB header declaring `bpp=24`
while emitting 32-bit pixel rows — a 32x32 frame claimed `biSizeImage` 4096 (= W*H*4) when
a valid 24bpp frame is 3240 bytes total. A spec-compliant decoder reads 3 bytes per pixel,
drifts out of alignment on every row, and paints diagonal colored stripes. The trigger is a
source image with no alpha channel.

Do not reach for `to-ico`. The ICO is written directly: a 6-byte header, one 16-byte
directory entry per frame, then per frame a 40-byte BITMAPINFOHEADER (`biHeight` = 2x
height, `biBitCount` = 32) + bottom-up BGRA rows + an all-zero AND mask.

## Regenerating

There is no committed script — the icons are static assets that change only when the
founder supplies new art. Regenerate with sharp, and validate the header arithmetic above
before committing; a malformed ICO fails silently in the tab, not at build time.
