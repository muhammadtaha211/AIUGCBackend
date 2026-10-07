import { describe, expect, it } from "vitest";
import { latestPromptVersion, renderPrompt } from "../src/prompts";
import { TEXT_BLOCK_EXAMPLES, TEXT_BLOCK_SKELETON_IDS } from "../src/text-block";

/**
 * text_block v1 (decisions 0090–0091, Appendices A and B of the 2026-10-07
 * brief): the ten skeletons with the founder's examples verbatim, the writing
 * rules, the truth rules, and the standing house rules that apply to burned
 * text. The rules are pinned as text — the prompt is the versioned artifact
 * and a rule going missing is the real signal.
 */
describe("text_block prompt v1", () => {
  const vars = { questionnaire: "{}", speaker_gender: "female" };
  const flat = (text: string) => text.replace(/\s+/g, " ");

  it("is the latest version and receives the questionnaire and the speaker gender", () => {
    expect(latestPromptVersion("text_block")).toBe(1);
    const { text, promptVersion } = renderPrompt("text_block", {
      questionnaire: '{"product_name":"Tavnit"}',
      speaker_gender: "male",
    });
    expect(promptVersion).toBe("text_block@v1");
    expect(text).toContain('"product_name":"Tavnit"');
    expect(text).toContain("The speaker is male");
    expect(text).not.toContain("{{");
  });

  it("throws when speaker_gender is missing (every clip carries one)", () => {
    expect(() => renderPrompt("text_block", { questionnaire: "{}" })).toThrow(/speaker_gender/);
  });

  it("carries every skeleton id and every founder example verbatim", () => {
    const { text } = renderPrompt("text_block", vars);
    for (const id of TEXT_BLOCK_SKELETON_IDS) {
      expect(text).toContain(`\`${id}\``);
      expect(text, id).toContain(TEXT_BLOCK_EXAMPLES[id]);
    }
  });

  it("pins the shape rules: the aim, the cap, the line-break rule, one product mention, the plural audience", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    expect(text).toContain("Aim for 25–40 Hebrew words. The hard cap is 400 characters");
    expect(text).toContain("Line breaks only in `quiz` and `founder_ask`");
    expect(text).toContain("Name the product once, the way the brand writes it. Latin stays Latin");
    expect(text).toContain("The audience is addressed in the plural");
    expect(text).toContain("No call to action outside `instead`");
    expect(text).toContain("no hashtags, no emoji");
  });

  it("pins the truth rules: no speaker experience of the product, no invented figures, no health or money promises", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    expect(text).toContain(
      "Never write the speaker using, trying, buying or benefiting from the product, in any tense",
    );
    expect(text).toContain("Never invent a number, price, statistic, earning, timeframe or result");
    expect(text).toContain("stated as the business's claim and never as the speaker's experience");
    expect(text).toContain("No health or money promises");
    expect(text).toContain("Nothing negative about a named company");
    expect(text).toContain("The texts never refer to the clip");
  });

  it("carries the standing house rules: the dash ban, the character set, straight quotes, the רגע tick, the naming policy, no calendar year", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    expect(text).toContain("Never an em dash or an en dash");
    expect(text).toContain("Hebrew, Latin, digits and standard punctuation only");
    expect(text).toContain("never the curly typographic pair");
    expect(text).toContain("Never `רגע` as a hesitation tick");
    expect(text).toContain("The tick is what is banned, not the word");
    expect(text).toContain("ChatGPT, Google, Excel, WhatsApp");
    expect(text).toContain("any small or local named business; any direct competitor");
    expect(text).toContain("No calendar year");
  });

  it("binds the skeletons the way the brief does and asks for every one back, written or skipped", () => {
    const text = flat(renderPrompt("text_block", vars).text);
    expect(text).toContain("A skeleton that does not fit this business is skipped, never forced");
    expect(text).toContain("Skip `discovery` when the questionnaire has no `wow`");
    expect(text).toContain("First person plural, the only skeleton that speaks as the business");
    expect(text).toContain("The confession is about the problem, never about the product");
    expect(text).toContain("A third-person archetype, never a named or real person");
    expect(text).toContain("Return every skeleton exactly once");
  });
});
