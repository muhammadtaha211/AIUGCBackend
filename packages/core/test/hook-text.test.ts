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
 * b_script v9 alongside the script, re-derived by hook_text v1 when the script
 * is edited, and rejected — never trimmed — when it is over the caps.
 */

describe("hookTextError", () => {
  it("passes a clean line under both caps", () => {
    expect(hookTextError("חייבת לספר לכם על משהו")).toBeUndefined();
    expect(hookTextError("ממש מפחיד כמה שזה טוב")).toBeUndefined();
  });

  it("counts words the way readTimeMs does — a spaced dash is not a word", () => {
    expect(hookTextWordCount("אחת שתיים — שלוש")).toBe(3);
  });

  it("rejects the 8th word and accepts the 7th", () => {
    expect(hookTextError("א ב ג ד ה ו ז ח")).toMatch(/8 words/);
    expect(hookTextError("א ב ג ד ה ו ז")).toBeUndefined();
  });

  it("rejects the 41st character, counting spaces", () => {
    const forty = "אבגדהוזחטי ".repeat(3) + "אבגדהוז";
    expect([...forty].length).toBe(40);
    expect(hookTextError(forty)).toBeUndefined();
    expect(hookTextError(`${forty}ח`)).toMatch(/41 characters/);
  });

  it("rejects trailing punctuation, emoji and niqqud; a maqaf is fine", () => {
    expect(hookTextError("למה אף אחד לא סיפר לי?")).toMatch(/punctuation/);
    expect(hookTextError("זה טוב מדי…")).toMatch(/punctuation/);
    expect(hookTextError("מצאתי את זה 🔥")).toMatch(/emoji/);
    expect(hookTextError("שָׁלוֹם לכולם")).toMatch(/niqqud/);
    expect(hookTextError("הסוד ל־2026")).toBeUndefined();
  });

  it("rejects an empty or whitespace-only line", () => {
    expect(hookTextError("")).toMatch(/empty/);
    expect(hookTextError("   ")).toMatch(/empty/);
  });

  it("exports the caps the prompts state", () => {
    expect(HOOK_TEXT_MAX_WORDS).toBe(7);
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
  /** Eight words — one over HOOK_TEXT_MAX_WORDS. */
  const OVER_CAP = "חייבת לספר לכם על משהו שגיליתי השבוע ממש";

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

  it("an over-cap hook_text is a PermanentError and inserts no row", async () => {
    generateObject
      .mockReset()
      .mockResolvedValueOnce(reply({ script: SCRIPT, hook_text: OVER_CAP }));
    const before = await scriptCount();

    await expect(generateBScript(db, { businessId, personaId, structureId })).rejects.toThrow(
      PermanentError,
    );
    expect(await scriptCount()).toBe(before);
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
