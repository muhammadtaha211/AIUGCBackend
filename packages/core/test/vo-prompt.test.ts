import { describe, expect, it } from "vitest";
import { latestPromptVersion, renderPrompt } from "../src/prompts";

/**
 * vo_script v6 = the FOMO five-beat rewrite: stake opener, {{hook_line}}
 * escalation, 90–100% word-budget band — keeping v3's {{demo_description}}
 * soft grounding and v4's {{persona_gender}} axis.
 * renderPrompt auto-selects the highest version, so generateVoScript must
 * always supply every variable — a missing variable throws at render time.
 */
describe("vo_script prompt v6", () => {
  const vars = {
    questionnaire: "{}",
    selected_advantages: "- משלוח מהיר",
    demo_seconds: 20,
    word_budget: 44,
    words_per_second: 2.2,
  };

  it("is the latest version and receives description, speaker gender and hook line", () => {
    expect(latestPromptVersion("vo_script")).toBe(6);
    const { text, promptVersion } = renderPrompt("vo_script", {
      ...vars,
      demo_description: "גלילה בתפריט, הוספה לעגלה",
      persona_gender: "female",
      hook_line: "מי שעדיין עושה את זה ידנית, מפסיד",
    });
    expect(promptVersion).toBe("vo_script@v6");
    expect(text).toContain("גלילה בתפריט, הוספה לעגלה");
    expect(text).toContain("SOFT grounding");
    expect(text).toContain("The speaker is female");
    expect(text).toContain("mid-twenties");
    expect(text).toContain("מי שעדיין עושה את זה ידנית, מפסיד");
  });

  it("throws when demo_description is missing (callers must pass the fallback)", () => {
    expect(() =>
      renderPrompt("vo_script", { ...vars, persona_gender: "female", hook_line: "(אין)" }),
    ).toThrow(/demo_description/);
  });

  it("throws when persona_gender is missing (callers must pass the default)", () => {
    expect(() =>
      renderPrompt("vo_script", { ...vars, demo_description: "(אין)", hook_line: "(אין)" }),
    ).toThrow(/persona_gender/);
  });

  it("throws when hook_line is missing (callers must pass the placeholder)", () => {
    expect(() =>
      renderPrompt("vo_script", { ...vars, demo_description: "(אין)", persona_gender: "female" }),
    ).toThrow(/hook_line/);
  });
});
