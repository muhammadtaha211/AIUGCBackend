import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { runLane } from "../src/jobs/worker";
import { createBusiness, setQuestionnaire, type Questionnaire } from "../src/pipelines/businesses";
import {
  analysisSectionsSchema,
  enqueueMissingSections,
  findSectionViolations,
  getLatestDemoAnalysis,
  type AnalysisSection,
} from "../src/pipelines/demo-analysis";
import { createDemo } from "../src/pipelines/demos";
import { setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * Sections (0030): the deterministic checker, the DRY_RUN grouping chain
 * (ingest -> analyze -> group), computed-once idempotence, and the CLI
 * backfill. A grouping is a nicety by contract — nothing here may fail the
 * analysis or park the lane.
 */

const QUESTIONNAIRE: Questionnaire = {
  category: "app_or_digital",
  product_name: "קמפיינר",
  what_it_does: "יוצר קמפיינים אוטומטית",
  advantages: ["מהיר", "בעברית"],
  target_audience: "בעלי עסקים קטנים",
  tone: "friendly",
};

let db: Db;
let pg: { close(): Promise<void> };
let cleanupStorage: () => void;
let businessId: string;
let demoId: string;

function tempFile(name: string): string {
  const dir = path.join(tmpdir(), "aiugc-sections-inputs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, "fake video bytes");
  return file;
}

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
    ownerEmail: "sections@example.com",
    name: "אפליקציית קמפיינים",
    ownerRole: "admin",
  });
  businessId = business.id;
  await setQuestionnaire(db, businessId, QUESTIONNAIRE);
});

afterAll(async () => {
  setStorage(undefined);
  cleanupStorage();
  await pg.close();
});

describe("findSectionViolations", () => {
  const valid: AnalysisSection[] = [
    { title: "תחילת השימוש", stateIndexes: [0, 2] },
    { title: "התוצאה", stateIndexes: [5] },
  ];

  it("accepts a disjoint, in-range, Hebrew grouping", () => {
    expect(findSectionViolations(valid, 6)).toEqual([]);
  });

  it("rejects empty, oversized, non-Hebrew, out-of-range and doubled", () => {
    expect(findSectionViolations([], 6)).toContain("zero sections");
    expect(
      findSectionViolations(
        Array.from({ length: 7 }, (_, i) => ({ title: "כותרת", stateIndexes: [i] })),
        7,
      ).some((v) => v.includes("maximum is 6")),
    ).toBe(true);
    expect(
      findSectionViolations([{ title: "Posting", stateIndexes: [0] }], 6).some((v) =>
        v.includes("not Hebrew"),
      ),
    ).toBe(true);
    expect(
      findSectionViolations([{ title: "כותרת", stateIndexes: [9] }], 6).some((v) =>
        v.includes("not in the timeline"),
      ),
    ).toBe(true);
    expect(
      findSectionViolations(
        [
          { title: "אחת", stateIndexes: [1] },
          { title: "שתיים", stateIndexes: [1] },
        ],
        6,
      ).some((v) => v.includes("two sections")),
    ).toBe(true);
    expect(
      findSectionViolations([{ title: "ריקה", stateIndexes: [] }], 6).some((v) =>
        v.includes("no states"),
      ),
    ).toBe(true);
  });
});

describe("group_analysis_states (dry-run chain)", () => {
  it("the analysis-ready hook writes canned Hebrew sections", { timeout: 60_000 }, async () => {
    const demo = await createDemo(db, { businessId, filePath: tempFile("demo.mp4") });
    demoId = demo.id;
    await drainAll(); // ingest -> analyze -> ready -> group

    const analysis = await getLatestDemoAnalysis(db, demoId);
    expect(analysis?.status).toBe("ready");
    expect(analysis?.sectionsPromptVersion).toBe("group_analysis_states@dry-run");
    const sections = analysisSectionsSchema.parse(analysis!.sections);
    expect(sections.length).toBeGreaterThanOrEqual(1);
    for (const section of sections) {
      expect(section.title).toMatch(/[֐-׿]/);
      expect(section.stateIndexes.length).toBeGreaterThan(0);
    }
    // The canned grouping passes its own validator, like dryRunPlan does.
    expect(findSectionViolations(sections, analysis!.stateCount!)).toEqual([]);
  });

  it("computed once — a duplicate job is a no-op, and the backfill skips it", async () => {
    const analysis = await getLatestDemoAnalysis(db, demoId);
    const before = analysis!.sections;

    // Nothing ungrouped -> the backfill enqueues nothing.
    expect(await enqueueMissingSections(db)).toBe(0);

    // Null it out (the pre-0030 world) -> the backfill picks it up and the
    // job regroups it.
    await db
      .update(dbSchema.demoAnalyses)
      .set({ sections: null, sectionsPromptVersion: null })
      .where(eq(dbSchema.demoAnalyses.id, analysis!.id));
    expect(await enqueueMissingSections(db)).toBe(1);
    await drainAll();

    const regrouped = await getLatestDemoAnalysis(db, demoId);
    expect(regrouped?.sections).toEqual(before);
  });
});
