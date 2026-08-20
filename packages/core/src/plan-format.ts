import type { AnalysisState } from "./pipelines/demo-analysis";

/**
 * The two step-plan constants a browser needs to know. Constants and a type
 * import only — this module is bundled into client components via the
 * "@aiugc/core/plan-format" subpath (same deal as hook-geometry and pricing),
 * so it must never import server code, read env, or touch the db. The type
 * import above is erased at build time (verbatimModuleSyntax), so nothing from
 * pipelines/demo-analysis reaches the bundle.
 *
 * pipelines/demo-step-plans re-exports both, so server callers keep importing
 * them from where they always did.
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
