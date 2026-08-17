import { describe, expect, it } from "vitest";
import {
  creditCostsSchema,
  quoteAssemblyRemix,
  quoteEndingReroll,
  quoteServiceA,
  quoteServiceASteps,
  quoteServiceB,
  type CreditCosts,
} from "../src/pricing";

/**
 * The shipped D1 answer (hybrid): a flat, a small per-demo-second rate paying
 * for the TTS funnel, the full rate on the avatar outro where the GPU spend
 * is, and a floor. The code must not know this model won — the two models it
 * beat are expressed in the same shape below and tested alongside it.
 */
const HYBRID: CreditCosts = {
  a_assembly_flat: 3,
  a_demo_per_second: 0.15,
  a_outro_per_second: 1,
  a_minimum_credits: 5,
  b_per_second: 1,
  b_minimum_credits: 0,
  a_ending_reroll_per_second: 1,
  a_remix_assembly_credits: 2,
  a_steps_credits: 5,
};

/** Model (i): marginal cost only — a flat plus the outro seconds. */
const COST_BASED: CreditCosts = {
  ...HYBRID,
  a_assembly_flat: 2,
  a_demo_per_second: 0,
  a_minimum_credits: 0,
};

/** Model (ii): "1 credit = 1 second" taken literally. */
const LENGTH_BASED: CreditCosts = {
  ...HYBRID,
  a_assembly_flat: 0,
  a_demo_per_second: 1,
  a_minimum_credits: 0,
};

describe("creditCostsSchema", () => {
  it("accepts fractional rates — whole-credit-per-second steps make tuning impossible", () => {
    expect(creditCostsSchema.safeParse(HYBRID).success).toBe(true);
    expect(creditCostsSchema.safeParse({ ...HYBRID, a_demo_per_second: 0.075 }).success).toBe(true);
  });

  it("rejects the old {a_render, b_render} shape and any partial row", () => {
    expect(creditCostsSchema.safeParse({ a_render: 1, b_render: 15 }).success).toBe(false);
    const { a_remix_assembly_credits: _dropped, ...missingKey } = HYBRID;
    expect(creditCostsSchema.safeParse(missingKey).success).toBe(false);
  });
});

describe("quoteServiceA — the three shapes planAOutro can return", () => {
  it("avatar: 35s demo + 6s ending = 15 credits (3 + 5.25 + 6 = 14.25)", () => {
    const quote = quoteServiceA({
      demoSeconds: 35,
      outroMode: "avatar",
      outroSeconds: 6,
      costs: HYBRID,
    });
    expect(quote.credits).toBe(15);
    expect(quote.subtotal).toBeCloseTo(14.25, 10);
    expect(quote.minimumApplied).toBe(false);
    expect(quote.components).toEqual([
      { kind: "assembly", credits: 3 },
      { kind: "demo", credits: 5.25, seconds: 35 },
      { kind: "outro", credits: 6, seconds: 6 },
    ]);
  });

  it("freeze: the same demo costs 9 — a frozen frame spends no GPU", () => {
    const quote = quoteServiceA({
      demoSeconds: 35,
      // planAOutro's freeze branch reports a REAL remainder (up to a_outro_min_seconds),
      // and the preview route passes it through. Billing it would make the quote
      // contradict the shape summary sitting next to it.
      outroMode: "freeze",
      outroSeconds: 1.4,
      costs: HYBRID,
    });
    expect(quote.credits).toBe(9);
    expect(quote.components.find((c) => c.kind === "outro")).toEqual({
      kind: "outro",
      credits: 0,
      seconds: 0,
    });
  });

  it("none: identical to freeze — neither ending is billed", () => {
    const none = quoteServiceA({
      demoSeconds: 35,
      outroMode: "none",
      outroSeconds: 0,
      costs: HYBRID,
    });
    expect(none.credits).toBe(9);
  });

  it("the minimum binds on a short demo, and says so", () => {
    // 8s is the shortest demo the wizard accepts: 3 + 1.2 = 4.2 -> floor to 5.
    const quote = quoteServiceA({
      demoSeconds: 8,
      outroMode: "none",
      outroSeconds: 0,
      costs: HYBRID,
    });
    expect(quote.credits).toBe(5);
    expect(quote.subtotal).toBeCloseTo(4.2, 10);
    expect(quote.minimumApplied).toBe(true);
  });

  it("a minimum equal to the subtotal is not 'binding' — it decided nothing", () => {
    const quote = quoteServiceA({
      demoSeconds: 8,
      outroMode: "none",
      outroSeconds: 0,
      costs: { ...HYBRID, a_minimum_credits: 4.2 },
    });
    expect(quote.credits).toBe(5); // ceil(4.2)
    expect(quote.minimumApplied).toBe(false);
  });
});

