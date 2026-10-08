import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Same hoisting reason as content-policy-gate.test.ts: the gate under test
// only reaches the real Claude call off the DRY_RUN path.
const generateObject = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/anthropic", () => ({
  generateObject,
  CLAUDE_MODEL: "claude-sonnet-5-5",
}));

import { chunkWords, type WordTiming } from "../src/captions";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { runLane } from "../src/jobs/worker";
import { BudgetError } from "../src/jobs/errors";
import { AccountBudgetError, recordUsage } from "../src/budget";
import { addHookClip, addPersona, addPersonaImage } from "../src/pipelines/bank";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import {
  CONTENT_POLICY_CHECK_FAILED,
  ContentPolicyError,
  generateHookLines,
  generateVoScript,
} from "../src/pipelines/copy";
import { creditBalance, grantCredits } from "../src/pipelines/credits";
import { approvePlan, requestDemoPlan } from "../src/pipelines/demo-step-plans";
import { createDemo } from "../src/pipelines/demos";
import { createBRender, createSet } from "../src/pipelines/sets";
import { getStorage, setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * INP-01 (security audit phase 4): assertContentPolicy made a paid Anthropic
 * call with no llm_tokens budget check before it, and a refused confirm
 * debits nothing — so the confirm was repeatable with no bound. This file
 * pins the fix: assertAccountBudget + assertBudget, both BEFORE the
 * classifier is ever asked, and both rethrown through the fail-open catch
 * rather than swallowed into "check failed, let it through" (that catch
 * exists for the CLASSIFIER's own failures — INP-02 — never for a caller
 * that is over its cap).
 *
 * Every scenario below builds its OWN business (per_account is keyed on the
 * owner, so a fresh business starts at zero) rather than reusing
 * content-policy-gate.test.ts's shared fixture, so the exact token counts
 * that trip the per-account cap are derivable and order-independent. Only
 * the platform-cap test (T2) needs its own database: it fills the platform
 * window, a file-wide side effect the other scenarios must not see.
 */

/** The shipped per-account LLM cap (0027, tightened 0036). */
const PER_ACCOUNT_LLM_TOKENS = 500_000;
/** The shipped platform-wide LLM cap (0036), 16x the per-account one. */
const PLATFORM_LLM_TOKENS = 8_000_000;

let db: Db;
let pg: { close(): Promise<void> };
let cleanupStorage: () => void;

async function drainAll(target: Db): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await runLane(target, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
    const queued = await target
      .select()
      .from(dbSchema.jobs)
      .where(sql`${dbSchema.jobs.status} = 'queued'`);
    if (queued.length === 0) return;
    await target.execute(
      sql`update jobs set run_at = now() - interval '1 second' where status = 'queued'`,
    );
  }
  throw new Error("queue did not drain");
}

