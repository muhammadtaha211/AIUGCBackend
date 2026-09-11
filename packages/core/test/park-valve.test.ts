import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import {
  failOverparkedWork,
  findOverparkedRenders,
  handleReapDeadRenders,
  MAX_BUDGET_PARK_MS,
} from "../src/pipelines/janitor";
import { WORK_PARK_EXPIRED_MESSAGE } from "../src/pipelines/renders";
import { createTestDb } from "./helpers/pglite";

/**
 * The 6h valve for parked work that is NOT a render. Before it existed, a
 * budget-parked synth_tts / analyze_demo / plan_demo_steps / generate_composite
 * re-queued at +1h forever with its domain row stuck mid-state — the hole
 * budget.ts:50-57 names ("a parked TTS job leaves the wizard spinning forever").
 *
 * Rows are seeded directly rather than driven through the pipelines: the four
 * types have four different entry points with four different prerequisites
 * (questionnaire, storage, persona images, a live Claude key), and what is
 * under test is the sweep, not the way a row gets to be parked. The parked
 * shape itself is copied from parkForBudget (queue.ts) so the seed cannot
 * drift from what production actually writes.
 */
describe("the max-park-age valve for non-render work (real DB)", () => {
  let db: Db;
  let pg: { close(): Promise<void> };

  let businessId: string;
  let demoId: string;
  let personaId: string;
  let scriptId: string;

  const silentLog = { info() {}, warn() {}, error() {} };

  /** The exact shape parkForBudget leaves, at a chosen age. */
  async function parkJob(opts: {
    type: string;
    key: string;
    payload?: Record<string, unknown>;
    state?: Record<string, unknown>;
    ageMs: number;
    errorClass?: "budget" | "transient";
  }): Promise<string> {
    const rows = await db
      .insert(dbSchema.jobs)
      .values({
        type: opts.type,
        idempotencyKey: opts.key,
        payload: opts.payload ?? {},
        state: opts.state ?? {},
        status: "queued",
        errorClass: opts.errorClass ?? "budget",
        lastError: "daily cap reached for llm_tokens: used 1 of 1 in the last 24h",
        runAt: new Date(Date.now() + 60 * 60 * 1000),
        createdAt: new Date(Date.now() - opts.ageMs),
      })
      .returning({ id: dbSchema.jobs.id });
    return rows[0]!.id;
  }

  const jobByKey = async (key: string) =>
    (
      await db
        .select()
        .from(dbSchema.jobs)
        .where(sql`${dbSchema.jobs.idempotencyKey} = ${key}`)
    )[0]!;

  /** Comfortably past MAX_BUDGET_PARK_MS; the render valve's own test uses 7h. */
  const OVERPARKED_MS = MAX_BUDGET_PARK_MS + 60 * 60 * 1000;

  async function newAnalysis(status: "pending" | "analysing" | "ready" = "analysing") {
    const rows = await db
      .insert(dbSchema.demoAnalyses)
      .values({ demoId, status })
      .returning({ id: dbSchema.demoAnalyses.id });
    return rows[0]!.id;
  }

  async function newPlan(analysisId: string) {
    const rows = await db
      .insert(dbSchema.demoStepPlans)
      .values({ demoId, analysisId, status: "planning" })
      .returning({ id: dbSchema.demoStepPlans.id });
    return rows[0]!.id;
  }

  async function newAudio(status: "queued" | "generating" | "ready" = "generating") {
    const rows = await db
      .insert(dbSchema.audioRenders)
      .values({ scriptId, voiceId: "voice-1", status })
      .returning({ id: dbSchema.audioRenders.id });
    return rows[0]!.id;
  }

  async function newComposite() {
    const rows = await db
      .insert(dbSchema.composites)
      .values({ businessId, personaId, status: "generating" })
      .returning({ id: dbSchema.composites.id });
    return rows[0]!.id;
  }

  beforeAll(async () => {
    ({ db, pg } = await createTestDb());

    const user = (
      await db
        .insert(dbSchema.users)
        .values({ email: "park-valve@example.com" })
        .returning({ id: dbSchema.users.id })
    )[0]!;
    businessId = (
      await db
        .insert(dbSchema.businesses)
        .values({ ownerUserId: user.id, name: "עסק בדיקה" })
        .returning({ id: dbSchema.businesses.id })
    )[0]!.id;
    demoId = (
      await db
        .insert(dbSchema.demos)
        .values({ businessId, status: "ready" })
        .returning({ id: dbSchema.demos.id })
    )[0]!.id;
    personaId = (
      await db
        .insert(dbSchema.personas)
        .values({ name: "דמות בדיקה", voiceId: "voice-1" })
        .returning({ id: dbSchema.personas.id })
    )[0]!.id;
    scriptId = (
      await db
        .insert(dbSchema.scripts)
        .values({ businessId, kind: "b_script", text: "טקסט בדיקה" })
        .returning({ id: dbSchema.scripts.id })
    )[0]!.id;
  });

  afterAll(async () => {
    await pg.close();
  });

  it("ends an over-parked analyze_demo: job failed, analysis failed, Hebrew on the row", async () => {
    const analysisId = await newAnalysis();
    // analyze_demo's row id lives on jobs.state, not the payload — the handler
    // creates the analysis itself and checkpoints the id before any paid call.
    await parkJob({
      type: "analyze_demo",
      key: `analyze:${demoId}`,
      payload: { demoId },
      state: { analysisId },
      ageMs: OVERPARKED_MS,
    });

    expect(await failOverparkedWork(db)).toBe(1);

    const job = await jobByKey(`analyze:${demoId}`);
    expect(job.status).toBe("failed");
    expect(job.errorClass).toBe("permanent");
    expect(job.lastError).toContain("budget park expired");

    const row = (
      await db.select().from(dbSchema.demoAnalyses).where(eq(dbSchema.demoAnalyses.id, analysisId))
    )[0]!;
    expect(row.status).toBe("failed");
    expect(row.failReason).toBe(WORK_PARK_EXPIRED_MESSAGE);
  });

  it("ends an over-parked plan_demo_steps and reuses the documented fail_kind", async () => {
    const planId = await newPlan(await newAnalysis("pending"));
    await parkJob({
      type: "plan_demo_steps",
      key: `plan:${planId}`,
      payload: { planId },
      ageMs: OVERPARKED_MS,
    });

    expect(await failOverparkedWork(db)).toBe(1);

    expect((await jobByKey(`plan:${planId}`)).status).toBe("failed");
    const row = (
      await db.select().from(dbSchema.demoStepPlans).where(eq(dbSchema.demoStepPlans.id, planId))
    )[0]!;
    expect(row.status).toBe("failed");
    expect(row.failReason).toBe(WORK_PARK_EXPIRED_MESSAGE);
    // No sixth value: "transient" is already in demo_step_plans' closed set.
    expect(row.failKind).toBe("transient");
  });

  it("ends an over-parked synth_tts — the case budget.ts names as spinning forever", async () => {
    const audioRenderId = await newAudio();
    await parkJob({
      type: "synth_tts",
      key: `tts:${audioRenderId}`,
      payload: { audioRenderId },
      ageMs: OVERPARKED_MS,
    });

    expect(await failOverparkedWork(db)).toBe(1);

    expect((await jobByKey(`tts:${audioRenderId}`)).status).toBe("failed");
    const row = (
      await db
        .select()
        .from(dbSchema.audioRenders)
        .where(eq(dbSchema.audioRenders.id, audioRenderId))
    )[0]!;
    expect(row.status).toBe("failed");
    expect(row.error).toBe(WORK_PARK_EXPIRED_MESSAGE);
  });

  it("ends an over-parked generate_composite", async () => {
    const compositeId = await newComposite();
    await parkJob({
      type: "generate_composite",
      key: `composite:${compositeId}`,
      payload: { compositeId },
      ageMs: OVERPARKED_MS,
    });

    expect(await failOverparkedWork(db)).toBe(1);

    expect((await jobByKey(`composite:${compositeId}`)).status).toBe("failed");
    const row = (
      await db.select().from(dbSchema.composites).where(eq(dbSchema.composites.id, compositeId))
    )[0]!;
    expect(row.status).toBe("failed");
    expect(row.error).toBe(WORK_PARK_EXPIRED_MESSAGE);
  });

  it("a second sweep changes nothing", async () => {
    const audioRenderId = await newAudio();
    await parkJob({
      type: "synth_tts",
      key: `tts-twice:${audioRenderId}`,
      payload: { audioRenderId },
      ageMs: OVERPARKED_MS,
    });

    expect(await failOverparkedWork(db)).toBe(1);
    const after = await jobByKey(`tts-twice:${audioRenderId}`);

    expect(await failOverparkedWork(db)).toBe(0);
    const again = await jobByKey(`tts-twice:${audioRenderId}`);
    expect(again.updatedAt.getTime()).toBe(after.updatedAt.getTime());
    expect(
      (
        await db
          .select()
          .from(dbSchema.audioRenders)
          .where(eq(dbSchema.audioRenders.id, audioRenderId))
      )[0]!.error,
    ).toBe(WORK_PARK_EXPIRED_MESSAGE);
  });

  it("leaves a BACKOFF-parked job alone — a transient retry is not a budget park", async () => {
    const audioRenderId = await newAudio();
    await parkJob({
      type: "synth_tts",
      key: `tts-backoff:${audioRenderId}`,
      payload: { audioRenderId },
      ageMs: OVERPARKED_MS,
      errorClass: "transient",
    });

    expect(await failOverparkedWork(db)).toBe(0);
    expect((await jobByKey(`tts-backoff:${audioRenderId}`)).status).toBe("queued");
    expect(
      (
        await db
          .select()
          .from(dbSchema.audioRenders)
          .where(eq(dbSchema.audioRenders.id, audioRenderId))
      )[0]!.status,
    ).toBe("generating");
  });

  it("leaves a budget-parked job younger than the valve alone", async () => {
    const audioRenderId = await newAudio();
    await parkJob({
      type: "synth_tts",
      key: `tts-young:${audioRenderId}`,
      payload: { audioRenderId },
      ageMs: MAX_BUDGET_PARK_MS - 60 * 60 * 1000,
    });

    expect(await failOverparkedWork(db)).toBe(0);
    expect((await jobByKey(`tts-young:${audioRenderId}`)).status).toBe("queued");
    expect(
      (
        await db
          .select()
          .from(dbSchema.audioRenders)
          .where(eq(dbSchema.audioRenders.id, audioRenderId))
      )[0]!.status,
    ).toBe("generating");
  });

  it("does not touch render_video or lipsync — the render valve still owns them", async () => {
    const renderId = (
      await db
        .insert(dbSchema.videoRenders)
        .values({ businessId, service: "b", params: {}, status: "queued" })
        .returning({ id: dbSchema.videoRenders.id })
    )[0]!.id;
    await parkJob({
      type: "lipsync",
      key: `lipsync:${renderId}`,
      payload: { videoRenderId: renderId },
      ageMs: OVERPARKED_MS,
    });

    // This valve ignores it...
    expect(await failOverparkedWork(db)).toBe(0);
    const job = await jobByKey(`lipsync:${renderId}`);
    expect(job.status).toBe("queued");
    expect(job.errorClass).toBe("budget");

    // ...and the render valve still finds it, unchanged.
    expect(await findOverparkedRenders(db)).toContainEqual({ videoRenderId: renderId });
  });

  it("ends the job even when it carries no domain-row id, so it cannot re-park forever", async () => {
    // analyze_demo parked before its checkpoint landed: nothing to fail, but
    // leaving the job queued would only park it again at +1h, indefinitely.
    await parkJob({
      type: "analyze_demo",
      key: `analyze-noid:${demoId}`,
      payload: { demoId },
      ageMs: OVERPARKED_MS,
    });

    // Zero ROWS landed — the return value counts domain rows, not jobs.
    expect(await failOverparkedWork(db)).toBe(0);
    expect((await jobByKey(`analyze-noid:${demoId}`)).status).toBe("failed");
  });

  it("never flips a domain row that already finished", async () => {
    const audioRenderId = await newAudio("ready");
    await parkJob({
      type: "synth_tts",
      key: `tts-ready:${audioRenderId}`,
      payload: { audioRenderId },
      ageMs: OVERPARKED_MS,
    });

    expect(await failOverparkedWork(db)).toBe(0);
    expect((await jobByKey(`tts-ready:${audioRenderId}`)).status).toBe("failed");
    const row = (
      await db
        .select()
        .from(dbSchema.audioRenders)
        .where(eq(dbSchema.audioRenders.id, audioRenderId))
    )[0]!;
    expect(row.status).toBe("ready");
    expect(row.error).toBeNull();
  });

  it("runs as part of the reaper sweep, not only when called directly", async () => {
    const audioRenderId = await newAudio();
    await parkJob({
      type: "synth_tts",
      key: `tts-reaper:${audioRenderId}`,
      payload: { audioRenderId },
      ageMs: OVERPARKED_MS,
    });

    await handleReapDeadRenders({} as never, { db, log: silentLog } as never);

    expect((await jobByKey(`tts-reaper:${audioRenderId}`)).status).toBe("failed");
    expect(
      (
        await db
          .select()
          .from(dbSchema.audioRenders)
          .where(eq(dbSchema.audioRenders.id, audioRenderId))
      )[0]!.error,
    ).toBe(WORK_PARK_EXPIRED_MESSAGE);
  });

  it("ends every over-parked type in one sweep", async () => {
    const analysisId = await newAnalysis();
    const planId = await newPlan(await newAnalysis("pending"));
    const audioRenderId = await newAudio();
    const compositeId = await newComposite();
    await parkJob({
      type: "analyze_demo",
      key: `batch-analyze:${analysisId}`,
      payload: { demoId },
      state: { analysisId },
      ageMs: OVERPARKED_MS,
    });
    await parkJob({
      type: "plan_demo_steps",
      key: `batch-plan:${planId}`,
      payload: { planId },
      ageMs: OVERPARKED_MS,
    });
    await parkJob({
      type: "synth_tts",
      key: `batch-tts:${audioRenderId}`,
      payload: { audioRenderId },
      ageMs: OVERPARKED_MS,
    });
    await parkJob({
      type: "generate_composite",
      key: `batch-composite:${compositeId}`,
      payload: { compositeId },
      ageMs: OVERPARKED_MS,
    });

    expect(await failOverparkedWork(db)).toBe(4);
    expect(await failOverparkedWork(db)).toBe(0);
  });
});
