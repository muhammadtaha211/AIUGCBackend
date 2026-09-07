import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import { personas } from "../src/db/schema";
import {
  HOOK_OPTIONS_PER_GENERATION,
  HOOK_TEMPLATES,
  pickHookTemplates,
} from "../src/hook-templates";
import { logger } from "../src/logger";
import { addPersona, addStructure } from "../src/pipelines/bank";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import { deriveHookText, generateBScript } from "../src/pipelines/copy";
import { renderPrompt } from "../src/prompts";
import { createTestDb } from "./helpers/pglite";

/**
 * The hook library: a random handful of curated openers is injected into every
 * b_script prompt as {{hook_options}}, and the chosen templates are recorded on
 * scripts.params so a winning hook can be traced back to its template.
 */

describe("pickHookTemplates", () => {
  it("returns the requested count", () => {
    expect(pickHookTemplates()).toHaveLength(HOOK_OPTIONS_PER_GENERATION);
    expect(pickHookTemplates(5)).toHaveLength(5);
  });

  it("is capped at the pool size", () => {
    expect(pickHookTemplates(HOOK_TEMPLATES.length + 10)).toHaveLength(HOOK_TEMPLATES.length);
  });

  it("never repeats a template within one pick, and only picks from the pool", () => {
    for (let i = 0; i < 30; i++) {
      const picked = pickHookTemplates();
      expect(new Set(picked).size).toBe(picked.length);
      for (const template of picked) expect(HOOK_TEMPLATES).toContain(template);
    }
  });

  it("varies across calls", () => {
    const draws = new Set(Array.from({ length: 20 }, () => pickHookTemplates().join("|")));
    expect(draws.size).toBeGreaterThan(1);
  });
});

// Mirrors how generateBScript formats its prompt variables.
function bScriptVars(hooks: string[], pointers?: string) {
  return {
    questionnaire: JSON.stringify({ product_name: "קרם הפנים" }, null, 2),
    persona: JSON.stringify({ name: "נועה", gender: "f" }),
    persona_gender: "female",
    skeleton: JSON.stringify({ beats: ["hook", "story", "cta"] }, null, 2),
    hook_options: hooks.map((t, i) => `${i + 1}. ${t}`).join("\n"),
    pointers: pointers ?? "(אין — התבסס על השאלון בלבד)",
    word_budget: 33,
    words_per_second: 2.2,
    duration_preset: 15,
  };
}

describe("b_script prompt rendering", () => {
  const hooks = pickHookTemplates();

  it("resolves to a b_script version", () => {
    expect(renderPrompt("b_script", bScriptVars(hooks)).promptVersion).toMatch(/^b_script@v\d+$/);
  });

  it("contains the injected hooks and no unreplaced placeholders (with pointers)", () => {
    const { text } = renderPrompt("b_script", bScriptVars(hooks, "לפתוח עם המשלוח המהיר"));
    hooks.forEach((hook, i) => expect(text).toContain(`${i + 1}. ${hook}`));
    expect(text).toContain("לפתוח עם המשלוח המהיר");
    expect(text).not.toMatch(/\{\{\w+\}\}/);
  });

  it("contains the injected hooks and no unreplaced placeholders (without pointers)", () => {
    const { text } = renderPrompt("b_script", bScriptVars(hooks));
    hooks.forEach((hook, i) => expect(text).toContain(`${i + 1}. ${hook}`));
    expect(text).toContain("(אין — התבסס על השאלון בלבד)");
    expect(text).not.toMatch(/\{\{\w+\}\}/);
  });

  it("states the speaker gender for each gender", () => {
    for (const gender of ["female", "male"]) {
      const { text } = renderPrompt("b_script", { ...bScriptVars(hooks), persona_gender: gender });
      expect(text).toContain(`The speaker is ${gender}.`);
    }
  });

  it("carries the {script, hook_text} output contract (v9+)", () => {
    const { text, promptVersion } = renderPrompt("b_script", bScriptVars(hooks));
    expect(Number(promptVersion.split("@v")[1])).toBeGreaterThanOrEqual(9);
    expect(text).toContain('{"script": "...", "hook_text": "..."}');
    expect(text).toContain("At most 7 Hebrew words and at most 40 characters");
  });

  it("states hook_text as a verbatim prefix, not a compression (v10+)", () => {
    const { text, promptVersion } = renderPrompt("b_script", bScriptVars(hooks));
    expect(Number(promptVersion.split("@v")[1])).toBeGreaterThanOrEqual(10);
    expect(text).toContain("VERBATIM PREFIX");
    expect(text).toContain("Verbatim, not compressed");
  });

  it("refers to the product by its kind, never by a placeholder word (v11+)", () => {
    const { text, promptVersion } = renderPrompt("b_script", bScriptVars(hooks));
    expect(Number(promptVersion.split("@v")[1])).toBeGreaterThanOrEqual(11);
    expect(text).toContain("`product_kind`");
    expect(text).toContain("Never `משהו`, never `הדבר הזה`, never `מוצר אחד`");
    expect(text).not.toContain("Refer to it obliquely");
  });

  it("states the word budget as a 90-100% band, not a ceiling (v10+)", () => {
    const { text, promptVersion } = renderPrompt("b_script", bScriptVars(hooks));
    expect(Number(promptVersion.split("@v")[1])).toBeGreaterThanOrEqual(10);
    expect(text).toContain("between 90% and 100% of");
    expect(text).not.toContain("AT MOST");
  });
});

