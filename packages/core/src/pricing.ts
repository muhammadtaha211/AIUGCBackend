import { z } from "zod";

/**
 * THE price. Every credit figure a customer is shown and every credit figure
 * the server debits comes from one of these functions — there is no second
 * place a price is computed. Pure math + zod only: this module is bundled into
 * client components via the "@aiugc/core/pricing" subpath (same deal as
 * hook-geometry), so it must never import server code, read env, or touch the
 * db. The caller loads `credit_costs` from app_config and passes it in.
 *
 * 1 credit = 1 second. Rates are fractional so pricing can be tuned without a
 * deploy; the CHARGE is always an integer because of the single ceil.
 */

/** Which ending planAOutro chose — only "avatar" spends GPU, so only it bills outro. */
export type AOutroMode = "none" | "freeze" | "avatar";

/**
 * The app_config `credit_costs` row. Rates are z.number() (NOT .int()) — an
 * integer-only demo rate would force whole-credit jumps per second and make
 * fine tuning impossible. The two *_minimum_credits keys express "no video
 * ever costs less than X" as config; 0 = inactive.
 */
export const creditCostsSchema = z.object({
  a_assembly_flat: z.number(),
  a_demo_per_second: z.number(),
  a_outro_per_second: z.number(),
  a_minimum_credits: z.number(),
  b_per_second: z.number(),
  b_minimum_credits: z.number(),
  a_ending_reroll_per_second: z.number(),
  /** Assembly-only remix (hook / hook line / rect). Flat, and floor-exempt. */
  a_remix_assembly_credits: z.number(),
  /** Steps-format Service A render. Flat, and floor-exempt (see quoteServiceASteps). */
  a_steps_credits: z.number(),
  /**
   * The demo analysis, charged ONCE per demo — on the first render of that
   * demo that actually takes the customer's money, never on the analysis
   * itself. Flat, and floor-exempt for the same reason a_steps_credits is.
   */
  a_demo_analysis_credits: z.number(),
  /**
   * One Service C (גוש טקסט) render: flat, floor-exempt (0053, decision 0089
   * §4 / 0099). The texts are free; only the render is charged.
   */
  c_text_block_credits: z.number(),
});

export type CreditCosts = z.infer<typeof creditCostsSchema>;

/**
 * One priced part of a quote. `kind` is a key, not a label — Hebrew lives in
 * the UI layer (same convention as questionnaire `tone`). Credits here are
 * UNROUNDED: they explain the number, they don't reproduce it.
 */
export interface QuoteComponent {
  kind:
    | "assembly"
    | "demo"
    | "outro"
    | "lipsync"
    | "reroll"
    | "remix"
    | "steps"
    | "analysis"
    | "text_block";
  credits: number;
  /** Seconds billed, for per-second components. Absent on flats. */
  seconds?: number;
}

export interface Quote {
  /** The integer charged. The ONLY number shown to a customer or debited. */
  credits: number;
  components: QuoteComponent[];
  /** Sum of the components, before the minimum clamp and before the ceil. */
  subtotal: number;
  /** True when the minimum — not the components — decided the price. */
  minimumApplied: boolean;
}

/**
 * Sum -> clamp to the minimum -> ceil ONCE. Never ceil per component: rounding
 * each part up separately drifts above the sum (a 34s demo + 6.5s outro quotes
 * 16 component-wise but 15 correctly), and any drift between the displayed
 * quote and the debit is the exact bug this module exists to prevent.
 */
function settle(components: QuoteComponent[], minimum: number): Quote {
  const subtotal = components.reduce((sum, c) => sum + c.credits, 0);
  const minimumApplied = minimum > subtotal;
  return {
    credits: Math.ceil(Math.max(minimum, subtotal)),
    components,
    subtotal,
    minimumApplied,
  };
}

/**
 * Service A. Soft estimate at script approval and the exact quote at the
 * advisory call this with the same arithmetic — only the inputs sharpen
 * (estimated VO length -> the approved audio's measured length).
 *
 * `outroSeconds` is billed only for an avatar ending. A freeze or a clean
 * ending spends no GPU, so it must cost nothing extra: the quote and the shape
 * summary beside it can never disagree.
 */
