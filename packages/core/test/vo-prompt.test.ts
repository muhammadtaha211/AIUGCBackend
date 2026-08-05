import { describe, expect, it } from "vitest";
import { latestPromptVersion, renderPrompt } from "../src/prompts";

/**
 * vo_script v5 = the mid-twenties "recorded on the fly" rewrite, keeping v3's
 * {{demo_description}} soft grounding and v4's {{persona_gender}} axis.
 * renderPrompt auto-selects the highest version, so generateVoScript must
 * always supply both — a missing variable throws at render time.
 */
describe("vo_script prompt v5", () => {
  const vars = {
    questionnaire: "{}",
    selected_advantages: "- משלוח מהיר",
    demo_seconds: 20,
    word_budget: 44,
    words_per_second: 2.2,
  };

  it("is the latest version and receives the description and speaker gender", () => {
    expect(latestPromptVersion("vo_script")).toBe(5);
    const { text, promptVersion } = renderPrompt("vo_script", {
      ...vars,
      demo_description: "גלילה בתפריט, הוספה לעגלה",
      persona_gender: "female",
    });
    expect(promptVersion).toBe("vo_script@v5");
    expect(text).toContain("גלילה בתפריט, הוספה לעגלה");
    expect(text).toContain("SOFT grounding");
    expect(text).toContain("The speaker is female");
    expect(text).toContain("mid-twenties");
  });

  it("throws when demo_description is missing (callers must pass the fallback)", () => {
    expect(() => renderPrompt("vo_script", { ...vars, persona_gender: "female" })).toThrow(
      /demo_description/,
    );
  });

  it("throws when persona_gender is missing (callers must pass the default)", () => {
    expect(() => renderPrompt("vo_script", { ...vars, demo_description: "(אין)" })).toThrow(
      /persona_gender/,
    );
  });
});
