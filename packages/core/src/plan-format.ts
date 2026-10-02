import type { AnalysisState } from "./pipelines/demo-analysis";

/**
 * The step-plan constants and pure formulas a browser needs to know. Constants,
 * pure functions and a type import only — this module is bundled into client
 * components via the "@aiugc/core/plan-format" subpath (same deal as
 * hook-geometry and pricing), so it must never import server code, read env, or
 * touch the db. The type import above is erased at build time
 * (verbatimModuleSyntax), so nothing from pipelines/demo-analysis reaches the
 * bundle.
 *
 * pipelines/demo-step-plans re-exports all of it, so server callers keep
 * importing from where they always did.
 */

/**
 * screenKinds the plan may never select — the deterministic form of the
 * prompt's prose skip list (login screens, tours, onboarding...), added after
 * a real run picked the login screen and two tour steps despite the prompt.
 * "product", "other" and absent (v2-era analyses without screenKind) pass;
 * missing means "no information", so those states stay prompt-governed.
 * The plan pass only: the wizard's inventory shows skip kinds like any other
 * readable state (isInventoryState, decision 0064).
 */
export const PLAN_SKIP_SCREEN_KINDS: ReadonlySet<NonNullable<AnalysisState["screenKind"]>> =
  new Set(["login", "loading", "onboarding", "error", "tour", "system"] as const);

/**
 * Whether a state belongs in the customer's inventory: every READABLE state,
 * shown equally (decision 0064 — no "less fitting" tier; the model's quality
 * preferences stay on the plan pass). Unreadable is out because
 * updatePlanSteps rejects it for human edits. The wizard's pages and the
 * group_analysis_states pool both use this, so the grouping covers exactly
 * what the UI shows.
 */
export function isInventoryState(state: { legibility: string }): boolean {
  return state.legibility !== "unreadable";
}

/** Hard ceiling on one caption, in characters. The wizard's label field and
 *  findPlanViolations must agree on it, and a client-side counter would be the
 *  third copy of the number. */
export const MAX_LABEL_CHARS = 60;

/** Every step's clip, in ms: a fixed 2 s (decision 0076). A constant, not a
 *  knob — the caption ceiling below and the 60 frames the render lays out are
 *  both derived from it. */
export const STEP_MS = 2000;

/** Hard ceiling on a MODEL caption, in whitespace words: what can be read in
 *  one step (readTimeMs of 4 words is exactly STEP_MS, pinned by a test). The
 *  wizard shows a longer hand-written caption a soft warning and the human
 *  edit path is never rejected on it (decision 0086). */
export const MAX_LABEL_WORDS = 4;

/** The prompt's caption FLOOR, in whitespace words. Deliberately NOT enforced
 *  in findPlanViolations — the human edit path may go shorter and nothing here
 *  rejects it — but the generated timing block needs it: under the read time of
 *  a floor-length caption no caption is legal at all, which is the gap below
 *  which two states cannot both be selected. */
export const MIN_LABEL_WORDS = 3;

/** Code default for the `a_steps_min` config knob (fewest steps a generated
 *  plan should have). The wizard's delete warning uses it too — a config row,
 *  if one is ever seeded, wins server-side and the client warning drifts until
 *  this constant is updated to match. */
export const A_STEPS_MIN_DEFAULT = 5;

/** Code default for the `a_steps_max` config knob (most steps a GENERATED plan
 *  may have — the human edit path is never capped, the wizard just warns past
 *  it that the format works best short). Same drift deal as A_STEPS_MIN_DEFAULT:
 *  a seeded config row wins server-side until this constant is updated to match.
 *  10 steps of STEP_MS is 20 s of demo (decision 0076). */
export const A_STEPS_MAX_DEFAULT = 10;

/** Fixed allowance before the label is being read at all: the 5-frame pop-in
 *  (ServiceASteps) plus the eye reaching the lower third after the hard cut. */
export const LABEL_LEAD_MS = 400;
/** Hebrew burned-caption reading rate. The slow end of the 2.5-3 words/sec
 *  band on purpose — the viewer is watching the demo, not the caption. */
export const LABEL_WORDS_PER_SECOND = 2.5;

/**
 * How long a burned step label needs to stay up to be read. A GUESS, and
 * labelled as one: nobody has measured Israeli viewers reading these.
 * Exported and pure because pass 2's runtime check and the wizard's
 * still-preview must use the same number the plan was built with.
 */
export function readTimeMs(label: string): number {
  // Count only tokens carrying a letter or digit — the same set the word CAP
  // counts (its normalizeWord drops punctuation-only tokens like a spaced
  // dash). Counting raw whitespace tokens here let a cap-legal label read as
  // one word longer than the cap counted it, so a caption the timing table
  // licensed failed the check built from this function.
  const words = label
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return LABEL_LEAD_MS + Math.round((words / LABEL_WORDS_PER_SECOND) * 1000);
}