function tempFile(name: string, content = "fake video bytes"): string {
  const dir = path.join(tmpdir(), "aiugc-policy-budget-inputs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${crypto.randomUUID()}-${name}`);
  writeFileSync(file, content);
  return file;
}

/**
 * The gate only talks to a provider off DRY_RUN (copy.ts:696) — everything
 * else these fixtures build is database work and stays on DRY_RUN's
 * deterministic stand-ins (demo-step-plans.ts:1424, copy.ts:158/224/326/554).
 */
async function withClassifier<T>(fn: () => Promise<T>): Promise<T> {
  process.env.DRY_RUN = "";
  resetEnvCache();
  try {
    return await fn();
  } finally {
    process.env.DRY_RUN = "1";
    resetEnvCache();
  }
}

async function ensureHookClip(target: Db): Promise<string> {
  return (
    await addHookClip(target, {
      filePath: tempFile("hook.mp4"),
      durationMs: 2000,
      textSafeArea: { x: 100, y: 200, w: 880, h: 400 },
    })
  ).id;
}

/** A Service-A-ready business: demo ingested, plan approved, one hook line. */
async function buildServiceAFixture(
  target: Db,
  tag: string,
  role: "customer" | "admin" = "customer",
) {
  const business = await createBusiness(target, {
    ownerEmail: `${tag}-${crypto.randomUUID()}@test.local`,
    name: `Biz ${tag}`,
    ownerRole: role,
  });
  await setQuestionnaire(target, business.id, {
    category: "local_service",
    product_name: `מוצר ${tag}`,
    what_it_does: "תיאור קצר של המוצר",
    advantages: ["יתרון אחד"],
    target_audience: "קהל יעד",
    tone: "friendly",
  });
  const demo = await createDemo(target, {
    businessId: business.id,
    filePath: tempFile("demo.mp4"),
  });
  await drainAll(target);
  const hookLine = (await generateHookLines(target, { businessId: business.id, n: 1 }))[0]!;
  const { planId } = await requestDemoPlan(target, demo.id);
  await drainAll(target);
  await approvePlan(target, planId);
  return {
    businessId: business.id,
    ownerUserId: business.ownerUserId,
    demoId: demo.id,
    hookLineId: hookLine.id,
    planId,
  };
}

async function approvedAudio(target: Db, businessId: string, demoId: string, personaId: string) {
  const script = await generateVoScript(target, {
    businessId,
    demoId,
    selectedAdvantages: [],
    personaId,
  });
  const words: WordTiming[] = [];
  for (let t = 0; t + 350 <= 9_900; t += 500) {
    words.push({ word: `מילה${t}`, startMs: t, endMs: t + 350 });
  }
  const filePath = await getStorage().put(
    "renders",
    `${businessId}/audio/budget-${crypto.randomUUID()}/audio.mp3`,
    Buffer.from("fake approved vo"),
  );
  const rows = await target
    .insert(dbSchema.audioRenders)
    .values({
      scriptId: script.id,
      voiceId: "voice_test",
      status: "ready",
      filePath,
      durationMs: 10_000,
      wordTimestamps: chunkWords(words),
      approvedAt: new Date(),
    })
    .returning();
  return rows[0]!;
}

async function debitCount(target: Db): Promise<number> {
  const rows = await target
    .select()
    .from(dbSchema.creditLedger)
    .where(eq(dbSchema.creditLedger.reason, "debit_render"));
  return rows.length;
}

async function policyFailedEvents(target: Db) {
  return target
    .select()
    .from(dbSchema.events)
    .where(eq(dbSchema.events.kind, CONTENT_POLICY_CHECK_FAILED));
}

beforeAll(async () => {
  process.env.DRY_RUN = "1";
  resetEnvCache();
  const testDb = await createTestDb();
  db = testDb.db;
  pg = testDb.pg;
  const ts = tempStorage();
  setStorage(ts.storage);
  cleanupStorage = ts.cleanup;
}, 60_000);

afterEach(() => {
  generateObject.mockReset();
});

afterAll(async () => {
  setStorage(undefined);
  cleanupStorage();
  await pg.close();
});

describe("INP-01 — the classifier is metered before it spends", () => {
  it(
    "T1: a repeated flagged confirm trips the per-account cap, then classifier calls stop entirely",
    { timeout: 180_000 },
    async () => {
      const hookClipId = await ensureHookClip(db);
      const { businessId, ownerUserId, demoId, hookLineId, planId } = await buildServiceAFixture(
        db,
        "cap1",
      );
      // The amount is incidental — every attempt below is refused BEFORE the
      // debit transaction, so the balance must never move regardless of how
      // many times the confirm is pressed (the shape of the attack itself:
      // an account with one render's worth of credits, repeated presses).
      await grantCredits(db, { userId: ownerUserId, credits: 1000, note: "test" });
      const personaId = (await addPersona(db, { name: "פרסונה", voiceId: "voice_cap1" })).id;
      await addPersonaImage(db, {
        personaId,
        filePath: tempFile("persona.jpg", "fake photo"),
        kind: "selfie",
      });

      const grid = {
        hookClipIds: [hookClipId],
        hookLineScriptIds: [hookLineId],
        mode: "silent" as const,
        format: "steps" as const,
        stepPlanId: planId,
      };

      // 100,000 tokens/call so the 500,000 per-account cap trips after
      // exactly 5 successful classifier calls: ceil(500_000 / 100_000) = 5.
      const PER_CALL_TOKENS = 100_000;
      generateObject.mockResolvedValue({
        object: { flagged: true, category: "Test category", reason: "טקסט לדוגמה" },
        usage: { inputTokens: PER_CALL_TOKENS, outputTokens: 0 },
      });

      const debitBefore = await debitCount(db);
      const balanceBefore = await creditBalance(db, ownerUserId);

      const PRESSES = 7;
      const outcomes: unknown[] = [];
      for (let i = 0; i < PRESSES; i++) {
        try {
          await withClassifier(() => createSet(db, { businessId, demoId, grid }));
          outcomes.push(null);
        } catch (err) {
          outcomes.push(err);
        }
      }

      // Presses 1-5: the classifier ran and flagged the text. Presses 6-7:
      // the per-account cap refuses the confirm before the classifier is
      // ever asked.
      for (let i = 0; i < 5; i++) expect(outcomes[i]).toBeInstanceOf(ContentPolicyError);
      for (let i = 5; i < PRESSES; i++) expect(outcomes[i]).toBeInstanceOf(AccountBudgetError);
      expect(generateObject).toHaveBeenCalledTimes(5);

      expect(await debitCount(db)).toBe(debitBefore);
      expect(await creditBalance(db, ownerUserId)).toBe(balanceBefore);

      // Same account, Service B: already over its cap from the loop above —
      // createBRender must refuse before the classifier is asked too, not
      // just createSet.
      const audio = await approvedAudio(db, businessId, demoId, personaId);
      const rendersBefore = await db
        .select()
        .from(dbSchema.videoRenders)
        .where(eq(dbSchema.videoRenders.businessId, businessId));

      await expect(
        withClassifier(() =>
          createBRender(db, {
            businessId,
            audioRenderId: audio.id,
            personaId,
            hookEffect: "zoom",
            hookText: "המסעדה שכולם מדברים עליה",
          }),
        ),
      ).rejects.toBeInstanceOf(AccountBudgetError);

      expect(generateObject).toHaveBeenCalledTimes(5); // unchanged — not called again
      expect(await debitCount(db)).toBe(debitBefore);
      expect(
        await db
          .select()
          .from(dbSchema.videoRenders)
          .where(eq(dbSchema.videoRenders.businessId, businessId)),
      ).toHaveLength(rendersBefore.length);
    },
  );

  it(
    "T3: a BudgetError or AccountBudgetError from the classifier call propagates, never swallowed by the fail-open",
    { timeout: 180_000 },
    async () => {
      const hookClipId = await ensureHookClip(db);
      const { businessId, ownerUserId, demoId, hookLineId, planId } = await buildServiceAFixture(
        db,
        "swallow",
      );
      await grantCredits(db, { userId: ownerUserId, credits: 1000, note: "test" });

      const grid = {
        hookClipIds: [hookClipId],
        hookLineScriptIds: [hookLineId],
        mode: "silent" as const,
        format: "steps" as const,
        stepPlanId: planId,
      };

      const failedBefore = (await policyFailedEvents(db)).length;
      const debitBefore = await debitCount(db);

      generateObject.mockRejectedValueOnce(new BudgetError("simulated platform trip"));
      await expect(
        withClassifier(() => createSet(db, { businessId, demoId, grid })),
      ).rejects.toBeInstanceOf(BudgetError);

      generateObject.mockRejectedValueOnce(new AccountBudgetError("simulated account trip"));
      await expect(
        withClassifier(() => createSet(db, { businessId, demoId, grid })),
      ).rejects.toBeInstanceOf(AccountBudgetError);

      // Neither error is a classifier failure — the fail-open catch must not
      // have written a "check failed, letting it through" event for either.
      expect((await policyFailedEvents(db)).length).toBe(failedBefore);
      expect(await debitCount(db)).toBe(debitBefore);
      expect(
        await db.select().from(dbSchema.sets).where(eq(dbSchema.sets.businessId, businessId)),
      ).toHaveLength(0);
    },
  );

  it(
    "T4: the admin bypass holds even for an account over the per-account cap",
    { timeout: 180_000 },
    async () => {
      const hookClipId = await ensureHookClip(db);
      const { businessId, demoId, hookLineId, planId } = await buildServiceAFixture(
        db,
        "adminbypass",
        "admin",
      );
      // Over the per-account cap, on purpose — the founder's own businesses
      // render outreach samples in volume and must never be throttled by it.
      await recordUsage(db, {
        provider: "anthropic",
        kind: "llm_tokens",
        quantity: PER_ACCOUNT_LLM_TOKENS + 100_000,
        businessId,
      });

      // Would refuse if ever reached — proves the bypass, not just an
      // absence of calls for an unrelated reason.
      generateObject.mockResolvedValue({
        object: { flagged: true, category: "Test category", reason: "x" },
        usage: { inputTokens: 10, outputTokens: 10 },
      });

      const grid = {
        hookClipIds: [hookClipId],
        hookLineScriptIds: [hookLineId],
        mode: "silent" as const,
        format: "steps" as const,
        stepPlanId: planId,
      };

      const { renders } = await withClassifier(() => createSet(db, { businessId, demoId, grid }));
      expect(renders).toHaveLength(1);
      expect(generateObject).not.toHaveBeenCalled();
    },
  );

  it(
    "T2: a platform-wide trip refuses the confirm even though this account is under its own cap",
    { timeout: 180_000 },
    async () => {
      const testDb = await createTestDb();
      try {
        const hookClipId = await ensureHookClip(testDb.db);
        const { businessId, ownerUserId, demoId, hookLineId, planId } = await buildServiceAFixture(
          testDb.db,
          "platform",
        );
        await grantCredits(testDb.db, { userId: ownerUserId, credits: 1000, note: "test" });

        // Fill the platform window on a DIFFERENT account, up to its exact
        // cap — measured, not assumed, so this holds even if some other
        // usage already exists in this fresh database.
        const filler = await createBusiness(testDb.db, {
          ownerEmail: `filler-${crypto.randomUUID()}@test.local`,
          name: "Filler",
        });
        const usedSoFar = await testDb.db
          .select({ used: sql<string>`coalesce(sum(${dbSchema.usageEvents.quantity}), 0)` })
          .from(dbSchema.usageEvents)
          .where(eq(dbSchema.usageEvents.kind, "llm_tokens"));
        const remaining = PLATFORM_LLM_TOKENS - Number(usedSoFar[0]?.used ?? 0);
        expect(remaining).toBeGreaterThan(0);
        await recordUsage(testDb.db, {
          provider: "anthropic",
          kind: "llm_tokens",
          quantity: remaining,
          businessId: filler.id,
        });

        const grid = {
          hookClipIds: [hookClipId],
          hookLineScriptIds: [hookLineId],
          mode: "silent" as const,
          format: "steps" as const,
          stepPlanId: planId,
        };

        generateObject.mockResolvedValue({
          object: { flagged: false, category: null, reason: null },
          usage: { inputTokens: 10, outputTokens: 10 },
        });

        const setsBefore = await testDb.db.select().from(dbSchema.sets);
        await expect(
          withClassifier(() => createSet(testDb.db, { businessId, demoId, grid })),
        ).rejects.toBeInstanceOf(BudgetError);

        expect(generateObject).not.toHaveBeenCalled();
        expect(await testDb.db.select().from(dbSchema.sets)).toHaveLength(setsBefore.length);
        expect(await policyFailedEvents(testDb.db)).toHaveLength(0);
        expect(await debitCount(testDb.db)).toBe(0);
      } finally {
        await testDb.pg.close();
      }
    },
  );
});
