import { describe, expect, it } from "vitest";
import type { CreditCosts } from "@aiugc/core/pricing";
import { B_EXAMPLE_SECONDS, buildPlansView, type PlanRow } from "@/lib/plans";
import {
  estimateLine,
  INTRO_CARD_CLAIM,
  introCardCreditsLine,
  introCardPriceLine,
} from "@/lib/plans-ui";

/**
 * The plan view model's arithmetic against the 0043 rates and the three 0043
 * plans (migrations 0043 + 0044, vault 0051): every number a plan card shows
 * is pinned here, so a card can never print a count the credits would not buy.
 */

/** The credit_costs row as 0043 set it, with 0053's Service C flat. */
const COSTS: CreditCosts = {
  a_assembly_flat: 75,
  a_demo_per_second: 3.75,
  a_outro_per_second: 25,
  a_minimum_credits: 100,
  b_per_second: 5,
  b_minimum_credits: 75,
  a_ending_reroll_per_second: 25,
  a_remix_assembly_credits: 10,
  a_steps_credits: 25,
  a_demo_analysis_credits: 20,
  c_text_block_credits: 25,
};

/** The three plans, deliberately NOT in price order — the view sorts. */
const PLANS: PlanRow[] = [
  { code: "studio", name: "פרימיום", priceAgorot: 50000, monthlyCredits: 5000 },
  { code: "starter", name: "התחלה", priceAgorot: 15000, monthlyCredits: 1000 },
  { code: "pro", name: "מתקדם", priceAgorot: 30000, monthlyCredits: 2500 },
];

describe("buildPlansView — the 0043 ladder", () => {
  const view = buildPlansView(PLANS, COSTS);

  it("orders by price and marks the middle tier popular", () => {
    expect(view.plans.map((p) => p.code)).toEqual(["starter", "pro", "studio"]);
    expect(view.plans.map((p) => p.popular)).toEqual([false, true, false]);
  });

  it("prices the three examples through the quote functions: B 20s = 100, A 45 then 25, C 25", () => {
    expect(view.examples).toEqual({
      bAd: 100,
      bSeconds: B_EXAMPLE_SECONDS,
      aFirst: 45,
      aNext: 25,
      cAd: 25,
    });
  });

  it("rates: ₪0.15 / ₪0.12 / ₪0.10 per credit, discounts 0 / 20 / 33", () => {
    expect(view.plans.map((p) => p.rateAgorotPerCredit)).toEqual([15, 12, 10]);
    expect(view.plans.map((p) => p.discountPctVsCheapest)).toEqual([0, 20, 33]);
  });

  it("counts: starter 10 / 39 / 40, pro 25 / 99 / 100, studio 50 / 199 / 200", () => {
    expect(view.plans.map((p) => [p.countB, p.countA, p.countC])).toEqual([
      [10, 39, 40],
      [25, 99, 100],
      [50, 199, 200],
    ]);
  });

  it("carries the display name, never the code, into the card", () => {
    expect(view.plans.map((p) => p.name)).toEqual(["התחלה", "מתקדם", "פרימיום"]);
  });
});

describe("buildPlansView — edges", () => {
  it("a plan too small for one first ad counts 0, never a negative", () => {
    const tiny = buildPlansView([{ ...PLANS[1]!, monthlyCredits: 40 }], COSTS);
    expect(tiny.plans[0]!.countA).toBe(0);
    expect(tiny.plans[0]!.countB).toBe(0);
  });

  it("the Service B floor binds the example: a 20s ad below 75 credits still costs 75", () => {
    const cheapB = buildPlansView(PLANS, { ...COSTS, b_per_second: 2 });
    expect(cheapB.examples.bAd).toBe(75);
    expect(cheapB.plans[0]!.countB).toBe(13);
  });

  it("a rate change moves the counts with no other edit", () => {
    const pricier = buildPlansView(PLANS, { ...COSTS, a_steps_credits: 50 });
    expect(pricier.examples.aNext).toBe(50);
    expect(pricier.plans[0]!.countA).toBe(1 + Math.floor((1000 - 70) / 50));
    const pricierC = buildPlansView(PLANS, { ...COSTS, c_text_block_credits: 30 });
    expect(pricierC.examples.cAd).toBe(30);
    expect(pricierC.plans[0]!.countC).toBe(33);
  });

  it("a text block priced at 0 counts 0, never Infinity", () => {
    const free = buildPlansView(PLANS, { ...COSTS, c_text_block_credits: 0 });
    expect(free.plans.map((p) => p.countC)).toEqual([0, 0, 0]);
  });

  it("a plan that is pricier per credit than the cheapest gets 0, never a negative discount", () => {
    const view = buildPlansView(
      [
        { code: "a", name: "א", priceAgorot: 10000, monthlyCredits: 1000 },
        { code: "b", name: "ב", priceAgorot: 20000, monthlyCredits: 1500 },
      ],
      COSTS,
    );
    expect(view.plans[1]!.discountPctVsCheapest).toBe(0);
  });

  it("an empty ladder is an empty view, not a crash", () => {
    expect(buildPlansView([], COSTS).plans).toEqual([]);
  });

  it("a plan with no credits has rate 0, discount 0 and counts 0 — never ₪∞ or NaN", () => {
    // Nothing writes such a row today; the guard is so a bad row shows a
    // zero instead of "₪∞ לקרדיט" on the public page.
    const view = buildPlansView(
      [{ code: "broken", name: "ריק", priceAgorot: 10000, monthlyCredits: 0 }, PLANS[1]!],
      COSTS,
    );
    const broken = view.plans.find((p) => p.code === "broken")!;
    expect(broken.rateAgorotPerCredit).toBe(0);
    expect(broken.discountPctVsCheapest).toBe(0);
    expect([broken.countB, broken.countA, broken.countC]).toEqual([0, 0, 0]);
    // And the healthy plan beside it is unaffected: a 0 cheapest rate means no discount for anyone.
    expect(view.plans.find((p) => p.code === "starter")!.discountPctVsCheapest).toBe(0);
    expect(Number.isFinite(view.plans.find((p) => p.code === "starter")!.rateAgorotPerCredit)).toBe(
      true,
    );
  });
});

describe("the card sentences read the view, never a literal", () => {
  const view = buildPlansView(PLANS, COSTS);

  it("estimate line on starter: all three services, the talking head's length stated", () => {
    expect(estimateLine(view.plans[0]!, view.examples)).toBe(
      "לדוגמה: עד 10 סרטונים עם דמות AI של 20 שנ׳, או עד 39 מודעות הוק + דמו מהקלטה אחת, או עד 40 סרטוני גוש טקסט",
    );
  });

  it("never phrases a count as videos per month, and never mentions VAT as included", () => {
    const offer = { priceAgorot: 500, credits: 150, days: 30 };
    const text = [
      ...view.plans.map((p) => estimateLine(p, view.examples)),
      introCardPriceLine(offer),
      introCardCreditsLine(offer),
      INTRO_CARD_CLAIM,
    ].join("\n");
    expect(text).not.toContain("סרטונים בחודש");
    expect(text).not.toContain("כולל מע״מ");
  });
});
