import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The production seam of analyze_demo with DRY_RUN OFF and only the two things
 * a unit test cannot reach replaced — ffmpeg and the vision provider. What is
 * under test is the handler's WIRING, not the salvage logic
 * (analysis-batch-salvage.test.ts owns that): usage is recorded for every
 * returned call including the one whose body is garbage, a batch is
 * checkpointed only after its corrective call returned, a checkpointed batch
 * is never re-bought on the next attempt, and an envelope failure is a
 * transient failure carrying the stop_reason and no response content.
 */

const generateRawWithImages = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/providers/anthropic")>()),
  generateRawWithImages,
  // The sections job runs on the light lane, which this test never drains —
  // stubbed anyway so nothing here can reach the network.
  generateObject: vi.fn(),
}));

const frameHashes = vi.hoisted(() => vi.fn());
const extractFrames = vi.hoisted(() => vi.fn());
vi.mock("../src/media/ffmpeg", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/media/ffmpeg")>()),
  frameHashes,
  extractFrames,
}));

import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { HEAVY_JOB_TYPES, runLane } from "../src/jobs/worker";
import { WORK_DIR } from "../src/paths";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import {
  analysisTimelineSchema,
  batchWireFormat,
  getLatestDemoAnalysis,
  requestDemoAnalysis,
} from "../src/pipelines/demo-analysis";
import type { RawResult } from "../src/providers/anthropic";
import { getStorage, setStorage, storageKey } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

let db: Db;
let pg: { close(): Promise<void> };
let cleanupStorage: () => void;
let businessId: string;
let demoId: string;
let jobId: string;

// Six samples at the default 5 fps (i * 200ms), three states of two frames
// each — A A B B C C — so the real clusterStates yields clusters at 0, 400
// and 800ms, and a_analysis_batch_size 2 splits them into batches of 2 + 1.
const A = 0n;
const B = (1n << 20n) - 1n;
const C = (1n << 40n) - 1n;

const usage = { inputTokens: 100, outputTokens: 20 };
const entry = (index: number, overrides: Record<string, unknown> = {}) => ({
  index,
  screenName: `מסך ${index}`,
  visibleText: ["טקסט"],
  action: "פעולה",
  actionType: "tap",
  screenKind: "product",
  sameStateAsPrevious: false,
  legibility: "high",
  salienceNote: null,
  ...overrides,
});
const respond = (frames: unknown[]): RawResult => ({
  text: JSON.stringify({ frames }),
  stopReason: "end_turn",
  usage,
});

type Call = { frames: number; prompt: string; format: unknown };
const calls: Call[] = [];
let oneFrameBatchIsGarbage = true;

