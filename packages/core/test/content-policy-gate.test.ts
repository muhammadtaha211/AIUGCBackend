import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Hoisted so the factory can close over it: the gate under test only reaches
// the real Claude call off the DRY_RUN path, and what the classifier answers
// IS the behaviour under test.
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
import { addHookClip, addPersona, addPersonaImage } from "../src/pipelines/bank";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import {
  CONTENT_POLICY_CHECK_FAILED,
  ContentPolicyError,
  generateHookLines,
  generateTextBlocks,
  generateVoScript,
} from "../src/pipelines/copy";
import { grantCredits, InsufficientCreditsError } from "../src/pipelines/credits";
import { approvePlan, requestDemoPlan } from "../src/pipelines/demo-step-plans";
import { createDemo } from "../src/pipelines/demos";
import { createBRender, createSet } from "../src/pipelines/sets";
import { createTextBlockRender } from "../src/pipelines/text-blocks";
import { getStorage, setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * The content-policy gate at the three render choke points (Service C's since
 * phase 2, decision 0099).
 *
 * It had never run: `contentPolicyCheck` was written, prompted, exported and
 * called by nothing (vault defect content-policy-classifier-never-runs, and
 * decision 0041 which accepted that). 0042 supersedes 0041 on the event 0041
 * itself named — the first signup by someone who is not the founder — and this
 * file is the pin under the wiring. `content_policy_flag` had no test anywhere.
 *
 * Everything runs against a CUSTOMER-owned business except the bypass test:
 * the founder's own businesses skip the gate, so an admin-owned fixture would
 * prove the opposite of what it looks like it proves.
 */

let db: Db;
let pg: { close(): Promise<void> };
let cleanupStorage: () => void;

let businessId: string;
let ownerUserId: string;
let adminBusinessId: string;
let demoId: string;
let hookClipId: string;
let hookLineId: string;
let personaId: string;
let planId: string;

const FLAGGED = {
  object: { flagged: true, category: "Medical or health claims", reason: "מבטיח ריפוי" },
  usage: { inputTokens: 900, outputTokens: 30 },
};
const CLEAN = {
  object: { flagged: false, category: null, reason: null },
  usage: { inputTokens: 900, outputTokens: 12 },
};

async function drainAll(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
    const queued = await db
      .select()
      .from(dbSchema.jobs)
      .where(sql`${dbSchema.jobs.status} = 'queued'`);
    if (queued.length === 0) return;
    await db.execute(
      sql`update jobs set run_at = now() - interval '1 second' where status = 'queued'`,
    );
  }
  throw new Error("queue did not drain");
}

