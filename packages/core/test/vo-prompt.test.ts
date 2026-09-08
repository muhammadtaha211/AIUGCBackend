import { describe, expect, it } from "vitest";
import { latestPromptVersion, renderPrompt } from "../src/prompts";

/**
 * vo_script v7 = the word budget reframed as a FLOOR: the length that fills the
 * demo, reached rather than stayed under, with an exemplar ladder at three
 * budgets so the model interpolates instead of anchoring on one length. Keeps
 * v6's five-beat arc and {{hook_line}} escalation, v3's {{demo_description}}
 * soft grounding and v4's {{persona_gender}} axis — same eight variables as v6.
 * renderPrompt auto-selects the highest version, so generateVoScript must
 * always supply every variable — a missing variable throws at render time.
 *
 * v8 (same eight vars — no restart needed) drops `רגע` from both the slang
 * list and its "A restart" imperfection example, and bans it outright: the
 * founder wants it gone as a filler/restart, permanently.
 */
describe("vo_script prompt v8", () => {
  const vars = {
    questionnaire: "{}",
    selected_advantages: "- משלוח מהיר",
    demo_seconds: 20,
    word_budget: 44,
    words_per_second: 2.2,
  };

  it("is the latest version and receives description, speaker gender and hook line", () => {
    expect(latestPromptVersion("vo_script")).toBe(8);
    const { text, promptVersion } = renderPrompt("vo_script", {
      ...vars,
      demo_description: "גלילה בתפריט, הוספה לעגלה",
      persona_gender: "female",
      hook_line: "מי שעדיין עושה את זה ידנית, מפסיד",
    });
    expect(promptVersion).toBe("vo_script@v8");
    expect(text).toContain("גלילה בתפריט, הוספה לעגלה");
    expect(text).toContain("SOFT grounding");
    expect(text).toContain("The speaker is female");
    expect(text).toContain("mid-twenties");
    expect(text).toContain("מי שעדיין עושה את זה ידנית, מפסיד");
  });

  /**
   * רגע is banned outright (founder ruling, 2026-09-08): no longer offered as
   * slang, no longer the "A restart" example, and the one place it may still
   * appear is the sentence that forbids it.
   */
  it("bans רגע as a filler, restart or aside, and drops it from the slang list (v8+)", () => {
    const { text } = renderPrompt("vo_script", {
      ...vars,
      demo_description: "(אין)",
      persona_gender: "female",
      hook_line: "(אין)",
    });
    expect(text).toContain("Never `רגע`");
    expect(text.match(/רגע/g)).toHaveLength(1);
    expect(text).not.toContain("וזה, רגע, זה פשוט הכל במסך אחד");
  });

  /**
   * The floor is the whole point of v7, and the budget is substituted into the
   * length section rather than named abstractly — a prompt that renders the
   * number but still frames it as a maximum would pass every other test here.
   */
  it("frames the budget as a floor, with no upper bound left anywhere", () => {
    const { text } = renderPrompt("vo_script", {
      ...vars,
      demo_description: "(אין)",
      persona_gender: "female",
      hook_line: "(אין)",
    });
    expect(text).toContain("44 is a floor, not a ceiling");
    expect(text).toContain("At 44 or above is correct");
    expect(text).not.toContain("90% and 100%");
    expect(text).not.toContain("AT MOST");
  });

  /** The ladder: three lengths, so a large budget has a shape to reach for. */
  it("carries worked exemplars at three budgets, not one", () => {
    const { text } = renderPrompt("vo_script", {
      ...vars,
      demo_description: "(אין)",
      persona_gender: "female",
      hook_line: "(אין)",
    });
    for (const budget of [25, 40, 120]) {
      expect(text).toContain(`At a budget of about ${budget} words:`);
    }
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