beforeAll(async () => {
  delete process.env.DRY_RUN; // the live path
  resetEnvCache();
  const testDb = await createTestDb();
  db = testDb.db;
  pg = testDb.pg;
  const ts = tempStorage();
  setStorage(ts.storage);
  cleanupStorage = ts.cleanup;

  const business = await createBusiness(db, {
    ownerEmail: "seam@example.com",
    name: "אפליקציית קמפיינים",
    ownerRole: "admin",
  });
  businessId = business.id;
  await setQuestionnaire(db, businessId, {
    category: "app_or_digital",
    product_name: "קמפיינר",
    what_it_does: "יוצר קמפיינים אוטומטית",
    advantages: ["מהיר", "בעברית"],
    target_audience: "בעלי עסקים קטנים",
    tone: "friendly",
  });
  await db.insert(dbSchema.appConfig).values({ key: "a_analysis_batch_size", value: 2 });

  // A ready demo whose normalized file exists in storage — no ingest, no ffprobe.
  const inserted = await db
    .insert(dbSchema.demos)
    .values({ businessId, status: "ready", durationMs: 1200 })
    .returning();
  demoId = inserted[0]!.id;
  const normalizedPath = await ts.storage.put(
    "assets",
    storageKey({ businessId, entity: "demo", id: demoId, filename: "normalized.mp4" }),
    Buffer.from("fake video bytes"),
  );
  await db.update(dbSchema.demos).set({ normalizedPath }).where(eq(dbSchema.demos.id, demoId));

  frameHashes.mockResolvedValue([A, A, B, B, C, C]);
  extractFrames.mockImplementation(
    async (_input: string, outDir: string, opts: { fps: number }) => {
      mkdirSync(outDir, { recursive: true });
      return [0, 1, 2, 3, 4, 5].map((i) => {
        const file = path.join(outDir, `${i}.jpg`);
        writeFileSync(file, `jpeg ${i}`);
        return { path: file, timestampMs: Math.round((i * 1000) / opts.fps) };
      });
    },
  );
  generateRawWithImages.mockImplementation(
    async (opts: { frames: unknown[]; prompt: string; format: unknown }): Promise<RawResult> => {
      calls.push({ frames: opts.frames.length, prompt: opts.prompt, format: opts.format });
      if (opts.frames.length === 2) {
        // The 2-frame batch: one out-of-enum frame, then a clean corrective.
        return opts.prompt.includes("not accepted")
          ? respond([entry(1)])
          : respond([entry(0), entry(1, { actionType: "click" })]);
      }
      // The 1-frame batch: a garbage envelope on the first attempt, valid on the next.
      if (oneFrameBatchIsGarbage) return { text: '{"nope":true}', stopReason: "end_turn", usage };
      return respond([entry(0)]);
    },
  );
});

afterAll(async () => {
  setStorage(undefined);
  cleanupStorage();
  rmSync(path.join(WORK_DIR, "analysis", demoId), { recursive: true, force: true });
  process.env.DRY_RUN = "1";
  resetEnvCache();
  await pg.close();
});

const runHeavyLane = () =>
  runLane(db, {
    workerId: "test",
    handlers: buildHandlers(),
    types: HEAVY_JOB_TYPES,
    drainAndExit: true,
  });

const usageRows = () =>
  db.select().from(dbSchema.usageEvents).where(eq(dbSchema.usageEvents.jobId, jobId));

const jobRow = async () =>
  (await db.select().from(dbSchema.jobs).where(eq(dbSchema.jobs.id, jobId)))[0]!;

