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
import { generateBScript } from "../src/pipelines/copy";
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
