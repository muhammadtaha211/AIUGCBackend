/**
 * The on-screen hook text of a Service B opener: the b_script's opening line
 * compressed for the frame, burned over the opener clip's palm phase. Pure —
 * this module is bundled into client components via the
 * "@aiugc/core/hook-text" subpath (plan-format is the precedent), so it must
 * never import server code.
 *
 * The caps are the prompt's caps: b_script (v9+) and hook_text emit under
 * them, and the pipeline rejects anything over — the string is burned into
 * the frame, so nothing silently trims it.
 */

export const HOOK_TEXT_MAX_WORDS = 7;
export const HOOK_TEXT_MAX_CHARS = 40;

const TRAILING_PUNCTUATION = /[.,!?;:…]$/;
const EMOJI = /\p{Extended_Pictographic}/u;
/** Hebrew points and cantillation marks — not maqaf (U+05BE) or geresh, which
 *  a plain line may legitimately carry (ב־2026, צ׳יפס). */
const NIQQUD = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/;

/** Tokens carrying a letter or digit — the same rule plan-format's readTimeMs
 *  counts by, so a spaced dash is not a word. */
export function hookTextWordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Why `text` cannot be burned as hook text, or undefined when it can. */
export function hookTextError(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return "hook_text is empty";
  const words = hookTextWordCount(trimmed);
  if (words > HOOK_TEXT_MAX_WORDS) {
    return `hook_text is ${words} words — the cap is ${HOOK_TEXT_MAX_WORDS}`;
  }
  const chars = [...trimmed].length;
  if (chars > HOOK_TEXT_MAX_CHARS) {
    return `hook_text is ${chars} characters — the cap is ${HOOK_TEXT_MAX_CHARS}`;
  }
  if (TRAILING_PUNCTUATION.test(trimmed)) return "hook_text ends with punctuation";
  if (EMOJI.test(trimmed)) return "hook_text contains an emoji";
  if (NIQQUD.test(trimmed)) return "hook_text contains niqqud";
  return undefined;
}
