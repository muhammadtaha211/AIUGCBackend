import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * AUTHZ-12 (.work/security/01-authz.md, CRITICAL, PROVEN): POST hook-lines,
 * /scripts and /vo-script made 1-2 Anthropic calls per request with NO
 * per-account cap, NO platform cap and NO rate limit — a free account could
 * spend without bound, and its recorded usage filled the shared platform
 * window, parking every other customer's analysis/plan/enhance jobs.
 * /api/scripts/[id]/text got the platform cap only (found in the sweep).
 *
 * This is the permanent regression test rebuilt from phase 1's probe (deleted
 * per RULES.md limit 2 after it proved the gap). Unlike that probe, which
 * called the pipeline functions directly, this one drives the actual route
 * handlers — the fix lives at the route layer (decision: not inside
 * callClaude, because generateHookLines/generateBScript/generateVoScript are
 * also reachable from the generate_copy job handler, packages/core/src/handlers.ts).
 *
 * assertAccountBudget, assertBudget and AccountBudgetError/BudgetError run
 * FOR REAL against a real (PGlite) DB — only the generation calls
 * (generateHookLines/generateBScript/generateVoScript/deriveHookText, the
 * functions that make the actual Anthropic call) are stubbed, so "the
 * provider stub was not called" is a direct assertion on those mocks.
 */

const fixture = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  db: undefined as unknown,
  generateHookLines: vi.fn(),
  generateBScript: vi.fn(),
  generateVoScript: vi.fn(),
  deriveHookText: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: fixture.user }, error: null }) },
  }),
}));

vi.mock("@aiugc/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aiugc/core")>();
  return {
    ...actual,
    // Real assertAccountBudget/assertBudget/recordUsage/pickStructureForBusiness
    // etc. all run against this real PGlite db — only the functions that make
    // the actual Anthropic call are stubbed.
    getDb: () => fixture.db,
    generateHookLines: fixture.generateHookLines,
    generateBScript: fixture.generateBScript,
    generateVoScript: fixture.generateVoScript,
    deriveHookText: fixture.deriveHookText,
  };
});

const core = await import("@aiugc/core");
const { createTestDb } = await import("../../../packages/core/test/helpers/pglite");
const schema = core.schema;

const { POST: hookLines } = await import("../src/app/api/businesses/[businessId]/hook-lines/route");
const { POST: scripts } = await import("../src/app/api/businesses/[businessId]/scripts/route");
const { POST: voScript } = await import("../src/app/api/businesses/[businessId]/vo-script/route");
const { POST: editText } = await import("../src/app/api/scripts/[id]/text/route");

