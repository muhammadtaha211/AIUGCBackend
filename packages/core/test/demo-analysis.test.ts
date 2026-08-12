import { existsSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { HEAVY_JOB_TYPES, runLane } from "../src/jobs/worker";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import {
  analysisTimelineSchema,
  getLatestDemoAnalysis,
  illegibleFraction,
  requestDemoAnalysis,
  subsampleClusters,
} from "../src/pipelines/demo-analysis";
import { createDemo } from "../src/pipelines/demos";
import { setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * Pass 1 of the step-plan format in DRY_RUN (real DB + jobs + storage, vision
 * stubbed): ingest auto-enqueues analyze_demo, the handler writes the canned
 * 12-state inventory, and re-runs are no-ops until an attempt fails.
 */

let db: Db;
let pg: { close(): Promise<void> };
let storageRoot: string;
let cleanupStorage: () => void;
let businessId: string;
let demoId: string;

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

function tempFile(name: string): string {
  const dir = path.join(tmpdir(), "aiugc-analysis-inputs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, "fake video bytes");
  return file;
}

beforeAll(async () => {
  process.env.DRY_RUN = "1";
  resetEnvCache();
  const testDb = await createTestDb();
  db = testDb.db;
  pg = testDb.pg;
  const ts = tempStorage();
  setStorage(ts.storage);
  storageRoot = ts.root;
  cleanupStorage = ts.cleanup;

  const business = await createBusiness(db, {
    ownerEmail: "analysis@example.com",
    name: "אפליקציית קמפיינים",
    ownerRole: "admin",
  });
  businessId = business.id;
  await setQuestionnaire(db, businessId, {
    category: "app_or_digital",
    product_name: "קמפיינר",
    what_it_does: "יוצר קמפיינים אוטומטית",
    advantages: ["מהיר", "בעברית", "בלי מעצב"],
    target_audience: "בעלי עסקים קטנים",
    tone: "friendly",
  });
});

afterAll(async () => {
  setStorage(undefined);
  cleanupStorage();
  await pg.close();
});

describe("analyze_demo (dry-run chain)", () => {
  it("ingest auto-runs the analysis to a ready 12-state inventory", { timeout: 60_000 }, async () => {
    const demo = await createDemo(db, { businessId, filePath: tempFile("demo.mp4") });
    demoId = demo.id;
    await drainAll();

    const analysis = await getLatestDemoAnalysis(db, demoId);
    expect(analysis?.status).toBe("ready");
    expect(analysis?.stateCount).toBe(12);
    expect(analysis?.promptVersion).toBe("analyze_demo@dry-run");

    const states = analysisTimelineSchema.parse(analysis!.timeline);
    expect(states).toHaveLength(12);
    // The DRY_RUN demo is 20s — every timestamp must fit inside it.
    for (const s of states) expect(s.timestampMs).toBeLessThanOrEqual(20_000);
    // Chronological by construction.
    for (let i = 1; i < states.length; i++) {
      expect(states[i]!.timestampMs).toBeGreaterThan(states[i - 1]!.timestampMs);
    }
    // The journey ends on the success state, and the fixture exercises the
    // downstream rules: one unreadable, one low, one duplicate.
    expect(states[states.length - 1]!.actionType).toBe("result");
    expect(states.filter((s) => s.legibility === "unreadable")).toHaveLength(1);
    expect(states.filter((s) => s.legibility === "low")).toHaveLength(1);
    expect(states.filter((s) => s.sameStateAsPrevious)).toHaveLength(1);
    // The canned mix stays under the 40% legibility gate.
    expect(illegibleFraction(states)).toBeLessThan(0.4);

    // Thumbs exist in storage at the recorded paths.
    for (const s of states) {
      expect(s.thumbPath).toContain(`${demoId}/states/${s.timestampMs}.jpg`);
      expect(existsSync(path.join(storageRoot, s.thumbPath))).toBe(true);
    }
  });

  it("a second request is a no-op while the analysis is ready", async () => {
    const result = await requestDemoAnalysis(db, demoId);
    expect(result.kind).toBe("already_ready");
    const rows = await db
      .select()
      .from(dbSchema.demoAnalyses)
      .where(eq(dbSchema.demoAnalyses.demoId, demoId));
    expect(rows).toHaveLength(1);
  });

  it("a failed attempt re-queues under a fresh key and lands a fresh row", { timeout: 60_000 }, async () => {
    await db
      .update(dbSchema.demoAnalyses)
      .set({ status: "failed", failReason: "בדיקה" })
      .where(eq(dbSchema.demoAnalyses.demoId, demoId));

    const result = await requestDemoAnalysis(db, demoId);
    expect(result.kind).toBe("queued");
    const job = await db
      .select()
      .from(dbSchema.jobs)
      .where(eq(dbSchema.jobs.idempotencyKey, `analyze:${demoId}:r1`));
    expect(job).toHaveLength(1);

    await drainAll();
    const rows = await db
      .select()
      .from(dbSchema.demoAnalyses)
      .where(eq(dbSchema.demoAnalyses.demoId, demoId));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status).sort()).toEqual(["failed", "ready"]);
  });

  it("analyze_demo runs on the heavy lane", () => {
    expect(HEAVY_JOB_TYPES).toContain("analyze_demo");
  });

  it("a request while the auto job is still queued reports in_flight, not a second job", { timeout: 60_000 }, async () => {
    const demo = await createDemo(db, { businessId, filePath: tempFile("demo2.mp4") });
    // Run ONLY ingest: the demo goes ready and analyze_demo sits queued.
    await runLane(db, {
      workerId: "test",
      handlers: buildHandlers(),
      types: ["ingest_demo"],
      drainAndExit: true,
    });

    const result = await requestDemoAnalysis(db, demo.id);
    expect(result.kind).toBe("in_flight");
    const analyzeJobs = await db
      .select()
      .from(dbSchema.jobs)
      .where(eq(dbSchema.jobs.idempotencyKey, `analyze:${demo.id}`));
    expect(analyzeJobs).toHaveLength(1);

    await drainAll();
    expect((await getLatestDemoAnalysis(db, demo.id))?.status).toBe("ready");
  });

  it("a job that died before inserting its row does not wedge re-runs", { timeout: 60_000 }, async () => {
    const demo = await createDemo(db, { businessId, filePath: tempFile("demo3.mp4") });
    await runLane(db, {
      workerId: "test",
      handlers: buildHandlers(),
      types: ["ingest_demo"],
      drainAndExit: true,
    });
    // Simulate a worker that died on every attempt BEFORE the analysis row
    // insert: the job is dead and demo_analyses holds zero rows for this demo.
    await db
      .update(dbSchema.jobs)
      .set({ status: "dead" })
      .where(eq(dbSchema.jobs.idempotencyKey, `analyze:${demo.id}`));
    expect(await getLatestDemoAnalysis(db, demo.id)).toBeUndefined();

    const result = await requestDemoAnalysis(db, demo.id);
    expect(result.kind).toBe("queued");
    const retryJobs = await db
      .select()
      .from(dbSchema.jobs)
      .where(eq(dbSchema.jobs.idempotencyKey, `analyze:${demo.id}:r1`));
    expect(retryJobs).toHaveLength(1);

    await drainAll();
    expect((await getLatestDemoAnalysis(db, demo.id))?.status).toBe("ready");
  });
});

describe("subsampleClusters", () => {
  it("is a no-op at or under the cap", () => {
    const clusters = [1, 2, 3];
    expect(subsampleClusters(clusters, 3)).toEqual([1, 2, 3]);
    expect(subsampleClusters(clusters, 10)).toEqual([1, 2, 3]);
  });

  it("thins evenly to the cap and always keeps the last cluster", () => {
    const clusters = Array.from({ length: 100 }, (_, i) => i);
    const kept = subsampleClusters(clusters, 80);
    expect(kept).toHaveLength(80);
    expect(kept[0]).toBe(0);
    // The recording ends on the success state — the tail must survive thinning.
    expect(kept[kept.length - 1]).toBe(99);
    expect(new Set(kept).size).toBe(80);
  });
});

describe("illegibleFraction", () => {
  it("counts low and unreadable together, and treats empty as fully illegible", () => {
    expect(
      illegibleFraction([
        { legibility: "high" },
        { legibility: "low" },
        { legibility: "unreadable" },
        { legibility: "high" },
      ]),
    ).toBe(0.5);
    expect(illegibleFraction([])).toBe(1);
  });
});
