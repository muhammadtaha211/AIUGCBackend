import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chunkWords, type WordTiming } from "../src/captions";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { runLane } from "../src/jobs/worker";
import { addHookClip, addPersona, addPersonaImage } from "../src/pipelines/bank";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import { generateHookLines, generateVoScript } from "../src/pipelines/copy";
import { creditBalance, grantCredits, InsufficientCreditsError } from "../src/pipelines/credits";
import { createDemo } from "../src/pipelines/demos";
import { handleReapDeadRenders } from "../src/pipelines/janitor";
import { RENDER_RETRIES_EXHAUSTED_MESSAGE } from "../src/pipelines/renders";
import { rejectRender } from "../src/pipelines/qc";
import { createBRender, createSet, quoteASet, quoteBRender } from "../src/pipelines/sets";
import { getStorage, setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * Phase 3: credits are real, per-second, and charged in exactly one place.
 * Everything here runs against a CUSTOMER-owned business — the founder's own
 * businesses bypass credits entirely, so an admin-owned test proves nothing.
 */

let db: Db;
let pg: { close(): Promise<void> };
let cleanupStorage: () => void;

let businessId: string;
let ownerUserId: string;
let demoId: string; // DRY_RUN ingest fakes a 20s demo
let hookClipId: string;
let hookLineId: string;
let personaId: string;

/** The shipped hybrid rates, on a 20s demo: flat 3 + 20 x 0.15 = 6 before any ending. */
const A_BASE_CREDITS = 6;

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
  const dir = path.join(tmpdir(), "aiugc-credits-inputs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

/** An approved audio of an exact length — the whole price hangs off this number. */
async function fabricateApprovedAudio(scriptId: string, durationMs: number) {
  const words: WordTiming[] = [];
  for (let t = 0; t + 350 <= durationMs - 100; t += 500) {
    words.push({ word: `מילה${t}`, startMs: t, endMs: t + 350 });
  }
  const filePath = await getStorage().put(
    "renders",
    `${businessId}/audio/fab-${durationMs}-${crypto.randomUUID()}/audio.mp3`,
    Buffer.from("fake approved vo"),
  );
  const rows = await db
    .insert(dbSchema.audioRenders)
    .values({
      scriptId,
      voiceId: "voice_test",
      status: "ready",
      filePath,
      durationMs,
      wordTimestamps: chunkWords(words),
      approvedAt: new Date(),
    })
    .returning();
  return rows[0]!;
}

async function voicedAudio(durationMs: number) {
  const script = await generateVoScript(db, {
    businessId,
    demoId,
    selectedAdvantages: [],
    personaId,
  });
  return fabricateApprovedAudio(script.id, durationMs);
}

async function debitsFor(videoRenderId: string) {
  return db
    .select()
    .from(dbSchema.creditLedger)
    .where(
      sql`${dbSchema.creditLedger.refId} = ${videoRenderId} and ${dbSchema.creditLedger.reason} = 'debit_render'`,
    );
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

  // ownerRole defaults to "customer" — deliberately NOT the admin bypass.
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
  await addPersonaImage(db, { personaId, filePath: tempFile("persona.jpg", "fake photo") });
}, 120_000);

afterAll(async () => {
  setStorage(undefined);
  cleanupStorage();
  await pg.close();
});

describe("the quote shown IS the quote debited", { timeout: 120_000 }, () => {
  it("ending none: 20s demo, VO within it — 6 credits, quoted and charged alike", async () => {
    await grantCredits(db, { userId: ownerUserId, credits: 100, note: "test" });
    const audio = await voicedAudio(20_000);

    const quote = await quoteASet(db, { businessId, demoId, audioRenderId: audio.id });
    expect(quote.creditsPerRender).toBe(A_BASE_CREDITS);
    expect(quote.chargeable).toBe(true);
    expect(quote.outroCredits).toBe(0); // no ending, nothing added

    const { renders } = await createSet(db, {
      businessId,
      demoId,
      grid: {
        hookClipIds: [hookClipId],
        hookLineScriptIds: [hookLineId],
        mode: "voiced",
        audioRenderId: audio.id,
        personaId,
      },
    });

    const debits = await debitsFor(renders[0]!.id);
    expect(debits).toHaveLength(1);
    expect(debits[0]!.delta).toBe(-quote.creditsPerRender);
  });

  it("ending freeze: a sub-2s remainder spends no GPU, so it costs the same 6", async () => {
    const audio = await voicedAudio(21_500);
    const quote = await quoteASet(db, { businessId, demoId, audioRenderId: audio.id });
    expect(quote.creditsPerRender).toBe(A_BASE_CREDITS);
    expect(quote.components.find((c) => c.kind === "outro")!.credits).toBe(0);
    // The advisory says "a freeze ending is included" and means it.
    expect(quote.outroCredits).toBe(0);

    const { renders } = await createSet(db, {
      businessId,
      demoId,
      grid: {
        hookClipIds: [hookClipId],
        hookLineScriptIds: [hookLineId],
        mode: "voiced",
        audioRenderId: audio.id,
        personaId,
      },
    });
    expect((await debitsFor(renders[0]!.id))[0]!.delta).toBe(-quote.creditsPerRender);
  });

  it("ending avatar: a 6s outro adds 6 credits of GPU — 12 in total", async () => {
    const audio = await voicedAudio(26_000);
    const quote = await quoteASet(db, { businessId, demoId, audioRenderId: audio.id });
    expect(quote.creditsPerRender).toBe(A_BASE_CREDITS + 6);
    expect(quote.components.find((c) => c.kind === "outro")!.seconds).toBe(6);
    expect(quote.outroCredits).toBe(6);

    const { renders } = await createSet(db, {
      businessId,
      demoId,
      grid: {
        hookClipIds: [hookClipId],
        hookLineScriptIds: [hookLineId],
        mode: "voiced",
        audioRenderId: audio.id,
        personaId,
      },
    });
    expect((await debitsFor(renders[0]!.id))[0]!.delta).toBe(-quote.creditsPerRender);
  });

  it("outroCredits is a delta between two ceiled quotes, not the outro component", async () => {
    // 6.5s ending: 3 flat + 3 demo + 6.5 outro = 12.5, ceiled ONCE to 13.
    // Without the ending the same render is 6. The customer pays 7 more —
    // showing the 6.5 component instead would understate it by half a credit
    // and disagree with the total sitting on the next line.
    const audio = await voicedAudio(26_500);
    const quote = await quoteASet(db, { businessId, demoId, audioRenderId: audio.id });

    expect(quote.components.find((c) => c.kind === "outro")!.credits).toBe(6.5);
    expect(quote.creditsPerRender).toBe(13);
    expect(quote.outroCredits).toBe(7);
    expect(quote.creditsPerRender - quote.outroCredits).toBe(A_BASE_CREDITS);
  });

  it("every cell of a Set gets its own debit row — refunds key on the render id", async () => {
    const audio = await voicedAudio(20_000);
    const second = await generateHookLines(db, { businessId, n: 1 });
    const { renders } = await createSet(db, {
      businessId,
      demoId,
      grid: {
        hookClipIds: [hookClipId],
        hookLineScriptIds: [hookLineId, second[0]!.id],
        mode: "voiced",
        audioRenderId: audio.id,
        personaId,
      },
    });

    expect(renders).toHaveLength(2);
    for (const render of renders) {
      expect(await debitsFor(render.id)).toHaveLength(1);
    }
  });

  it("Service B: the quote is ceil(duration_ms / 1000) at 1 credit per second", async () => {
    const audio = await voicedAudio(15_400);
    const quote = await quoteBRender(db, { businessId, audioRenderId: audio.id });
    expect(quote.creditsPerRender).toBe(16); // 15.4s rounds up

    const render = await createBRender(db, { businessId, audioRenderId: audio.id, personaId });
    expect((await debitsFor(render.id))[0]!.delta).toBe(-16);
  });
});

describe("insufficient balance", { timeout: 120_000 }, () => {
  it("throws the typed error and writes NO set, render, job or ledger row", async () => {
    const poor = await createBusiness(db, { ownerEmail: "poor@example.com", name: "עסק ריק" });
    await setQuestionnaire(db, poor.id, {
      category: "local_service",
      product_name: "עסק ריק",
      what_it_does: "בדיקה",
      advantages: ["א"],
      target_audience: "כולם",
      tone: "friendly",
    });
    const demo = await createDemo(db, { businessId: poor.id, filePath: tempFile("demo2.mp4") });
    await drainAll();
    const hookLine = (await generateHookLines(db, { businessId: poor.id, n: 1 }))[0]!;
    const script = await generateVoScript(db, {
      businessId: poor.id,
      demoId: demo.id,
      selectedAdvantages: [],
      personaId,
    });
    const audio = await fabricateApprovedAudio(script.id, 20_000);

    const before = {
      sets: (await db.select().from(dbSchema.sets)).length,
      renders: (await db.select().from(dbSchema.videoRenders)).length,
      jobs: (await db.select().from(dbSchema.jobs)).length,
      ledger: (await db.select().from(dbSchema.creditLedger)).length,
    };

    await expect(
      createSet(db, {
        businessId: poor.id,
        demoId: demo.id,
        grid: {
          hookClipIds: [hookClipId],
          hookLineScriptIds: [hookLine.id],
          mode: "voiced",
          audioRenderId: audio.id,
          personaId,
        },
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);

    expect((await db.select().from(dbSchema.sets)).length).toBe(before.sets);
    expect((await db.select().from(dbSchema.videoRenders)).length).toBe(before.renders);
    expect((await db.select().from(dbSchema.jobs)).length).toBe(before.jobs);
    expect((await db.select().from(dbSchema.creditLedger)).length).toBe(before.ledger);
  });
});

describe("admin bypass", { timeout: 120_000 }, () => {
  it("an admin-owned business renders for free and writes zero ledger rows", async () => {
    const founder = await createBusiness(db, {
      ownerEmail: "founder@example.com",
      name: "עסק של המייסד",
      ownerRole: "admin",
    });
    await setQuestionnaire(db, founder.id, {
      category: "local_service",
      product_name: "עסק של המייסד",
      what_it_does: "דגימות לפנייה קרה",
      advantages: ["א"],
      target_audience: "כולם",
      tone: "friendly",
    });
    const demo = await createDemo(db, { businessId: founder.id, filePath: tempFile("demo3.mp4") });
    await drainAll();
    const hookLine = (await generateHookLines(db, { businessId: founder.id, n: 1 }))[0]!;
    const script = await generateVoScript(db, {
      businessId: founder.id,
      demoId: demo.id,
      selectedAdvantages: [],
      personaId,
    });
    const audio = await fabricateApprovedAudio(script.id, 26_000);

    const quote = await quoteASet(db, {
      businessId: founder.id,
      demoId: demo.id,
      audioRenderId: audio.id,
    });
    expect(quote.chargeable).toBe(false);

    const { renders } = await createSet(db, {
      businessId: founder.id,
      demoId: demo.id,
      grid: {
        hookClipIds: [hookClipId],
        hookLineScriptIds: [hookLine.id],
        mode: "voiced",
        audioRenderId: audio.id,
        personaId,
      },
    });

    expect(await debitsFor(renders[0]!.id)).toHaveLength(0);
    expect(await creditBalance(db, founder.ownerUserId)).toBe(0);
    // ...and outreach samples come out un-watermarked, deliberately.
    expect(renders[0]!.watermarked).toBe(false);
  });
});

describe("refunds", { timeout: 120_000 }, () => {
  it("a freeze/none render — which never enqueues lipsync — is still refunded", async () => {
    await grantCredits(db, { userId: ownerUserId, credits: 100, note: "test" });
    const audio = await voicedAudio(20_000);
    const { renders } = await createSet(db, {
      businessId,
      demoId,
      grid: {
        hookClipIds: [hookClipId],
        hookLineScriptIds: [hookLineId],
        mode: "voiced",
        audioRenderId: audio.id,
        personaId,
      },
    });
    const render = renders[0]!;
    const balanceAfterDebit = await creditBalance(db, ownerUserId);

    // The job dies WITHOUT running its terminal path (worker OOM/kill leaves
    // exactly this shape); the reaper sweep is the net that refunds it.
    await db
      .update(dbSchema.jobs)
      .set({ status: "dead", lastError: "boom" })
      .where(sql`${dbSchema.jobs.payload}->>'videoRenderId' = ${render.id}`);

    await handleReapDeadRenders(
      {} as never,
      {
        db,
        log: { info() {}, warn() {}, error() {} },
      } as never,
    );

    const refunds = await db
      .select()
      .from(dbSchema.creditLedger)
      .where(
        sql`${dbSchema.creditLedger.refId} = ${render.id} and ${dbSchema.creditLedger.reason} = 'refund_failed'`,
      );
    expect(refunds).toHaveLength(1);
    expect(await creditBalance(db, ownerUserId)).toBe(
      balanceAfterDebit + Math.abs((await debitsFor(render.id))[0]!.delta),
    );

    // The reaper writes the fixed Hebrew string — never the job's raw lastError.
    const reaped = (
      await db
        .select()
        .from(dbSchema.videoRenders)
        .where(sql`${dbSchema.videoRenders.id} = ${render.id}`)
    )[0]!;
    expect(reaped.status).toBe("failed");
    expect(reaped.error).toBe(RENDER_RETRIES_EXHAUSTED_MESSAGE);

    // A second sweep must not refund twice.
    await handleReapDeadRenders(
      {} as never,
      {
        db,
        log: { info() {}, warn() {}, error() {} },
      } as never,
    );
    expect(
      await db
        .select()
        .from(dbSchema.creditLedger)
        .where(
          sql`${dbSchema.creditLedger.refId} = ${render.id} and ${dbSchema.creditLedger.reason} = 'refund_failed'`,
        ),
    ).toHaveLength(1);
  });
});

describe("QC rejection never double-charges", { timeout: 120_000 }, () => {
  it("regeneration reuses the original debit — the customer pays once for our QC", async () => {
    await grantCredits(db, { userId: ownerUserId, credits: 100, note: "test" });
    const audio = await voicedAudio(15_000);
    const render = await createBRender(db, { businessId, audioRenderId: audio.id, personaId });
    expect(await debitsFor(render.id)).toHaveLength(1);

    await db
      .update(dbSchema.videoRenders)
      .set({ status: "qc_pending" })
      .where(eq(dbSchema.videoRenders.id, render.id));

    const balanceBefore = await creditBalance(db, ownerUserId);
    const { regeneratedRenderId } = await rejectRender(db, render.id, "השפתיים לא מסונכרנות");

    expect(regeneratedRenderId).toBeDefined();
    expect(await debitsFor(regeneratedRenderId!)).toHaveLength(0);
    expect(await creditBalance(db, ownerUserId)).toBe(balanceBefore);
  });
});
