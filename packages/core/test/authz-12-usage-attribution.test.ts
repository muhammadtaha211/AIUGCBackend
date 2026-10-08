import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Hoisted so the module factory below can close over it — the same pattern
// hook-text.test.ts and hook-line-chars.test.ts use to exercise the real
// pipeline functions against a real (PGlite) DB without a network call.
const generateObject = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/anthropic", () => ({
  generateObject,
  CLAUDE_MODEL: "claude-sonnet-5-5",
}));

import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { addPersona, addStructure } from "../src/pipelines/bank";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import {
  deriveHookText,
  generateBScript,
  generateHookLines,
  generateVoScript,
} from "../src/pipelines/copy";
import { createTestDb } from "./helpers/pglite";

/**
 * AUTHZ-12 decision 5: assertAccountBudget's abuse ceiling sums usage_events
 * through an INNER JOIN to businesses (docs/vault/facts/per-account-cap-blind-spot.md)
 * — a row with business_id NULL is invisible to it. The per-account check
 * added to the three synchronous copy routes (and to /api/scripts/[id]/text)
 * is a no-op unless the usage IT is meant to bound actually carries
 * business_id. This pins that every llm_tokens usage_events row written by
 * generateHookLines, generateBScript (both its own call and its hookTextOrDerived
 * fallback), generateVoScript and deriveHookText carries the business_id it
 * was called with.
 */

function reply(object: Record<string, unknown>) {
  return { object, usage: { inputTokens: 800, outputTokens: 100 } };
}

describe("copy generation usage rows carry business_id (real DB, mocked Claude)", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let businessId: string;
  let personaId: string;
  let structureId: string;
  let demoId: string;

  beforeAll(async () => {
    delete process.env.DRY_RUN;
    resetEnvCache();
    const testDb = await createTestDb();
    db = testDb.db;
    pg = testDb.pg;

    const business = await createBusiness(db, {
      ownerEmail: "usage-attribution@example.com",
      name: "עסק לבדיקת ייחוס שימוש",
    });
    businessId = business.id;
    await setQuestionnaire(db, businessId, {
      category: "physical_product",
      product_name: "מוצר לדוגמה",
      what_it_does: "עושה משהו",
      advantages: ["מהיר"],
      target_audience: "כולם",
      tone: "friendly",
    });
    personaId = (await addPersona(db, { name: "נועה", voiceId: "voice_noa" })).id;
    structureId = (
      await addStructure(db, { title: "show-and-react", skeleton: { beats: ["hook", "cta"] } })
    ).id;
    const [demo] = await db
      .insert(schema.demos)
      .values({ businessId, status: "ready", durationMs: 20_000 })
      .returning();
    demoId = demo!.id;
  });

  afterAll(async () => {
    await pg.close();
  });

  /** Every llm_tokens row written since the last check, newest first. */
  async function llmUsageRows() {
    return db.select().from(schema.usageEvents).where(eq(schema.usageEvents.kind, "llm_tokens"));
  }

  it("generateHookLines", async () => {
    generateObject.mockReset().mockResolvedValueOnce(
      reply({
        options: Array.from({ length: 10 }, (_, i) => ({ text: `שורה ${i}`, angle: "a" })),
      }),
    );
    const before = (await llmUsageRows()).length;

    await generateHookLines(db, { businessId, personaId });

    const rows = await llmUsageRows();
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)!.businessId).toBe(businessId);
  });

  it("generateBScript — the model's own call", async () => {
    generateObject
      .mockReset()
      .mockResolvedValueOnce(reply({ script: "טקסט הסקריפט המלא", hook_text: "חייבת לספר לכם" }));
    const before = (await llmUsageRows()).length;

    await generateBScript(db, { businessId, personaId, structureId });

    const rows = await llmUsageRows();
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)!.businessId).toBe(businessId);
  });

  it("generateBScript — the hookTextOrDerived fallback call also carries business_id", async () => {
    // Nine words — one over HOOK_TEXT_MAX_WORDS — forces the fallback derivation.
    const overCap = "אני לא יכולה להאמין מה קרה לי פה היום";
    generateObject
      .mockReset()
      .mockResolvedValueOnce(reply({ script: "טקסט הסקריפט המלא", hook_text: overCap }))
      .mockResolvedValueOnce(reply({ hook_text: "חייבת לספר לכם" }));
    const before = (await llmUsageRows()).length;

    await generateBScript(db, { businessId, personaId, structureId });

    const rows = await llmUsageRows();
    expect(rows.length).toBe(before + 2);
    expect(rows.at(-1)!.businessId).toBe(businessId);
    expect(rows.at(-2)!.businessId).toBe(businessId);
  });

  it("generateVoScript", async () => {
    generateObject.mockReset().mockResolvedValueOnce(reply({ script: "טקסט התסריט המדובר" }));
    const before = (await llmUsageRows()).length;

    await generateVoScript(db, { businessId, demoId, selectedAdvantages: [], personaId });

    const rows = await llmUsageRows();
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)!.businessId).toBe(businessId);
  });

  it("deriveHookText — the POST /api/scripts/[id]/text path", async () => {
    generateObject.mockReset().mockResolvedValueOnce(reply({ hook_text: "חייבת לספר לכם" }));
    const before = (await llmUsageRows()).length;

    await deriveHookText(db, { businessId, text: "טקסט הסקריפט המלא ששוכתב" });

    const rows = await llmUsageRows();
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)!.businessId).toBe(businessId);
  });
});
