import { describe, expect, it } from "vitest";
import { latestPromptVersion, renderPrompt } from "../src/prompts";

/**
 * hook_lines v7 = exemplar surgery on the three frames that failed identically
 * on both live businesses: `forbidden_secret` became `disbelief_at_ease` (the
 * secrecy contradicted the demo that follows), `quoted_objection` lost its
 * dismissal, and `absurd_affection` gained a role test. Plus four hard rules —
 * no closing beat, name the noun, verb precision, and the character set.
 * renderPrompt auto-selects the highest version, so generateHookLines must
 * always supply every variable — a missing variable throws at render time.
 */
describe("hook_lines prompt v7", () => {
  const vars = { questionnaire: "{}" };

  it("is the latest version and receives the avoid list and speaker gender", () => {
    expect(latestPromptVersion("hook_lines")).toBe(7);
    const { text, promptVersion } = renderPrompt("hook_lines", {
      ...vars,
      avoid: "- מי שעדיין עושה את זה ידנית, מפסיד",
      persona_gender: "male",
    });
    expect(promptVersion).toBe("hook_lines@v7");
    expect(text).toContain("מי שעדיין עושה את זה ידנית, מפסיד");
    expect(text).toContain("The speaker is male");
  });

  it("throws when avoid is missing (callers must pass the fallback)", () => {
    expect(() => renderPrompt("hook_lines", { ...vars, persona_gender: "female" })).toThrow(
      /avoid/,
    );
  });

  it("throws when persona_gender is missing (callers must pass the default)", () => {
    expect(() => renderPrompt("hook_lines", { ...vars, avoid: "(אין)" })).toThrow(/persona_gender/);
  });

  it("names all ten frame keys, so the returned angle is always one of them", () => {
    const { text } = renderPrompt("hook_lines", {
      ...vars,
      avoid: "(אין — זו הקבוצה הראשונה)",
      persona_gender: "female",
    });
    for (const frame of [
      "pov_scene",
      "disbelief",
      "disbelief_at_ease",
      "regret_waste",
      "humblebrag_uncertainty",
      "absurd_affection",
      "generational",
      "quoted_objection",
      "era_declaration",
      "hidden_method",
    ]) {
      expect(text).toContain(frame);
    }
  });

  it("carries no trace of the renamed frame", () => {
    const { text } = renderPrompt("hook_lines", {
      ...vars,
      avoid: "(אין — זו הקבוצה הראשונה)",
      persona_gender: "female",
    });
    expect(text).not.toContain("forbidden_secret");
    // The withholding shape appeared twice in v6 — the frame and the worked
    // gender example — and both live failures echoed it near-verbatim.
    expect(text).not.toContain("לא אמורה לספר");
  });
});
