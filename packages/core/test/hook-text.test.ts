import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

// Hoisted so the module factory below can close over it: the cap check runs
// on the live path (DRY_RUN fabricates an in-cap hook_text by construction).
const generateObject = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/anthropic", () => ({
  generateObject,
  CLAUDE_MODEL: "claude-sonnet-4-6",
}));

import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import {
  HOOK_TEXT_MAX_CHARS,
  HOOK_TEXT_MAX_WORDS,
  hookTextError,
  hookTextWordCount,
} from "../src/hook-text";
import { PermanentError } from "../src/jobs/errors";
import { addPersona, addStructure } from "../src/pipelines/bank";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import { deriveHookText, generateBScript, updateScriptText } from "../src/pipelines/copy";
import { createTestDb } from "./helpers/pglite";

/**
 * The on-screen hook text of a Service B opener (vault 0017): emitted by
 * b_script v9 alongside the script, re-derived by hook_text when the script is
 * edited — or when b_script's own line misses a cap — and rejected, never
 * trimmed, when the re-derived line misses one too.
 */

describe("hookTextError", () => {
  it("passes a clean line under both caps", () => {
    expect(hookTextError("חייבת לספר לכם על משהו")).toBeUndefined();
    expect(hookTextError("ממש מפחיד כמה שזה טוב")).toBeUndefined();
  });

  it("counts words the way readTimeMs does — a spaced dash is not a word", () => {
    expect(hookTextWordCount("אחת שתיים — שלוש")).toBe(3);
  });

  it("rejects the 9th word and accepts the 8th", () => {
    expect(hookTextError("א ב ג ד ה ו ז ח ט")).toMatch(/9 words/);
    expect(hookTextError("א ב ג ד ה ו ז ח")).toBeUndefined();
  });

  it("rejects the 41st character, counting spaces", () => {
    const forty = "אבגדהוזחטי ".repeat(3) + "אבגדהוז";
    expect([...forty].length).toBe(40);
    expect(hookTextError(forty)).toBeUndefined();
    expect(hookTextError(`${forty}ח`)).toMatch(/41 characters/);
  });

  it("rejects a trailing full stop, comma, colon, semicolon or ellipsis", () => {
    expect(hookTextError("זה טוב מדי…")).toMatch(/punctuation/);
    expect(hookTextError("זה טוב מדי.")).toMatch(/punctuation/);
    expect(hookTextError("זה טוב מדי,")).toMatch(/punctuation/);
    expect(hookTextError("זה טוב מדי:")).toMatch(/punctuation/);
    expect(hookTextError("זה טוב מדי;")).toMatch(/punctuation/);
  });

  // Founder, 2026-09-06: a Hebrew hook is very often a question, and the wizard
  // invites the customer to edit the line — "?" was the most natural thing to
  // type there and the field refused it.
  it("allows a trailing question mark or exclamation mark", () => {
    expect(hookTextError("למה אף אחד לא סיפר לי?")).toBeUndefined();
    expect(hookTextError("משלוח חינם!")).toBeUndefined();
    // Still counted and capped like any other line.
    expect(hookTextError("א ב ג ד ה ו ז ח ט?")).toMatch(/9 words/);
  });

  it("rejects emoji and niqqud; a maqaf is fine", () => {
    expect(hookTextError("מצאתי את זה 🔥")).toMatch(/emoji/);
    expect(hookTextError("שָׁלוֹם לכולם")).toMatch(/niqqud/);
    expect(hookTextError("הסוד ל־2026")).toBeUndefined();
  });

  it("rejects an empty or whitespace-only line", () => {
    expect(hookTextError("")).toMatch(/empty/);
    expect(hookTextError("   ")).toMatch(/empty/);
  });

  it("rejects a line with no words, and the characters a hook line may not burn", () => {
    expect(hookTextError("—")).toMatch(/no words/);
    // Zero-width space and an Arabic tatweel — the same set copy.ts rejects
    // on hook lines; both would burn as stray glyphs.
    expect(hookTextError("מצאתי​דירה")).toMatch(/U\+200B/);
    expect(hookTextError("כולם עברו לـAI")).toMatch(/U\+0640/);
    // Latin brand names, digits and ASCII punctuation stay legal.
    expect(hookTextError("ככה מוחקים את ChatGPT ב-2026")).toBeUndefined();
  });

  // The word cap is deliberately one looser than the 7 the prompts aim at
  // (2026-09-08, vault 0030); the character cap is the physical one and is the
  // same number the prompts state.
  it("exports the caps, the word one a notch above what the prompts aim at", () => {
    expect(HOOK_TEXT_MAX_WORDS).toBe(8);
    expect(HOOK_TEXT_MAX_CHARS).toBe(40);
  });
});

