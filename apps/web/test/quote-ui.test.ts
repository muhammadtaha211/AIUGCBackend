import { describe, expect, it } from "vitest";
import {
  bShapeSummary,
  newDemoNudge,
  stepsPriceBreakdown,
  type StepsQuoteView,
} from "@/lib/quote-ui";

/**
 * The two sentences that carry `a_demo_analysis_credits` (migration 0039) to
 * the customer. Both take their numbers from the quote route and hold none of
 * their own — the price is config and moves without a deploy, so a literal in
 * either of these would go stale silently.
 */

const FIRST_RENDER: NonNullable<StepsQuoteView> = {
  credits: 5,
  render: 3,
  analysis: 2,
  balance: 42,
  shortfall: 0,
};
const REUSED: NonNullable<StepsQuoteView> = { ...FIRST_RENDER, credits: 3, analysis: 0 };

describe("stepsPriceBreakdown", () => {
  it("explains the first render of a new recording: 5 = 3 + 2", () => {
    expect(stepsPriceBreakdown(FIRST_RENDER)).toBe(
      "5 קרדיטים: 3 לסרטון + 2 על ניתוח ההקלטה. כל מודעה נוספת מאותה הקלטה תעלה 3.",
    );
  });

  it("says nothing on a recording that has already been paid for once", () => {
    // The confirm button already carries "3 קרדיטים"; restating it as a
    // one-part breakdown would be noise, not an explanation.
    expect(stepsPriceBreakdown(REUSED)).toBeNull();
  });

  it("says nothing on the admin bypass", () => {
    expect(stepsPriceBreakdown(null)).toBeNull();
  });

  it("reads the numbers off the quote — no literal price lives here", () => {
    const tuned = { ...FIRST_RENDER, credits: 11, render: 7, analysis: 4 };
    const line = stepsPriceBreakdown(tuned)!;
    expect(line).toContain("11 קרדיטים");
    expect(line).toContain("7 לסרטון");
    expect(line).toContain("4 על ניתוח");
    expect(line).toContain("תעלה 7");
  });
});

describe("newDemoNudge", () => {
  it("names what a new recording costs on top, and points at the list", () => {
    expect(newDemoNudge(2)).toBe(
      "כל סרטון חדש עובר ניתוח מלא שלוקח כמה דקות, ועולה 2 קרדיטים נוספים במודעה הראשונה שתיצרו ממנו — אם כבר העליתם את הסרטון, בחרו אותו מהרשימה למעלה.",
    );
  });

  it("says WHEN the extra is charged — the list is full of demos it still applies to", () => {
    // The picker lists every READY demo, and ready means analysed, not paid
    // for. Dropping "במודעה הראשונה שתיצרו ממנו" would turn "pick it from the
    // list" into a promise to save the credits, which is false for a demo
    // nobody has rendered from yet — and the render step would then quote 5
    // and contradict it.
    expect(newDemoNudge(2)).toContain("במודעה הראשונה שתיצרו ממנו");
  });

  it("falls back to the time-only sentence when there is no price to name", () => {
    // null = the admin bypass or a quote that has not landed; 0 = a row tuned
    // to charge nothing for the analysis. Naming "0 קרדיטים נוספים" would be
    // an anti-nudge — it argues FOR uploading again.
    const timeOnly =
      "כל סרטון חדש עובר ניתוח מלא שלוקח כמה דקות — אם כבר העליתם את הסרטון, בחרו אותו מהרשימה למעלה.";
    expect(newDemoNudge(null)).toBe(timeOnly);
    expect(newDemoNudge(0)).toBe(timeOnly);
  });
});

describe("bShapeSummary with demo cutaways (vault 0121)", () => {
  it("is unchanged without cutaways and names how many with them", () => {
    expect(bShapeSummary(16.3)).toBe(bShapeSummary(16.3, 0));
    expect(bShapeSummary(16.3, 1)).toContain("עם קטע אחד מסרטון המוצר");
    expect(bShapeSummary(16.3, 2)).toContain("עם 2 קטעים מסרטון המוצר");
  });
});
