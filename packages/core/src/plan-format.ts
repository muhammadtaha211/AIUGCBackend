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
 * The Phase 8 picker groups/hides by the same set.
 */
export const PLAN_SKIP_SCREEN_KINDS: ReadonlySet<NonNullable<AnalysisState["screenKind"]>> =
  new Set(["login", "loading", "onboarding", "error", "tour", "system"] as const);

/** Hard ceiling on one caption, in characters. The wizard's label field and
 *  findPlanViolations must agree on it, and a client-side counter would be the
 *  third copy of the number. */
export const MAX_LABEL_CHARS = 60;

/** Hard ceiling on a caption, in whitespace words. Not a target — holding
 *  labels to a 3-5 word average is the prompt's job. Also bounds the longest
 *  window a single step can earn, which the runtime band's reachability
 *  check needs. Hard on the MODEL path only (findPlanViolations); the wizard
 *  shows it as a soft warning and the human edit path is never rejected on it. */
export const MAX_LABEL_WORDS = 6;

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
 *  7 is arithmetic, not taste: at the 3s step floor, 7 steps already fill the
 *  21s runtime ceiling exactly. */
export const A_STEPS_MAX_DEFAULT = 7;

/** Fixed allowance before the label is being read at all: the 5-frame pop-in
 *  (ServiceASteps) plus the eye reaching the lower third after the hard cut. */
export const LABEL_LEAD_MS = 400;
/** Hebrew burned-caption reading rate. The slow end of the 2.5-3 words/sec
 *  band on purpose — the viewer is watching the demo, not the caption. */
export const LABEL_WORDS_PER_SECOND = 2.5;

/**
 * How long a burned step label needs to stay up to be read. A GUESS, exactly
 * like DEFAULT_STEP_MS, and labelled as one: nobody has measured Israeli
 * viewers reading these. Exported and pure because pass 2's runtime check and
 * the wizard's still-preview must use the same number the plan was built with.
 */
export function readTimeMs(label: string): number {
  // Count only tokens carrying a letter or digit — the same set the word CAP
  // counts (its normalizeWord drops punctuation-only tokens like a spaced
  // dash). Counting raw whitespace tokens here let a cap-legal 6-word label
  // read as 7 (3200ms > the 3s step floor), busting the 21s band on 7-step
  // plans that the generated timing table licenses at the ceiling exactly.
  const words = label
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return LABEL_LEAD_MS + Math.round((words / LABEL_WORDS_PER_SECOND) * 1000);
}

/** On-screen length of the steps (the hook clip sits on top of this). The
 *  runtime band in findPlanViolations measures this over ASSEMBLED steps, and
 *  the wizard preview shows the same number. */
export function totalRuntimeMs(steps: { durationMs: number }[]): number {
  return steps.reduce((ms, step) => ms + step.durationMs, 0);
}
