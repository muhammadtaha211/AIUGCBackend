import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROMPTS_DIR } from "../src/paths";
import { latestPromptVersion, renderPrompt } from "../src/prompts";

/**
 * plan_demo_steps v14 = v13 with the label-provenance rule described as what
 * it now is (decision 0049): computed after the answer and shown to the
 * customer as unverified words, never a mechanical failure. Same six variables
 * as v13, so no restart trap (docs/vault/facts/prompt-versions-on-disk.md);
 * the four arithmetic checks, the caption examples, the ending and one-beat
 * rules and the timing block are untouched.
 */
describe("plan_demo_steps prompt v14", () => {
  const read = (version: number): string =>
    readFileSync(path.join(PROMPTS_DIR, "plan_demo_steps", `v${version}.md`), "utf8");
  const vars = (text: string): Set<string> =>
    new Set([...text.matchAll(/{{(\w+)}}/g)].map((m) => m[1]!));

  it("is the latest version and takes exactly v13's variables", () => {
    expect(latestPromptVersion("plan_demo_steps")).toBe(14);
    expect(vars(read(14))).toEqual(vars(read(13)));
    expect(vars(read(14))).toEqual(
      new Set(["min", "max", "questionnaire", "demo_description", "timeline", "timing"]),
    );
  });

  it("no longer says the word rule fails the plan — the words are shown to the customer", () => {
    const text = read(14);
    expect(text).not.toContain("fails the whole plan");
    expect(text).not.toContain("will fail the check");
    expect(text).not.toContain("checked mechanically");
    expect(text).toContain("shown to the customer as unverified");
    // The instruction that stays: claims the customer never made are not invented.
    expect(text).toContain("not yours to invent");
    // The instruction verbs and their present-tense plurals are named as never marked.
    expect(text).toContain("present-tense plurals");
    // Still hard, still verbatim: the four arithmetic checks.
    expect(text).toContain("Then check the arithmetic, all four:");
    expect(text).toContain("Does the plan total inside the band named in the timing block?");
    expect(text).toContain(
      "Is any pair of selected states the same beat under the test in step 3?",
    );
  });

  it("renders with the caller's vars and leaves no placeholder behind", () => {
    const { text, promptVersion } = renderPrompt("plan_demo_steps", {
      questionnaire: "{}",
      timeline: "[]",
      min: 5,
      max: 7,
      timing: "| caption | seconds it needs |",
      demo_description: "(אין)",
    });
    expect(promptVersion).toBe("plan_demo_steps@v14");
    expect(text).not.toContain("{{");
  });
});
