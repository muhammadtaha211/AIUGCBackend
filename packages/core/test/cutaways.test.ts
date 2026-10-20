import { and, eq, sql } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the factory can close over it: the draft makes no model call at
// all, and the content-policy classifier is what createBRender must never reach
// with a bad plan.
const generateObject = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/anthropic", () => ({
  generateObject,
  CLAUDE_MODEL: "claude-sonnet-5-5",
}));

import type { CaptionChunk } from "../src/captions";
import { resetEnvCache } from "../src/config";
import { CUTAWAY_EDGE_MS, cutawayWindowsError } from "../src/cutaway-structure";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { addPersona, addPersonaImage } from "../src/pipelines/bank";
import { createBusiness } from "../src/pipelines/businesses";
import {
  CutawayPlanError,
  draftCutawayPlan,
  resolveCutawaysForRender,
  updateCutawayPlan,
} from "../src/pipelines/cutaways";
import type { AnalysisState } from "../src/pipelines/demo-analysis";
import { createBRender } from "../src/pipelines/sets";
import { setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/** 15 three-word chunks, 1.2 s apart: an 18 s voice that lays out two cutaways. */
const CAPTIONS: CaptionChunk[] = Array.from({ length: 15 }, (_, c) => ({
  text: "",
  startMs: c * 1200,
  endMs: c * 1200 + 1100,
  words: [0, 1, 2].map((w) => ({
    word: `מילה${c * 3 + w}`,
    startMs: c * 1200 + w * 400,
    endMs: c * 1200 + w * 400 + 350,
  })),
}));
const VO_MS = 18_000;

/** 30 states, 2 s apart; the first two are login screens (never a draft's pick). */
function timeline(): AnalysisState[] {
  return Array.from({ length: 30 }, (_, i) => ({
    timestampMs: 600 + i * 2000,
    screenName: i < 2 ? "מסך התחברות" : `מסך ${i}`,
    visibleText: i === 5 ? ["dana@example.com", "054-1234567", "בחירת דמות"] : [`טקסט ${i}`],
    action: `User does step ${i}`,
    actionType: "tap" as const,
    screenKind: i < 2 ? ("login" as const) : ("product" as const),
    sameStateAsPrevious: false,
    legibility: "high" as const,
    salienceNote: null,
    thumbPath: `assets/x/states/${i}.jpg`,
  }));
}

describe("demo cutaways: the draft, the edit, the copy enqueue takes", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let cleanupStorage: () => void;
  let businessId: string;
  let otherBusinessId: string;
  let audioId: string;
  let demoId: string;
  let analysisId: string;

  async function seedAudio(bizId: string, approved = true) {
    const script = (
      await db
        .insert(dbSchema.scripts)
        .values({ businessId: bizId, kind: "b_script", text: "תסריט" })
        .returning()
    )[0]!;
    return (
      await db
        .insert(dbSchema.audioRenders)
        .values({
          scriptId: script.id,
          voiceId: "voice_noa",
          status: "ready",
          filePath: "renders/x/vo.mp3",
          durationMs: VO_MS,
          wordTimestamps: CAPTIONS,
          approvedAt: approved ? new Date() : null,
        })
        .returning()
    )[0]!.id;
  }

  async function seedDemo(bizId: string, analysisStatus: "ready" | "analysing" | "failed" | null) {
    const demo = (
      await db
        .insert(dbSchema.demos)
        .values({
          businessId: bizId,
          status: "ready",
          normalizedPath: "assets/x/demo/normalized.mp4",
          durationMs: 62_000,
        })
        .returning()
    )[0]!;
    if (!analysisStatus) return { demoId: demo.id, analysisId: "" };
    const tl = timeline();
    const analysis = (
      await db
        .insert(dbSchema.demoAnalyses)
        .values({
          demoId: demo.id,
          status: analysisStatus,
          timeline: analysisStatus === "ready" ? tl : null,
          sections:
            analysisStatus === "ready"
              ? [{ title: "יצירת סרטון", stateIndexes: tl.map((_, i) => i) }]
              : null,
        })
        .returning()
    )[0]!;
    if (analysisStatus === "ready") {
      await db.insert(dbSchema.demoAnalysisFootage).values({
        analysisId: analysis.id,
        fps: 5,
        fileSha: "sha",
        // The moment's picture appears 200 ms before its representative sample.
        moments: tl.map((s) => ({
          t: s.timestampMs,
          startMs: s.timestampMs - 200,
          endMs: s.timestampMs + 1000,
          read: true,
        })),
      });
    }
    return { demoId: demo.id, analysisId: analysis.id };
  }

  function setDryRun(on: boolean) {
    process.env.DRY_RUN = on ? "1" : "0";
    resetEnvCache();
  }

  beforeAll(async () => {
    setDryRun(true);
    const testDb = await createTestDb();
    db = testDb.db;
    pg = testDb.pg;
    const ts = tempStorage();
    setStorage(ts.storage);
    cleanupStorage = ts.cleanup;
    businessId = (await createBusiness(db, { ownerEmail: "c@example.com", name: "עסק" })).id;
    otherBusinessId = (await createBusiness(db, { ownerEmail: "c@example.com", name: "אחר" })).id;
    audioId = await seedAudio(businessId);
    ({ demoId, analysisId } = await seedDemo(businessId, "ready"));
  });

  beforeEach(() => {
    generateObject.mockReset();
    setDryRun(true);
  });

  afterEach(async () => {
    await db.delete(dbSchema.cutawayPlans);
    await db.delete(dbSchema.usageEvents);
    await db.delete(dbSchema.events);
  });

  afterAll(async () => {
    setDryRun(true);
    await pg.close();
    cleanupStorage();
  });

  it("drafts free and keyless: the demo in order, slots on the layout, windows on moments, never a login screen", async () => {
    for (const dryRun of [true, false]) {
      setDryRun(dryRun);
      await db.delete(dbSchema.cutawayPlans);
      const plan = await draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId });
      expect(generateObject).not.toHaveBeenCalled();
      expect(plan.slots.length).toBeGreaterThanOrEqual(1);
      expect(plan.words).toHaveLength(45);
      const anchorStarts = new Set(plan.anchors.map((a) => a.startMs));
      let previous = -1;
      for (const slot of plan.slots) {
        expect(slot.lengthMs).toBeGreaterThanOrEqual(4000);
        expect(slot.lengthMs).toBeLessThanOrEqual(6000);
        expect(anchorStarts).toContain(slot.demoStartMs);
        expect(slot.stateIndex).toBeGreaterThanOrEqual(2);
        expect(slot.draftDemoStartMs).toBe(slot.demoStartMs);
        // In demo order, spread through the recording.
        expect(slot.demoStartMs).toBeGreaterThan(previous);
        previous = slot.demoStartMs;
      }
      // Windows start on the moment's first held frame, not its sample.
      expect(plan.anchors[0]).toEqual({ startMs: 400, stateIndex: 0 });
      expect(plan.minStartMs).toBe(CUTAWAY_EDGE_MS);
      expect(cutawayWindowsError(plan.slots, plan.maxEndMs + CUTAWAY_EDGE_MS)).toBeNull();
      expect(await db.select().from(dbSchema.usageEvents)).toHaveLength(0);
      const row = (await db.select().from(dbSchema.cutawayPlans))[0]!;
      expect(row.hookText).toBe("");
    }
  });
  it("is idempotent per (audio, analysis, structure, hook text); a new hook text is a fresh draft", async () => {
    const a = await draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId });
    const again = await draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId });
    expect(again.planId).toBe(a.planId);
    const hooked = await draftCutawayPlan(db, {
      businessId,
      audioRenderId: audioId,
      demoId,
      hookText: "מילה0 מילה1 מילה2 מילה3 מילה4",
    });
    expect(hooked.planId).not.toBe(a.planId);
    expect(hooked.hookText).toBe("מילה0 מילה1 מילה2 מילה3 מילה4");
    const back = await draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId });
    expect(back.planId).toBe(a.planId);
    expect(await db.select().from(dbSchema.cutawayPlans)).toHaveLength(2);
  });

  it("refuses what is not this business's, not approved, or not analysed", async () => {
    const code = async (p: Promise<unknown>) =>
      p.then(
        () => "ok",
        (err: unknown) => (err instanceof CutawayPlanError ? err.code : String(err)),
      );
    const other = await seedDemo(otherBusinessId, "ready");
    expect(
      await code(
        draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId: other.demoId }),
      ),
    ).toBe("not_found");
    const otherAudio = await seedAudio(otherBusinessId);
    expect(
      await code(draftCutawayPlan(db, { businessId, audioRenderId: otherAudio, demoId })),
    ).toBe("not_found");
    const unapproved = await seedAudio(businessId, false);
    expect(
      await code(draftCutawayPlan(db, { businessId, audioRenderId: unapproved, demoId })),
    ).toBe("audio_not_approved");
    const analysing = await seedDemo(businessId, "analysing");
    expect(
      await code(
        draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId: analysing.demoId }),
      ),
    ).toBe("analysis_pending");
    const failed = await seedDemo(businessId, "failed");
    expect(
      await code(
        draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId: failed.demoId }),
      ),
    ).toBe("analysis_failed");
    const none = await seedDemo(businessId, null);
    expect(
      await code(draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId: none.demoId })),
    ).toBe("analysis_pending");
    await db
      .update(dbSchema.demos)
      .set({ status: "normalizing" })
      .where(eq(dbSchema.demos.id, none.demoId));
    expect(
      await code(draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId: none.demoId })),
    ).toBe("demo_not_ready");
  });

  it("the customer's edit moves windows to other moments, keeps the draft beside them, and refuses a bad move", async () => {
    const plan = await draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId });
    const starts = plan.slots.map((s) => s.demoStartMs);
    const target = plan.anchors.find((a) => a.stateIndex === 25)!.startMs;
    const moved = [...starts.slice(0, -1), target];
    const edited = await updateCutawayPlan(db, { businessId, planId: plan.planId, starts: moved });
    expect(edited.slots.at(-1)!.demoStartMs).toBe(target);
    expect(edited.slots.at(-1)!.stateIndex).toBe(25);
    expect(edited.slots.at(-1)!.draftDemoStartMs).toBe(starts.at(-1));
    const row = (await db.select().from(dbSchema.cutawayPlans))[0]!;
    expect(row.editedAt).not.toBeNull();

    const code = async (s: number[], biz = businessId) =>
      updateCutawayPlan(db, { businessId: biz, planId: plan.planId, starts: s }).then(
        () => "ok",
        (err: unknown) => (err instanceof CutawayPlanError ? err.code : String(err)),
      );
    expect(await code([starts[0]!])).toBe(starts.length === 1 ? "ok" : "invalid_windows");
    expect(await code(starts.map(() => starts[0]!))).toBe(
      starts.length > 1 ? "invalid_windows" : "ok",
    );
    expect(await code(starts.map((s) => s + 1))).toBe("invalid_windows");
    expect(await code(starts, otherBusinessId)).toBe("not_found");
  });

  it("enqueue copies the windows only for the same audio and hook text it was laid out from", async () => {
    const plan = await draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId });
    const copy = await resolveCutawaysForRender(db, {
      businessId,
      planId: plan.planId,
      audioRenderId: audioId,
    });
    expect(copy).toEqual({
      structure: "alternate",
      planId: plan.planId,
      demoId,
      analysisId,
      slots: plan.slots.map(({ fromMs, toMs, demoStartMs }) => ({ fromMs, toMs, demoStartMs })),
    });
    const stale = async (opts: {
      audioRenderId?: string;
      hookText?: string;
      businessId?: string;
    }) =>
      resolveCutawaysForRender(db, {
        businessId,
        planId: plan.planId,
        audioRenderId: audioId,
        ...opts,
      }).then(
        () => "ok",
        (err: unknown) => (err instanceof CutawayPlanError ? err.code : String(err)),
      );
    expect(await stale({ hookText: "מילה0 מילה1" })).toBe("stale");
    expect(await stale({ audioRenderId: await seedAudio(businessId) })).toBe("stale");
    expect(await stale({ businessId: otherBusinessId })).toBe("not_found");
  });

  it("createBRender refuses a foreign plan before the paid classifier, with no debit and no render", async () => {
    const tempDir = path.join(tmpdir(), "aiugc-cutaways-inputs");
    mkdirSync(tempDir, { recursive: true });
    const file = path.join(tempDir, "selfie.jpg");
    writeFileSync(file, "fake");
    const persona = await addPersona(db, { name: "נועה", voiceId: "voice_noa" });
    const image = await addPersonaImage(db, {
      personaId: persona.id,
      filePath: file,
      kind: "selfie",
    });
    const otherAudio = await seedAudio(otherBusinessId);
    const other = await seedDemo(otherBusinessId, "ready");
    const otherPlan = await draftCutawayPlan(db, {
      businessId: otherBusinessId,
      audioRenderId: otherAudio,
      demoId: other.demoId,
    });
    // Off DRY_RUN from here: the classifier would be a real (mocked) call.
    setDryRun(false);
    await expect(
      createBRender(db, {
        businessId,
        audioRenderId: audioId,
        personaId: persona.id,
        personaImageId: image.id,
        cutawayPlanId: otherPlan.planId,
      }),
    ).rejects.toThrow(CutawayPlanError);
    expect(generateObject).not.toHaveBeenCalled();
    const renders = await db
      .select()
      .from(dbSchema.videoRenders)
      .where(
        and(
          eq(dbSchema.videoRenders.businessId, businessId),
          sql`${dbSchema.videoRenders.service} = 'b'`,
        ),
      );
    expect(renders).toHaveLength(0);
    const debits = await db
      .select()
      .from(dbSchema.creditLedger)
      .where(eq(dbSchema.creditLedger.businessId, businessId));
    expect(debits).toHaveLength(0);
  });
});
