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
  type CutawayEdit,
  cutawayPlacement,
  demoOrderPicks,
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

  async function seedAudio(bizId: string, opts: { approved?: boolean; hookText?: string } = {}) {
    const approved = opts.approved ?? true;
    const script = (
      await db
        .insert(dbSchema.scripts)
        .values({
          businessId: bizId,
          kind: "b_script",
          text: "תסריט",
          params: opts.hookText ? { hookText: opts.hookText } : {},
        })
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

  /** The questionnaire's product_name — what productMention listens for. */
  async function nameProduct(productName: string | null) {
    await db
      .update(dbSchema.businesses)
      .set({ questionnaire: productName === null ? null : { product_name: productName } })
      .where(eq(dbSchema.businesses.id, businessId));
  }

  /** The footage row's spans, shifted: the anchors move with them. */
  async function setMoments(shiftMs: number) {
    await db
      .update(dbSchema.demoAnalysisFootage)
      .set({
        moments: timeline().map((t) => ({
          t: t.timestampMs,
          startMs: t.timestampMs + shiftMs,
          endMs: t.timestampMs + 1000,
          read: true,
        })),
      })
      .where(eq(dbSchema.demoAnalysisFootage.analysisId, analysisId));
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
    await nameProduct(null);
    await db.delete(dbSchema.cutawayPlans);
    await db.delete(dbSchema.usageEvents);
    await db.delete(dbSchema.events);
  });

  afterAll(async () => {
    setDryRun(true);
    await pg.close();
    cleanupStorage();
  });

  it("drafts free and keyless from the product mention: the demo in order, windows on moments, never a login screen", async () => {
    for (const dryRun of [true, false]) {
      setDryRun(dryRun);
      await db.delete(dbSchema.cutawayPlans);
      const plan = await draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId });
      expect(generateObject).not.toHaveBeenCalled();
      expect(plan.slots.length).toBeGreaterThanOrEqual(1);
      expect(plan.captions).toEqual(CAPTIONS);
      expect(plan.voDurationMs).toBe(VO_MS);
      expect(plan.captionOffsetMs).toBe(250);
      // No name in the questionnaire or the words: 40% of the 18 s voice.
      expect(plan.mentionMs).toBe(7200);
      const anchorStarts = new Set(plan.anchors.map((a) => a.startMs));
      let previous = -1;
      for (const [i, slot] of plan.slots.entries()) {
        expect(slot.id).toBe(i + 1);
        expect(slot.fromMs).toBeGreaterThanOrEqual(plan.mentionMs);
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
      expect(plan.updatedAt).toBe(row.updatedAt.toISOString());
    }
  });

  it("the demo's opening screen is a window start too, clamped to the edge", () => {
    const tl = timeline();
    const p = cutawayPlacement({
      timeline: tl,
      moments: tl.map((s, i) => ({
        t: s.timestampMs,
        startMs: i === 0 ? 0 : s.timestampMs - 200,
        endMs: 0,
        read: true,
      })),
      durationMs: 62_000,
      sampleMs: 200,
    });
    expect(p.anchors[0]).toEqual({ startMs: CUTAWAY_EDGE_MS, stateIndex: 0 });
    expect(new Set(p.anchors.map((a) => a.startMs)).size).toBe(p.anchors.length);
  });

  it("a demo too tight for every slot keeps a leading run — never a slot lost from the middle", () => {
    const tl = timeline().slice(0, 3);
    // Three screens: 0, 7000 and 9000 ms in a 12 s recording.
    const p = cutawayPlacement({
      timeline: tl.map((s, i) => ({
        ...s,
        timestampMs: [400, 7000, 9000][i]!,
        screenKind: "product" as const,
      })),
      moments: null,
      durationMs: 12_000,
      sampleMs: 200,
    });
    // 5.24 s then 4 s: the first fits only from the opening screen (clamped to
    // 400), and then the second still fits after it at 7000.
    const picks = demoOrderPicks(p, [5240, 4000]);
    expect(picks.map((a) => a.startMs)).toEqual([400, 7000]);
    // Too long to hold both: the first is kept, the second dropped off the end.
    expect(demoOrderPicks(p, [5240, 6000]).map((a) => a.startMs)).toEqual([400]);
    // Windows follow the demo and never overlap.
    for (const lengths of [
      [4000, 4000],
      [5000, 4000],
      [6000, 4000],
    ]) {
      const run = demoOrderPicks(p, lengths);
      for (let i = 1; i < run.length; i++) {
        expect(run[i]!.startMs).toBeGreaterThanOrEqual(run[i - 1]!.startMs + lengths[i - 1]! + 34);
      }
    }
  });

  it("an untouched draft follows the product mention; a plan the customer edited never moves", async () => {
    const first = await draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId });
    expect(first.mentionMs).toBe(7200);
    // Asked again with nothing changed: the same row, not even rewritten.
    const same = await draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId });
    expect(same.updatedAt).toBe(first.updatedAt);

    // The questionnaire now names the product, and the voice says it at word 27.
    await nameProduct("מילה27");
    const moved = await draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId });
    expect(moved.planId).toBe(first.planId);
    expect(moved.mentionMs).toBe(10_800);
    expect(moved.slots[0]!.fromMs).toBe(10_800);
    expect((await db.select().from(dbSchema.cutawayPlans))[0]!.editedAt).toBeNull();

    // The customer removes every clip; the name changes again; their plan stands.
    const edited = await updateCutawayPlan(db, {
      businessId,
      planId: first.planId,
      expectedUpdatedAt: moved.updatedAt,
      slots: [],
    });
    expect(edited.slots).toEqual([]);
    await nameProduct(null);
    const kept = await draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId });
    expect(kept.slots).toEqual([]);
    expect(kept.mentionMs).toBe(7200);
  });

  it("a 0121 row is laid out again from the mention, keeping the window the customer picked", async () => {
    const plan = await draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId });
    const picked = plan.anchors.find((a) => a.stateIndex === 20)!;
    // What 0121 stored: no ids, the first cut a few seconds in, its window moved by the customer.
    await db
      .update(dbSchema.cutawayPlans)
      .set({
        slots: [
          {
            fromMs: 3600,
            toMs: 8400,
            wordFrom: 9,
            wordTo: 21,
            demoStartMs: picked.startMs,
            stateIndex: 20,
            draftDemoStartMs: plan.slots[0]!.draftDemoStartMs,
            draftStateIndex: plan.slots[0]!.draftStateIndex,
          },
        ],
        editedAt: new Date(),
      })
      .where(eq(dbSchema.cutawayPlans.id, plan.planId));
    const again = await draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId });
    expect(again.planId).toBe(plan.planId);
    expect(again.slots[0]).toMatchObject({
      id: 1,
      fromMs: plan.slots[0]!.fromMs,
      toMs: plan.slots[0]!.toMs,
      demoStartMs: picked.startMs,
      stateIndex: 20,
      draftDemoStartMs: plan.slots[0]!.draftDemoStartMs,
    });
    expect(again.slots[0]!.fromMs).toBeGreaterThanOrEqual(again.mentionMs);
    expect((await db.select().from(dbSchema.cutawayPlans))[0]!.editedAt).not.toBeNull();
  });

  it("is keyed on the script's own hook text — never a line the client sends", async () => {
    const hooked = await seedAudio(businessId, { hookText: "מילה0 מילה1 מילה2" });
    const a = await draftCutawayPlan(db, { businessId, audioRenderId: hooked, demoId });
    expect(a.hookText).toBe("מילה0 מילה1 מילה2");
    const again = await draftCutawayPlan(db, { businessId, audioRenderId: hooked, demoId });
    expect(again.planId).toBe(a.planId);
    expect(await db.select().from(dbSchema.cutawayPlans)).toHaveLength(1);
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
    const unapproved = await seedAudio(businessId, { approved: false });
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

  /** One PATCH as the wizard sends it: the whole list, and the version it edited. */
  const send = (
    planId: string,
    expectedUpdatedAt: string,
    slots: CutawayEdit[],
    biz = businessId,
  ) => updateCutawayPlan(db, { businessId: biz, planId, expectedUpdatedAt, slots });
  const edit = (s: CutawayEdit) => ({
    id: s.id,
    fromMs: s.fromMs,
    toMs: s.toMs,
    demoStartMs: s.demoStartMs,
  });
  const codeOf = (p: Promise<unknown>) =>
    p.then(
      () => "ok",
      (err: unknown) => (err instanceof CutawayPlanError ? err.code : String(err)),
    );
  const windowOf = (plan: { anchors: { startMs: number; stateIndex: number }[] }, state: number) =>
    plan.anchors.find((a) => a.stateIndex === state)!.startMs;

  it("the customer moves a clip to any phrase, adds one and removes one — the draft's pick kept beside a drafted clip", async () => {
    const plan = await draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId });
    const drafted = plan.slots[0]!;
    // Moved to the very first phrase — before the product mention, on purpose: allowed.
    let current = await send(plan.planId, plan.updatedAt, [
      { ...edit(drafted), fromMs: 1200, toMs: 1200 + drafted.lengthMs },
    ]);
    expect(current.slots).toHaveLength(1);
    expect(current.slots[0]).toMatchObject({
      id: 1,
      fromMs: 1200,
      toMs: 1200 + drafted.lengthMs,
      wordFrom: 3,
      demoStartMs: drafted.demoStartMs,
      stateIndex: drafted.stateIndex,
      draftDemoStartMs: drafted.demoStartMs,
    });

    // Added: a new id, a window of its own, no draft pick.
    current = await send(plan.planId, current.updatedAt, [
      edit(current.slots[0]!),
      { id: 2, fromMs: 9600, toMs: 14_400, demoStartMs: windowOf(plan, 25) },
    ]);
    expect(current.slots.map((s) => s.id)).toEqual([1, 2]);
    expect(current.slots[1]).toMatchObject({ stateIndex: 25, wordFrom: 24, wordTo: 36 });
    expect(current.slots[1]).not.toHaveProperty("draftDemoStartMs");

    // Removed: clip 1 is simply gone.
    current = await send(plan.planId, current.updatedAt, [edit(current.slots[1]!)]);
    expect(current.slots.map((s) => s.id)).toEqual([2]);
    expect((await db.select().from(dbSchema.cutawayPlans))[0]!.editedAt).not.toBeNull();
  });

  it("refuses a stale version, broken slots and reused footage — writing nothing", async () => {
    const plan = await draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId });
    const a = { id: 1, fromMs: 2400, toMs: 7200, demoStartMs: windowOf(plan, 5) };
    const b = { id: 2, fromMs: 9600, toMs: 14_400, demoStartMs: windowOf(plan, 15) };
    const current = await send(plan.planId, plan.updatedAt, [a, b]);
    const v = current.updatedAt;

    expect(await codeOf(send(plan.planId, plan.updatedAt, [a]))).toBe("edit_conflict");
    expect(await codeOf(send(plan.planId, v, [{ ...a, fromMs: 2500 }]))).toBe("invalid_windows");
    expect(await codeOf(send(plan.planId, v, [a, { ...b, id: 1 }]))).toBe("invalid_windows");
    expect(await codeOf(send(plan.planId, v, [{ ...a, id: 9 }]))).toBe("invalid_windows");
    expect(await codeOf(send(plan.planId, v, [a, { ...b, fromMs: 6000, toMs: 10_800 }]))).toBe(
      "invalid_windows",
    );
    expect(await codeOf(send(plan.planId, v, [a, { ...b, demoStartMs: a.demoStartMs }]))).toBe(
      "invalid_windows",
    );
    expect(await codeOf(send(plan.planId, v, [{ ...a, demoStartMs: a.demoStartMs + 1 }]))).toBe(
      "invalid_windows",
    );
    expect(await codeOf(send(plan.planId, v, [a], otherBusinessId))).toBe("not_found");
    const row = (await db.select().from(dbSchema.cutawayPlans))[0]!;
    expect(row.updatedAt.toISOString()).toBe(v);

    // The anchors move when a footage row's spans change: a clip whose window the
    // customer did not touch keeps its stored pick, and the save still goes through.
    await setMoments(-100);
    expect(await codeOf(send(plan.planId, v, [a, b]))).toBe("ok");
    await setMoments(-200);
  });

  it("enqueue copies the windows for the same audio; none left is today's ad; another audio is stale", async () => {
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
    const resolve = (opts: { audioRenderId?: string; businessId?: string }) =>
      codeOf(
        resolveCutawaysForRender(db, {
          businessId,
          planId: plan.planId,
          audioRenderId: audioId,
          ...opts,
        }),
      );
    expect(await resolve({ audioRenderId: await seedAudio(businessId) })).toBe("stale");
    expect(await resolve({ businessId: otherBusinessId })).toBe("not_found");

    await send(plan.planId, plan.updatedAt, []);
    expect(
      await resolveCutawaysForRender(db, {
        businessId,
        planId: plan.planId,
        audioRenderId: audioId,
      }),
    ).toBeNull();
  });

  it("enqueue gives way to a longer final hook text: the clip under it moves to the next phrase, or drops — never stored", async () => {
    const plan = await draftCutawayPlan(db, { businessId, audioRenderId: audioId, demoId });
    const early = { id: 1, fromMs: 1200, toMs: 6000, demoStartMs: windowOf(plan, 5) };
    let current = await send(plan.planId, plan.updatedAt, [early]);
    // Five spoken words: the line leaves on the phrase after word 4 — VO 2400.
    const hookText = "מילה0 מילה1 מילה2 מילה3 מילה4";
    const resolve = (text?: string) =>
      resolveCutawaysForRender(db, {
        businessId,
        planId: plan.planId,
        audioRenderId: audioId,
        hookText: text,
      });
    expect((await resolve(hookText))!.slots).toEqual([
      { fromMs: 2400, toMs: 7200, demoStartMs: early.demoStartMs },
    ]);
    // Derived, never written: without the line the clip is where the customer put it.
    expect((await resolve())!.slots).toEqual([
      { fromMs: 1200, toMs: 6000, demoStartMs: early.demoStartMs },
    ]);

    // Boxed in by the clips after it, it has nowhere to go: dropped, and the rest still render.
    current = await send(plan.planId, current.updatedAt, [
      early,
      { id: 2, fromMs: 6000, toMs: 10_800, demoStartMs: windowOf(plan, 10) },
      { id: 3, fromMs: 10_800, toMs: 15_600, demoStartMs: windowOf(plan, 15) },
    ]);
    expect((await resolve(hookText))!.slots.map((s) => s.fromMs)).toEqual([6000, 10_800]);
    expect(current.slots).toHaveLength(3);
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
