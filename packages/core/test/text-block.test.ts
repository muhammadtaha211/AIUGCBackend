import { describe, expect, it } from "vitest";
import {
  findGeneratedTextBlockDash,
  findIllegalTextBlockChar,
  fittingTextBlockSkeletons,
  isTextBlockPlaceholder,
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
 * The גוש טקסט rules (decisions 0090–0091, amended 2026-10-07): the burn
 * check is the hook line's character set plus the newline, en and em dash
 * included, and the 450-code-point cap — an edited text gets exactly these and
 * nothing more. The long dashes are refused in generated text only.
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

  it("labels relatable_observation by its new move, in the founder's own words", () => {
    expect(textBlockSkeletonLabel("relatable_observation")).toBe("אין לי מושג איך אתם עושים את זה");
  });

  it("every founder example passes the burn check as written; the hard cap is 450, a margin over the prompt's 400", () => {
    for (const id of TEXT_BLOCK_SKELETON_IDS) {
      expect(textBlockTextError(TEXT_BLOCK_EXAMPLES[id]), id).toBeNull();
    }
    expect(textBlockLength(TEXT_BLOCK_EXAMPLES.instead)).toBe(396);
    expect(TEXT_BLOCK_MAX_CHARS).toBe(450);
  });
});

describe("findIllegalTextBlockChar (the burn check's character set)", () => {
  it("passes Hebrew, Latin brand names, digits, ASCII punctuation, straight quotes, a hyphen and a newline", () => {
    expect(
      findIllegalTextBlockChar(
        'עשרים הודעות ב-8 בערב? יש כלים כמו Sederly - "ככה". 1. שאלה\n2. שאלה (עוד ב-Eretzy)… ₪0',
      ),
    ).toBeUndefined();
  });

  it("passes the em dash and the en dash: they burn, and an edit may carry them", () => {
    expect(findIllegalTextBlockChar("אין לי מושג — אבל שאפו")).toBeUndefined();
    expect(findIllegalTextBlockChar("אין לי מושג – אבל שאפו")).toBeUndefined();
  });

  it("rejects emoji, a tatweel, a zero-width space and a bidi control", () => {
    expect(findIllegalTextBlockChar("שאפו 🔥")?.codepoint).toBe("U+1F525");
    expect(findIllegalTextBlockChar("לـAI")?.codepoint).toBe("U+0640");
    expect(findIllegalTextBlockChar("א​ב")?.codepoint).toBe("U+200B");
    expect(findIllegalTextBlockChar("‫שלום")?.codepoint).toBe("U+202B");
  });
});

describe("findGeneratedTextBlockDash (generated text only)", () => {
  it("finds the em dash and the en dash, and nothing in a plain or joining hyphen", () => {
    expect(findGeneratedTextBlockDash("אין לי מושג — אבל שאפו")).toBe("U+2014");
    expect(findGeneratedTextBlockDash("אין לי מושג – אבל שאפו")).toBe("U+2013");
    expect(findGeneratedTextBlockDash("ב-Sederly - אין לי מושג, ב-8 בערב")).toBeUndefined();
  });

  it("finds nothing in any of the ten founder examples", () => {
    for (const id of TEXT_BLOCK_SKELETON_IDS) {
      expect(findGeneratedTextBlockDash(TEXT_BLOCK_EXAMPLES[id]), id).toBeUndefined();
    }
  });
});

describe("textBlockTextError (the burn check for generation, edit and render)", () => {
  it("accepts a clean block and trims Windows line endings on the way", () => {
    expect(textBlockTextError("  שורה אחת\r\nשורה שנייה  ")).toBeNull();
    expect(normalizeTextBlockText("  שורה אחת\r\nשורה שנייה  ")).toBe("שורה אחת\nשורה שנייה");
  });

  it("collapses runs of spaces inside a line and trims line ends — pre-wrap keeps what the fitter measures", () => {
    expect(normalizeTextBlockText("א  ב\t ג \n\n ד")).toBe("א ב ג\n\nד");
  });

  it("refuses an empty text", () => {
    expect(textBlockTextError("   \n  ")).toBe("הטקסט ריק.");
  });

  it("refuses the 451st code point and names the count", () => {
    const text = "א".repeat(450);
    expect(textBlockTextError(text)).toBeNull();
    expect(textBlockTextError(`${text}ב`)).toMatch(/450 תווים.*451/);
  });

  it("accepts a long dash — an edited text is not checked for it — and names other glyphs by codepoint", () => {
    expect(textBlockTextError("זה — זה")).toBeNull();
    expect(textBlockTextError("זה – זה")).toBeNull();
    expect(textBlockTextError("זה 🔥 זה")).toMatch(/U\+1F525/);
  });
});

describe("fittingTextBlockSkeletons (what a batch asks for)", () => {
  it("drops discovery, alone, when the questionnaire has no wow: missing, null, empty or blank", () => {
    const nine = TEXT_BLOCK_SKELETON_IDS.filter((id) => id !== "discovery");
    for (const questionnaire of [{}, { wow: null }, { wow: "" }, { wow: " \n\t " }]) {
      expect(fittingTextBlockSkeletons(questionnaire), JSON.stringify(questionnaire)).toEqual(nine);
    }
  });

  it("asks for all ten, in bank order, when there is a wow", () => {
    expect(fittingTextBlockSkeletons({ wow: "מחברים את קבוצת הגן" })).toEqual([
      ...TEXT_BLOCK_SKELETON_IDS,
    ]);
  });
});

describe("isTextBlockPlaceholder (never served to a customer)", () => {
  it("catches what the model returned in place of a skip, and the empty text", () => {
    for (const text of ["skip", "skipped", "discovery", "N/A", ""]) {
      expect(isTextBlockPlaceholder(text), JSON.stringify(text)).toBe(true);
    }
  });

  it("passes every founder example and a Hebrew text carrying a Latin brand", () => {
    for (const id of TEXT_BLOCK_SKELETON_IDS) {
      expect(isTextBlockPlaceholder(TEXT_BLOCK_EXAMPLES[id]), id).toBe(false);
    }
    expect(isTextBlockPlaceholder("יש כלים כמו Sederly")).toBe(false);
  });
});
