import { describe, expect, it } from "vitest";
import { fitParagraphFontSize, TEXT_BLOCK_FONT } from "../src/text-fit";

/**
 * The paragraph fitter (Service C): the hook-line descent with explicit line
 * breaks honoured. A fake 0.5em-per-character measure, like timing.test.ts.
 */
const measure = (text: string, size: number) => text.length * size * 0.5;
const fit = (text: string, maxWidth = 820, maxHeight = 1040) =>
  fitParagraphFontSize({ text, maxWidth, maxHeight, ...TEXT_BLOCK_FONT, measure });

describe("fitParagraphFontSize", () => {
  it("a short block takes the base size", () => {
    expect(fit("שורה קצרה")).toBe(TEXT_BLOCK_FONT.base);
  });

  it("honours explicit line breaks: three short lines need three lines of height", () => {
    // At 54px with lineHeight 1.3 a line is ~70px; a box of 150px holds two
    // lines, not three — so the breaks force the size down, where the same
    // words on one line would not.
    expect(fit("א\nב\nג", 820, 150)).toBeLessThan(TEXT_BLOCK_FONT.base);
    expect(fit("א ב ג", 820, 150)).toBe(TEXT_BLOCK_FONT.base);
  });

  it("a blank line keeps its height", () => {
    expect(fit("א\n\nב", 820, 150)).toBeLessThan(fit("א\nב", 820, 150));
  });

  it("the quiz shape: numbered lines each on their own line, inside the default area at base", () => {
    const quiz =
      "רוב הישראלים לא עונים נכון אפילו על אחת מאלה\n\n1. איזו עיר בארץ הכי גבוהה מעל פני הים?\n2. מי היה ראש הממשלה השני של ישראל?\n3. מאיפה מגיע השם תל אביב?\n\n(עוד שאלות כאלה ב-Eretzy)";
    expect(fit(quiz)).toBe(TEXT_BLOCK_FONT.base);
  });

  it("a 400-character block still fits the default area above the floor", () => {
    const words = Array.from({ length: 66 }, () => "מילהה").join(" "); // 395 chars
    const size = fit(words);
    expect(size).toBeGreaterThan(TEXT_BLOCK_FONT.min);
    expect(size).toBeLessThanOrEqual(TEXT_BLOCK_FONT.base);
  });

  it("floors at the minimum: an unbreakable word wider than the area, or far too much text", () => {
    expect(fit("א".repeat(200))).toBe(TEXT_BLOCK_FONT.min);
    expect(fit("מילה ".repeat(400))).toBe(TEXT_BLOCK_FONT.min);
  });

  it("steps down by 2px like the hook-line fitter", () => {
    const size = fit("מילה ".repeat(90));
    expect(size % 2).toBe(0);
    expect(size).toBeLessThan(TEXT_BLOCK_FONT.base);
  });
});