function tempFile(name: string, content = "fake video bytes"): string {
  const dir = path.join(tmpdir(), "aiugc-policy-inputs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

async function approvedAudio() {
  const script = await generateVoScript(db, {
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
    `${businessId}/audio/policy-${crypto.randomUUID()}/audio.mp3`,
    Buffer.from("fake approved vo"),
  );
  const rows = await db
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

/**
 * The gate is the one thing in these three functions that talks to a provider,
 * and `contentPolicyCheck` short-circuits to "not flagged" under DRY_RUN
 * (copy.ts:666) — so the classifier only exists with DRY_RUN off. Everything
 * else on the three paths is database work.
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

async function policyEvents(kind: string) {
  return db.select().from(dbSchema.events).where(eq(dbSchema.events.kind, kind));
}

async function debitCount(): Promise<number> {
  const rows = await db
    .select()
    .from(dbSchema.creditLedger)
    .where(eq(dbSchema.creditLedger.reason, "debit_render"));
  return rows.length;
}

const aGrid = () => ({
  hookClipIds: [hookClipId],
  hookLineScriptIds: [hookLineId],
  mode: "silent" as const,
  format: "steps" as const,
  stepPlanId: planId,
});

beforeAll(async () => {
  process.env.DRY_RUN = "1";
  resetEnvCache();
  const testDb = await createTestDb();
  db = testDb.db;
  pg = testDb.pg;
  const ts = tempStorage();
  setStorage(ts.storage);
  cleanupStorage = ts.cleanup;

  const business = await createBusiness(db, {
    ownerEmail: "customer@example.com",
    name: "מסעדת הבית",
  });
  businessId = business.id;
  ownerUserId = business.ownerUserId;
  await setQuestionnaire(db, businessId, {
    category: "local_service",
    product_name: "מסעדת הבית",
    what_it_does: "אוכל ביתי במשלוח עד הבית",
    advantages: ["משלוח תוך 30 דקות"],
    target_audience: "משפחות עסוקות",
    tone: "friendly",
  });
  await grantCredits(db, { userId: ownerUserId, credits: 1000, note: "test" });

  const adminBusiness = await createBusiness(db, {
    ownerEmail: "founder@example.com",
    name: "תבנית",
    ownerRole: "admin",
  });
  adminBusinessId = adminBusiness.id;
  await setQuestionnaire(db, adminBusinessId, {
    category: "local_service",
    product_name: "תבנית",
    what_it_does: "מודעות וידאו בעברית",
    advantages: ["מהיר"],
    target_audience: "מפרסמים",
    tone: "friendly",
  });

  const demo = await createDemo(db, { businessId, filePath: tempFile("demo.mp4") });
  demoId = demo.id;
  await drainAll();

  hookClipId = (
    await addHookClip(db, {
      filePath: tempFile("hook.mp4"),
      durationMs: 2000,
      textSafeArea: { x: 100, y: 200, w: 880, h: 400 },
    })
  ).id;
  hookLineId = (await generateHookLines(db, { businessId, n: 1 }))[0]!.id;

  personaId = (await addPersona(db, { name: "נועה", voiceId: "voice_noa" })).id;
  await addPersonaImage(db, {
    personaId,
    filePath: tempFile("persona.jpg", "fake photo"),
    kind: "selfie",
  });

  ({ planId } = await requestDemoPlan(db, demoId));
  await drainAll();
  await approvePlan(db, planId);
}, 180_000);

afterEach(async () => {
  generateObject.mockReset();
  // One database for the whole file (the fixture is expensive), so the event
  // assertions below would otherwise count every previous test's rows too.
  await db.delete(dbSchema.events);
});

afterAll(async () => {
  setStorage(undefined);
  cleanupStorage();
  await pg.close();
});

describe("Service A — createSet", { timeout: 180_000 }, () => {
  it("a flag refuses the set, writes the event, and debits nothing", async () => {
    generateObject.mockResolvedValue(FLAGGED);
    const before = await debitCount();
    const setsBefore = await db.select().from(dbSchema.sets);

    await expect(
      withClassifier(() => createSet(db, { businessId, demoId, grid: aGrid() })),
    ).rejects.toBeInstanceOf(ContentPolicyError);

    // Refused BEFORE the transaction: no debit, and no set row either.
    expect(await debitCount()).toBe(before);
    expect(await db.select().from(dbSchema.sets)).toHaveLength(setsBefore.length);

    const flags = await policyEvents("content_policy_flag");
    expect(flags).toHaveLength(1);
    expect(flags[0]!.businessId).toBe(businessId);
    expect(flags[0]!.payload).toMatchObject({ category: "Medical or health claims" });
  });

  it("the refusal carries the category and keeps the quoted text off the message", async () => {
    generateObject.mockResolvedValue(FLAGGED);
    const err = await withClassifier(() =>
      createSet(db, { businessId, demoId, grid: aGrid() }).catch((e: unknown) => e),
    );
    expect(err).toBeInstanceOf(ContentPolicyError);
    const policyErr = err as ContentPolicyError;
    expect(policyErr.category).toBe("Medical or health claims");
    expect(policyErr.reason).toBe("מבטיח ריפוי");
    // `reason` quotes the customer's own text; messages travel to logs and to
    // Sentry, fields do not.
    expect(policyErr.message).not.toContain("מבטיח ריפוי");
  });

  it("sends the questionnaire and the burned hook line to the classifier", async () => {
    generateObject.mockResolvedValue(CLEAN);
    await withClassifier(() => createSet(db, { businessId, demoId, grid: aGrid() }));

    expect(generateObject).toHaveBeenCalledTimes(1);
    const prompt = generateObject.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain("מסעדת הבית"); // questionnaire
    expect(prompt).toContain("משלוח תוך 30 דקות"); // questionnaire
    const hookLine = (
      await db.select().from(dbSchema.scripts).where(eq(dbSchema.scripts.id, hookLineId))
    )[0]!;
    expect(prompt).toContain(hookLine.text); // the line that gets burned in
  });

  it("a clean verdict lets the set through and debits normally", async () => {
    generateObject.mockResolvedValue(CLEAN);
    const before = await debitCount();

    const { renders } = await withClassifier(() =>
      createSet(db, { businessId, demoId, grid: aGrid() }),
    );

    expect(renders).toHaveLength(1);
    expect(await debitCount()).toBe(before + 1);
    expect(await policyEvents(CONTENT_POLICY_CHECK_FAILED)).toHaveLength(0);
  });

  it("records the spend against the business, not into the per-account blind spot", async () => {
    generateObject.mockResolvedValue(CLEAN);
    await withClassifier(() => createSet(db, { businessId, demoId, grid: aGrid() }));

    const usage = await db
      .select()
      .from(dbSchema.usageEvents)
      .where(eq(dbSchema.usageEvents.kind, "llm_tokens"));
    expect(usage.length).toBeGreaterThan(0);
    // assertAccountBudget inner-joins businesses, so a NULL business_id row is
    // invisible to the per-account cap.
    for (const row of usage) expect(row.businessId).not.toBeNull();
  });

  it("fails OPEN: a classifier error records that it did not run and lets the render through", async () => {
    generateObject.mockRejectedValue(new Error("anthropic 529 overloaded"));
    const before = await debitCount();

    const { renders } = await withClassifier(() =>
      createSet(db, { businessId, demoId, grid: aGrid() }),
    );

    expect(renders).toHaveLength(1);
    expect(await debitCount()).toBe(before + 1);
    const skipped = await policyEvents(CONTENT_POLICY_CHECK_FAILED);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.businessId).toBe(businessId);
    expect(JSON.stringify(skipped[0]!.payload)).toContain("529");
  });

  it("an admin-owned business skips the check entirely", async () => {
    generateObject.mockResolvedValue(FLAGGED);
    const adminDemo = await createDemo(db, {
      businessId: adminBusinessId,
      filePath: tempFile("admin-demo.mp4"),
    });
    await drainAll();
    const { planId: adminPlan } = await requestDemoPlan(db, adminDemo.id);
    await drainAll();
    await approvePlan(db, adminPlan);
    const adminHook = (await generateHookLines(db, { businessId: adminBusinessId, n: 1 }))[0]!;

    const { renders } = await withClassifier(() =>
      createSet(db, {
        businessId: adminBusinessId,
        demoId: adminDemo.id,
        grid: {
          hookClipIds: [hookClipId],
          hookLineScriptIds: [adminHook.id],
          mode: "silent",
          format: "steps",
          stepPlanId: adminPlan,
        },
      }),
    );

    expect(renders).toHaveLength(1);
    // The classifier was never asked — a FLAGGED mock would have refused.
    expect(generateObject).not.toHaveBeenCalled();
  });
});

describe("Service B — createBRender", { timeout: 180_000 }, () => {
  it("a flag refuses the render, writes the event, and debits nothing", async () => {
    const audio = await approvedAudio();
    generateObject.mockResolvedValue(FLAGGED);
    const before = await debitCount();
    const rendersBefore = await db.select().from(dbSchema.videoRenders);

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
    ).rejects.toBeInstanceOf(ContentPolicyError);

    expect(await debitCount()).toBe(before);
    expect(await db.select().from(dbSchema.videoRenders)).toHaveLength(rendersBefore.length);
    expect(await policyEvents("content_policy_flag")).toHaveLength(1);
  });

  it("sends the FINAL burned hook text and the spoken script to the classifier", async () => {
    const audio = await approvedAudio();
    generateObject.mockResolvedValue(CLEAN);

    await withClassifier(() =>
      createBRender(db, {
        businessId,
        audioRenderId: audio.id,
        personaId,
        hookEffect: "zoom",
        hookText: "המסעדה שכולם מדברים עליה",
      }),
    );

    expect(generateObject).toHaveBeenCalledTimes(1);
    const prompt = generateObject.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain("המסעדה שכולם מדברים עליה");
    expect(prompt).toContain("מסעדת הבית");
    const script = (
      await db.select().from(dbSchema.scripts).where(eq(dbSchema.scripts.id, audio.scriptId))
    )[0]!;
    expect(prompt).toContain(script.text.slice(0, 30));
  });

  it("a clean verdict lets the render through and debits once", async () => {
    const audio = await approvedAudio();
    generateObject.mockResolvedValue(CLEAN);
    const before = await debitCount();

    const render = await withClassifier(() =>
      createBRender(db, { businessId, audioRenderId: audio.id, personaId }),
    );

    expect(render.service).toBe("b");
    expect(await debitCount()).toBe(before + 1);
  });

  it("fails OPEN on a classifier error, on this path too", async () => {
    const audio = await approvedAudio();
    generateObject.mockRejectedValue(new Error("anthropic timeout"));

    const render = await withClassifier(() =>
      createBRender(db, { businessId, audioRenderId: audio.id, personaId }),
    );

    expect(render.service).toBe("b");
    expect(await policyEvents(CONTENT_POLICY_CHECK_FAILED)).toHaveLength(1);
  });
});

describe("Service C — createTextBlockRender", { timeout: 180_000 }, () => {
  let cBusinessId: string;
  let cScriptId: string;
  let cClipId: string;
  let brokeBusinessId: string;
  let brokeScriptId: string;
  let adminScriptId: string;

  /** A customer business with a questionnaire and one served text over cClipId. */
  async function customerWithText(email: string, name: string) {
    const business = await createBusiness(db, { ownerEmail: email, name });
    await setQuestionnaire(db, business.id, {
      category: "local_service",
      product_name: name,
      what_it_does: "אוכל ביתי במשלוח עד הבית",
      advantages: ["משלוח תוך 30 דקות"],
      target_audience: "משפחות עסוקות",
      tone: "friendly",
    });
    const batch = await generateTextBlocks(db, { businessId: business.id, clipId: cClipId });
    return { business, scriptId: batch.texts[0]!.id };
  }

  async function serviceCRenders() {
    return db.select().from(dbSchema.videoRenders).where(eq(dbSchema.videoRenders.service, "c"));
  }

  async function renderJobCount(): Promise<number> {
    const rows = await db
      .select()
      .from(dbSchema.jobs)
      .where(sql`${dbSchema.jobs.idempotencyKey} like 'render:%'`);
    return rows.length;
  }

  beforeAll(async () => {
    // A clip a customer may use: active, uploaded, on an active character.
    const character = await addPersona(db, { name: "מאיה", gender: "female" });
    const [clip] = await db
      .insert(dbSchema.textBlockClips)
      .values({
        filePath: "assets/text_block_clip/policy/clip.mp4",
        durationMs: 10_000,
        speakerGender: "female",
        personaId: character.id,
        textSafeArea: { x: 80, y: 360, w: 820, h: 1040 },
      })
      .returning();
    cClipId = clip!.id;

    // Its own owner and its own grant, so the debit counts below are C's alone.
    const funded = await customerWithText("c-customer@example.com", "מטבח של סבתא");
    cBusinessId = funded.business.id;
    cScriptId = funded.scriptId;
    await grantCredits(db, { userId: funded.business.ownerUserId, credits: 100, note: "test" });

    const broke = await customerWithText("c-broke@example.com", "בלי קרדיטים");
    brokeBusinessId = broke.business.id;
    brokeScriptId = broke.scriptId;

    const adminBatch = await generateTextBlocks(db, {
      businessId: adminBusinessId,
      clipId: cClipId,
    });
    adminScriptId = adminBatch.texts[0]!.id;
  });

  it("a flag refuses the render: no render row, no job, no debit, one flag event — and the classifier saw the questionnaire and the final text", async () => {
    generateObject.mockResolvedValue(FLAGGED);
    const debitsBefore = await debitCount();
    const rendersBefore = (await serviceCRenders()).length;
    const jobsBefore = await renderJobCount();

    await expect(
      withClassifier(() =>
        createTextBlockRender(db, {
          businessId: cBusinessId,
          clipId: cClipId,
          scriptId: cScriptId,
        }),
      ),
    ).rejects.toBeInstanceOf(ContentPolicyError);

    expect(await serviceCRenders()).toHaveLength(rendersBefore);
    expect(await renderJobCount()).toBe(jobsBefore);
    expect(await debitCount()).toBe(debitsBefore);
    const flags = await policyEvents("content_policy_flag");
    expect(flags).toHaveLength(1);
    expect(flags[0]!.businessId).toBe(cBusinessId);

    expect(generateObject).toHaveBeenCalledTimes(1);
    const prompt = generateObject.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain("מטבח של סבתא"); // questionnaire
    const script = (
      await db.select().from(dbSchema.scripts).where(eq(dbSchema.scripts.id, cScriptId))
    )[0]!;
    expect(prompt).toContain(script.text); // the block that gets burned
  });

  it("a clean verdict lets the render through and debits once", async () => {
    generateObject.mockResolvedValue(CLEAN);
    const before = await debitCount();

    const render = await withClassifier(() =>
      createTextBlockRender(db, { businessId: cBusinessId, clipId: cClipId, scriptId: cScriptId }),
    );

    expect(render.service).toBe("c");
    expect(await debitCount()).toBe(before + 1);
  });

  it("an admin-owned business skips the check entirely and is never charged", async () => {
    generateObject.mockResolvedValue(FLAGGED);

    const render = await withClassifier(() =>
      createTextBlockRender(db, {
        businessId: adminBusinessId,
        clipId: cClipId,
        scriptId: adminScriptId,
      }),
    );

    expect(render.service).toBe("c");
    // The classifier was never asked — a FLAGGED mock would have refused.
    expect(generateObject).not.toHaveBeenCalled();
    const adminOwner = (
      await db.select().from(dbSchema.businesses).where(eq(dbSchema.businesses.id, adminBusinessId))
    )[0]!.ownerUserId;
    expect(
      await db
        .select()
        .from(dbSchema.creditLedger)
        .where(eq(dbSchema.creditLedger.userId, adminOwner)),
    ).toHaveLength(0);
  });

  it("the free gates run first: a zero balance never pays for the classifier", async () => {
    generateObject.mockResolvedValue(FLAGGED);

    await expect(
      withClassifier(() =>
        createTextBlockRender(db, {
          businessId: brokeBusinessId,
          clipId: cClipId,
          scriptId: brokeScriptId,
        }),
      ),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);

    expect(generateObject).not.toHaveBeenCalled();
    expect(await policyEvents("content_policy_flag")).toHaveLength(0);
  });

  it("an unburnable text is refused before the classifier", async () => {
    generateObject.mockResolvedValue(CLEAN);
    const [emoji] = await db
      .insert(dbSchema.scripts)
      .values({
        businessId: cBusinessId,
        kind: "text_block",
        text: "זה 🔥 זה",
        params: { speakerGender: "female" },
        userEdited: true,
      })
      .returning();

    await expect(
      withClassifier(() =>
        createTextBlockRender(db, {
          businessId: cBusinessId,
          clipId: cClipId,
          scriptId: emoji!.id,
        }),
      ),
    ).rejects.toThrow(/U\+1F525/);
    expect(generateObject).not.toHaveBeenCalled();
  });
});
