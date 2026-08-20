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
  const words = label.trim().split(/\s+/).filter(Boolean).length;
  return LABEL_LEAD_MS + Math.round((words / LABEL_WORDS_PER_SECOND) * 1000);
}

/** On-screen length of the steps (the hook clip sits on top of this). The
 *  runtime band in findPlanViolations measures this over ASSEMBLED steps, and
 *  the wizard preview shows the same number. */
export function totalRuntimeMs(steps: { durationMs: number }[]): number {
  return steps.reduce((ms, step) => ms + step.durationMs, 0);
}
