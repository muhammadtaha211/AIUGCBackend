import { describe, expect, it } from "vitest";
import { TEXT_BLOCK_MAX_CHARS, textBlockTextError } from "@aiugc/core/text-block";
import {
  C_STEP_TITLES,
  C_WIZARD_STEPS,
  cShapeSummary,
  earlierTexts,
  isTextBlockDirty,
  retryableTextBlockFailure,
  textBlockCounter,
  textBlockDraft,
  withSavedText,
  withShownText,
  type TextBlockOption,
} from "../src/lib/service-c-ui";

const first: TextBlockOption = { scriptId: "s1", text: "טקסט ראשון", skeleton: "reframe" };
const second: TextBlockOption = { scriptId: "s2", text: "טקסט שני", skeleton: "quiz" };

describe("C wizard steps", () => {
  it("runs character -> clip -> studio -> render, each with a title", () => {
    expect(C_WIZARD_STEPS).toEqual(["persona", "clip", "studio", "render"]);
    for (const step of C_WIZARD_STEPS) expect(C_STEP_TITLES[step]).toBeTruthy();
  });
});

describe("textBlockDraft / isTextBlockDirty", () => {
  it("shows the stored text until there is a draft", () => {
    expect(textBlockDraft(first)).toBe("טקסט ראשון");
    expect(textBlockDraft({ ...first, draft: "ערוך" })).toBe("ערוך");
  });

  it("is dirty only when the normalized draft differs from the stored text", () => {
    expect(isTextBlockDirty(first)).toBe(false);
    // Whitespace the route would collapse is not an edit.
    expect(isTextBlockDirty({ ...first, draft: "  טקסט   ראשון \r\n" })).toBe(false);
    expect(isTextBlockDirty({ ...first, draft: "טקסט אחר" })).toBe(true);
  });
});

describe("textBlockCounter", () => {
  it("counts code points of the normalized text against the cap", () => {
    expect(textBlockCounter("  שלום  עולם ")).toBe(`9/${TEXT_BLOCK_MAX_CHARS}`);
    expect(textBlockCounter("")).toBe(`0/${TEXT_BLOCK_MAX_CHARS}`);
  });

  it("goes over the cap exactly where the render check starts refusing", () => {
    const atCap = "א".repeat(TEXT_BLOCK_MAX_CHARS);
    expect(textBlockCounter(atCap)).toBe(`${TEXT_BLOCK_MAX_CHARS}/${TEXT_BLOCK_MAX_CHARS}`);
    expect(textBlockTextError(atCap)).toBeNull();
    expect(textBlockCounter(atCap + "ב")).toBe(
      `${TEXT_BLOCK_MAX_CHARS + 1}/${TEXT_BLOCK_MAX_CHARS}`,
    );
    expect(textBlockTextError(atCap + "ב")).not.toBeNull();
  });
});

describe("withShownText", () => {
  it("appends a new text in the order served", () => {
    expect(withShownText([first], second).map((t) => t.scriptId)).toEqual(["s1", "s2"]);
  });

  it("never lists one row twice (two tabs can serve it twice)", () => {
    const texts = [first];
    expect(withShownText(texts, { ...first })).toBe(texts);
  });
});

describe("withSavedText", () => {
  it("swaps the edited text for the new row in place and drops its draft", () => {
    const texts = [{ ...first, draft: "ערוך" }, second];
    const saved = withSavedText(texts, "s1", { scriptId: "s3", text: "ערוך" });
    expect(saved).toEqual([{ scriptId: "s3", text: "ערוך", skeleton: "reframe" }, second]);
  });
});

describe("earlierTexts", () => {
  it("lists every text but the pick, most recent first", () => {
    const third: TextBlockOption = { scriptId: "s3", text: "שלישי", skeleton: "instead" };
    expect(earlierTexts([first, second, third], "s2").map((t) => t.scriptId)).toEqual(["s3", "s1"]);
    expect(earlierTexts([first], "s1")).toEqual([]);
  });
});

describe("retryableTextBlockFailure", () => {
  it("refuses a retry only on a daily quota", () => {
    expect(retryableTextBlockFailure(429)).toBe(false);
    for (const status of [0, 402, 422, 500, 502, 503]) {
      expect(retryableTextBlockFailure(status)).toBe(true);
    }
  });
});

describe("cShapeSummary", () => {
  it("names the clip's own length, to a tenth of a second", () => {
    expect(cShapeSummary(12_345)).toContain("12.3");
  });
});
