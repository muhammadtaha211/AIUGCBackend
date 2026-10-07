import { describe, expect, it } from "vitest";
import {
  findIllegalTextBlockChar,
  isTextBlockSkeletonId,
  normalizeTextBlockText,
  TEXT_BLOCK_EXAMPLES,
  TEXT_BLOCK_MAX_CHARS,
  TEXT_BLOCK_SKELETON_IDS,
  TEXT_BLOCK_SKELETONS,
  textBlockLength,
  textBlockSkeletonLabel,
  textBlockTextError,
} from "../src/text-block";

/**
 * The גוש טקסט burn rules (decisions 0090–0091): the character set is the hook
 * line's plus the newline and minus the long dashes, the cap is 400 code
 * points, and an edited text gets exactly these checks and nothing more.
 */
describe("text block vocabulary", () => {
  it("has the ten skeletons of the 2026-10-07 brief, in its order, each with a Hebrew label", () => {
    expect(TEXT_BLOCK_SKELETON_IDS).toEqual([
      "reframe",
      "instead",
      "shoutout_hack",
      "wish_more_knew",
      "founder_ask",
      "relatable_observation",
      "quiz",
      "discovery",
      "envy_portrait",
      "cautionary_confession",
    ]);
    for (const skeleton of TEXT_BLOCK_SKELETONS) {
      expect(skeleton.label).toMatch(/[֐-׿]/);
      expect(textBlockSkeletonLabel(skeleton.id)).toBe(skeleton.label);
    }
    expect(isTextBlockSkeletonId("quiz")).toBe(true);
    expect(isTextBlockSkeletonId("pov_scene")).toBe(false);
    expect(textBlockSkeletonLabel("unknown")).toBe("unknown");
  });

  it("every founder example passes the burn check as written — the cap is 400 because `instead` is 396", () => {
    for (const id of TEXT_BLOCK_SKELETON_IDS) {
      expect(textBlockTextError(TEXT_BLOCK_EXAMPLES[id]), id).toBeNull();
    }
    expect(textBlockLength(TEXT_BLOCK_EXAMPLES.instead)).toBe(396);
    expect(TEXT_BLOCK_MAX_CHARS).toBe(400);
  });
});

describe("findIllegalTextBlockChar", () => {
  it("passes Hebrew, Latin brand names, digits, ASCII punctuation, straight quotes, a hyphen and a newline", () => {
    expect(
      findIllegalTextBlockChar(
        'עשרים הודעות ב-8 בערב? יש כלים כמו Sederly - "ככה". 1. שאלה\n2. שאלה (עוד ב-Eretzy)… ₪0',
      ),
    ).toBeUndefined();
  });

  it("rejects the em dash and the en dash the founder banned for this format", () => {
    expect(findIllegalTextBlockChar("אין לי מושג — אבל שאפו")).toEqual({
      char: "—",
      codepoint: "U+2014",
    });
    expect(findIllegalTextBlockChar("אין לי מושג – אבל שאפו")?.codepoint).toBe("U+2013");
  });

  it("rejects emoji, a tatweel, a zero-width space and a bidi control", () => {
    expect(findIllegalTextBlockChar("שאפו 🔥")?.codepoint).toBe("U+1F525");
    expect(findIllegalTextBlockChar("לـAI")?.codepoint).toBe("U+0640");
    expect(findIllegalTextBlockChar("א​ב")?.codepoint).toBe("U+200B");
    expect(findIllegalTextBlockChar("‫שלום")?.codepoint).toBe("U+202B");
  });
});

describe("textBlockTextError (the one check for generation, edit and render)", () => {
  it("accepts a clean block and trims Windows line endings on the way", () => {
    expect(textBlockTextError("  שורה אחת\r\nשורה שנייה  ")).toBeNull();
    expect(normalizeTextBlockText("  שורה אחת\r\nשורה שנייה  ")).toBe("שורה אחת\nשורה שנייה");
  });

  it("refuses an empty text", () => {
    expect(textBlockTextError("   \n  ")).toBe("הטקסט ריק.");
  });

  it("refuses the 401st code point and names the count", () => {
    const text = "א".repeat(400);
    expect(textBlockTextError(text)).toBeNull();
    expect(textBlockTextError(`${text}ב`)).toMatch(/400 תווים.*401/);
  });

  it("names the long dash as its own case, other glyphs by codepoint", () => {
    expect(textBlockTextError("זה — זה")).toMatch(/קו מפריד ארוך/);
    expect(textBlockTextError("זה 🔥 זה")).toMatch(/U\+1F525/);
  });
});