describe("generateBScript / deriveHookText / updateScriptText (real DB, mocked Claude)", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let businessId: string;
  let personaId: string;
  let structureId: string;

  const SCRIPT =
    "חייבת לספר לכם על משהו שגיליתי השבוע ניסיתי את זה בספקנות ותוך יום הבנתי " +
    "שאין סיכוי שאני חוזרת אחורה קוראים לזה קרם הפנים ממליצה בחום";
  const HOOK = "חייבת לספר לכם על משהו";
  /** Nine words — one over HOOK_TEXT_MAX_WORDS, and 37 characters, so the word
   *  cap is the only rule it breaks. */
  const OVER_CAP = "אני לא יכולה להאמין מה קרה לי פה היום";

  function reply(object: Record<string, string>) {
    return { object, usage: { inputTokens: 900, outputTokens: 120 } };
  }

  async function scriptCount(): Promise<number> {
    return (await db.select().from(dbSchema.scripts)).length;
  }

  async function llmUsageCount(): Promise<number> {
    return (
      await db
        .select()
        .from(dbSchema.usageEvents)
        .where(sql`${dbSchema.usageEvents.kind} = 'llm_tokens'`)
    ).length;
  }

  beforeAll(async () => {
    delete process.env.DRY_RUN;
    resetEnvCache();
    const testDb = await createTestDb();
    db = testDb.db;
    pg = testDb.pg;
    const business = await createBusiness(db, {
      ownerEmail: "founder@example.com",
      name: "קרם הפנים",
      ownerRole: "admin",
    });
    businessId = business.id;
    await setQuestionnaire(db, businessId, {
      category: "physical_product",
      product_name: "קרם הפנים",
      what_it_does: "קרם לחות טבעי לעור רגיש",
      advantages: ["רכיבים טבעיים בלבד"],
      target_audience: "נשים 25-45",
      tone: "friendly",
    });
    personaId = (await addPersona(db, { name: "נועה", voiceId: "voice_noa" })).id;
    structureId = (
      await addStructure(db, {
        title: "show-and-react",
        skeleton: { beats: ["hook", "react", "cta"] },
      })
    ).id;
  });

  afterAll(async () => {
    await pg.close();
  });

  it("stores the model's hook_text on params, parsed with a schema that requires it", async () => {
    generateObject.mockReset().mockResolvedValueOnce(reply({ script: SCRIPT, hook_text: HOOK }));

    const script = await generateBScript(db, { businessId, personaId, structureId });

    expect(script.text).toBe(SCRIPT);
    expect((script.params as { hookText?: string }).hookText).toBe(HOOK);
    // The hook_text era starts at v9; the exact latest is not pinned.
    expect(Number(script.promptVersion!.split("@v")[1])).toBeGreaterThanOrEqual(9);

    const call = generateObject.mock.calls[0]![0] as { prompt: string; schema: z.ZodType };
    expect(call.prompt).toContain('"hook_text"');
    // b_script's own contract — not the {script} schema vo_script shares.
    expect(call.schema.safeParse({ script: "x" }).success).toBe(false);
    expect(call.schema.safeParse({ script: "x", hook_text: "y" }).success).toBe(true);
  });

  it("falls back to hook_text when the model's line misses a cap, and says so on params", async () => {
    // The production failure this fallback exists for, 2026-09-08 (Vercel log):
    // "hook_text is 8 words — the cap is 7" lost the customer a good script.
    generateObject
      .mockReset()
      .mockResolvedValueOnce(reply({ script: SCRIPT, hook_text: OVER_CAP }))
      .mockResolvedValueOnce(reply({ hook_text: HOOK }));
    const usageBefore = await llmUsageCount();
    const before = await scriptCount();

    const script = await generateBScript(db, { businessId, personaId, structureId });

    // The script survives its bad hook line — that is the whole point.
    expect(await scriptCount()).toBe(before + 1);
    expect(script.text).toBe(SCRIPT);
    const params = script.params as {
      hookText?: string;
      hookTextDerived?: boolean;
      hookTextPromptVersion?: string;
    };
    expect(params.hookText).toBe(HOOK);
    expect(params.hookTextDerived).toBe(true);
    expect(params.hookTextPromptVersion).toMatch(/^hook_text@v\d+$/);

    // Two paid calls: the b_script generation, then the re-derivation — which
    // is handed the FINISHED script, so its answer is a prefix of what is said.
    expect(generateObject).toHaveBeenCalledTimes(2);
    const second = generateObject.mock.calls[1]![0] as { prompt: string };
    expect(second.prompt).toContain(SCRIPT);
    expect(await llmUsageCount()).toBe(usageBefore + 2);
  });

  it("throws and inserts no row when the re-derived line misses a cap too", async () => {
    generateObject
      .mockReset()
      .mockResolvedValueOnce(reply({ script: SCRIPT, hook_text: OVER_CAP }))
      .mockResolvedValueOnce(reply({ hook_text: OVER_CAP }));
    const before = await scriptCount();

    await expect(generateBScript(db, { businessId, personaId, structureId })).rejects.toThrow(
      PermanentError,
    );
    expect(await scriptCount()).toBe(before);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("does not re-derive when the model's own line is already in cap", async () => {
    generateObject.mockReset().mockResolvedValueOnce(reply({ script: SCRIPT, hook_text: HOOK }));

    const script = await generateBScript(db, { businessId, personaId, structureId });

    expect(generateObject).toHaveBeenCalledTimes(1);
    const params = script.params as Record<string, unknown>;
    expect(params.hookText).toBe(HOOK);
    expect(params).not.toHaveProperty("hookTextDerived");
    expect(params).not.toHaveProperty("hookTextPromptVersion");
  });

  it("deriveHookText: script in, hook_text out, one llm_tokens usage row", async () => {
    generateObject.mockReset().mockResolvedValueOnce(reply({ hook_text: HOOK }));
    const usageBefore = await llmUsageCount();

    const hookText = await deriveHookText(db, { businessId, text: SCRIPT });

    expect(hookText).toBe(HOOK);
    const call = generateObject.mock.calls[0]![0] as { prompt: string; schema: z.ZodType };
    expect(call.prompt).toContain(SCRIPT);
    expect(call.schema.safeParse({ hook_text: "y" }).success).toBe(true);
    expect(await llmUsageCount()).toBe(usageBefore + 1);
  });

  it("deriveHookText rejects an over-cap answer the same way", async () => {
    generateObject.mockReset().mockResolvedValueOnce(reply({ hook_text: OVER_CAP }));
    await expect(deriveHookText(db, { businessId, text: SCRIPT })).rejects.toThrow(PermanentError);
  });

  it("updateScriptText merges params into the one new row and leaves the original alone", async () => {
    generateObject.mockReset().mockResolvedValueOnce(reply({ script: SCRIPT, hook_text: HOOK }));
    const script = await generateBScript(db, { businessId, personaId, structureId });
    const originalParams = script.params as Record<string, unknown>;

    const edited = await updateScriptText(db, script.id, `${SCRIPT} נסו עכשיו`, {
      hookText: "משהו חדש לגמרי",
    });

    expect(edited.id).not.toBe(script.id);
    expect(edited.userEdited).toBe(true);
    const params = edited.params as Record<string, unknown>;
    expect(params.hookText).toBe("משהו חדש לגמרי");
    // Everything else on the original row's params survives the merge.
    expect(params.hookTemplates).toEqual(originalParams.hookTemplates);
    expect(params.wordBudget).toBe(originalParams.wordBudget);

    // Immutable: the original row still carries the draft.
    const original = (
      await db
        .select()
        .from(dbSchema.scripts)
        .where(sql`${dbSchema.scripts.id} = ${script.id}`)
    )[0]!;
    expect((original.params as { hookText?: string }).hookText).toBe(HOOK);

    // No params: the original params are carried verbatim, as before.
    const again = await updateScriptText(db, script.id, "טקסט אחר לגמרי");
    expect((again.params as { hookText?: string }).hookText).toBe(HOOK);
  });
});
