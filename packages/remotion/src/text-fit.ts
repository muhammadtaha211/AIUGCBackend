/**
 * Shrink-to-fit for the burned hook line: Hebrew word lengths vary widely and
 * the prompt's length cap is advisory, so the render itself must guarantee the
 * text stays inside the clip's safe area. Pure math over an injected `measure`
 * (the composition passes @remotion/layout-utils measureText) so it is
 * unit-testable without a browser.
 */

/**
 * The hook line's sizing envelope. Lives here (not in ServiceA.tsx) so the
 * admin safe-area editor can preview with the same numbers the render uses.
 */
export const HOOK_FONT = { base: 92, min: 40, lineHeight: 1.2 } as const;

/**
 * Fixed lower-third rect (1080x1920 space) where step labels burn. Bottom edge
 * at 1480 — the same clearance the caption overlay keeps above platform chrome
 * (TikTok caption + CTA, Reels action rail) — and low enough that a label
 * never covers the mid-screen element it describes. Two lines at HOOK_FONT
 * base size fit. Exported so the wizard's CSS still-preview places text with
 * the exact numbers the render uses.
 */
export const STEP_LABEL_RECT = { x: 60, y: 1250, w: 960, h: 230 } as const;
/**
 * The גוש טקסט block's sizing envelope (Service C, decision 0090 §8): clearly
 * smaller than the hook line, and it floors at the same 40px. Lives here so
 * the admin editor previews with the numbers the render uses.
 */
export const TEXT_BLOCK_FONT = { base: 54, min: 40, lineHeight: 1.3 } as const;

/**
 * Shrink-to-fit for a paragraph: the hook-line fitter with explicit line
 * breaks honoured. The text is split on `\n` first — `quiz` carries one
 * question per line and `founder_ask` has blank lines between beats — and
 * each paragraph is greedy-wrapped on its own; a blank line keeps its height.
 * Same linear descent in steps of 2 to the floor.
 */
export function fitParagraphFontSize(opts: {
  text: string;
  maxWidth: number;
  maxHeight: number;
  base: number;
  min: number;
  lineHeight: number;
  measure: (text: string, fontSize: number) => number;
}): number {
  const paragraphs = opts.text.split("\n").map((p) => p.split(/[ \t]+/).filter(Boolean));
  for (let size = opts.base; size > opts.min; size -= 2) {
    if (paragraphsFit(paragraphs, size, opts)) return size;
  }
  return opts.min;
}

function paragraphsFit(
  paragraphs: string[][],
  size: number,
  opts: {
    maxWidth: number;
    maxHeight: number;
    lineHeight: number;
    measure: (text: string, fontSize: number) => number;
  },
): boolean {
  let lines = 0;
  for (const words of paragraphs) {
    lines++; // the paragraph's first line, or the blank line itself
    let current = "";
    for (const word of words) {
      if (opts.measure(word, size) > opts.maxWidth) return false; // unbreakable overflow
      const candidate = current ? `${current} ${word}` : word;
      if (opts.measure(candidate, size) <= opts.maxWidth) {
        current = candidate;
      } else {
        lines++;
        current = word;
      }
    }
  }
  return lines * size * opts.lineHeight <= opts.maxHeight;
}

export function fitFontSize(opts: {
  text: string;
  maxWidth: number;
  maxHeight: number;
  base: number;
  min: number;
  lineHeight: number;
  /** Rendered width in px of `text` at `fontSize`. */
  measure: (text: string, fontSize: number) => number;
}): number {
  const words = opts.text.split(/\s+/).filter(Boolean);
  for (let size = opts.base; size > opts.min; size -= 2) {
    if (fits(words, size, opts)) return size;
  }
  return opts.min;
}

/** Greedy word-wrap at `size`: every word fits the width, all lines fit the height. */
function fits(
  words: string[],
  size: number,
  opts: {
    maxWidth: number;
    maxHeight: number;
    lineHeight: number;
    measure: (text: string, fontSize: number) => number;
  },
): boolean {
  let lines = 1;
  let current = "";
  for (const word of words) {
    if (opts.measure(word, size) > opts.maxWidth) return false; // unbreakable overflow
    const candidate = current ? `${current} ${word}` : word;
    if (opts.measure(candidate, size) <= opts.maxWidth) {
      current = candidate;
    } else {
      lines++;
      current = word;
    }
  }
  return lines * size * opts.lineHeight <= opts.maxHeight;
}