describe("ceil once, never per component", () => {
  it("34s demo + 6.5s ending: summing then ceiling gives 15, component-wise gives 16", () => {
    const quote = quoteServiceA({
      demoSeconds: 34,
      outroMode: "avatar",
      outroSeconds: 6.5,
      costs: HYBRID,
    });

    const componentWise = quote.components.reduce((sum, c) => sum + Math.ceil(c.credits), 0);
    expect(componentWise).toBe(16); // the bug we are not writing
    expect(quote.credits).toBe(15); // sum -> clamp -> one ceil
    expect(quote.credits).toBeLessThan(componentWise);
  });

  it("the clamp happens before the ceil — a fractional floor still charges an integer", () => {
    // subtotal 4.2, floor 5.5. ceil(max(5.5, 4.2)) = 6.
    // Clamping AFTER the ceil would give max(5.5, 5) = 5.5 — not a whole credit.
    const quote = quoteServiceA({
      demoSeconds: 8,
      outroMode: "none",
      outroSeconds: 0,
      costs: { ...HYBRID, a_minimum_credits: 5.5 },
    });
    expect(quote.subtotal).toBeCloseTo(4.2, 10); // the breakdown stays unrounded
    expect(quote.credits).toBe(6);
    expect(Number.isInteger(quote.credits)).toBe(true);
    expect(quote.minimumApplied).toBe(true);
  });
});

describe("quoteServiceB", () => {
  it("an exact 15s VO is 15 credits — the flat b_render:15 arrived at honestly", () => {
    const quote = quoteServiceB({ durationMs: 15_000, costs: HYBRID });
    expect(quote.credits).toBe(15);
    expect(quote.subtotal).toBe(15);
    expect(quote.components).toEqual([{ kind: "lipsync", credits: 15, seconds: 15 }]);
  });

  it("a fractional second rounds up — never charge for less video than we render", () => {
    expect(quoteServiceB({ durationMs: 15_001, costs: HYBRID }).credits).toBe(16);
    expect(quoteServiceB({ durationMs: 15_999, costs: HYBRID }).credits).toBe(16);
    expect(quoteServiceB({ durationMs: 16_000, costs: HYBRID }).credits).toBe(16);
  });

  it("honours b_minimum_credits when the founder turns it on", () => {
    const quote = quoteServiceB({ durationMs: 6_000, costs: { ...HYBRID, b_minimum_credits: 10 } });
    expect(quote.credits).toBe(10);
    expect(quote.minimumApplied).toBe(true);
    // ...and is inactive at 0, the shipped value.
    expect(quoteServiceB({ durationMs: 6_000, costs: HYBRID }).credits).toBe(6);
  });
});

describe("quoteEndingReroll", () => {
  it("prices the VO tail the GPU re-runs on", () => {
    const quote = quoteEndingReroll({ sliceSeconds: 6, costs: HYBRID });
    expect(quote.credits).toBe(6);
    expect(quote.components).toEqual([{ kind: "reroll", credits: 6, seconds: 6 }]);
  });

  it("is floor-exempt — a re-roll is not a new video", () => {
    const quote = quoteEndingReroll({
      sliceSeconds: 2,
      costs: { ...HYBRID, a_minimum_credits: 5 },
    });
    expect(quote.credits).toBe(2);
    expect(quote.minimumApplied).toBe(false);
  });
});