describe("hook_text prompt rendering", () => {
  it("resolves to a hook_text version and renders clean", () => {
    const { text, promptVersion } = renderPrompt("hook_text", {
      script: "ניסיתי מיליון דברים ושום דבר לא עבד",
    });
    expect(promptVersion).toMatch(/^hook_text@v\d+$/);
    expect(text).toContain("ניסיתי מיליון דברים");
    expect(text).toContain('{"hook_text": "..."}');
    expect(text).not.toMatch(/\{\{\w+\}\}/);
  });

  it("states hook_text as a verbatim prefix, not a compression (v2+)", () => {
    const { text, promptVersion } = renderPrompt("hook_text", {
      script: "ניסיתי מיליון דברים ושום דבר לא עבד",
    });
    expect(Number(promptVersion.split("@v")[1])).toBeGreaterThanOrEqual(2);
    expect(text).toContain("VERBATIM PREFIX");
    expect(text).toContain("Verbatim, not compressed");
  });
});

describe("tts_enhance prompt rendering", () => {
  it("resolves to a tts_enhance version and renders clean", () => {
    const { text, promptVersion } = renderPrompt("tts_enhance", {
      script: "ניסיתי מיליון דברים ושום דבר לא עבד",
    });
    expect(promptVersion).toMatch(/^tts_enhance@v\d+$/);
    expect(text).toContain("ניסיתי מיליון דברים");
    expect(text).not.toMatch(/\{\{\w+\}\}/);
  });
});

describe("generateBScript (dry-run, real DB)", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let businessId: string;
  let personaId: string;
  let structureId: string;

  beforeAll(async () => {
    process.env.DRY_RUN = "1";
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

  it("records the chosen hook templates on scripts.params", async () => {
    const script = await generateBScript(db, { businessId, personaId, structureId });
    const { hookTemplates } = script.params as { hookTemplates: string[] };
    expect(hookTemplates).toHaveLength(HOOK_OPTIONS_PER_GENERATION);
    expect(new Set(hookTemplates).size).toBe(hookTemplates.length);
    for (const template of hookTemplates) expect(HOOK_TEMPLATES).toContain(template);
  });

  it("records hookText — the first five words of the dry-run script", async () => {
    const script = await generateBScript(db, { businessId, personaId, structureId });
    const { hookText } = script.params as { hookText: string };
    expect(hookText).toBe(script.text.split(" ").slice(0, 5).join(" "));
    expect(hookText).toBe("חייבת לספר לכם על משהו");
  });

  it("deriveHookText (dry-run) returns the first five words without a model call", async () => {
    const text = "ממש מפחיד כמה שהמוצר הזה טוב ניסיתי הכל וזה מה שעבד";
    expect(await deriveHookText(db, { businessId, text })).toBe("ממש מפחיד כמה שהמוצר הזה");
  });

  it("records a b_script prompt_version, with and without pointers", async () => {
    const withPointers = await generateBScript(db, {
      businessId,
      personaId,
      structureId,
      pointers: "לפתוח עם המשלוח המהיר",
    });
    expect(withPointers.promptVersion).toMatch(/^b_script@v\d+$/);

    const withoutPointers = await generateBScript(db, { businessId, personaId, structureId });
    expect(withoutPointers.promptVersion).toMatch(/^b_script@v\d+$/);
  });

  it("defaults a gender-less persona to female and warns with the persona id", async () => {
    const warn = vi.spyOn(logger, "warn");
    await generateBScript(db, { businessId, personaId, structureId });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ personaId }),
      expect.stringContaining("female"),
    );
    warn.mockRestore();
  });

  it("does not warn when the persona has a gender", async () => {
    const male = await addPersona(db, { name: "יוסי", voiceId: "voice_noa" });
    await db.update(personas).set({ gender: "male" }).where(eq(personas.id, male.id));
    const warn = vi.spyOn(logger, "warn");
    await generateBScript(db, { businessId, personaId: male.id, structureId });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
