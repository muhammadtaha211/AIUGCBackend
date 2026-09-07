/**
 * The Service B script's word ceiling and the guard that enforces it. Pure —
 * this module is bundled into client components via the
 * "@aiugc/core/b-script-words" subpath (hook-text is the precedent), so it
 * must never import server code. It lives here rather than in pipelines/copy
 * for exactly that reason: the wizard names the ceiling, and copy.ts pulls in
 * the db and the Anthropic client.
 */

/**
 * Runaway-cost guard, NOT a product limit: a b_script's length is what the
 * ad's TTS, its HeyGen GPU seconds and its Remotion render are all billed by,
 * so one pasted document could buy minutes of GPU. ~150 Hebrew words is
 * ~60-70s of speech — far past any ad we sell, far under MAX_LIPSYNC_SECONDS.
 *
 * The wizard MAY name it, as a soft warning on the script step (founder,
 * 2026-09-07) — a customer who pastes an essay should learn why the save will
 * fail before clicking, not after. What it must never become is a DURATION
 * limit: nothing may tell the customer their ad has to be under N seconds.
 * `scripts.params.wordBudget` is the generation TARGET the prompt writes to,
 * and neither number bounds how long an ad may run.
 */
export const MAX_B_SCRIPT_WORDS = 150;

/** Whitespace-separated tokens — the count both the guard and the UI use. */
export function countScriptWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * The web edit path ("write it myself" / post-generation edits) calls this
 * before updateScriptText. It refuses runaway input only — a script over its
 * word budget is a longer ad, priced per audio second by quoteBRender, not an
 * error.
 */
export function assertBScriptWordCeiling(text: string): void {
  if (countScriptWords(text) > MAX_B_SCRIPT_WORDS) {
    throw new Error("אורך התסריט חורג מהמגבלה לעיבוד — פנו לתמיכה");
  }
}