describe("quoteAssemblyRemix", () => {
  it("is the flat key, at the shipped value", () => {
    expect(quoteAssemblyRemix({ costs: HYBRID }).credits).toBe(2);
  });

  it("MUST ignore a_minimum_credits — the floor would silently kill the volume play", () => {
    const quote = quoteAssemblyRemix({ costs: { ...HYBRID, a_minimum_credits: 5 } });
    expect(quote.credits).toBe(2);
    expect(quote.minimumApplied).toBe(false);
    // A remix re-runs assembly and nothing else; it must never cost a fresh
    // video's price just because it also goes through createSet.
    expect(quote.credits).toBeLessThan(
      quoteServiceA({ demoSeconds: 35, outroMode: "avatar", outroSeconds: 6, costs: HYBRID })
        .credits,
    );
  });
});

describe("quoteServiceASteps", () => {
  it("is the flat key — never the uploaded duration", () => {
    // A 3-minute recording under the full-format quote would price ~31
    // credits for a ~20s output; the steps flat doesn't look at the demo.
    const quote = quoteServiceASteps({ costs: HYBRID });
    expect(quote.credits).toBe(5);
    expect(quote.components).toEqual([{ kind: "steps", credits: 5 }]);
  });

  it("is floor-exempt — the flat IS the price, tuning it below the floor works", () => {
    const quote = quoteServiceASteps({ costs: { ...HYBRID, a_steps_credits: 3 } });
    expect(quote.credits).toBe(3);
    expect(quote.minimumApplied).toBe(false);
  });
});

describe("the config shape expresses the models D1 rejected — code never learns which won", () => {
  const demo35Avatar6 = (costs: CreditCosts) =>
    quoteServiceA({ demoSeconds: 35, outroMode: "avatar", outroSeconds: 6, costs }).credits;
  const demo35Freeze = (costs: CreditCosts) =>
    quoteServiceA({ demoSeconds: 35, outroMode: "freeze", outroSeconds: 1.4, costs }).credits;

  it("model (i) cost-based: 8 credits, and 2 without an avatar ending", () => {
    expect(demo35Avatar6(COST_BASED)).toBe(8);
    expect(demo35Freeze(COST_BASED)).toBe(2);
  });

  it("model (ii) length-based: every billable second, 41", () => {
    // 35 demo + 6 outro. The 2s bank hook is not a quote input by design —
    // under a length model it belongs in a_assembly_flat.
    expect(demo35Avatar6(LENGTH_BASED)).toBe(41);
    expect(demo35Freeze(LENGTH_BASED)).toBe(35);
  });

  it("model (iii) hybrid, as shipped: 15 credits — the same as a 15s Service B ad", () => {
    expect(demo35Avatar6(HYBRID)).toBe(15);
    expect(demo35Freeze(HYBRID)).toBe(9);
    expect(demo35Avatar6(HYBRID)).toBe(
      quoteServiceB({ durationMs: 15_000, costs: HYBRID }).credits,
    );
  });
});

describe("purity", () => {
  it("is total — no input throws, and nothing is mutated", () => {
    const costs = { ...HYBRID };
    const snapshot = JSON.stringify(costs);
    expect(() =>
      quoteServiceA({ demoSeconds: 0, outroMode: "avatar", outroSeconds: 0, costs }),
    ).not.toThrow();
    expect(() => quoteServiceB({ durationMs: 0, costs })).not.toThrow();
    expect(JSON.stringify(costs)).toBe(snapshot);
  });

  it("is deterministic — the displayed quote and the debited quote are one call", () => {
    const args = { demoSeconds: 35, outroMode: "avatar" as const, outroSeconds: 6, costs: HYBRID };
    expect(quoteServiceA(args).credits).toBe(quoteServiceA(args).credits);
  });
});
