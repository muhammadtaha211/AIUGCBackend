import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROMPTS_DIR } from "../src/paths";
import { planTimingMarkdown } from "../src/pipelines/demo-step-plans";
import { latestPromptVersion, renderPrompt } from "../src/prompts";

const read = (version: number): string =>
  readFileSync(path.join(PROMPTS_DIR, "plan_demo_steps", `v${version}.md`), "utf8");
const vars = (text: string): Set<string> =>
  new Set([...text.matchAll(/{{(\w+)}}/g)].map((m) => m[1]!));

/**
 * plan_demo_steps v14 = v13 with the label-provenance rule described as what
 * it now is (decision 0049): computed after the answer and shown to the
 * customer as unverified words, never a mechanical failure. Same six variables
 * as v13, so no restart trap (docs/vault/facts/prompt-versions-on-disk.md);
 * the four arithmetic checks, the caption examples, the ending and one-beat
 * rules and the timing block are untouched.
 */
describe("plan_demo_steps prompt v14", () => {
  it("takes exactly v13's variables", () => {
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
});

/**
 * plan_demo_steps v15 = v14 with a step's clip as decisions 0070/0072 make
 * it: it runs until the app leaves its screen (the timeline's `clipMs`), the
 * cap or the next selected state, whichever comes first, and nothing pads it
 * to a floor. Same six variables as v14 — `clipMs` rides inside {{timeline}}
 * and its explanation inside {{timing}} — so no restart trap.
 */
describe("plan_demo_steps prompt v15", () => {
  it("is the latest version and takes exactly v14's variables", () => {
    expect(latestPromptVersion("plan_demo_steps")).toBe(15);
    expect(vars(read(15))).toEqual(vars(read(14)));
  });

  it("renders the clipMs explanation through {{timing}} and leaves no placeholder behind", () => {
    const { text, promptVersion } = renderPrompt("plan_demo_steps", {
      questionnaire: "{}",
      timeline: "[]",
      min: 5,
      max: 7,
      timing: planTimingMarkdown({
        maxMs: 4000,
        runtime: { minMs: 15_000, maxMs: 21_000 },
        minSteps: 5,
        maxSteps: 7,
      }),
      demo_description: "(אין)",
    });
    expect(promptVersion).toBe("plan_demo_steps@v15");
    expect(text).not.toContain("{{");
    // The prose names the field; the generated block says what it measures,
    // with the cap and the minimum gap computed, not restated.
    expect(text).toContain("that is the state's `clipMs`");
    expect(text).toContain("Every timeline entry carries `clipMs`");
    expect(text).toContain("never more than 4.0s");
    expect(text).toContain("Under a 1.6s gap you may not select both states at all.");
    expect(text).toContain("The steps must total 15.0-21.0s");
  });

  it("keeps rule 4 and the one-beat worked examples", () => {
    const text = read(15);
    // accessNotice tells a pinned plan to ignore rule 4 by this name.
    expect(text).toContain("**4. Open with the way in.**");
    expect(text).toContain("### ONE CAPTION PER VISUAL BEAT — how to decide");
    expect(text).toContain("ONE beat — states 11 and 12.");
    expect(text).toContain("TWO beats — states 2 and 3.");
    expect(text).toContain("Then check the arithmetic, all four:");
  });

  it("no longer promises a floor-length clip or an uncapped ending", () => {
    // Both were v14's, so the negative checks below are not vacuous.
    expect(read(14)).toContain("runs its floor length");
    expect(read(14)).toContain("your ending — is never capped");
    const text = read(15);
    expect(text).not.toContain("runs its floor length");
    expect(text).not.toContain("your ending — is never capped");
    expect(text).toContain("Your ending is no exception: it runs its own `clipMs`.");
  });
});