describe("analyze_demo at the production seam (DRY_RUN off, ffmpeg + provider mocked)", () => {
  it(
    "attempt 1: every returned call is in the ledger, the finished batch is checkpointed after its corrective call, and the garbage batch fails the attempt transiently with the stop_reason and no content",
    { timeout: 60_000 },
    async () => {
      const requested = await requestDemoAnalysis(db, demoId);
      expect(requested.kind).toBe("queued");
      jobId = (requested as { jobId: string }).jobId;

      await runHeavyLane();

      // Three calls: the 2-frame batch twice (base + corrective), the 1-frame batch once.
      expect(calls.map((c) => c.frames).sort()).toEqual([1, 2, 2]);
      const corrective = calls.find((c) => c.prompt.includes("not accepted"))!;
      expect(corrective.frames).toBe(2);
      expect(corrective.prompt).toContain('- Frame 1: actionType "click" is not an allowed value');
      // Every call went out under the pinned wire.
      for (const c of calls) expect(c.format).toEqual(batchWireFormat());

      // Usage FIRST: three rows, one per returned call — the garbage one included.
      const rows = await usageRows();
      expect(rows).toHaveLength(3);
      for (const r of rows) {
        expect(r.provider).toBe("anthropic");
        expect(r.kind).toBe("llm_tokens");
        expect(r.quantity).toBe(120);
        expect(r.businessId).toBe(businessId);
      }

      // The envelope failure is transient, names the stop_reason, echoes nothing.
      const job = await jobRow();
      expect(job.status).toBe("queued");
      expect(job.attempts).toBe(1);
      expect(job.errorClass).toBe("transient");
      expect(job.lastError).toBe(
        "analysis: batch response is not a frames envelope (stop_reason: end_turn)",
      );
      expect(job.lastError).not.toContain("nope");

      // The finished batch is checkpointed — AFTER its corrective call, with both
      // frames present — and the failed batch is not.
      const state = job.state as { batchResults?: Record<string, unknown[]>; resumeKey?: string };
      expect(state.resumeKey).toContain("/5/2/0,400,800");
      expect(Object.keys(state.batchResults ?? {})).toEqual(["0"]);
      expect(state.batchResults!["0"]!.map((f) => (f as { index: number } | null)?.index)).toEqual([
        0, 1,
      ]);

      // Not the last attempt: the domain row stays in flight.
      expect((await getLatestDemoAnalysis(db, demoId))?.status).toBe("analysing");
    },
  );

  it(
    "attempt 2: the checkpointed batch is never re-bought, and the analysis lands ready",
    { timeout: 60_000 },
    async () => {
      oneFrameBatchIsGarbage = false;
      await db.execute(
        sql`update jobs set run_at = now() - interval '1 second' where id = ${jobId}::uuid`,
      );
      await runHeavyLane();

      // Exactly one more call — the 1-frame batch. The 2-frame batch was resumed.
      expect(calls).toHaveLength(4);
      expect(calls[3]!.frames).toBe(1);
      expect(await usageRows()).toHaveLength(4);

      const job = await jobRow();
      expect(job.status).toBe("succeeded");

      const analysis = await getLatestDemoAnalysis(db, demoId);
      expect(analysis?.status).toBe("ready");
      expect(analysis?.stateCount).toBe(3);
      const timeline = analysisTimelineSchema.parse(analysis!.timeline);
      expect(timeline.map((s) => s.timestampMs)).toEqual([0, 400, 800]);
      // The corrective call's frame 1 landed at cluster 400ms with its own thumb.
      expect(timeline.map((s) => s.thumbPath)).toEqual(
        [0, 400, 800].map(
          (ms) =>
            `assets/${storageKey({ businessId, entity: "demo", id: demoId, filename: `states/${ms}.jpg` })}`,
        ),
      );
      expect(timeline.every((s) => s.actionType === "tap")).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// The fill round at the seam
// ---------------------------------------------------------------------------

// Ten samples, five states of two frames each — clusters at 0, 400, 800,
// 1200 and 1600ms, every neighbour 20+ bits apart — and a_analysis_batch_size
// 4 splits them into batches of 4 + 1.
const D = (1n << 60n) - 1n;
const FIVE_STATES = [A, A, B, B, C, C, D, D, A, A];

type SeenCall = {
  labels: string[];
  jpegs: string[];
  prompt: string;
  system: string;
  format: unknown;
};
const seen: SeenCall[] = [];
let lastBatchIsGarbage = true;

async function seedReadyDemo(): Promise<string> {
  const inserted = await db
    .insert(dbSchema.demos)
    .values({ businessId, status: "ready", durationMs: 2000 })
    .returning();
  const id = inserted[0]!.id;
  const normalizedPath = await getStorage().put(
    "assets",
    storageKey({ businessId, entity: "demo", id, filename: "normalized.mp4" }),
    Buffer.from("fake video bytes"),
  );
  await db.update(dbSchema.demos).set({ normalizedPath }).where(eq(dbSchema.demos.id, id));
  return id;
}

const usageRowsOf = (id: string) =>
  db.select().from(dbSchema.usageEvents).where(eq(dbSchema.usageEvents.jobId, id));
const jobRowOf = async (id: string) =>
  (await db.select().from(dbSchema.jobs).where(eq(dbSchema.jobs.id, id)))[0]!;

describe("the fill round at the production seam (a batch of 4 collapses to one entry, twice)", () => {
  let collapseDemoId: string;
  let collapseJobId: string;
  let collapseResumeKey: string;
  let oldFormatDemoId: string;

  beforeAll(async () => {
    await db
      .update(dbSchema.appConfig)
      .set({ value: 4 })
      .where(eq(dbSchema.appConfig.key, "a_analysis_batch_size"));
    frameHashes.mockResolvedValue(FIVE_STATES);
    extractFrames.mockImplementation(
      async (_input: string, outDir: string, opts: { fps: number }) => {
        mkdirSync(outDir, { recursive: true });
        return FIVE_STATES.map((_, i) => {
          const file = path.join(outDir, `${i}.jpg`);
          writeFileSync(file, `jpeg ${i}`);
          return { path: file, timestampMs: Math.round((i * 1000) / opts.fps) };
        });
      },
    );
    generateRawWithImages.mockImplementation(
      async (opts: {
        system: string;
        frames: { label: string; jpeg: Buffer }[];
        prompt: string;
        format: unknown;
      }): Promise<RawResult> => {
        seen.push({
          labels: opts.frames.map((f) => f.label),
          jpegs: opts.frames.map((f) => f.jpeg.toString()),
          prompt: opts.prompt,
          system: opts.system,
          format: opts.format,
        });
        // Batch 0, the first call and the corrective alike: one entry, frame 0's.
        if (opts.frames.length === 4) return respond([entry(0)]);
        // Batch 1 is a natural one-frame batch: garbage on the first attempt.
        if (opts.frames[0]!.label.includes("t=1.6s")) {
          return lastBatchIsGarbage
            ? { text: '{"nope":true}', stopReason: "end_turn", usage }
            : respond([entry(0)]);
        }
        // A fill: the model claims "same" with no neighbour to compare against.
        return respond([entry(0, { sameStateAsPrevious: true })]);
      },
    );
    collapseDemoId = await seedReadyDemo();
    oldFormatDemoId = await seedReadyDemo();
  });

  afterAll(() => {
    for (const id of [collapseDemoId, oldFormatDemoId]) {
      rmSync(path.join(WORK_DIR, "analysis", id), { recursive: true, force: true });
    }
  });

  it(
    "attempt 1: frames 1-3 are re-sent one per call through the same builder, every call is in the ledger, and the checkpoint carries which frames were filled alone",
    { timeout: 60_000 },
    async () => {
      const requested = await requestDemoAnalysis(db, collapseDemoId);
      collapseJobId = (requested as { jobId: string }).jobId;
      await runHeavyLane();
      const job = await jobRowOf(collapseJobId);
      const state = job.state as {
        resumeKey: string;
        batchResults?: Record<string, Record<string, unknown>[]>;
      };
      // Kept before any assertion: the old-format test below seeds with it.
      collapseResumeKey = state.resumeKey;

      const whole = seen.filter((c) => c.labels.length === 4);
      const lastBatch = seen.filter((c) => c.labels[0]!.includes("t=1.6s"));
      const alone = seen.filter((c) => c.labels.length === 1 && !c.labels[0]!.includes("t=1.6s"));
      expect(whole).toHaveLength(2); // the first call and the corrective
      expect(whole[1]!.prompt).toContain(
        "- It covered only 1 of these 4 frames (1 entries returned).",
      );
      expect(lastBatch).toHaveLength(1);
      // One call per missing frame, each carrying that cluster's own image —
      // samples 2, 4 and 6 are the representatives at 400, 800 and 1200ms.
      expect(alone.map((c) => [c.labels, c.jpegs]).sort()).toEqual([
        [["Frame 0 — t=0.4s"], ["jpeg 2"]],
        [["Frame 0 — t=0.8s"], ["jpeg 4"]],
        [["Frame 0 — t=1.2s"], ["jpeg 6"]],
      ]);
      // The same builder as any batch: the prompt the natural one-frame batch
      // got, the same system prompt, the pinned wire.
      for (const c of alone) {
        expect(c.prompt).toBe(lastBatch[0]!.prompt);
        expect(c.system).toBe(whole[0]!.system);
      }
      for (const c of seen) expect(c.format).toEqual(batchWireFormat());

      // 2 whole-batch + 3 fills + 1 garbage: six calls, six usage rows.
      expect(seen).toHaveLength(6);
      expect(await usageRowsOf(collapseJobId)).toHaveLength(6);

      expect(job.status).toBe("queued");
      expect(job.errorClass).toBe("transient");
      expect(collapseResumeKey).toContain("/5/4/0,400,800,1200,1600");
      expect(Object.keys(state.batchResults ?? {})).toEqual(["0"]);
      expect(state.batchResults!["0"]!.map((f) => [f.index, f.filledAlone ?? null])).toEqual([
        [0, null],
        [1, true],
        [2, true],
        [3, true],
      ]);
      expect(Object.keys(state.batchResults!["0"]![0]!)).not.toContain("filledAlone");
    },
  );

  it(
    "attempt 2: nothing in the checkpointed batch is re-bought, fills included, and the filled states are decided by dHash",
    { timeout: 60_000 },
    async () => {
      lastBatchIsGarbage = false;
      await db.execute(
        sql`update jobs set run_at = now() - interval '1 second' where id = ${collapseJobId}::uuid`,
      );
      await runHeavyLane();

      expect(seen).toHaveLength(7);
      expect(seen[6]!.labels).toEqual(["Frame 0 — t=1.6s"]);
      expect(await usageRowsOf(collapseJobId)).toHaveLength(7);
      expect((await jobRowOf(collapseJobId)).status).toBe("succeeded");

      const analysis = await getLatestDemoAnalysis(db, collapseDemoId);
      expect(analysis?.status).toBe("ready");
      const timeline = analysisTimelineSchema.parse(analysis!.timeline);
      expect(timeline.map((s) => s.timestampMs)).toEqual([0, 400, 800, 1200, 1600]);
      // The fills said "same"; read back from the checkpoint as filled alone,
      // the hashes (20+ bits apart) decide instead.
      expect(timeline.map((s) => s.sameStateAsPrevious)).toEqual([
        false,
        false,
        false,
        false,
        false,
      ]);
    },
  );

  it(
    "a checkpoint written before the fill round resumes as not filled alone, and its null stays final — no fill re-opens a checkpointed batch",
    { timeout: 60_000 },
    async () => {
      const requested = await requestDemoAnalysis(db, oldFormatDemoId);
      const oldJobId = (requested as { jobId: string }).jobId;
      const inserted = await db
        .insert(dbSchema.demoAnalyses)
        .values({ demoId: oldFormatDemoId, status: "pending" })
        .returning();
      // Same samples and config, so the same resumeKey — it carries no demo id.
      // Batch 0 as the code before the fill round checkpointed it: no
      // provenance anywhere, frame 1 flagged "same", frame 3 never returned.
      await db
        .update(dbSchema.jobs)
        .set({
          state: {
            analysisId: inserted[0]!.id,
            resumeKey: collapseResumeKey,
            batchResults: {
              0: [entry(0), entry(1, { sameStateAsPrevious: true }), entry(2), null],
            },
          },
        })
        .where(eq(dbSchema.jobs.id, oldJobId));

      const before = seen.length;
      await runHeavyLane();

      // Only batch 1 is bought: batch 0 resumed with its null, and no fill ran.
      expect(seen.slice(before).map((c) => c.labels)).toEqual([["Frame 0 — t=1.6s"]]);
      expect(await usageRowsOf(oldJobId)).toHaveLength(1);

      const analysis = await getLatestDemoAnalysis(db, oldFormatDemoId);
      expect(analysis?.status).toBe("ready");
      const timeline = analysisTimelineSchema.parse(analysis!.timeline);
      // 400's flag is trusted (adjacent, transcribed in its batch); 1200 is
      // dropped, so 1600 is re-judged against 800 by dHash.
      expect(timeline.map((s) => [s.timestampMs, s.sameStateAsPrevious])).toEqual([
        [0, false],
        [400, true],
        [800, false],
        [1600, false],
      ]);
    },
  );
});
