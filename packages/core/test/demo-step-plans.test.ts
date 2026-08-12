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
import { createBusiness, setQuestionnaire, type Questionnaire } from "../src/pipelines/businesses";
import type { AnalysisState } from "../src/pipelines/demo-analysis";
import {
  approvePlan,
  findPlanViolations,
  getStepPlan,
  planStepsSchema,
  requestDemoPlan,
  runPlanRegression,
  unexplainedMomentsSchema,
  updatePlanSteps,
} from "../src/pipelines/demo-step-plans";
import { createDemo } from "../src/pipelines/demos";
import { setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * Pass 2 of the step-plan format in DRY_RUN: plan generation over the canned
 * analysis, the deterministic anti-fabrication rule, the edit/approve/fork
 * lifecycle, and the fixtures/timelines regression harness.
 */

let db: Db;
let pg: { close(): Promise<void> };
let cleanupStorage: () => void;
let businessId: string;
let demoId: string;
let planId: string;

const QUESTIONNAIRE: Questionnaire = {
  category: "app_or_digital",
  product_name: "קמפיינר",
  what_it_does: "יוצר קמפיינים אוטומטית",
  advantages: ["מהיר", "בעברית", "בלי מעצב"],
  target_audience: "בעלי עסקים קטנים",
  tone: "friendly",
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

function tempFile(name: string): string {
  const dir = path.join(tmpdir(), "aiugc-plan-inputs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, "fake video bytes");
  return file;
}

/** Minimal timeline for the pure-validation tests. */
function state(overrides: Partial<AnalysisState>): AnalysisState {
  return {
    timestampMs: 0,
    screenName: "מסך",
    visibleText: [],
    action: "פעולה",
    actionType: "tap",
    sameStateAsPrevious: false,
    legibility: "high",
    salienceNote: null,
    thumbPath: "assets/x/states/0.jpg",
    ...overrides,
  };
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
    ownerEmail: "plans@example.com",
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

describe("plan_demo_steps (dry-run chain)", () => {
  it("refuses to plan a demo with no ready analysis", async () => {
    const demo = await createDemo(db, { businessId, filePath: tempFile("demo.mp4") });
    demoId = demo.id;
    await expect(requestDemoPlan(db, demoId)).rejects.toThrow(/no ready analysis/);
    await drainAll(); // ingest -> analyze -> analysis ready
  });

  it("generates a ready plan from the canned analysis", { timeout: 60_000 }, async () => {
    const { planId: id } = await requestDemoPlan(db, demoId);
    planId = id;
    await drainAll();

    const plan = await getStepPlan(db, planId);
    expect(plan?.status).toBe("ready");
    expect(plan?.approvedAt).toBeNull();
    expect(plan?.promptVersion).toBe("plan_demo_steps@dry-run");
    expect(plan?.notes).toBeNull();

    const steps = planStepsSchema.parse(plan!.steps);
    // The canned analysis: idle/dup/low/unreadable states are skipped.
    expect(steps.map((s) => s.sourceIndex)).toEqual([1, 2, 3, 5, 6, 7, 10, 11]);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.timestampMs).toBeGreaterThan(steps[i - 1]!.timestampMs);
    }
    // The video ends on the success state, label lifted off the screen, no "!".
    const last = steps[steps.length - 1]!;
    expect(last.actionType).toBe("result");
    expect(last.label).toBe("הקמפיין נוצר");
    expect(last.durationMs).toBe(2800);
    // Total runtime lands in the 12-17s target band.
    const total = steps.reduce((ms, s) => ms + s.durationMs, 0);
    expect(total).toBeGreaterThanOrEqual(12_000);
    expect(total).toBeLessThanOrEqual(17_000);

    const moments = unexplainedMomentsSchema.parse(plan!.unexplainedMoments);
    expect(moments).toHaveLength(1);
    expect(moments[0]!.timestampMs).toBe(11_000);
  });

  it("plan_demo_steps runs on the light lane", () => {
    expect(HEAVY_JOB_TYPES).not.toContain("plan_demo_steps");
  });

  it("regenerating creates a NEW plan row — never mutates the old one", { timeout: 60_000 }, async () => {
    const { planId: second } = await requestDemoPlan(db, demoId);
    expect(second).not.toBe(planId);
    await drainAll();
    expect((await getStepPlan(db, second))?.status).toBe("ready");
    expect((await getStepPlan(db, planId))?.status).toBe("ready");
  });
});

describe("plan lifecycle: edit, approve, fork", () => {
  it("edits before approval mutate in place, re-sorted chronologically server-side", async () => {
    // Client sends the steps out of order with free-text labels.
    const updated = await updatePlanSteps(db, {
      planId,
      steps: [
        { sourceIndex: 11, label: "טקסט חופשי של המשתמש" },
        { sourceIndex: 1, label: "מילים שלא מופיעות במסך" },
      ],
    });
    expect(updated.id).toBe(planId); // same row
    expect(updated.approvedAt).toBeNull();
    const steps = planStepsSchema.parse(updated.steps);
    expect(steps.map((s) => s.sourceIndex)).toEqual([1, 11]); // re-sorted
    expect(steps[0]!.timestampMs).toBe(1500);
    expect(steps[0]!.actionType).toBe("navigate");
    expect(steps[0]!.durationMs).toBe(1800); // derived, not client-supplied
    expect(steps[1]!.durationMs).toBe(2800);
  });

  it("rejects duplicate, out-of-range and empty-label steps", async () => {
    await expect(
      updatePlanSteps(db, {
        planId,
        steps: [
          { sourceIndex: 1, label: "א" },
          { sourceIndex: 1, label: "ב" },
        ],
      }),
    ).rejects.toThrow(/appears twice/);
    await expect(
      updatePlanSteps(db, { planId, steps: [{ sourceIndex: 99, label: "א" }] }),
    ).rejects.toThrow(/not in the analysis timeline/);
    await expect(
      updatePlanSteps(db, { planId, steps: [{ sourceIndex: 1, label: "   " }] }),
    ).rejects.toThrow(/empty label/);
    await expect(updatePlanSteps(db, { planId, steps: [] })).rejects.toThrow(/at least one/);
    // State 9 of the canned timeline is unreadable — the server mirrors the
    // picker's filter regardless of who selected it.
    await expect(
      updatePlanSteps(db, { planId, steps: [{ sourceIndex: 9, label: "לא קריא" }] }),
    ).rejects.toThrow(/unreadable/);
  });

  it("approve is the gate; editing an approved plan forks a fresh unapproved row", async () => {
    const approved = await approvePlan(db, planId);
    expect(approved.approvedAt).not.toBeNull();
    // Idempotent re-approve.
    expect((await approvePlan(db, planId)).approvedAt).toEqual(approved.approvedAt);

    const fork = await updatePlanSteps(db, {
      planId,
      steps: [{ sourceIndex: 3, label: "גרסה חדשה" }],
    });
    expect(fork.id).not.toBe(planId);
    expect(fork.approvedAt).toBeNull();
    expect(planStepsSchema.parse(fork.steps).map((s) => s.sourceIndex)).toEqual([3]);

    // The approved original is untouched — renders that reference it keep
    // composing what the customer signed off on.
    const original = await getStepPlan(db, planId);
    expect(original?.approvedAt).not.toBeNull();
    expect(planStepsSchema.parse(original!.steps).map((s) => s.sourceIndex)).toEqual([1, 11]);
  });
});

describe("findPlanViolations (the anti-fabrication rule, deterministic)", () => {
  const timeline: AnalysisState[] = [
    state({ timestampMs: 0, visibleText: ["פרויקט חדש", "שמירה"] }),
    state({ timestampMs: 1000, visibleText: ["הקמפיין נוצר!"], actionType: "result" }),
    state({ timestampMs: 2000, visibleText: [], legibility: "unreadable" }),
  ];

  it("accepts labels lifted from the screen or the questionnaire", () => {
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "פרויקט חדש" },
          { sourceIndex: 1, label: "הקמפיין נוצר" }, // punctuation-insensitive
        ],
        timeline,
        QUESTIONNAIRE,
        8,
      ),
    ).toEqual([]);
    // Questionnaire words are allowed on any step.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "קמפיינר מהיר" }], timeline, QUESTIONNAIRE, 8),
    ).toEqual([]);
  });

  it("absorbs single-letter Hebrew prefixes on either side", () => {
    // Label adds a prefix the screen lacks...
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "בפרויקט" }], timeline, QUESTIONNAIRE, 8),
    ).toEqual([]);
    // ...and the screen carries a prefix the label lacks ("הקמפיין" -> "קמפיין").
    expect(
      findPlanViolations([{ sourceIndex: 1, label: "קמפיין" }], timeline, QUESTIONNAIRE, 8),
    ).toEqual([]);
  });

  it("absorbs prefixed function words instead of flagging them as fabricated", () => {
    // Hebrew glues ו/ש onto function words; "וגם"/"שכבר" must not cost a paid
    // corrective re-request.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "וגם שמירה" }], timeline, QUESTIONNAIRE, 8),
    ).toEqual([]);
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "שכבר שמירה" }], timeline, QUESTIONNAIRE, 8),
    ).toEqual([]);
  });

  it("shape rules: model plans must end on the result state and explain under-min counts", () => {
    // Ends mid-journey while a selectable result state exists -> violation.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "שמירה" }], timeline, QUESTIONNAIRE, 8, {
        minSteps: 1,
        notes: null,
      }).some((v) => v.includes("result/success")),
    ).toBe(true);
    // Ending on the result state passes.
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "שמירה" },
          { sourceIndex: 1, label: "נוצר" },
        ],
        timeline,
        QUESTIONNAIRE,
        8,
        { minSteps: 1, notes: null },
      ),
    ).toEqual([]);
    // No selectable result in the timeline -> the rule cannot apply.
    expect(
      findPlanViolations(
        [{ sourceIndex: 0, label: "שמירה" }],
        [state({ timestampMs: 0, visibleText: ["שמירה"] })],
        QUESTIONNAIRE,
        8,
        { minSteps: 1, notes: null },
      ),
    ).toEqual([]);
    // Under the minimum: silent -> violation; explained in notes -> allowed.
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "שמירה" },
          { sourceIndex: 1, label: "נוצר" },
        ],
        timeline,
        QUESTIONNAIRE,
        8,
        { minSteps: 6, notes: null },
      ).some((v) => v.includes("fewer than the minimum")),
    ).toBe(true);
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "שמירה" },
          { sourceIndex: 1, label: "נוצר" },
        ],
        timeline,
        QUESTIONNAIRE,
        8,
        { minSteps: 6, notes: "יש רק שני מסכים מובחנים" },
      ),
    ).toEqual([]);
  });

  it("allows function words but flags fabricated content words", () => {
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "רק פרויקט חדש" }], timeline, QUESTIONNAIRE, 8),
    ).toEqual([]);
    const violations = findPlanViolations(
      [{ sourceIndex: 0, label: "חוויה מדהימה" }],
      timeline,
      QUESTIONNAIRE,
      8,
    );
    expect(violations.some((v) => v.includes("חוויה"))).toBe(true);
    expect(violations.some((v) => v.includes("מדהימה"))).toBe(true);
  });

  it("flags structural violations: unreadable states, dups, range, word count, step count", () => {
    expect(
      findPlanViolations([{ sourceIndex: 2, label: "שמירה" }], timeline, QUESTIONNAIRE, 8).some(
        (v) => v.includes("unreadable"),
      ),
    ).toBe(true);
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "שמירה" },
          { sourceIndex: 0, label: "שמירה" },
        ],
        timeline,
        QUESTIONNAIRE,
        8,
      ).some((v) => v.includes("twice")),
    ).toBe(true);
    expect(
      findPlanViolations([{ sourceIndex: 9, label: "שמירה" }], timeline, QUESTIONNAIRE, 8).some(
        (v) => v.includes("not in the timeline"),
      ),
    ).toBe(true);
    expect(
      findPlanViolations(
        [{ sourceIndex: 0, label: "פרויקט חדש שמירה פרויקט חדש" }],
        timeline,
        QUESTIONNAIRE,
        8,
      ).some((v) => v.includes("over 4 words")),
    ).toBe(true);
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "שמירה" },
          { sourceIndex: 1, label: "נוצר" },
        ],
        timeline,
        QUESTIONNAIRE,
        1,
      ).some((v) => v.includes("maximum is 1")),
    ).toBe(true);
    expect(findPlanViolations([], timeline, QUESTIONNAIRE, 8)).toEqual(["the plan has zero steps"]);
  });
});

describe("plan regress (fixtures/timelines)", () => {
  it("runs green on the shipped fixture", { timeout: 60_000 }, async () => {
    const results = await runPlanRegression(db);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const shipped = results.find((r) => r.fixture === "dry-run-campaign-app.json");
    expect(shipped).toBeDefined();
    expect(shipped!.error).toBeUndefined();
    expect(shipped!.pass).toBe(true);
    for (const r of results) expect(r.pass).toBe(true);
  });
});
