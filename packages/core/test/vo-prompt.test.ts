import { describe, expect, it } from "vitest";
import { latestPromptVersion, renderPrompt } from "../src/prompts";

/**
 * vo_script v3 = v2 + the {{demo_description}} soft-grounding section.
 * renderPrompt auto-selects the highest version, so generateVoScript must
 * always supply demo_description (with the explicit "none" fallback) — a
 * missing variable throws at render time.
 */
describe("vo_script prompt v3", () => {
  const vars = {
    questionnaire: "{}",
    selected_advantages: "- משלוח מהיר",
    demo_seconds: 20,
    word_budget: 44,
    words_per_second: 2.2,
  };

  it("is the latest version and receives the footage description", () => {
    expect(latestPromptVersion("vo_script")).toBe(3);
    const { text, promptVersion } = renderPrompt("vo_script", {
      ...vars,
      demo_description: "גלילה בתפריט, הוספה לעגלה",
    });
    expect(promptVersion).toBe("vo_script@v3");
    expect(text).toContain("גלילה בתפריט, הוספה לעגלה");
    expect(text).toContain("SOFT grounding");
  });

  it("throws when demo_description is missing (callers must pass the fallback)", () => {
    expect(() => renderPrompt("vo_script", vars)).toThrow(/demo_description/);
  });
});