export function quoteServiceA(opts: {
  demoSeconds: number;
  outroMode: AOutroMode;
  outroSeconds: number;
  costs: CreditCosts;
}): Quote {
  const { demoSeconds, outroMode, outroSeconds, costs } = opts;
  const billedOutroSeconds = outroMode === "avatar" ? outroSeconds : 0;
  return settle(
    [
      { kind: "assembly", credits: costs.a_assembly_flat },
      {
        kind: "demo",
        credits: demoSeconds * costs.a_demo_per_second,
        seconds: demoSeconds,
      },
      {
        kind: "outro",
        credits: billedOutroSeconds * costs.a_outro_per_second,
        seconds: billedOutroSeconds,
      },
    ],
    costs.a_minimum_credits,
  );
}

/** Service B: the approved VO's measured length is the whole price. */
export function quoteServiceB(opts: { durationMs: number; costs: CreditCosts }): Quote {
  const seconds = opts.durationMs / 1000;
  return settle(
    [{ kind: "lipsync", credits: seconds * opts.costs.b_per_second, seconds }],
    opts.costs.b_minimum_credits,
  );
}

/**
 * Re-roll an avatar ending: the GPU runs again on the same VO tail, nothing
 * else does. No minimum — the floors say "no VIDEO costs less than X", and a
 * re-roll is not a new video.
 */
export function quoteEndingReroll(opts: { sliceSeconds: number; costs: CreditCosts }): Quote {
  return settle(
    [
      {
        kind: "reroll",
        credits: opts.sliceSeconds * opts.costs.a_ending_reroll_per_second,
        seconds: opts.sliceSeconds,
      },
    ],
    0,
  );
}

/**
 * Steps-format Service A: one Remotion render, plus the demo analysis on the
 * first render that pays for it. The full-format quote (assembly +
 * demo-per-second) would bill the UPLOADED duration: a 3-minute recording
 * would price ~31 credits for a ~20s output, at a rate calibrated to subsidise
 * a TTS funnel this format doesn't use.
 *
 * The analysis used to be amortised INTO the flat, which made every variant
 * pay for it again — the exact opposite of the reuse the format is built for.
 * It is now its own part, added once per demo: `firstPaidRenderOfDemo` is a
 * fact about the LEDGER (see demoHasPaidRender in pipelines/sets.ts), not
 * about this wizard run, so a demo analysed yesterday and abandoned pays the
 * same today as one uploaded and rendered straight through. The analysis is
 * never debited on its own — a failed analysis costs the customer nothing.
 *
 * BOTH parts are floor-exempt: the flats ARE the whole price, and a floor
 * would silently override tuning either below a_minimum_credits. One ceil over
 * the sum, as everywhere else.
 */
export function quoteServiceASteps(opts: {
  costs: CreditCosts;
  firstPaidRenderOfDemo: boolean;
}): Quote {
  const components: QuoteComponent[] = [{ kind: "steps", credits: opts.costs.a_steps_credits }];
  if (opts.firstPaidRenderOfDemo) {
    components.push({ kind: "analysis", credits: opts.costs.a_demo_analysis_credits });
  }
  return settle(components, 0);
}

/**
 * Changing only the hook clip, the hook line, or the text rect re-runs
 * assembly and NOTHING else — no TTS, no GPU, near-zero marginal cost. It
 * still goes through createSet, so it would inherit a_minimum_credits and get
 * silently priced like a fresh video, which would kill the whole point of
 * remixing. Hence: its own flat key, and the floor is deliberately not applied.
 */
export function quoteAssemblyRemix(opts: { costs: CreditCosts }): Quote {
  return settle([{ kind: "remix", credits: opts.costs.a_remix_assembly_credits }], 0);
}

/**
 * Service C, גוש טקסט: one flat per render, floor-exempt like the steps flat —
 * the flat IS the price (decision 0089 §4, made live by 0099).
 */
export function quoteServiceC(opts: { costs: CreditCosts }): Quote {
  return settle([{ kind: "text_block", credits: opts.costs.c_text_block_credits }], 0);
}

/**
 * What one Claude call costs US, not what a customer pays: the agorot written to
 * `usage_events.cost_estimate_agorot` for every `llm_tokens` row. claude-sonnet-5-5
 * at $2 in / $10 out per MTok (vault 0094), ~370 agorot/USD. A local estimate
 * against a hard-coded rate, never an invoice; the token counts are the API's.
 */
export function llmCostAgorot(inputTokens: number, outputTokens: number): number {
  return Math.ceil(((inputTokens * 2 + outputTokens * 10) / 1_000_000) * 370);
}
