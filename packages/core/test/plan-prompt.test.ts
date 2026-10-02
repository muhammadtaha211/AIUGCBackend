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
 * — so no restart trap. The file only: the timing block it was rendered with
 * is generated for the latest version alone.
 */
describe("plan_demo_steps prompt v15", () => {
  it("takes exactly v14's variables", () => {
    expect(vars(read(15))).toEqual(vars(read(14)));
  });

  it("keeps rule 4 and the one-beat worked examples", () => {
    const text = read(15);
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

/**
 * plan_demo_steps v16 = v15 with a step as decisions 0076/0084 make it: one
 * fixed 2 s clip, already placed for every state (`clipStartMs`, with `calm`
 * and `twoPages` saying what the footage shows in it). Nothing is left to add
 * up — a plan runs its step count times the step length — so the prompt asks
 * for a step count, clips that share no footage and captions short enough to
 * read in one step, and for nothing else. Same six variables as v15 — the new
 * fields ride inside {{timeline}} and their explanation inside {{timing}} —
 * so no restart trap.
 */
describe("plan_demo_steps prompt v16", () => {
  const timing = planTimingMarkdown({ minSteps: 5, maxSteps: 10 });
  const render = () =>
    renderPrompt("plan_demo_steps", {
      questionnaire: "{}",
      timeline: "[]",
      min: 5,
      max: 10,
      timing,
      demo_description: "(אין)",
    });

  it("is the latest version and takes exactly v15's variables", () => {
    expect(latestPromptVersion("plan_demo_steps")).toBe(16);
    expect(vars(read(16))).toEqual(vars(read(15)));
  });

  it("the timing block is computed: a row per legal caption length, the step, the totals", () => {
    // Three words is the prompt's floor and four the ceiling — four words read
    // in exactly one step — so the table has those two rows and no other.
    expect(timing.split("\n").filter((line) => /^\| \d+ words/.test(line))).toEqual([
      "| 3 words | 1.6s |",
      "| 4 words | 2.0s |",
    ]);
    expect(timing).toContain("Every step runs exactly 2.0s: its clip.");
    // What the model reads on every timeline entry, and what each field means.
    expect(timing).toContain("Every timeline entry carries `clipStartMs`");
    expect(timing).toContain("`calm`, true when nothing in the picture changes during that clip");
    expect(timing).toContain("`twoPages`, true when the clip probably shows two different pages");
    // The no-shared-footage rule as a number the model can check.
    expect(timing).toContain("their `clipStartMs` values must be at least 2000 apart");
    expect(timing).toContain("5 steps run 10.0s, 10 steps run 20.0s");
  });

  it("renders the timing block through {{timing}} and leaves no placeholder behind", () => {
    const { text, promptVersion } = render();
    expect(promptVersion).toBe("plan_demo_steps@v16");
    expect(text).not.toContain("{{");
    expect(text).toContain("is to select 5–10 states");
    expect(text).toContain(timing);
    // The prose points at the block's numbers instead of restating them.
    expect(text).toContain("listed on its timeline entry as `clipStartMs`");
    expect(text).toContain("the timing block after the one before it?");
    expect(text).toContain("no longer than the longest row of the timing table above");
  });

  it("keeps the way-in rule under its heading, and the one-beat worked examples", () => {
    const text = read(16);
    // accessNotice tells a pinned plan to ignore this rule by its heading.
    expect(text).toContain("**4. Open with the way in.**");
    expect(text).toContain("### ONE CAPTION PER VISUAL BEAT — how to decide");
    expect(text).toContain("ONE beat — states 11 and 12.");
    expect(text).toContain("TWO beats — states 2 and 3.");
    expect(text).toContain("Then check the plan, all five:");
  });

  it("no longer mentions clipMs, a runtime band or a cap on a clip", () => {
    // All three were v15's, so the negative checks below are not vacuous.
    expect(read(15)).toContain("`clipMs`");
    expect(read(15)).toMatch(/\bband\b/);
    expect(read(15)).toMatch(/\bcap\b/);
    const { text } = render();
    expect(text).not.toContain("clipMs");
    expect(text).not.toMatch(/\bband\b/);
    expect(text).not.toMatch(/\bcap(ped)?\b/);
    expect(text).not.toContain("must total");
    // A clip is the same length everywhere, the ending included.
    expect(text).toContain("Every step runs exactly the same length");
  });
});
