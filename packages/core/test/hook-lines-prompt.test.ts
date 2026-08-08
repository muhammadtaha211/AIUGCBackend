import { describe, expect, it } from "vitest";
import { latestPromptVersion, renderPrompt } from "../src/prompts";

/**
 * hook_lines v6 = the frame rewrite: ten sentence shapes instead of four
 * intentions, a first-person speaker with a two-axis gender rule, and
 * {{avoid}} so a reroll batch does not circle back to the same phrasings.
 * {{n}} is gone — the prompt always writes all ten and `n` only decides how
 * many rows core keeps.
 * renderPrompt auto-selects the highest version, so generateHookLines must
 * always supply every variable — a missing variable throws at render time.
 */
describe("hook_lines prompt v6", () => {
  const vars = { questionnaire: "{}" };

  it("is the latest version and receives the avoid list and speaker gender", () => {
    expect(latestPromptVersion("hook_lines")).toBe(6);
    const { text, promptVersion } = renderPrompt("hook_lines", {
      ...vars,
      avoid: "- מי שעדיין עושה את זה ידנית, מפסיד",
      persona_gender: "male",
    });
    expect(promptVersion).toBe("hook_lines@v6");
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
      "forbidden_secret",
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
});
