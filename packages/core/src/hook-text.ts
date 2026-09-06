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

/**
 * Punctuation that cannot end a burned line. A question mark or an exclamation
 * mark CAN (founder, 2026-09-06): a Hebrew hook is very often a question, the
 * wizard invites the customer to edit the line, and refusing "?" rejected the
 * most natural thing to type there. A full stop, comma, colon, semicolon or
 * ellipsis still cannot — on one big centred line they read as a sentence that
 * was cut off rather than as a hook.
 *
 * The prompts (b_script v9+, hook_text v1) still ask the model for no trailing
 * punctuation at all. A generator stricter than its validator is safe, and
 * relaxing the prompt is a prompt-version decision, not this one.
 */
const TRAILING_PUNCTUATION = /[.,;:…]$/;
const EMOJI = /\p{Extended_Pictographic}/u;
/** Hebrew points and cantillation marks — not maqaf (U+05BE) or geresh, which
 *  a plain line may legitimately carry (ב־2026, צ׳יפס). */
const NIQQUD = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/;
/**
 * The burnable set — the same class generateHookLines enforces on a hook line
 * (pipelines/copy.ts, ILLEGAL_HOOK_LINE_CHAR), because this string is burned
 * the same way: Hebrew, Latin, digits, ASCII punctuation and the typographic
 * marks that render inside an RTL line. A zero-width joiner or an Arabic
 * tatweel burns as a stray glyph or corrupts the line invisibly.
 */
// Escapes, not literals: a Hebrew range inside a character class reorders in
// every editor that renders bidi.
const ILLEGAL_CHAR = new RegExp(
  "[^" +
    "\u0020-\u007E" +
    "\u0590-\u05FF" +
    "\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u20AA" +
    "]",
  "u",
);

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
  if (EMOJI.test(trimmed)) return "hook_text contains an emoji";
  const illegal = ILLEGAL_CHAR.exec(trimmed)?.[0];
  if (illegal !== undefined) {
    const hex = illegal.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
    return `hook_text contains an unrenderable character U+${hex}`;
  }
  const words = hookTextWordCount(trimmed);
  if (words === 0) return "hook_text has no words";
  if (words > HOOK_TEXT_MAX_WORDS) {
    return `hook_text is ${words} words — the cap is ${HOOK_TEXT_MAX_WORDS}`;
  }
  const chars = [...trimmed].length;
  if (chars > HOOK_TEXT_MAX_CHARS) {
    return `hook_text is ${chars} characters — the cap is ${HOOK_TEXT_MAX_CHARS}`;
  }
  if (TRAILING_PUNCTUATION.test(trimmed))
    return "hook_text ends with punctuation — only ? and ! may";
  if (NIQQUD.test(trimmed)) return "hook_text contains niqqud";
  return undefined;
}
