import { describe, expect, it } from "vitest";
import {
  assertBScriptWordCeiling,
  countScriptWords,
  MAX_B_SCRIPT_WORDS,
} from "../src/b-script-words";
import { MAX_LIPSYNC_SECONDS } from "../src/providers/lipsync";

/**
 * The guard that replaced the word-budget hard cap. It is a runaway-cost
 * guard, so what it must NOT do is as pinned as what it must: a script over
 * its 15s word budget (31 words) is an ordinary longer ad and has to pass.
 */

const words = (n: number) => Array.from({ length: n }, () => "מילה").join(" ");

describe("assertBScriptWordCeiling", () => {
  it("passes a script well over its word budget — the budget is a target, not a cap", () => {
    // 31 = floor(15 * words_per_second 2.1), the live 15s budget.
    expect(() => assertBScriptWordCeiling(words(32))).not.toThrow();
    expect(() => assertBScriptWordCeiling(words(MAX_B_SCRIPT_WORDS - 1))).not.toThrow();
  });

  it("passes at exactly the ceiling", () => {
    expect(() => assertBScriptWordCeiling(words(MAX_B_SCRIPT_WORDS))).not.toThrow();
  });

  it("throws one word past the ceiling", () => {
    expect(() => assertBScriptWordCeiling(words(MAX_B_SCRIPT_WORDS + 1))).toThrow();
  });

  it("refuses in the system-limit register, never as 'your script is too long'", () => {
    // api-errors.ts passes this message straight to the customer, keyed on
    // "חורג מהמגבלה לעיבוד" — the phrasing and the mapping move together.
    expect(() => assertBScriptWordCeiling(words(MAX_B_SCRIPT_WORDS + 1))).toThrow(
      /חורג מהמגבלה לעיבוד/,
    );
    expect(() => assertBScriptWordCeiling(words(MAX_B_SCRIPT_WORDS + 1))).toThrow(/פנו לתמיכה/);
  });

  it("is reachable from the package barrel, where the web route imports it", async () => {
    // The guard moved to a client-safe module so the wizard can name the
    // ceiling; the route's `from "@aiugc/core"` import must survive that.
    const barrel = await import("../src/index");
    expect(barrel.MAX_B_SCRIPT_WORDS).toBe(MAX_B_SCRIPT_WORDS);
    expect(barrel.assertBScriptWordCeiling).toBe(assertBScriptWordCeiling);
  });

  it("counts the way countWords does — whitespace-separated tokens, edges ignored", () => {
    const atCeiling = `  ${words(MAX_B_SCRIPT_WORDS).replace(/ /g, "\n  ")}  `;
    expect(countScriptWords(atCeiling)).toBe(MAX_B_SCRIPT_WORDS);
    expect(() => assertBScriptWordCeiling(atCeiling)).not.toThrow();
    expect(() => assertBScriptWordCeiling("")).not.toThrow();
    expect(countScriptWords("   ")).toBe(0);
  });

  it("stays an order of magnitude under the lipsync guard it sits behind", () => {
    // ~150 words at the live 2.1 w/s (app_config.words_per_second) is ~71s.
    expect(MAX_B_SCRIPT_WORDS / 2.1).toBeLessThan(MAX_LIPSYNC_SECONDS);
  });
});