function post(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(businessId: string) {
  return { params: Promise.resolve({ businessId }) };
}

/** The shipped caps (0036/0040): per-account 500,000, platform 8,000,000. */
const PER_ACCOUNT_LLM_CAP = 500_000;
const PLATFORM_LLM_CAP = 8_000_000;

describe("AUTHZ-12: per-account and platform LLM caps on the synchronous copy routes", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>["db"];
  let pg: Awaited<ReturnType<typeof createTestDb>>["pg"];
  let personaId: string;

  // A distinct business + owner per scenario, so one scenario's seeded usage
  // never leaks into another's per-account check (they sum by owner).
  let quietBiz: { id: string; ownerUserId: string };
  let loudBiz: { id: string; ownerUserId: string };
  let founderBiz: { id: string; ownerUserId: string };
  let textBiz: { id: string; ownerUserId: string };
  let textScriptId: string;
  let victimBiz: { id: string; ownerUserId: string };
  let bulkBiz: { id: string; ownerUserId: string };

  async function burnLlm(businessId: string, tokens: number) {
    await core.recordUsage(db, {
      provider: "anthropic",
      kind: "llm_tokens",
      quantity: tokens,
      businessId,
    });
  }

  async function makeBusiness(email: string, role: "customer" | "admin" = "customer") {
    const business = await core.createBusiness(db, { ownerEmail: email, name: `Biz ${email}` });
    if (role === "admin") {
      await db
        .update(schema.users)
        .set({ role: "admin" })
        .where(eq(schema.users.id, business.ownerUserId));
    }
    await core.setQuestionnaire(db, business.id, {
      category: "physical_product",
      product_name: "מוצר",
      what_it_does: "עושה משהו",
      advantages: ["מהיר"],
      target_audience: "כולם",
      tone: "friendly",
    });
    return business;
  }

  async function demoFor(businessId: string) {
    const [demo] = await db
      .insert(schema.demos)
      .values({ businessId, status: "ready", durationMs: 20_000 })
      .returning();
    return demo!.id;
  }

  beforeAll(async () => {
    const testDb = await createTestDb();
    db = testDb.db;
    pg = testDb.pg;
    fixture.db = db;

    personaId = (await core.addPersona(db, { name: "נועה", voiceId: "voice_noa" })).id;
    // Founder-global, active — pickStructureForBusiness (real) picks it up for
    // every business below. Its id is never needed directly.
    await core.addStructure(db, { title: "show-and-react", skeleton: { beats: ["hook", "cta"] } });

    quietBiz = await makeBusiness("quiet@authz12.test");
    loudBiz = await makeBusiness("loud@authz12.test");
    founderBiz = await makeBusiness("founder@authz12.test", "admin");
    textBiz = await makeBusiness("text@authz12.test");
    victimBiz = await makeBusiness("victim@authz12.test");
    bulkBiz = await makeBusiness("bulk@authz12.test");

    // loudBiz: exactly at the per-account ceiling.
    await burnLlm(loudBiz.id, PER_ACCOUNT_LLM_CAP);
    // founderBiz: far past it — admin-owned businesses bypass the check.
    await burnLlm(founderBiz.id, PER_ACCOUNT_LLM_CAP * 10);

    const [textScript] = await db
      .insert(schema.scripts)
      .values({ businessId: textBiz.id, kind: "b_script", text: "טקסט מקורי", personaId })
      .returning();
    textScriptId = textScript!.id;
  });

  afterAll(async () => {
    await pg.close();
  });

  beforeAll(() => {
    fixture.generateHookLines.mockResolvedValue([
      { id: "s1", text: "שורה אחת", params: { angle: "a" } },
    ]);
    fixture.generateBScript.mockResolvedValue({
      id: "s2",
      text: "תסריט",
      params: { wordBudget: 40, hookText: "חייבת לספר לכם" },
    });
    fixture.generateVoScript.mockResolvedValue({
      id: "s3",
      text: "תסריט מדובר",
      params: { wordBudget: 40 },
    });
    fixture.deriveHookText.mockResolvedValue("חייבת לספר לכם");
  });

  describe("POST hook-lines — full scenario", () => {
    it("per-account cap: 429 in Hebrew, generateHookLines NOT called (decision 1)", async () => {
      fixture.user = { id: loudBiz.ownerUserId, email: "loud@authz12.test" };
      fixture.generateHookLines.mockClear();

      const response = await hookLines(post(`/api/businesses/${loudBiz.id}/hook-lines`, {}), {
        params: Promise.resolve({ businessId: loudBiz.id }),
      });

      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({
        ok: false,
        error: "הגעתם למכסת יצירת התוכן היומית של החשבון — נסו שוב מחר.",
      });
      expect(fixture.generateHookLines).not.toHaveBeenCalled();
    });

    it("admin-owned business bypasses the per-account cap (decision 1, mirrors budget.ts's existing bypass)", async () => {
      fixture.user = { id: founderBiz.ownerUserId, email: "founder@authz12.test" };
      fixture.generateHookLines.mockClear();

      const response = await hookLines(post(`/api/businesses/${founderBiz.id}/hook-lines`, {}), {
        params: Promise.resolve({ businessId: founderBiz.id }),
      });

      expect(response.status).toBe(200);
      expect(fixture.generateHookLines).toHaveBeenCalledTimes(1);
    });

    it("under both caps: 200, generateHookLines IS called with the businessId", async () => {
      fixture.user = { id: quietBiz.ownerUserId, email: "quiet@authz12.test" };
      fixture.generateHookLines.mockClear();

      const response = await hookLines(post(`/api/businesses/${quietBiz.id}/hook-lines`, {}), {
        params: Promise.resolve({ businessId: quietBiz.id }),
      });

      expect(response.status).toBe(200);
      expect(fixture.generateHookLines).toHaveBeenCalledTimes(1);
      expect(fixture.generateHookLines.mock.calls[0]![1]).toMatchObject({
        businessId: quietBiz.id,
      });
    });
  });

  describe("POST scripts (generateBScript) — wired the same way", () => {
    it("per-account cap blocks it before generateBScript runs", async () => {
      fixture.user = { id: loudBiz.ownerUserId, email: "loud@authz12.test" };
      fixture.generateBScript.mockClear();

      const response = await scripts(
        post(`/api/businesses/${loudBiz.id}/scripts`, { personaId, durationPreset: 30 }),
        params(loudBiz.id),
      );

      expect(response.status).toBe(429);
      expect(fixture.generateBScript).not.toHaveBeenCalled();
    });

    it("under both caps: 200, generateBScript IS called", async () => {
      fixture.user = { id: quietBiz.ownerUserId, email: "quiet@authz12.test" };
      fixture.generateBScript.mockClear();

      const response = await scripts(
        post(`/api/businesses/${quietBiz.id}/scripts`, { personaId, durationPreset: 30 }),
        params(quietBiz.id),
      );

      expect(response.status).toBe(200);
      expect(fixture.generateBScript).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST vo-script (generateVoScript) — wired the same way", () => {
    it("per-account cap blocks it before generateVoScript runs", async () => {
      const demoId = await demoFor(loudBiz.id);
      fixture.user = { id: loudBiz.ownerUserId, email: "loud@authz12.test" };
      fixture.generateVoScript.mockClear();

      const response = await voScript(
        post(`/api/businesses/${loudBiz.id}/vo-script`, {
          demoId,
          personaId,
          selectedAdvantages: [],
        }),
        params(loudBiz.id),
      );

      expect(response.status).toBe(429);
      expect(fixture.generateVoScript).not.toHaveBeenCalled();
    });

    it("under both caps: 200, generateVoScript IS called", async () => {
      const demoId = await demoFor(quietBiz.id);
      fixture.user = { id: quietBiz.ownerUserId, email: "quiet@authz12.test" };
      fixture.generateVoScript.mockClear();

      const response = await voScript(
        post(`/api/businesses/${quietBiz.id}/vo-script`, {
          demoId,
          personaId,
          selectedAdvantages: [],
        }),
        params(quietBiz.id),
      );

      expect(response.status).toBe(200);
      expect(fixture.generateVoScript).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST /api/scripts/[id]/text (deriveHookText) — found in the sweep, fixed the same way", () => {
    it("had the platform cap only before this fix; now the per-account cap blocks it too", async () => {
      // A b_script row belonging to loudBiz (already at the per-account cap),
      // so an edit to it exercises the same owner-level check as the other
      // three routes.
      const [loudScript] = await db
        .insert(schema.scripts)
        .values({ businessId: loudBiz.id, kind: "b_script", text: "טקסט מקורי", personaId })
        .returning();

      fixture.user = { id: loudBiz.ownerUserId, email: "loud@authz12.test" };
      fixture.deriveHookText.mockClear();

      const response = await editText(
        post(`/api/scripts/${loudScript!.id}/text`, { text: "טקסט חדש" }),
        {
          params: Promise.resolve({ id: loudScript!.id }),
        },
      );

      expect(response.status).toBe(429);
      expect(fixture.deriveHookText).not.toHaveBeenCalled();
    });

    it("under both caps: 200, deriveHookText IS called for a b_script edit", async () => {
      fixture.user = { id: textBiz.ownerUserId, email: "text@authz12.test" };
      fixture.deriveHookText.mockClear();

      const response = await editText(
        post(`/api/scripts/${textScriptId}/text`, { text: "טקסט חדש" }),
        {
          params: Promise.resolve({ id: textScriptId }),
        },
      );

      expect(response.status).toBe(200);
      expect(fixture.deriveHookText).toHaveBeenCalledTimes(1);
    });
  });

  // Declared LAST on purpose: this trips the shared 24h platform window for
  // every business (usage_events rows persist for the rest of the file), so
  // nothing after it can expect a 200 from any of the four routes above.
  describe("platform cap (decision 2) — run last, trips the shared window for everyone", () => {
    it("503 in Hebrew, generateHookLines NOT called, no job row changes", async () => {
      const jobsBefore = (await db.select().from(schema.jobs)).length;
      // loudBiz (500k) + founderBiz (5,000k) already recorded. Burn the rest
      // under a THIRD business (bulkBiz), never victimBiz's own — victimBiz
      // must stay under ITS per-account cap so this proves the PLATFORM
      // check trips, not the per-account one.
      await burnLlm(bulkBiz.id, PLATFORM_LLM_CAP - PER_ACCOUNT_LLM_CAP - PER_ACCOUNT_LLM_CAP * 10);

      fixture.user = { id: victimBiz.ownerUserId, email: "victim@authz12.test" };
      fixture.generateHookLines.mockClear();

      const response = await hookLines(post(`/api/businesses/${victimBiz.id}/hook-lines`, {}), {
        params: Promise.resolve({ businessId: victimBiz.id }),
      });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ok: false,
        error: "המערכת עמוסה כרגע. נסו שוב מאוחר יותר.",
      });
      expect(fixture.generateHookLines).not.toHaveBeenCalled();
      expect((await db.select().from(schema.jobs)).length).toBe(jobsBefore);
    });
  });
});