/** On-screen length of the steps (the hook clip sits on top of this) — the
 *  number the wizard and the confirm screen show. */
export function totalRuntimeMs(steps: { durationMs: number }[]): number {
  return steps.reduce((ms, step) => ms + step.durationMs, 0);
}

/** How many words can be read in a clip of this length — readTimeMs inverted,
 *  in integer math so 2000 ms gives exactly 4. */
export function readableWords(durationMs: number): number {
  return Math.max(0, Math.floor(((durationMs - LABEL_LEAD_MS) * LABEL_WORDS_PER_SECOND) / 1000));
}

/** Whether a caption needs longer than its clip stays up. One predicate for
 *  the plan job's word ceiling and the wizard's soft warning: on a STEP_MS
 *  clip it is exactly "more than MAX_LABEL_WORDS words". */
export function labelTooLong(label: string, durationMs: number): boolean {
  return readTimeMs(label) > durationMs;
}

/** A clip of the demo, in ms. */
export interface Clip {
  startMs: number;
  durationMs: number;
}

/** The normalized demo's frame rate: normalizeVideo forces it, the footage
 *  detector reads every frame at it and the render lays steps out at it (all
 *  three pinned equal by a test). */
export const DEMO_FPS = 30;

/** The demo frame a time falls on — the render's own rounding
 *  (@aiugc/remotion's msToFrame), so a clip counted here is the clip rendered. */
export function demoFrame(ms: number): number {
  return Math.round((ms / 1000) * DEMO_FPS);
}

/** A clip as demo frames: it shows startFrame up to, not including, endFrame. */
export function clipFrames(clip: Clip): { startFrame: number; endFrame: number } {
  return {
    startFrame: demoFrame(clip.startMs),
    endFrame: demoFrame(clip.startMs + clip.durationMs),
  };
}

/**
 * The clip a stored step plays and renders — the ONE reading of a step, shared
 * by the render (renders.ts) and the editor's preview, so they cannot disagree.
 * `startMs` is where its 2 s clip starts (decision 0084); a step stored before
 * that has none and starts at its moment, with the length it was saved with —
 * exactly what it has always rendered.
 */
export function stepClip(step: {
  timestampMs: number;
  durationMs: number;
  startMs?: number;
}): Clip {
  return { startMs: step.startMs ?? step.timestampMs, durationMs: step.durationMs };
}

/** Whether two clips share footage. Clips that only touch do not. */
export function clipsOverlap(a: Clip, b: Clip): boolean {
  return a.startMs < b.startMs + b.durationMs && b.startMs < a.startMs + a.durationMs;
}

/** Every pair of clips that share footage, as positions in the given list
 *  (earlier position first). All pairs, not neighbours only: a step can clear
 *  the one before it and still overlap the one before that. */
export function overlappingPairs(clips: Clip[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < clips.length; i++) {
    for (let j = i + 1; j < clips.length; j++) {
      if (clipsOverlap(clips[i]!, clips[j]!)) pairs.push([i, j]);
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Label tokenization — shared by findOffScreenWords (server) and the editor's
// marks (client), so the words the server flags are the words the client
// finds in the label. Moved here from pipelines/demo-step-plans in 0049.
// ---------------------------------------------------------------------------

/**
 * The boundary a label splits on: anything that is not a letter, digit,
 * combining mark or an in-word quote mark (kept so acronyms like לו"ז survive
 * as one token). Whitespace-only splitting left ·/־/– glued to neighbouring
 * words whenever the OCR dropped a space. \p{M} keeps combining niqqud
 * attached to its letter; normalizeWord then strips it from the token.
 */
const WORD_BOUNDARY = /[^\p{L}\p{M}\p{N}'"׳״]+/u;

/** The label's own tokens AS WRITTEN (NFC, nothing else) — what the editor
 *  marks by exact match. normalizeWord is for matching only. */
export function splitWords(text: string): string[] {
  return text.normalize("NFC").split(WORD_BOUNDARY).filter(Boolean);
}

/**
 * Edge punctuation stripped before matching; case folded for Latin. Both sides
 * of every comparison go through here: NFC first, Hebrew geresh/gershayim
 * unified with their ASCII lookalikes (לו״ז vs לו"ז), combining marks (niqqud)
 * dropped — screen OCR and model labels disagree on all three.
 */
export function normalizeWord(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/׳/g, "'")
    .replace(/״/g, '"')
    .replace(/\p{M}+/gu, "")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .toLowerCase();
}

/** Comparable word tokens: splitWords, normalized, empties dropped. */
export function tokenizeWords(text: string): string[] {
  return splitWords(text).map(normalizeWord).filter(Boolean);
}
