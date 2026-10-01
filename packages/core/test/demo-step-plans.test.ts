import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { msToFrame, serviceAStepsTimeline } from "@aiugc/remotion/timing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordUsage } from "../src/budget";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { HEAVY_JOB_TYPES, runLane } from "../src/jobs/worker";
import {
  addDemoNote,
  createBusiness,
  MAX_DEMO_NOTES,
  requireQuestionnaire,
  setQuestionnaire,
  type Questionnaire,
} from "../src/pipelines/businesses";
import { getLatestDemoAnalysis, type AnalysisState } from "../src/pipelines/demo-analysis";
import {
  approvePlan,
  assembleSteps,
  clipBounds,
  findOffScreenWords,
  findPlanViolations,
  generateStepPlan,
  getStepPlan,
  isNewScreen,
  MIN_GAP_MS,
  normalizeWord,
  planStepsSchema,
  planTimingMarkdown,
  readTimeMs,
  recordingEndMs,
  screenEnds,
  splitWords,
  tokenizeWords,
  stepDurations,
  stepRuntimeBand,
  requestDemoPlan,
  runPlanRegression,
  timelineClipMs,
  totalRuntimeMs,
  unexplainedMomentsSchema,
  updatePlanSteps,
  type ClipBounds,
  type StepDurationConfig,
} from "../src/pipelines/demo-step-plans";
import { createDemo } from "../src/pipelines/demos";
import { FIXTURES_DIR, PROMPTS_DIR } from "../src/paths";
import { A_STEPS_MAX_DEFAULT, A_STEPS_MIN_DEFAULT } from "../src/plan-format";
import { latestPromptVersion, renderPrompt } from "../src/prompts";
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

/** The shipped clip cap and analysis sample — what stepDurations returns with
 *  no app_config rows (pinned in "step durations" below). */
const DURATIONS: StepDurationConfig = { maxMs: 4000, sampleMs: 200 };

/** Clip bounds over a recording that runs on `tailMs` past the last state —
 *  the cap by default, so no step in a shape test runs short for want of
 *  footage, only for the reason the test is about. */
function boundsOver(timeline: AnalysisState[], tailMs = DURATIONS.maxMs): ClipBounds {
  return clipBounds(DURATIONS, timeline, timeline[timeline.length - 1]!.timestampMs + tailMs);
}

interface TimelineFixture {
  timeline: AnalysisState[];
  recordingMs?: number;
  expected: { sourceIndexes: number[]; dryRunSourceIndexes?: number[] };
}

/** Every fixtures/timelines file, as `aiugc plan regress` reads them. */
const FIXTURE_FILES = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));

function loadFixture(file: string): TimelineFixture {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), "utf8")) as TimelineFixture;
}

/** A fixture's bounds exactly as generateStepPlan builds them. */
function fixtureBounds(fixture: TimelineFixture): ClipBounds {
  return clipBounds(DURATIONS, fixture.timeline, fixture.recordingMs);
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

    const steps = planStepsSchema.parse(plan!.steps);
    // The canned analysis holds each of its five product screens for a second
    // state (a duplicate, a typing, a scroll, an unreadable frame), and since
    // 0070 a step ends one sample after the last state on its screen. So the
    // happy path selects the five first states — home, the new-project form,
    // the template list, the editor, the success screen — each running to its
    // own screen's end: home to the duplicate at 4800ms, the form to the typing
    // at 8600ms, the templates to the scroll at 11600ms, the editor to its
    // unreadable frame at 14400ms, success to the 4s cap inside the stubbed 20s
    // recording.
    expect(steps.map((s) => s.sourceIndex)).toEqual([3, 5, 7, 9, 11]);
    expect(steps.map((s) => s.label)).toEqual([
      "הפרויקטים שלי",
      "פרויקט חדש",
      "בחרו תבנית",
      "שמירה",
      "הקמפיין נוצר",
    ]);
    expect(steps.map((s) => s.durationMs)).toEqual([2000, 2800, 2000, 1800, 4000]);
    expect(totalRuntimeMs(steps)).toBe(12_600);
    // No step runs into the next one's footage.
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i - 1]!.timestampMs + steps[i - 1]!.durationMs).toBeLessThanOrEqual(
        steps[i]!.timestampMs,
      );
    }
    // Five is the minimum, so there is no shortfall to explain.
    expect(plan?.notes).toBeNull();

    const moments = unexplainedMomentsSchema.parse(plan!.unexplainedMoments);
    expect(moments).toHaveLength(1);
    expect(moments[0]!.timestampMs).toBe(9800);
  });

  it(
    "the canned plan reaches the minimum when index-even thinning would not",
    { timeout: 60_000 },
    async () => {
      // subsampleClusters thins by INDEX, so a cluster of states close together
      // can spend most of the cap before the min-gap walk runs — and the
      // minimum-step waiver counts a forward greedy over the legal pool, sees
      // the states the thinning threw away, and refuses to forgive the
      // shortfall. generateStepPlan then threw "dry-run plan violates its own
      // rules" on the path the whole suite, `aiugc plan regress` keyless and a
      // DRY_RUN worker all run. Timestamps are on the analyser's real grid
      // (multiples of 200ms, never closer than 400ms), all one screen, on a
      // 15s recording so every state's clip is the full cap. At the 1.6s gap
      // the thinning keeps states 0, 2, 5 and 9 — four — while walking back
      // from the ending finds six (0, 2, 3, 5, 6, 9).
      const ts = [0, 1600, 2800, 4400, 5800, 7200, 8800, 9600, 10_000, 11_000];
      const words = ["אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע", "עשר"];
      const timeline = ts.map((t, i) =>
        state({
          timestampMs: t,
          visibleText: [words[i]!],
          actionType: i === ts.length - 1 ? "result" : "tap",
        }),
      );
      const draft = await generateStepPlan(db, {
        timeline,
        questionnaire: QUESTIONNAIRE,
        recordingMs: 15_000,
      });
      expect(draft.steps.length).toBeGreaterThanOrEqual(5);
      // The ending is the one state the format cannot lose.
      expect(draft.steps[draft.steps.length - 1]!.sourceIndex).toBe(ts.length - 1);
    },
  );

  it("the minimum counts only states the ending rule allows", { timeout: 60_000 }, async () => {
    // Real recordings keep rolling after the success screen, and a state after
    // it can never be a step — the last-step rule forbids it. Counting those
    // states as "selectable" demanded a plan the other rule rejects, which is
    // the other half of the keyless throw: the canned plan stops at the ending
    // and this walk did not. Here four states precede the success screen and
    // four follow it, against a minimum of five. The recording runs 4s past
    // the last state so all four after it are long enough to caption.
    const ts = [0, 3200, 6400, 20_000, 25_000, 26_600, 28_200, 29_800];
    const words = ["אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה"];
    const timeline = ts.map((t, i) =>
      state({
        timestampMs: t,
        visibleText: [words[i]!],
        actionType: i === 3 ? "result" : "tap",
      }),
    );
    const draft = await generateStepPlan(db, {
      timeline,
      questionnaire: QUESTIONNAIRE,
      recordingMs: 33_800,
    });
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 3]);
  });

  it("plan_demo_steps runs on the light lane", () => {
    expect(HEAVY_JOB_TYPES).not.toContain("plan_demo_steps");
  });

  it(
    "regenerating creates a NEW plan row — never mutates the old one",
    { timeout: 60_000 },
    async () => {
      const { planId: second } = await requestDemoPlan(db, demoId);
      expect(second).not.toBe(planId);
      await drainAll();
      expect((await getStepPlan(db, second))?.status).toBe("ready");
      expect((await getStepPlan(db, planId))?.status).toBe("ready");
    },
  );

  it(
    "a regenerate while one is still generating collapses onto the live job",
    { timeout: 60_000 },
    async () => {
      // Every press must not be a fresh paid enqueue: the route's budget gate
      // reads usage that lags the queue, so uncollapsed presses outrun it.
      const first = await requestDemoPlan(db, demoId);
      const second = await requestDemoPlan(db, demoId);
      expect(second.planId).toBe(first.planId);
      expect(second.jobId).toBe(first.jobId);
      await drainAll();
      expect((await getStepPlan(db, first.planId))?.status).toBe("ready");
    },
  );

  it(
    "the job-level account-cap backstop fails a queued plan fast, in Hebrew",
    { timeout: 60_000 },
    async () => {
      // A customer (not admin-bypassed) account at its 0027 llm_tokens ceiling:
      // the queued job must die as a fast PermanentError — never park, never
      // spend — even though it was enqueued before the cap was hit.
      const customer = await createBusiness(db, {
        ownerEmail: "capped@example.com",
        name: "עסק שמור",
      });
      await setQuestionnaire(db, customer.id, QUESTIONNAIRE);
      const demo = await createDemo(db, {
        businessId: customer.id,
        filePath: tempFile("capped.mp4"),
      });
      await drainAll(); // ingest -> analysis ready

      await recordUsage(db, {
        provider: "anthropic",
        kind: "llm_tokens",
        // Exactly the per-account cap: 0027 seeded 1_500_000, 0036 tightened it
        // to 500_000. Burning the cap exactly is the point — it proves the
        // queued-job backstop, so it moves with the cap.
        quantity: 500_000,
        businessId: customer.id,
      });

      const { planId: cappedPlanId } = await requestDemoPlan(db, demo.id);
      await drainAll();
      const plan = await getStepPlan(db, cappedPlanId);
      expect(plan?.status).toBe("failed");
      expect(plan?.failReason).toMatch(/מכסת/);
    },
  );
});

describe("plan lifecycle: edit, approve, fork", () => {
  it("edits before approval mutate in place, re-sorted chronologically server-side", async () => {
    // Client sends the steps out of order with free-text labels. sourceIndex 1
    // is a login state — human edits deliberately bypass the model's skip rule.
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
    expect(steps[0]!.timestampMs).toBe(1000);
    expect(steps[0]!.actionType).toBe("navigate");
    // Derived, not client-supplied — and from the screens, not the labels.
    // 1000ms -> 16000ms is a wide gap, so neither step is cut by the other:
    // state 1's login screen holds through the typing at 2000ms and the app
    // navigates home at 3000ms, so it runs to 2000 + 200; the success screen
    // runs the 4s cap, inside the stubbed 20s recording. Step 0 is not padded
    // for its label (its four words would ask 2000ms).
    expect(steps[0]!.durationMs).toBe(1200);
    expect(steps[1]!.durationMs).toBe(4000);
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
    // State 10 of the canned timeline is unreadable — the server mirrors the
    // picker's filter regardless of who selected it.
    await expect(
      updatePlanSteps(db, { planId, steps: [{ sourceIndex: 10, label: "לא קריא" }] }),
    ).rejects.toThrow(/unreadable/);
  });

  it("a human's too-close pair is accepted and stored short, never rewound", async () => {
    // updatePlanSteps has no violation channel and no retry: whatever the
    // customer ticked in the picker is what renders. Two states 400ms apart
    // are a VIOLATION on the model path (below) and a 400ms clip here.
    const tight = await createDemo(db, { businessId, filePath: tempFile("tight.mp4") });
    await drainAll(); // ingest -> analysis ready
    const analysis = (await getLatestDemoAnalysis(db, tight.id))!;
    await db
      .update(dbSchema.demoAnalyses)
      .set({
        timeline: [
          state({ timestampMs: 0, visibleText: ["אחת"], actionType: "tap" }),
          state({ timestampMs: 400, visibleText: ["סוף"], actionType: "result" }),
        ],
      })
      .where(eq(dbSchema.demoAnalyses.id, analysis.id));
    const inserted = await db
      .insert(dbSchema.demoStepPlans)
      .values({ demoId: tight.id, analysisId: analysis.id, status: "ready", steps: [] })
      .returning();

    const updated = await updatePlanSteps(db, {
      planId: inserted[0]!.id,
      steps: [
        { sourceIndex: 0, label: "אחת" },
        { sourceIndex: 1, label: "סוף" },
      ],
    });
    const steps = planStepsSchema.parse(updated.steps);
    expect(steps[0]!.durationMs).toBe(400);
    expect(steps[0]!.timestampMs + steps[0]!.durationMs).toBe(steps[1]!.timestampMs);
  });

  it("marks are carried by sourceIndex, not by position — a deleted step moves nobody's", async () => {
    // The rule (decision 0049): a step whose label is still the model's keeps
    // the row's marks; a changed or added one gets []. The KEY is sourceIndex.
    // plan-retry-contract.test.ts covers the edit-one-label case, but its
    // fixture gives only one step a non-empty mark, so a position-keyed
    // implementation passes it byte-identically. Here three steps carry three
    // DIFFERENT marks and the middle one is deleted: positions shift under the
    // survivors, so position keying drops step 3's mark and this test goes red.
    const demo = await createDemo(db, { businessId, filePath: tempFile("marks.mp4") });
    await drainAll(); // ingest -> analysis ready
    const analysis = (await getLatestDemoAnalysis(db, demo.id))!;
    await db
      .update(dbSchema.demoAnalyses)
      .set({
        timeline: [
          state({ timestampMs: 0, visibleText: ["אפס"], actionType: "navigate" }),
          state({ timestampMs: 3000, visibleText: ["אחת"], actionType: "tap" }),
          state({ timestampMs: 6000, visibleText: ["שתיים"], actionType: "type" }),
          state({ timestampMs: 9000, visibleText: ["סוף"], actionType: "result" }),
        ],
      })
      .where(eq(dbSchema.demoAnalyses.id, analysis.id));
    const inserted = await db
      .insert(dbSchema.demoStepPlans)
      .values({
        demoId: demo.id,
        analysisId: analysis.id,
        status: "ready",
        steps: [
          {
            sourceIndex: 1,
            label: "כיתוב ראשון",
            timestampMs: 3000,
            actionType: "tap",
            durationMs: 3000,
            offScreenWords: ["ראשון"],
          },
          {
            sourceIndex: 2,
            label: "כיתוב אמצעי",
            timestampMs: 6000,
            actionType: "type",
            durationMs: 3000,
            offScreenWords: ["אמצעי"],
          },
          {
            sourceIndex: 3,
            label: "כיתוב אחרון",
            timestampMs: 9000,
            actionType: "result",
            durationMs: 3000,
            offScreenWords: ["אחרון"],
          },
        ],
      })
      .returning();
    const marks = (steps: unknown) =>
      planStepsSchema.parse(steps).map((s) => [s.sourceIndex, s.offScreenWords]);

    // Delete the middle step; 1 and 3 are untouched and keep THEIR OWN marks.
    const afterDelete = await updatePlanSteps(db, {
      planId: inserted[0]!.id,
      steps: [
        { sourceIndex: 1, label: "כיתוב ראשון" },
        { sourceIndex: 3, label: "כיתוב אחרון" },
      ],
    });
    expect(marks(afterDelete.steps)).toEqual([
      [1, ["ראשון"]],
      [3, ["אחרון"]],
    ]);

    // Now rewrite step 3's label: its marks are the customer's problem no
    // longer, step 1's are untouched.
    const afterEdit = await updatePlanSteps(db, {
      planId: inserted[0]!.id,
      steps: [
        { sourceIndex: 1, label: "כיתוב ראשון" },
        { sourceIndex: 3, label: "כיתוב אחר לגמרי" },
      ],
    });
    expect(marks(afterEdit.steps)).toEqual([
      [1, ["ראשון"]],
      [3, []],
    ]);
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

describe("findPlanViolations (the plan-shape rules, deterministic)", () => {
  // Label provenance moved out to findOffScreenWords (decision 0049) — the
  // describe below carries those tests. 2s apart: these fixtures stand for
  // VALID plans, and two states closer together than the shortest caption's
  // read time are a violation in their own right. Every timeline here is one
  // screen on a recording that runs on past it (boundsOver), so every clip is
  // the full cap and none of these rules trips over a short one.
  const timeline: AnalysisState[] = [
    state({ timestampMs: 0, visibleText: ["פרויקט חדש", "שמירה"] }),
    state({ timestampMs: 2000, visibleText: ["הקמפיין נוצר!"], actionType: "result" }),
    state({ timestampMs: 4000, visibleText: [], legibility: "unreadable" }),
  ];
  const bounds = boundsOver(timeline);

  it("shape rules: model plans must end on the result state and explain under-min counts", () => {
    // Ends mid-journey while a selectable result state exists -> violation.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "שמירה" }], timeline, 8, {
        minSteps: 1,
        notes: null,
        bounds,
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
        8,
        { minSteps: 1, notes: null, bounds },
      ),
    ).toEqual([]);
    // Ends mid-journey but `notes` explains (the timeline's only "result"
    // states may be mistyped error screens) -> the notes waive the rule.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "שמירה" }], timeline, 8, {
        minSteps: 1,
        notes: "אין בהקלטה מסך סיום ברור",
        bounds,
      }),
    ).toEqual([]);
    // No selectable result in the timeline -> the rule cannot apply.
    const noResult = [state({ timestampMs: 0, visibleText: ["שמירה"] })];
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "שמירה" }], noResult, 8, {
        minSteps: 1,
        notes: null,
        bounds: boundsOver(noResult),
      }),
    ).toEqual([]);
    // Under the minimum on a timeline that could carry more -> violation...
    const roomy: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["אחת"] }),
      state({ timestampMs: 2000, visibleText: ["שתיים"] }),
      state({ timestampMs: 4000, visibleText: ["שלוש"] }),
      state({ timestampMs: 6000, visibleText: ["ארבע"] }),
      state({ timestampMs: 8000, visibleText: ["חמש"], actionType: "result" }),
    ];
    const short = [
      { sourceIndex: 0, label: "אחת" },
      { sourceIndex: 4, label: "חמש" },
    ];
    expect(
      findPlanViolations(short, roomy, 8, {
        minSteps: 5,
        notes: null,
        bounds: boundsOver(roomy),
      }).some((v) => v.includes("fewer than the minimum")),
    ).toBe(true);
    // ...and `notes` does NOT waive it any more. That hatch belongs to the
    // last-step rule alone; waiving both is how a 5-step plan with a
    // 26-second hole in the middle passed.
    expect(
      findPlanViolations(short, roomy, 8, {
        minSteps: 5,
        notes: "בסרטון אין יותר צעדים",
        bounds: boundsOver(roomy),
      }).some((v) => v.includes("fewer than the minimum")),
    ).toBe(true);
    // The waiver is the timeline itself: two selectable states cannot make 6,
    // whatever the model writes in `notes`.
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "שמירה" },
          { sourceIndex: 1, label: "נוצר" },
        ],
        timeline,
        8,
        { minSteps: 6, notes: null, bounds },
      ),
    ).toEqual([]);
  });

  it("the min-step waiver counts SPACING, not just legal states", () => {
    // Five legal states, but the last two sit 400ms apart: the min-gap rule
    // means at most four can ever be steps, so a 4-step plan is the longest
    // plan this timeline has and must not be flagged.
    const bunched: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["אחת"] }),
      state({ timestampMs: 2000, visibleText: ["שתיים"] }),
      state({ timestampMs: 4000, visibleText: ["שלוש"] }),
      state({ timestampMs: 6000, visibleText: ["ארבע"] }),
      state({ timestampMs: 6400, visibleText: ["חמש"], actionType: "result" }),
    ];
    const four = [
      { sourceIndex: 0, label: "אחת" },
      { sourceIndex: 1, label: "שתיים" },
      { sourceIndex: 2, label: "שלוש" },
      { sourceIndex: 4, label: "חמש" },
    ];
    expect(
      findPlanViolations(four, bunched, 8, {
        minSteps: 5,
        notes: null,
        bounds: boundsOver(bunched),
      }),
    ).toEqual([]);
    // Space that pair out and the same 4-step plan IS a violation.
    const spread = bunched.map((s, i) => (i === 4 ? state({ ...s, timestampMs: 8000 }) : s));
    expect(
      findPlanViolations(
        four.map((s) => (s.sourceIndex === 4 ? { ...s } : s)),
        spread,
        8,
        { minSteps: 5, notes: null, bounds: boundsOver(spread) },
      ).some((v) => v.includes("fewer than the minimum")),
    ).toBe(true);
  });

  it("names the success candidates when the plan continues past the result state (real a179f069)", () => {
    // The a179f069 shape: the recording keeps going after the success moment,
    // and the model selects steps from the unfinished second journey. The
    // violation must name the candidate indexes and licence dropping the
    // trailing steps — the one corrective retry has no other way to know the
    // mechanical fix. Two candidates on purpose: the real timeline has two,
    // and a message naming only one would steer the retry blind.
    const continues: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["התחלה"] }),
      state({ timestampMs: 2000, visibleText: ["הושלם"], actionType: "result" }),
      state({ timestampMs: 4000, visibleText: ["המשך"] }),
      state({ timestampMs: 6000, visibleText: ["נשמר"], actionType: "result" }),
    ];
    const violations = findPlanViolations(
      [
        { sourceIndex: 0, label: "התחלה" },
        { sourceIndex: 1, label: "הושלם" },
        { sourceIndex: 2, label: "המשך" },
      ],
      continues,
      8,
      { minSteps: 6, notes: null, bounds: boundsOver(continues) },
    );
    const shapeViolation = violations.find((v) => v.includes("result/success"));
    expect(shapeViolation).toBeDefined();
    // Names every candidate to end on, and the minimum the drop must respect.
    expect(shapeViolation).toContain("sourceIndex 1, 3");
    expect(shapeViolation).toContain("drop every step after it");
    expect(shapeViolation).toContain("fewer than 6 steps");
    // The shortfall path is no longer notes (notes stopped waiving the
    // minimum), so the message routes to adding states — and has to say in the
    // same breath what may not be added: "select additional states" on its own
    // made a live retry pad with a loading screen, an unfixable fresh
    // violation with no third call. Pin both halves.
    expect(shapeViolation).toContain("select additional distinct product states");
    expect(shapeViolation).toContain("never pad with loading, duplicate or otherwise skipped");
  });

  it("flags skip-kind screens for the model, treats absent screenKind as no information", () => {
    const kinds: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["התחברות"], screenKind: "login" }),
      state({ timestampMs: 1000, visibleText: ["דף הבית"], screenKind: "product" }),
      state({
        timestampMs: 2000,
        visibleText: ["שגיאה"],
        actionType: "result",
        screenKind: "error",
      }),
      state({ timestampMs: 3000, visibleText: ["נשמר"] }), // v2-era: no screenKind
    ];
    // Login screens are never steps for the model.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "התחברות" }], kinds, 8).some((v) =>
        v.includes('"login"'),
      ),
    ).toBe(true);
    // product and absent screenKind both pass.
    expect(findPlanViolations([{ sourceIndex: 1, label: "דף הבית" }], kinds, 8)).toEqual([]);
    expect(findPlanViolations([{ sourceIndex: 3, label: "נשמר" }], kinds, 8)).toEqual([]);
    // The only "result" is an error screen the analysis mistyped — the shape
    // rule must not force the plan to end on a state it may never select.
    expect(
      findPlanViolations([{ sourceIndex: 1, label: "דף הבית" }], kinds, 8, {
        minSteps: 1,
        notes: null,
        bounds: boundsOver(kinds),
      }),
    ).toEqual([]);
  });

  it("flags structural violations: unreadable states, dups, range, word count, step count", () => {
    expect(
      findPlanViolations([{ sourceIndex: 2, label: "שמירה" }], timeline, 8).some((v) =>
        v.includes("unreadable"),
      ),
    ).toBe(true);
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "שמירה" },
          { sourceIndex: 0, label: "שמירה" },
        ],
        timeline,
        8,
      ).some((v) => v.includes("twice")),
    ).toBe(true);
    expect(
      findPlanViolations([{ sourceIndex: 9, label: "שמירה" }], timeline, 8).some((v) =>
        v.includes("not in the timeline"),
      ),
    ).toBe(true);
    // Six is the ceiling: five passes, seven does not.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "פרויקט חדש שמירה פרויקט חדש" }], timeline, 8),
    ).toEqual([]);
    expect(
      findPlanViolations(
        [{ sourceIndex: 0, label: "פרויקט חדש שמירה פרויקט חדש שמירה פרויקט" }],
        timeline,
        8,
      ).some((v) => v.includes("over 6 words")),
    ).toBe(true);
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "שמירה" },
          { sourceIndex: 1, label: "נוצר" },
        ],
        timeline,
        1,
      ).some((v) => v.includes("maximum is 1")),
    ).toBe(true);
    expect(findPlanViolations([], timeline, 8)).toEqual(["the plan has zero steps"]);
  });
});

describe("findOffScreenWords (the provenance highlight, deterministic)", () => {
  // The rule that used to fail plans (decision 0049): same tokenization, same
  // dup-run pooling, same three exemptions — it now returns the words instead
  // of violation strings, and generateStepPlan stores them on each step for
  // the editor to mark. Every test here is the gate's test ported one for one:
  // same inputs, same words; "rejects" became "flags".
  const timeline: AnalysisState[] = [
    state({ timestampMs: 0, visibleText: ["פרויקט חדש", "שמירה"] }),
    state({ timestampMs: 2000, visibleText: ["הקמפיין נוצר!"], actionType: "result" }),
    state({ timestampMs: 4000, visibleText: [], legibility: "unreadable" }),
  ];
  /** The flagged words of a one-step plan. */
  const flagged = (
    label: string,
    opts: {
      sourceIndex?: number;
      timeline?: AnalysisState[];
      questionnaire?: Questionnaire;
      description?: string | null;
    } = {},
  ): string[] =>
    findOffScreenWords(
      [{ sourceIndex: opts.sourceIndex ?? 0, label }],
      opts.timeline ?? timeline,
      opts.questionnaire ?? QUESTIONNAIRE,
      opts.description,
    )[0]!.words;

  it("returns one entry per step, in order, carrying the sourceIndex", () => {
    expect(
      findOffScreenWords(
        [
          { sourceIndex: 0, label: "פרויקט חדש" },
          { sourceIndex: 1, label: "הקמפיין נוצר" }, // punctuation-insensitive
        ],
        timeline,
        QUESTIONNAIRE,
      ),
    ).toEqual([
      { index: 0, sourceIndex: 0, words: [] },
      { index: 1, sourceIndex: 1, words: [] },
    ]);
  });

  it("passes labels lifted from the screen or the questionnaire", () => {
    expect(flagged("פרויקט חדש")).toEqual([]);
    expect(flagged("הקמפיין נוצר", { sourceIndex: 1 })).toEqual([]);
    // Questionnaire words pass on any step.
    expect(flagged("קמפיינר מהיר")).toEqual([]);
  });

  it("absorbs single-letter Hebrew prefixes on either side", () => {
    // Label adds a prefix the screen lacks...
    expect(flagged("בפרויקט")).toEqual([]);
    // ...and the screen carries a prefix the label lacks ("הקמפיין" -> "קמפיין").
    expect(flagged("קמפיין", { sourceIndex: 1 })).toEqual([]);
  });

  it("absorbs prefixed function words instead of marking them", () => {
    // Hebrew glues ו/ש onto function words; "וגם"/"שכבר" would be noise.
    expect(flagged("וגם שמירה")).toEqual([]);
    expect(flagged("שכבר שמירה")).toEqual([]);
  });

  it("demo-description words pass — the upload note widens the vocabulary", () => {
    // "קופון" is on no screen and in no questionnaire field; only the
    // customer's own note carries it — the same customer-authored-claims
    // principle as demo_notes, wired per-demo instead of per-business.
    expect(flagged("קופון הנחה", { description: "מזינים קופון הנחה בקופה" })).toEqual([]);
    // Absent everywhere -> marked. The description weakens the rule by
    // exactly its own words, nothing more.
    expect(flagged("קופון הנחה")).toEqual(["קופון", "הנחה"]);
    // Blank and null are the no-description case, not a wildcard.
    expect(flagged("קופון הנחה", { description: "   " })).toEqual(["קופון", "הנחה"]);
    expect(flagged("קופון הנחה", { description: null })).toEqual(["קופון", "הנחה"]);
  });

  it("pools visibleText across a sameStateAsPrevious run (real BotTeacher state 36)", () => {
    // Exact strings from demo ba70c3d7 / analysis 6a1b247e: the anchor frame's
    // OCR clipped "נשלים" to "נשלי"; the dup frames of the SAME screen read it
    // fully. The label must match against the whole run, not the anchor alone.
    const run: AnalysisState[] = [
      state({
        timestampMs: 54_600,
        visibleText: [
          "עוד רגע לפני שמתחילים – בואו נשלי",
          "הפרטים האקדמיים קובעים איך נתאים לך את המערכת. אפשר לשנות ב",
          "Mohamed Taha",
          "סוג תואר",
        ],
        actionType: "navigate",
      }),
      state({
        timestampMs: 55_600,
        visibleText: ["עוד רגע לפני שמתחילים – בואו נשלים פרט"],
        sameStateAsPrevious: true,
        legibility: "low",
        actionType: "idle",
      }),
      state({
        timestampMs: 56_800,
        visibleText: ["רגע לפני שמתחילים – בואו נשלים פרטים"],
        sameStateAsPrevious: true,
        legibility: "low",
        actionType: "idle",
      }),
    ];
    // The word the anchor clipped, found on the dups: nothing marked.
    expect(flagged("בואו נשלים", { timeline: run })).toEqual([]);
    // A word absent from the entire run is still marked — pooling adds no slack.
    expect(flagged("חוויה", { timeline: run })).toEqual(["חוויה"]);
  });

  it("keeps the מלאה true positive (real BotTeacher state 72)", () => {
    // State 72's run is itself alone; the screen says "מבחן מלא", never "מלאה".
    const tourState = state({
      timestampMs: 109_800,
      visibleText: [
        "boteacher",
        "BRONZE · עוזר אקדמי אישי",
        "6/11",
        "מכונת המבחנים",
        "סימולציה של מבחן מלא על חומר הקורס, עם ציון בסוף – כדי",
        "שתגיע למבחן האמיתי בלי חן",
        "המשך",
        "חזור",
        "דלג על הכל",
      ],
      actionType: "navigate",
    });
    expect(flagged("סימולציה מלאה", { timeline: [tourState] })).toEqual(["מלאה"]);
    // Words genuinely on that screen pass, including across the · separator.
    expect(flagged("מכונת המבחנים", { timeline: [tourState] })).toEqual([]);
  });

  it("normalizes gershayim, glued separators and niqqud on both sides", () => {
    const noisy: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ['הלו"ז שלי', "BRONZE·עוזר אקדמי", "שָׁלוֹם"] }),
    ];
    // Hebrew gershayim (U+05F4) in the label vs ASCII quote on screen.
    expect(flagged("לו״ז", { timeline: noisy })).toEqual([]);
    // The OCR glued a · onto the word; whitespace splitting left it stuck.
    expect(flagged("עוזר", { timeline: noisy })).toEqual([]);
    // Screen carries niqqud, the label does not.
    expect(flagged("שלום", { timeline: noisy })).toEqual([]);
  });

  it("words from demo_notes pass — an explained moment becomes copy", () => {
    // Not on state 0's screen and not elsewhere in the questionnaire...
    expect(flagged("תבניות מוכנות")).toEqual(["תבניות", "מוכנות"]);
    // ...but once the customer's answer carries them, nothing is marked.
    const explained = { ...QUESTIONNAIRE, demo_notes: ["מסך בחירת תבניות מוכנות"] };
    expect(flagged("תבניות מוכנות", { questionnaire: explained })).toEqual([]);
  });

  it("never marks instruction verbs — a caption tells you what to DO (real a179f069 state 1)", () => {
    // Verbatim visibleText from the shipped analysis. The opening caption the
    // format wants is "go to boteacher.com": "boteacher" off the screen, "כנסו"
    // off the instruction allowlist.
    const home = state({
      timestampMs: 2800,
      visibleText: [
        "Create /",
        "Higgsfe",
        "https://boteacher.com",
        "Ask about this page",
        "Apps",
        "boteacher",
        "שבוע",
        "יום",
        "היום",
        "מרחב לנשום",
      ],
      actionType: "navigate",
      legibility: "low",
    });
    expect(flagged("כנסו לboteacher", { timeline: [home] })).toEqual([]);
    // Prefixed forms are not marked either — Hebrew glues ו onto verbs too.
    expect(flagged("ולחצו boteacher", { timeline: [home] })).toEqual([]);
    // A verb that is NOT on the list is marked: the allowlist is a list, not
    // a morphology rule.
    expect(flagged("הורידו boteacher", { timeline: [home] })).toEqual(["הורידו"]);
  });

  it("never marks pronouns addressed to the viewer", () => {
    expect(flagged("שמירה שלכם")).toEqual([]);
    expect(flagged("הוא נוצר", { sourceIndex: 1 })).toEqual([]);
  });

  it("still flags a product claim absent from the screen and the questionnaire", () => {
    // The rule loosens for instructions and must NOT loosen for claims:
    // "automatically" is a promise about the product, and a promise the
    // recording does not show belongs in the questionnaire — a caption that
    // invents it is exactly what the customer has to see marked.
    const bare: Questionnaire = { ...QUESTIONNAIRE, what_it_does: "יוצר קמפיינים" };
    expect(flagged("שמירה אוטומטית", { questionnaire: bare })).toEqual(["אוטומטית"]);
    // No root or morphology matching either: the questionnaire saying
    // "אוטומטי" does not license "אוטומטית".
    expect(
      flagged("שמירה אוטומטית", {
        questionnaire: { ...bare, what_it_does: "יוצר קמפיינים אוטומטי" },
      }),
    ).toEqual(["אוטומטית"]);
  });

  it("passes function words but flags fabricated content words", () => {
    expect(flagged("רק פרויקט חדש")).toEqual([]);
    expect(flagged("חוויה מדהימה")).toEqual(["חוויה", "מדהימה"]);
  });

  it("the confirm step can be an instruction instead of the button's own label", () => {
    // The real a179f069 confirm dialog. Before אשרו/אישרו were allowlisted,
    // EVERY instruction form was rejected here and reading the button label
    // back ("אישר ניתוב לחומר קורס") was the only caption that passed — the
    // validator forced the transcription the prompt forbids.
    const confirm = [
      state({
        timestampMs: 0,
        actionType: "select",
        visibleText: [
          "Takin Syllabus.txt",
          "זוהה סילבוס",
          "יעד ניתוב",
          "חומר קורס",
          "אישר ניתוב (1)",
        ],
      }),
    ];
    const ok = (label: string) => flagged(label, { timeline: confirm }).length === 0;
    expect(ok("אשרו את הניתוב")).toBe(true);
    expect(ok("אישרו את הניתוב")).toBe(true);
    // ה-prefixed forms need no entries of their own: unlike "היכנסו", which
    // halts prefix-stripping at the yod, these strip straight to the base.
    expect(ok("האשרו את הניתוב")).toBe(true);
    expect(ok("ואשרו את היעד")).toBe(true);
    expect(ok("התחילו ניתוב")).toBe(true);
    // במקום closed the file-routing fixture; שלו/שלה closed the pronoun set,
    // which passed "שלהם" by double-stripping while rejecting the singular.
    expect(ok("במקום זה")).toBe(true);
    expect(ok("שלו")).toBe(true);
    expect(ok("שלה")).toBe(true);
  });

  it("prepositions and narration verbs are never marked", () => {
    // "לפי" failed a live plan three rounds running (2026-09-14/15, docs/vault/
    // facts/label-rule-families-2026-09-15.md): a bare preposition carries no
    // product claim. This timeline shows neither it nor the QUESTIONNAIRE
    // (which has "בלי", deliberately not used here).
    expect(flagged("שמירה לפי פרויקט")).toEqual([]);
    // Glued ו, exactly like the other function words.
    expect(flagged("ולפי פרויקט")).toEqual([]);
    // The present-tense plural of a listed imperative narrates the screen the
    // way a friend does ("ממלאים" for "מלאו") and is exempt the same way.
    expect(flagged("ממלאים פרויקט חדש")).toEqual([]);
    // The verbs the census found off-screen whose imperatives are NOT listed
    // stay marked — the list is a list, not a morphology rule.
    expect(flagged("מצאו פרויקט")).toEqual(["מצאו"]);
    // A content word absent from the screen, the questionnaire and the
    // description is marked; the additions widen nothing else.
    expect(flagged("הפרטים של פרויקט")).toEqual(["הפרטים"]);
  });

  it("a verb of understanding is a claim — בין is not a function word, דרך is", () => {
    // "בין" was a member for one commit (a4c1339) and came back off: it
    // admits "הבין"/"מבין" by prefix-stripping, and a claim that the product
    // UNDERSTOOD something is exactly the class this highlight exists for.
    expect(flagged("הבין שמירה")).toEqual(["הבין"]);
    expect(flagged("מבין פרויקט")).toEqual(["מבין"]);
    // The price of that: the genuine preposition is marked too, which under
    // decision 0049 is an amber mark and not a rejection.
    expect(flagged("בין שמירה לפרויקט")).toEqual(["בין"]);
    // "דרך" stays — "הדרך"/"בדרך" say how something is done, never what the
    // product can do, so neither needs the screen to back it.
    expect(flagged("שמירה דרך פרויקט")).toEqual([]);
    expect(flagged("הדרך לפרויקט")).toEqual([]);
  });

  it("morphology is still not matched — a claim and a plural stay flagged", () => {
    // Deliberate, and measured rather than papered over: "הקמפיין" is the
    // questionnaire's own noun in the definite singular and it still fails
    // against "קמפיינים", which is what keeps dry-run-campaign-app red.
    const screen = [state({ timestampMs: 0, visibleText: ["שמירה"] })];
    expect(flagged("הקמפיין נוצר", { timeline: screen })).toContain("הקמפיין");
    // A benefit the customer never claimed stays marked. ("אוטומטית" would
    // pass here — it is in this questionnaire's what_it_does, which is the
    // rule working, not failing.)
    expect(flagged("בחינם", { timeline: screen })).toEqual(["בחינם"]);
  });

  it("returns the label's own tokens as written, so the editor can match them exactly", () => {
    // Normalization is for MATCHING only: the stored word keeps the label's
    // spelling and case, and edge punctuation is a separator, never part of
    // the word — the editor splits the same way (splitWords) and marks by
    // string equality.
    expect(flagged("חוויה, מדהימה!")).toEqual(["חוויה", "מדהימה"]);
    expect(flagged("Amazing שמירה")).toEqual(["Amazing"]);
    expect(splitWords("חוויה, מדהימה!")).toEqual(["חוויה", "מדהימה"]);
    expect(tokenizeWords("Amazing, לו״ז")).toEqual(["amazing", 'לו"ז']);
    expect(normalizeWord("שָׁלוֹם!")).toBe("שלום");
  });

  it("does not throw on a sourceIndex outside the timeline — the shape rule owns that", () => {
    expect(
      findOffScreenWords([{ sourceIndex: 9, label: "שמירה" }], timeline, QUESTIONNAIRE),
    ).toEqual([{ index: 0, sourceIndex: 9, words: ["שמירה"] }]);
  });
});

describe("the runtime band (steps only — the hook sits on top)", () => {
  /** The shipped band, as a literal (stepRuntimeBand pins the config path). */
  const band = { minMs: 15_000, maxMs: 21_000 };
  /** Six states 3s apart on one screen, ending on a result, on a recording
   *  that runs 4s past it: every step runs the 3s gap to the next selected
   *  state, the last one the 4s cap. Room for any plan shape. */
  const wide: AnalysisState[] = [
    state({ timestampMs: 0, visibleText: ["אחת"], actionType: "navigate" }),
    state({ timestampMs: 3000, visibleText: ["שתיים"], actionType: "tap" }),
    state({ timestampMs: 6000, visibleText: ["שלוש"], actionType: "type" }),
    state({ timestampMs: 9000, visibleText: ["ארבע"], actionType: "select" }),
    state({ timestampMs: 12_000, visibleText: ["חמש"], actionType: "scroll" }),
    state({ timestampMs: 15_000, visibleText: ["שש"], actionType: "result" }),
  ];
  const wideBounds = boundsOver(wide);
  const pick = (...i: number[]) =>
    i.map((n) => ({ sourceIndex: n, label: wide[n]!.visibleText[0]! }));
  const shape = (steps: { sourceIndex: number; label: string }[]) =>
    findPlanViolations(steps, wide, 8, {
      minSteps: 1,
      notes: null,
      bounds: wideBounds,
      runtime: band,
    });

  it("flags a plan that is too short, and says which way to move", () => {
    // 3000 (cut by state 1) + 4000 + 4000 (the cap) = 11000ms.
    const v = shape(pick(0, 1, 5)).find((x) => x.includes("total"));
    expect(v).toContain("11000ms");
    expect(v).toContain("too SHORT by 4000ms");
    expect(v).toContain("15000-21000ms");
    // What each step runs, so the retry does not have to redo the clip
    // arithmetic it just got wrong.
    expect(v).toContain("state 0 runs 3000ms, state 1 runs 4000ms, state 5 runs 4000ms");
    // The retry prompt orders MINIMAL edits and every untouched step kept; a
    // live v4 retry read that as "do not add" and handed back the same short
    // plan with a note suggesting the very fix it would not make. So this
    // message has to licence the addition — and bound it, because the one
    // time a retry was told plainly to add states it padded with a loading
    // screen.
    expect(v).toContain("ADD one or two more distinct product states");
    expect(v).toContain("never add a loading, duplicate or otherwise skipped state");
  });

  it("flags a plan that is too long", () => {
    // Every state selected runs 5 x 3000 + 4000 = 19000ms, inside the shipped
    // band — so squeeze the band instead; the rule is the comparison, not the
    // constant.
    const v = findPlanViolations(pick(0, 1, 2, 3, 4, 5), wide, 8, {
      minSteps: 1,
      notes: null,
      bounds: wideBounds,
      runtime: { ...band, maxMs: 18_000 },
    }).find((x) => x.includes("total"));
    expect(v).toContain("19000ms");
    // Live (plan bd0913b4, 2026-10-01): the last retry swapped a 1.2s step
    // for a 4.0s one and landed 600ms over; the overshoot is spelled out.
    expect(v).toContain("too LONG by 1000ms");
    expect(v).toContain("state 5 runs 4000ms");
  });

  it("is silent inside the band, and absent when no band is supplied", () => {
    // 5 x 3000 + 4000 = 19000ms.
    expect(shape(pick(0, 1, 2, 3, 4, 5))).toEqual([]);
    expect(
      findPlanViolations(pick(0, 1, 5), wide, 8, {
        minSteps: 1,
        notes: null,
        bounds: wideBounds,
      }),
    ).toEqual([]);
  });

  it("measures ASSEMBLED windows, not the cap or each state's own clip", () => {
    // Read nominally this plan is three steps at the cap (12000ms), or each
    // state's own clip (3200 + 1200 + 4000 = 8400ms). The video shows
    // neither: state 1 cuts step 0 at its 2000ms gap, the app leaves the home
    // screen one sample after the idle frame at 3000ms so step 1 runs
    // 1200ms, and the success screen runs the cap — 7200ms.
    const tight: AnalysisState[] = [
      state({ timestampMs: 0, screenName: "בית", visibleText: ["אחת"], actionType: "navigate" }),
      state({
        timestampMs: 2000,
        screenName: "בית",
        visibleText: ["אחת", "שתיים"],
        actionType: "tap",
      }),
      state({
        timestampMs: 3000,
        screenName: "בית",
        visibleText: ["אחת", "שתיים"],
        actionType: "idle",
      }),
      state({
        timestampMs: 4000,
        screenName: "סיום",
        visibleText: ["נשמר"],
        actionType: "result",
      }),
    ];
    const steps = [
      { sourceIndex: 0, label: "אחת" },
      { sourceIndex: 1, label: "שתיים" },
      { sourceIndex: 3, label: "נשמר" },
    ];
    const tightBounds = boundsOver(tight);
    expect(timelineClipMs(tight, tightBounds)).toEqual([3200, 1200, 200, 4000]);
    expect(assembleSteps(steps, tight, tightBounds).map((s) => s.durationMs)).toEqual([
      2000, 1200, 4000,
    ]);
    // Asserted through the CEILING, which has no escape and reports the same
    // assembled number.
    expect(
      findPlanViolations(steps, tight, 8, {
        minSteps: 1,
        notes: null,
        bounds: tightBounds,
        runtime: { minMs: 5000, maxMs: 7000 },
      }).find((x) => x.includes("total")),
    ).toContain("7200ms");
  });

  it("waives the FLOOR when the recording is too short to reach it, never the ceiling", () => {
    // demos.ts accepts an 8-second recording; this one is 10s. Every
    // selectable state selected, perfectly spaced, assembles to the
    // recording's own 10000ms — the success step is cut by the recording's
    // end — so the 15s floor is unreachable and "ADD one or two more distinct
    // product states" is advice about states that do not exist. Before the
    // waiver this burned the retry and failed the plan permanently, with a
    // Hebrew "try again" that never would.
    const tenSeconds: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["אחת"], actionType: "navigate" }),
      state({ timestampMs: 2000, visibleText: ["שתיים"], actionType: "tap" }),
      state({ timestampMs: 4000, visibleText: ["שלוש"], actionType: "type" }),
      state({ timestampMs: 6000, visibleText: ["ארבע"], actionType: "select" }),
      state({ timestampMs: 8000, visibleText: ["חמש"], actionType: "result" }),
    ];
    const tenBounds = clipBounds(DURATIONS, tenSeconds, 10_000);
    const everything = tenSeconds.map((s, i) => ({
      sourceIndex: i,
      label: s.visibleText[0]!,
    }));
    expect(totalRuntimeMs(assembleSteps(everything, tenSeconds, tenBounds))).toBe(10_000);
    expect(
      findPlanViolations(everything, tenSeconds, 8, {
        minSteps: 5,
        notes: null,
        bounds: tenBounds,
        runtime: band,
      }),
    ).toEqual([]);
    // A short plan on a recording long enough to do better IS flagged — the
    // waiver is about the timeline, never about the total.
    expect(shape(pick(0, 1, 5)).some((v) => v.includes("too SHORT"))).toBe(true);
    // And the ceiling never gets the escape: a long plan can always drop steps.
    expect(
      findPlanViolations(pick(0, 1, 2, 3, 4, 5), wide, 8, {
        minSteps: 1,
        notes: null,
        bounds: wideBounds,
        runtime: { minMs: 30_000, maxMs: 12_000 },
      }).some((v) => v.includes("too LONG")),
    ).toBe(true);
  });

  it("notes does not waive the band — a short ad is short however it is explained", () => {
    expect(
      findPlanViolations(pick(0, 1, 5), wide, 8, {
        minSteps: 1,
        notes: "בסרטון אין יותר מסכים",
        bounds: wideBounds,
        runtime: band,
      }).some((x) => x.includes("too SHORT")),
    ).toBe(true);
  });

  it("the floor's escape never strands the ending — a reachable floor stays enforced", () => {
    // The leftmost greedy this replaced took every state at the earliest legal
    // moment (maximum CARDINALITY) and then could not take the final state,
    // 1400ms after its last pick — so it valued this timeline at 6 x 1600 +
    // 4000 = 13600ms, declared the 15s floor unreachable and switched the
    // check OFF. A 12800ms plan then shipped with zero violations. The floor
    // IS reachable here: skipping 9600 to take 11000 assembles 5 x 1600 +
    // 3000 + 4000 = 15000ms.
    const ts = [0, 1600, 3200, 4800, 6400, 8000, 9600, 11_000];
    const words = ["אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה"];
    const grid: AnalysisState[] = ts.map((t, i) =>
      state({
        timestampMs: t,
        visibleText: [words[i]!],
        actionType: i === ts.length - 1 ? "result" : "tap",
      }),
    );
    const gridBounds = boundsOver(grid);
    const plan = (...i: number[]) => i.map((n) => ({ sourceIndex: n, label: words[n]! }));
    expect(totalRuntimeMs(assembleSteps(plan(0, 1, 2, 3, 4, 5, 7), grid, gridBounds))).toBe(15_000);
    // 3 x 1600 + 4000 (the cap, under the 6200ms gap) + 4000 = 12800ms.
    const short = plan(0, 1, 2, 3, 7);
    expect(totalRuntimeMs(assembleSteps(short, grid, gridBounds))).toBe(12_800);
    expect(
      findPlanViolations(short, grid, 8, {
        minSteps: 5,
        notes: null,
        bounds: gridBounds,
        runtime: band,
      }).some((v) => v.includes("too SHORT")),
    ).toBe(true);
  });

  it("the floor's escape ignores states after the success — post-success filming cannot certify an unreachable floor", () => {
    // Success at 9s of a 25s recording, customer kept filming after it (the
    // normal case, per the last-step rule's own comment). An ending-compliant
    // plan tops out at 4 steps, 3 x 3000 + 4000 = 13000ms; the states at
    // 12/15/18/21s can never be steps, so counting their coverage (>= the 15s
    // floor) would order the model to add pre-ending states that do not
    // exist, burn the one retry, and fail the plan permanently. Bounded at
    // the ending, the escape forgives the shortfall — shipped at the 3s-floor
    // change, when the raised band moved this asymmetry onto ordinary short
    // demos.
    const ts = [0, 3000, 6000, 9000, 12_000, 15_000, 18_000, 21_000];
    const grid: AnalysisState[] = ts.map((t, i) =>
      state({
        timestampMs: t,
        visibleText: [`מסך ${i}`],
        actionType: i === 3 ? "result" : "tap",
      }),
    );
    const gridBounds = boundsOver(grid);
    const plan = [0, 1, 2, 3].map((i) => ({ sourceIndex: i, label: `מסך ${i}` }));
    expect(totalRuntimeMs(assembleSteps(plan, grid, gridBounds))).toBe(13_000);
    expect(
      findPlanViolations(plan, grid, 7, {
        minSteps: 4,
        notes: null,
        bounds: gridBounds,
        runtime: band,
      }),
    ).toEqual([]);
  });

  it("the floor's escape measures capped gaps, not wall clock", () => {
    // Two states 30 seconds apart. The wall clock says 30s is available, but a
    // step can only claim the gap to the state actually selected after it,
    // capped at its own clip — so the most this timeline can ever assemble is
    // 2 x 4000 = 8000ms and the 15s floor is unreachable. The old span-based
    // bound read the 30s as claimable and ordered the model to add states
    // that do not exist, burning the one retry on a permanent failure.
    const twoStates: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["אחת"], actionType: "navigate" }),
      state({ timestampMs: 30_000, visibleText: ["שש"], actionType: "result" }),
    ];
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "אחת" },
          { sourceIndex: 1, label: "שש" },
        ],
        twoStates,
        8,
        { minSteps: 1, notes: null, bounds: boundsOver(twoStates), runtime: band },
      ),
    ).toEqual([]);
  });
});

describe("a state too short to caption is not selectable for the shape rules", () => {
  // The customer stops recording one second into the success screen. That
  // state's clip (1000ms) is under MIN_GAP_MS: no caption fits on it, so the
  // read-time rule would reject it as an ending while the ending rule
  // demanded it, and no retry could satisfy both. Four product steps before
  // it, a minimum of five, and a floor only that last second could reach —
  // each rule would count the state if it were selectable.
  const ts = [0, 2000, 4000, 6000, 10_000];
  const words = ["אחת", "שתיים", "שלוש", "ארבע", "נשמר"];
  const timeline: AnalysisState[] = ts.map((t, i) =>
    state({
      timestampMs: t,
      visibleText: [words[i]!],
      actionType: i === 4 ? "result" : "tap",
    }),
  );
  const plan = [0, 1, 2, 3].map((i) => ({ sourceIndex: i, label: words[i]! }));
  const check = (recordingEnd: number) =>
    findPlanViolations(plan, timeline, 7, {
      minSteps: 5,
      notes: null,
      bounds: { ...DURATIONS, recordingEndMs: recordingEnd },
      runtime: { minMs: 11_000, maxMs: 21_000 },
    });

  it("is not the required ending, not counted toward the minimum, not counted toward the floor", () => {
    expect(timelineClipMs(timeline, { ...DURATIONS, recordingEndMs: 11_000 })[4]).toBe(1000);
    // 3 x 2000 + 4000 = 10000ms, all the four captionable states can make.
    expect(
      totalRuntimeMs(assembleSteps(plan, timeline, { ...DURATIONS, recordingEndMs: 11_000 })),
    ).toBe(10_000);
    expect(check(11_000)).toEqual([]);
  });

  it("with room to caption it, the same state is all three again", () => {
    // Three more seconds of recording: its clip is the 4000ms cap.
    const v = check(14_000);
    expect(v.some((x) => x.includes("result/success"))).toBe(true);
    expect(v.some((x) => x.includes("fewer than the minimum"))).toBe(true);
    expect(v.some((x) => x.includes("too SHORT"))).toBe(true);
  });
});

describe("a caption must outlast its own read time", () => {
  const band = { minMs: 15_000, maxMs: 21_000 };
  /** The shipped a179f069 shape: a long caption on a state only 1600ms before
   *  the next selected one, so that state cuts its window. */
  const squeezed: AnalysisState[] = [
    state({ timestampMs: 0, visibleText: ["אחת"], actionType: "navigate" }),
    state({ timestampMs: 1600, visibleText: ["שתיים"], actionType: "select" }),
    state({ timestampMs: 20_000, visibleText: ["שלוש"], actionType: "result" }),
  ];
  const steps = (first: string) => [
    { sourceIndex: 0, label: first },
    { sourceIndex: 1, label: "שתיים" },
    { sourceIndex: 2, label: "שלוש" },
  ];
  const check = (first: string) =>
    findPlanViolations(steps(first), squeezed, 8, {
      minSteps: 1,
      notes: null,
      bounds: boundsOver(squeezed),
      runtime: band,
    });

  it("flags the caption the next state squeezed, and names both exits", () => {
    // Six words need 2800ms; the window is 1600ms because state 1 is 1600ms
    // later. (1600 - 400 lead) at 2.5 words/sec = 3 words that would fit.
    const hit = check("אחת אחת אחת אחת אחת אחת").find((v) => v.includes("but needs"));
    expect(hit).toBeDefined();
    expect(hit).toContain("state 0");
    expect(hit).toContain("1600ms");
    expect(hit).toContain("2800ms");
    expect(hit).toContain("cut by the next selected state");
    expect(hit).toContain("cut it to 3 words");
    // Rewriting alone often cannot fix it, so the merge exit must be offered.
    expect(hit).toContain("drop one of the two states");
  });

  it("names the screen when the app, not the next step, cut the window", () => {
    // State 1 is picked late on its screen: the app navigates away after the
    // idle frame at 3000ms, so the step runs 1200ms however far off the next
    // selected state is. Dropping a neighbour cannot help; an earlier moment
    // on the same screen can, and the message has to say so.
    const late: AnalysisState[] = [
      state({ timestampMs: 0, screenName: "בית", visibleText: ["אחת"], actionType: "navigate" }),
      state({
        timestampMs: 2000,
        screenName: "בית",
        visibleText: ["אחת", "שתיים"],
        actionType: "tap",
      }),
      state({
        timestampMs: 3000,
        screenName: "בית",
        visibleText: ["אחת", "שתיים"],
        actionType: "idle",
      }),
      state({
        timestampMs: 6000,
        screenName: "סיום",
        visibleText: ["נשמר"],
        actionType: "result",
      }),
    ];
    const hit = findPlanViolations(
      [
        { sourceIndex: 1, label: "אחת שתיים שלוש" },
        { sourceIndex: 3, label: "נשמר" },
      ],
      late,
      8,
      { minSteps: 1, notes: null, bounds: boundsOver(late), runtime: band },
    ).find((v) => v.includes("but needs"));
    expect(hit).toBeDefined();
    expect(hit).toContain("state 1");
    expect(hit).toContain("on screen for 1200ms but needs 1600ms");
    expect(hit).toContain("the app leaves that screen 1200ms after this state");
    // (1200 - 400 lead) at 2.5 words/sec = 2 words — under the 3-word floor,
    // so no rewrite can fix it. Offering "cut it to 2 words" spent a retry
    // live (plan bd0913b4, 2026-10-01): the model wrote 3 words, still short.
    expect(hit).not.toContain("cut it to");
    expect(hit).toContain("no caption of 3 or more words fits");
    expect(hit).toContain("drop this step");
    expect(hit).toContain("select an earlier state on the same screen");
    expect(hit).not.toContain("drop one of the two states");
  });

  it("offers the shorter caption only when one of at least 3 words fits", () => {
    // The same screen, left 2000ms after state 1: (2000 - 400) at 2.5
    // words/sec = 4 words fit, so the rewrite is a real exit — and dropping
    // the step is still offered beside it.
    const roomier: AnalysisState[] = [
      state({ timestampMs: 0, screenName: "בית", visibleText: ["אחת"], actionType: "navigate" }),
      state({
        timestampMs: 2000,
        screenName: "בית",
        visibleText: ["אחת", "שתיים"],
        actionType: "tap",
      }),
      state({
        timestampMs: 3800,
        screenName: "בית",
        visibleText: ["אחת", "שתיים"],
        actionType: "idle",
      }),
      state({
        timestampMs: 6000,
        screenName: "סיום",
        visibleText: ["נשמר"],
        actionType: "result",
      }),
    ];
    const hit = findPlanViolations(
      [
        { sourceIndex: 1, label: "אחת שתיים שלוש ארבע חמש שש" },
        { sourceIndex: 3, label: "נשמר" },
      ],
      roomier,
      8,
      { minSteps: 1, notes: null, bounds: boundsOver(roomier), runtime: band },
    ).find((v) => v.includes("but needs"));
    expect(hit).toContain("on screen for 2000ms but needs 2800ms");
    expect(hit).toContain("either cut it to 4 words or fewer");
    expect(hit).toContain("drop this step");
  });

  it("stays silent when every caption fits its window", () => {
    expect(check("אחת").some((v) => v.includes("but needs"))).toBe(false);
  });

  it("never fires on the human path — no `shape`, no shape rules", () => {
    // Human edits go through updatePlanSteps, which never calls this at all;
    // this pins the same split the min-gap rule has, so a customer who picks
    // two nearby states gets a short clip rather than a blocked save.
    expect(findPlanViolations(steps("אחת אחת אחת אחת אחת אחת"), squeezed, 8)).toEqual([]);
  });
});

describe("the prompt's timing block is generated from the code, not restated", () => {
  // The production defaults, spelled out rather than imported: a test that
  // reads the same constants the generator reads cannot catch either moving.
  // This describe pinned the pre-b60b5b6 era (1400ms floor, 11-16s band,
  // 8-step cap) long after production moved, which is how the band/floor
  // contradiction shipped unnoticed — these literals must be the SHIPPED
  // config, and the band-coherence describe below is what checks they can
  // coexist.
  const BAND = { minMs: 15_000, maxMs: 21_000 };
  const block = planTimingMarkdown({ maxMs: 4000, runtime: BAND, minSteps: 5, maxSteps: 7 });
  const label = (words: number) => Array.from({ length: words }, () => "אחת").join(" ");

  /** Only the read-time violations, for a caption on state 0 with `gapMs` to
   *  the next SELECTED state — the squeeze the gap ceiling describes. One
   *  screen on a long recording, so only that gap can cut the window. */
  const readTimeViolations = (gapMs: number, first: string): string[] => {
    const timeline: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["אחת"], actionType: "tap" }),
      state({ timestampMs: gapMs, visibleText: ["שתיים"], actionType: "tap" }),
      state({ timestampMs: gapMs + 30_000, visibleText: ["שלוש"], actionType: "result" }),
    ];
    return findPlanViolations(
      [
        { sourceIndex: 0, label: first },
        { sourceIndex: 1, label: "שתיים" },
        { sourceIndex: 2, label: "שלוש" },
      ],
      timeline,
      8,
      { minSteps: 1, notes: null, bounds: boundsOver(timeline), runtime: BAND },
    ).filter((v) => v.includes("but needs"));
  };

  const readRows = [...block.matchAll(/^\| (\d+) words \| ([\d.]+)s \|$/gm)].map((m) => ({
    words: Number(m[1]),
    ms: Math.round(Number(m[2]) * 1000),
  }));

  it("offers one row per legal caption length", () => {
    expect(readRows.map((r) => r.words)).toEqual([3, 4, 5, 6]);
  });

  it("every row is the gap findPlanViolations actually demands — v10's first row was not", () => {
    // v10 hand-wrote "1.4-2.0s -> 3 words". readTimeMs asks 1600ms for three
    // words, so the prompt licensed plans this very check then rejected — two
    // of the campaign-app regression failures. Each row is now walked through
    // the check itself: at the stated gap the caption is legal, 100ms under it
    // is not. A row that drifts from readTimeMs fails one of the two.
    for (const row of readRows) {
      expect(readTimeMs(label(row.words))).toBe(row.ms);
      expect(readTimeViolations(row.ms, label(row.words))).toEqual([]);
      expect(readTimeViolations(row.ms - 100, label(row.words))).toHaveLength(1);
    }
  });

  it("names the gap below which no pair is selectable — the shortest caption's read time", () => {
    // With the 3s step floor gone (0072) nothing outruns the read time: under
    // the read time of a floor-length caption no caption fits at all, so that
    // is the gap — the same MIN_GAP_MS findPlanViolations holds a pair to.
    const shortest = readRows[0]!;
    expect(shortest.ms).toBe(1600);
    expect(MIN_GAP_MS).toBe(shortest.ms);
    expect(block).toContain("Under a 1.6s gap");
  });

  it("stops offering caption lengths a configured ceiling could never grant", () => {
    // a_step_ms_max below a row's read time caps every step under it, so the
    // row would advertise a window assembleSteps never hands out.
    const tight = planTimingMarkdown({ maxMs: 2000, runtime: BAND, minSteps: 5, maxSteps: 7 });
    const rows = (text: string) =>
      [...text.matchAll(/^\| (\d+) words \| ([\d.]+)s \|$/gm)].map((m) => Number(m[1]));
    expect(rows(tight)).toEqual([3, 4]);
    // ...and never empties out, however low the ceiling goes.
    expect(
      rows(planTimingMarkdown({ maxMs: 800, runtime: BAND, minSteps: 5, maxSteps: 7 })),
    ).toEqual([3]);
  });

  it("states the band and the clip rule, with no per-kind floor and no totals grid", () => {
    expect(block).toContain("The steps must total 15.0-21.0s; aim near 18.0s.");
    // clipMs is how the model learns where each step would end, and the cap.
    expect(block).toContain("`clipMs`");
    expect(block).toContain("never more than 4.0s");
    // minSteps at the cap: 5 x 4.0s.
    expect(block).toContain("5 full-length steps run 20.0s");
    // Steps follow the footage, so the per-action lengths and the shape-by-
    // length totals grid they fed have nothing left to say — nor a verdict.
    expect(block).not.toMatch(/^\| \d+ \|/m);
    expect(block).not.toMatch(/navigate|scroll|idle/);
    expect(block).not.toContain("too SHORT");
    expect(block).not.toContain("passes");
  });

  it("the latest prompt file asks for the block, and the caller's vars satisfy it", () => {
    // renderPrompt substitutes only what the template references, so a prompt
    // that stops asking for {{timing}} loses every derived number in silence —
    // and one that asks for a variable generateStepPlan does not pass throws on
    // the paid path only. Both are checked here, against whatever is latest.
    const version = latestPromptVersion("plan_demo_steps");
    const file = readFileSync(path.join(PROMPTS_DIR, "plan_demo_steps", `v${version}.md`), "utf8");
    expect(file).toContain("{{timing}}");

    const { text, promptVersion } = renderPrompt("plan_demo_steps", {
      questionnaire: "{}",
      timeline: "[]",
      min: 5,
      max: 7,
      timing: block,
      // v13+ — same one-way compatibility as {{timing}}: extra vars are
      // ignored by older templates, absent ones throw on the latest.
      demo_description: "(אין)",
    });
    expect(promptVersion).toBe(`plan_demo_steps@v${version}`);
    expect(text).toContain(block);
    expect(text).not.toContain("{{");
  });
});

describe("the one-beat test's calibration", () => {
  // v11 replaced v10's "if most of the entries are the same" with a measured
  // threshold, because "most" reads as a majority and the real one-beat pair
  // sits at 44% — so the model correctly called it two screens, twice.
  const timeline = (
    JSON.parse(
      readFileSync(path.join(FIXTURES_DIR, "real-botteacher-file-routing.json"), "utf8"),
    ) as { timeline: AnalysisState[] }
  ).timeline;
  const sharedEntries = (a: number, b: number): string[] => {
    const left = new Set(timeline[a]!.visibleText);
    return timeline[b]!.visibleText.filter((t) => left.has(t));
  };
  /** v11's rule: shared entries over the LONGER of the two arrays. */
  const overlap = (a: number, b: number): number =>
    sharedEntries(a, b).length /
    Math.max(timeline[a]!.visibleText.length, timeline[b]!.visibleText.length);

  it("puts the one-beat pair and the two-beat pair on opposite sides of a third", () => {
    // The counts v11's two worked pairs quote. A re-snapshotted fixture that
    // moves them makes the prompt's examples wrong, and that is worth a red.
    expect(timeline[11]!.visibleText).toHaveLength(9);
    expect(timeline[12]!.visibleText).toHaveLength(6);
    expect(timeline[2]!.visibleText).toHaveLength(17);
    expect(timeline[3]!.visibleText).toHaveLength(5);

    // The STRINGS, not just the counts. v11 quotes these seven entries by
    // name; counts alone stay green when a re-OCR swaps which entries overlap
    // (state 12 re-reading `Black Hole` as `boteacher` keeps the count at 4),
    // and the prompt would then be citing entries that are no longer shared.
    expect(sharedEntries(11, 12)).toEqual([
      "Black Hole",
      "Takin Syllabus.txt",
      "זוהה סילבוס",
      "יעד ניתוב",
    ]);
    expect(sharedEntries(2, 3)).toEqual([
      "שפוך פה הכל",
      "boteacher יעשה לך סדר",
      "מבחן ללא פתרון לא ייקלט למערכת",
    ]);
    // The LATEST prompt, not a pinned version: the quoted entries have to
    // survive into whatever is actually being sent.
    const prompt = readFileSync(
      path.join(PROMPTS_DIR, "plan_demo_steps", `v${latestPromptVersion("plan_demo_steps")}.md`),
      "utf8",
    );
    for (const entry of [...sharedEntries(11, 12), ...sharedEntries(2, 3)]) {
      expect(prompt, `v11 quotes ${entry}`).toContain(entry);
    }

    expect(overlap(11, 12)).toBeGreaterThanOrEqual(1 / 3);
    expect(overlap(2, 3)).toBeLessThan(1 / 3);
    // And below a majority, which is why v10's wording merged neither pair.
    expect(overlap(11, 12)).toBeLessThan(0.5);
  });

  it("also merges 12/13, the pair that decides where the dialog run ends", () => {
    // The founder's brief named 11/12 AND 12/13 as pairs v10's "most of the
    // entries" failed to merge. 12/13 is the one the prompt has no worked
    // example for, and it is what extends the run past state 12 — so it is
    // pinned here rather than left to be rediscovered.
    expect(sharedEntries(12, 13)).toEqual(["Black Hole", "יעד ניתוב", "חומר קורס"]);
    expect(overlap(12, 13)).toBeGreaterThanOrEqual(1 / 3);
    // Exact matching misses the OCR near-miss v11 tells the model to count.
    expect(timeline[12]!.visibleText).toContain("אישר ניתוב (1)");
    expect(timeline[13]!.visibleText).toContain("אישור ניתוב (1)");
  });

  it("dividing by the SHORTER array is what would merge the two-beat pair", () => {
    // States 2 and 3 are the dashboard and the panel that opens over it: most
    // of the small panel's text is also on the dashboard behind it. The rule
    // has to name its divisor or it swallows every dialog in the timeline.
    const short = Math.min(timeline[2]!.visibleText.length, timeline[3]!.visibleText.length);
    expect(sharedEntries(2, 3).length / short).toBeGreaterThan(0.5);
  });
});

describe("step durations (the window model)", () => {
  it("with no app_config rows the code constants are the configuration", async () => {
    // Spelled out, not imported: a test that reads the constant cannot notice
    // the constant moving, and these two numbers ARE the shipped behaviour.
    expect(await stepDurations(db)).toEqual({ maxMs: 4000, sampleMs: 200 });

    await db.insert(dbSchema.appConfig).values([
      // Gone with the 3s floor (0072): a stale row changes nothing.
      { key: "a_step_ms_min", value: 2000 },
      { key: "a_step_ms_max", value: 3000 },
      { key: "a_analysis_fps", value: 3 },
    ]);
    // The sample follows the analysis's own fps, floored (1000 / 3 -> 333) so
    // a cut never passes the next sample on that grid.
    expect(await stepDurations(db)).toEqual({ maxMs: 3000, sampleMs: 333 });

    // A cap under one sample would leave a clip with no frame.
    await db
      .update(dbSchema.appConfig)
      .set({ value: 100 })
      .where(eq(dbSchema.appConfig.key, "a_step_ms_max"));
    expect((await stepDurations(db)).maxMs).toBe(333);

    await db
      .delete(dbSchema.appConfig)
      .where(
        sql`${dbSchema.appConfig.key} in ('a_step_ms_min', 'a_step_ms_max', 'a_analysis_fps')`,
      );
    expect(await stepDurations(db)).toEqual({ maxMs: 4000, sampleMs: 200 });
  });

  it("with no app_config rows the runtime band is the code constants", async () => {
    // Every band in this file is a literal passed straight to
    // findPlanViolations, so without this the shipped 15-21s band was the one
    // duration default no test pinned: MIN_RUNTIME_MS could be edited to any
    // value and the suite stayed green. Whether it still fits the cap and the
    // step counts is the band-coherence describe's job.
    expect(await stepRuntimeBand(db)).toEqual({ minMs: 15_000, maxMs: 21_000 });

    await db.insert(dbSchema.appConfig).values([
      { key: "a_steps_runtime_min_ms", value: 9000 },
      { key: "a_steps_runtime_max_ms", value: 14_000 },
    ]);
    expect(await stepRuntimeBand(db)).toEqual({ minMs: 9000, maxMs: 14_000 });

    // A pair the wrong way round must not make the band unsatisfiable.
    await db
      .update(dbSchema.appConfig)
      .set({ value: 5000 })
      .where(eq(dbSchema.appConfig.key, "a_steps_runtime_max_ms"));
    expect((await stepRuntimeBand(db)).maxMs).toBe(9000); // floored at minMs

    await db
      .delete(dbSchema.appConfig)
      .where(
        sql`${dbSchema.appConfig.key} in ('a_steps_runtime_min_ms', 'a_steps_runtime_max_ms')`,
      );
    expect(await stepRuntimeBand(db)).toEqual({ minMs: 15_000, maxMs: 21_000 });
  });

  it("readTimeMs grows with the label — a 6-word label outlasts a 2-word one", () => {
    expect(readTimeMs("בוחרים מוצר")).toBeLessThan(
      readTimeMs("מתחברים לאפליקציה בוחרים מוצר ומשלמים בהעברה"),
    );
    // 400ms lead + 2.5 words/sec. Spelled out rather than recomputed from the
    // constants: a test that imports the guess cannot catch the guess moving.
    expect(readTimeMs("בוחרים מוצר")).toBe(1200);
    expect(readTimeMs("מתחברים לאפליקציה בוחרים מוצר ומשלמים בהעברה")).toBe(2800);
    // A punctuation-only token (spaced dash) is not a read word — and the
    // 6-word cap already skips it, so counting it here made a cap-legal label
    // read as 7 words and outgrow the 3s floor with the 7-step band at zero
    // slack.
    expect(readTimeMs("פתחו את התפריט — בחרו פרויקט חדש")).toBe(
      readTimeMs("פתחו את התפריט בחרו פרויקט חדש"),
    );
    expect(readTimeMs("   ")).toBe(400); // no words: the lead alone
  });

  it("caps a step at the gap to the next state, never at its own clip", () => {
    // The real defect (fixtures/timelines/real-botteacher-file-routing.json):
    // a `type` state 1600ms before the next selected one, given `type`'s flat
    // 2200ms, rendered 600ms of source twice.
    const timeline: AnalysisState[] = [
      state({ timestampMs: 10_000, actionType: "type" }),
      state({ timestampMs: 11_600, actionType: "result" }),
    ];
    const steps = assembleSteps(
      [
        { sourceIndex: 0, label: "ממלאים פרטים" },
        { sourceIndex: 1, label: "מוכן" },
      ],
      timeline,
      clipBounds(DURATIONS, timeline, 30_000),
    );
    expect(steps[0]!.durationMs).toBe(1600); // the gap, not its 4000ms clip
    expect(steps[0]!.timestampMs + steps[0]!.durationMs).toBe(steps[1]!.timestampMs);
    // The last step has no neighbour to hit: it runs its own clip, the cap.
    expect(steps[1]!.durationMs).toBe(4000);
  });

  it("never overlaps, whatever order the selection arrives in", () => {
    // The client sends steps unsorted (the picker is a grid). Durations must
    // be computed against the CHRONOLOGICAL neighbour, not the array one.
    const timeline: AnalysisState[] = [
      state({ timestampMs: 0, actionType: "navigate" }),
      state({ timestampMs: 1500, actionType: "tap" }),
      state({ timestampMs: 3000, actionType: "type" }),
      state({ timestampMs: 30_000, actionType: "result" }),
    ];
    const steps = assembleSteps(
      [
        { sourceIndex: 2, label: "שלוש" },
        { sourceIndex: 0, label: "אחת" },
        { sourceIndex: 3, label: "סוף" },
        { sourceIndex: 1, label: "שתיים" },
      ],
      timeline,
      boundsOver(timeline),
    );
    expect(steps.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 3]);
    for (let i = 0; i < steps.length - 1; i++) {
      expect(steps[i]!.timestampMs + steps[i]!.durationMs).toBeLessThanOrEqual(
        steps[i + 1]!.timestampMs,
      );
    }
  });

  it("a too-close pair renders short, never overlapping — and the cap holds whatever the caption asks", () => {
    const timeline: AnalysisState[] = [
      state({ timestampMs: 0, actionType: "tap" }),
      // 400ms later: two states inside one caption's read time. The MODEL is
      // stopped by findPlanViolations; a human edit reaches here and is
      // HONOURED. 400ms of what the customer chose is honest; a longer clip
      // would replay the next step's source, which nobody picked.
      state({ timestampMs: 400, actionType: "result" }),
    ];
    const tooClose = assembleSteps(
      [
        { sourceIndex: 0, label: "אחת" },
        { sourceIndex: 1, label: "סוף" },
      ],
      timeline,
      boundsOver(timeline),
    );
    expect(tooClose[0]!.durationMs).toBe(400);
    expect(tooClose[0]!.timestampMs + tooClose[0]!.durationMs).toBe(tooClose[1]!.timestampMs);

    // Ceiling: a label nobody could read inside 4s, with all the room it wants.
    const roomy: AnalysisState[] = [state({ timestampMs: 0, actionType: "result" })];
    const long = assembleSteps(
      [{ sourceIndex: 0, label: "אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע עשר" }],
      roomy,
      boundsOver(roomy, 30_000),
    );
    expect(readTimeMs("אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע עשר")).toBe(4400);
    expect(long[0]!.durationMs).toBe(4000);
  });

  it("the canned DRY_RUN plan tops up from the legal pool rather than throwing", async () => {
    // dryRunPlan prefers "high"/non-idle states; findPlanViolations' min-step
    // waiver counts every LEGAL state, "low" and idle included. On mostly-dim
    // footage the quality pool alone lands under the minimum on a timeline the
    // waiver does not forgive, and the keyless path threw — on the very path
    // the whole suite, `aiugc plan regress` and a DRY_RUN worker all run.
    // One screen on a 19s recording: every state's clip is the full cap.
    const dim: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["אחת"], actionType: "navigate", legibility: "low" }),
      state({ timestampMs: 3000, visibleText: ["שתיים"], actionType: "tap", legibility: "low" }),
      state({ timestampMs: 6000, visibleText: ["שלוש"], actionType: "type" }),
      state({ timestampMs: 9000, visibleText: ["ארבע"], actionType: "select" }),
      state({ timestampMs: 12_000, visibleText: ["חמש"], actionType: "scroll", legibility: "low" }),
      state({ timestampMs: 15_000, visibleText: ["שש"], actionType: "result" }),
    ];
    const draft = await generateStepPlan(db, {
      timeline: dim,
      questionnaire: QUESTIONNAIRE,
      recordingMs: 19_000,
    });
    // The quality pool holds three states; the legal pool holds six, so the
    // plan tops up instead of dying under the 5-step minimum.
    expect(draft.steps.length).toBeGreaterThanOrEqual(5);
    expect(draft.steps[draft.steps.length - 1]!.actionType).toBe("result");
  });

  it("the canned DRY_RUN plan obeys the min-gap rule it is validated against", async () => {
    // dryRunPlan is run through the SAME findPlanViolations as a real plan, so
    // a canned plan that trips the rule throws instead of producing a plan —
    // and subsampleClusters always keeps its last element before lastResult is
    // appended, so (final candidate, success screen) is exactly the pair a
    // real recording puts under the gap.
    const tight: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["פתיחה"], actionType: "navigate" }),
      state({ timestampMs: 4000, visibleText: ["בחירה"], actionType: "tap" }),
      state({ timestampMs: 8000, visibleText: ["הקלדה"], actionType: "type" }),
      state({ timestampMs: 44_600, visibleText: ["שמירה"], actionType: "tap" }),
      state({ timestampMs: 45_000, visibleText: ["נוצר"], actionType: "result" }),
    ];
    const draft = await generateStepPlan(db, {
      timeline: tight,
      questionnaire: QUESTIONNAIRE,
      recordingMs: 49_000,
    });
    const picked = draft.steps.map((s) => s.timestampMs);
    expect(picked).toContain(45_000); // the ending is the one state it cannot lose
    expect(picked).not.toContain(44_600); // its too-close neighbour is dropped
    for (let i = 1; i < picked.length; i++) {
      expect(picked[i]! - picked[i - 1]!).toBeGreaterThanOrEqual(MIN_GAP_MS);
    }
  });

  it("two states inside one caption's read time are a VIOLATION for the model, not a short clip", () => {
    // Real timelines put states 400ms apart (fixtures/timelines: the botteacher
    // recordings both do). Selecting both is a selection bug — the corrective
    // retry has to see it, because no duration can honour both windows.
    const timeline: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["התחלה"] }),
      state({ timestampMs: 400, visibleText: ["המשך"] }),
      state({ timestampMs: 9000, visibleText: ["נשמר"], actionType: "result" }),
    ];
    const bounds = boundsOver(timeline);
    const violations = findPlanViolations(
      [
        { sourceIndex: 0, label: "התחלה" },
        { sourceIndex: 1, label: "המשך" },
        { sourceIndex: 2, label: "נשמר" },
      ],
      timeline,
      8,
      { minSteps: 1, notes: null, bounds },
    );
    const tooClose = violations.find((v) => v.includes("400ms apart"));
    expect(tooClose).toBeDefined();
    expect(tooClose).toContain("states 0 and 1");
    // `notes` waives the shape rules above it — it must NOT waive this one:
    // nothing explains a clip shorter than the eye can land on.
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "התחלה" },
          { sourceIndex: 1, label: "המשך" },
          { sourceIndex: 2, label: "נשמר" },
        ],
        timeline,
        8,
        { minSteps: 1, notes: "הקלטה קצרה", bounds },
      ).some((v) => v.includes("400ms apart")),
    ).toBe(true);
    // Far enough apart -> silent.
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "התחלה" },
          { sourceIndex: 2, label: "נשמר" },
        ],
        timeline,
        8,
        { minSteps: 1, notes: null, bounds },
      ),
    ).toEqual([]);
  });
});

describe("isNewScreen — two of three signals (decision 0070)", () => {
  const dashboard = state({
    screenName: "לוח בקרה",
    visibleText: ["הפרויקטים שלי", "פרויקט חדש", "הגדרות"],
    actionType: "navigate",
  });
  const settings = state({
    screenName: "הגדרות חשבון",
    visibleText: ["שם משתמש", "סיסמה", "שמירה"],
    actionType: "navigate",
  });

  it("a popup, a typing run and a scroll stay on the screen; a navigation leaves it", () => {
    // A dialog over the page keeps its name and most of its text.
    const dialog = state({
      screenName: "לוח בקרה",
      visibleText: ["הפרויקטים שלי", "פרויקט חדש", "למחוק את הפרויקט?", "ביטול"],
      actionType: "tap",
    });
    expect(isNewScreen(dashboard, dialog)).toBe(false);
    // Typing grows the text on the same form.
    expect(
      isNewScreen(
        state({ screenName: "הרשמה", visibleText: ["שם מלא", "אימייל"], actionType: "type" }),
        state({
          screenName: "הרשמה",
          visibleText: ["שם מלא", "דנה כהן", "אימייל"],
          actionType: "type",
        }),
      ),
    ).toBe(false);
    // A scroll moves rows off and new ones in, under the same name.
    expect(
      isNewScreen(
        state({
          screenName: "מוצרים",
          visibleText: ["חולצה לבנה", "נעלי ספורט", "מחיר"],
          actionType: "scroll",
        }),
        state({
          screenName: "מוצרים",
          visibleText: ["נעלי ספורט", "כובע קש", "מחיר"],
          actionType: "scroll",
        }),
      ),
    ).toBe(false);
    // All three signals: a navigation, a new name, none of the old text.
    expect(isNewScreen(dashboard, settings)).toBe(true);
  });

  it("one signal alone never cuts, and a duplicate frame never starts a screen", () => {
    // The model called it a navigation, but the name and text are the page's own.
    expect(isNewScreen(dashboard, { ...dashboard })).toBe(false);
    // Everything changed, but the model called the frame a duplicate.
    expect(isNewScreen(dashboard, { ...settings, sameStateAsPrevious: true })).toBe(false);
  });

  it("names a site's pages alike by the text before ' - '", () => {
    const product = state({
      screenName: "tavnit.ai - שם המוצר",
      visibleText: ["שם המוצר", "תיאור"],
      actionType: "tap",
    });
    const pricing = state({
      screenName: "tavnit.ai - תמחור",
      visibleText: ["מחיר", "המשך"],
      actionType: "tap",
    });
    // Same site before the dash: the names agree, so only the text votes.
    expect(isNewScreen(product, pricing)).toBe(false);
    // Another site with the same change of text: the names vote too.
    expect(isNewScreen(product, { ...pricing, screenName: "boteacher.com - תמחור" })).toBe(true);
  });

  it("two frames with no text read are no evidence of a change", () => {
    const blank = state({ screenName: "עורך", visibleText: [], actionType: "scroll" });
    const unread = state({ screenName: "לא ברור", visibleText: [], actionType: "idle" });
    // Renamed, nothing transcribed on either side: only the name votes.
    expect(isNewScreen(blank, unread)).toBe(false);
    // Text appearing on the renamed frame is the second vote.
    expect(isNewScreen(blank, { ...unread, visibleText: ["שמירה"] })).toBe(true);
  });
});

describe("assembleSteps ends a step where its screen ends (decisions 0070, 0072)", () => {
  /** The dashboard: a delete dialog opens over it at 800ms, a project name is
   *  typed at 1600ms, the list is scrolled at 2400ms — one screen throughout.
   *  The app navigates to settings at 6000ms. */
  const screens: AnalysisState[] = [
    state({
      timestampMs: 0,
      screenName: "לוח בקרה",
      visibleText: ["הפרויקטים שלי", "פרויקט חדש", "הגדרות"],
      actionType: "navigate",
    }),
    state({
      timestampMs: 800,
      screenName: "לוח בקרה",
      visibleText: ["הפרויקטים שלי", "פרויקט חדש", "למחוק את הפרויקט?", "ביטול"],
      actionType: "tap",
    }),
    state({
      timestampMs: 1600,
      screenName: "לוח בקרה",
      visibleText: ["הפרויקטים שלי", "פרויקט חדש", "קמפיין קיץ"],
      actionType: "type",
    }),
    state({
      timestampMs: 2400,
      screenName: "לוח בקרה",
      visibleText: ["פרויקט חדש", "קמפיין קיץ", "קמפיין חורף"],
      actionType: "scroll",
    }),
    state({
      timestampMs: 6000,
      screenName: "הגדרות חשבון",
      visibleText: ["שם משתמש", "סיסמה", "שמירה"],
      actionType: "navigate",
    }),
  ];
  const bounds: ClipBounds = { ...DURATIONS, recordingEndMs: 20_000 };
  const one = (sourceIndex: number, b: ClipBounds = bounds) =>
    assembleSteps([{ sourceIndex, label: "כיתוב" }], screens, b)[0]!;

  it("rides through a popup, a typing run and a scroll, and ends one sample after the screen's last state", () => {
    expect(screenEnds(screens, bounds)).toEqual([2600, 2600, 2600, 2600, 20_000]);
    // Not at the dialog (800), the typing (1600) or the scroll (2400) — and
    // not at the cap (4000) or where the settings screen's first state sits
    // (6000): one sample after the scroll, the last frame known to show the
    // dashboard (cut early when unsure, 0072).
    expect(one(0).durationMs).toBe(2400 + 200);
    // Picked mid-screen, it ends at the same frame.
    expect(one(1).durationMs).toBe(2600 - 800);
  });

  it("the next selected state still cuts it, sooner than the screen", () => {
    const steps = assembleSteps(
      [
        { sourceIndex: 0, label: "כיתוב" },
        { sourceIndex: 2, label: "כיתוב" },
      ],
      screens,
      bounds,
    );
    // The 1600ms gap to state 2; then state 2 to its screen's end at 2600.
    expect(steps.map((s) => s.durationMs)).toEqual([1600, 1000]);
  });

  it("the last step never outruns the recording, and no step outruns the cap", () => {
    // Settings holds to the end of a 7s recording...
    expect(one(4, { ...bounds, recordingEndMs: 7000 }).durationMs).toBe(1000);
    // ...which is the upload's length floored to the 200ms grid (7150 -> 7000).
    expect(one(4, clipBounds(DURATIONS, screens, 7150)).durationMs).toBe(1000);
    // On a 20s recording it holds 14s, and the step runs the 4s cap.
    expect(one(4).durationMs).toBe(4000);
  });
});

/** Three product screens with nothing in common — names and text differ in
 *  words, not digits (the screen test drops one-character tokens). */
const SCREENS = ["לוח בקרה", "פרויקט חדש", "בחירת תבנית"];
const TEXTS = ["הפרויקטים שלי", "שם הפרויקט", "מודעה פוסט"];

describe("the reachability bound and the sample guards (review of 0072)", () => {
  it("the floor escape counts only plans that END on the success state", () => {
    // Three 4s product screens, then a navigate X (clip 3000) and the success
    // S (clip 2000) 1000ms apart on one screen. Ending on X would reach 15000,
    // but a compliant plan ends on S: [0, 2, 4, 7] is the best there is, at
    // 14000. "Too SHORT" there would order a retry no plan can satisfy, so it
    // stands down.
    const timeline: AnalysisState[] = [
      ...[0, 4200, 8400].flatMap((t, k) => [
        state({
          timestampMs: t,
          screenName: SCREENS[k]!,
          visibleText: [TEXTS[k]!],
          actionType: "navigate",
        }),
        state({
          timestampMs: t + 3800,
          screenName: SCREENS[k]!,
          visibleText: [TEXTS[k]!],
          actionType: "tap",
        }),
      ]),
      state({
        timestampMs: 12_600,
        screenName: "שמירה",
        visibleText: ["שמירה", "פרסום"],
        actionType: "navigate",
      }),
      state({
        timestampMs: 13_600,
        screenName: "שמירה",
        visibleText: ["שמירה", "פורסם"],
        actionType: "result",
      }),
      state({
        timestampMs: 15_400,
        screenName: "שמירה",
        visibleText: ["שמירה", "פורסם"],
        actionType: "idle",
      }),
    ];
    const bounds: ClipBounds = { ...DURATIONS, recordingEndMs: 15_600 };
    expect(timelineClipMs(timeline, bounds)).toEqual([
      4000, 200, 4000, 200, 4000, 200, 3000, 2000, 200,
    ]);
    const plan = [0, 2, 4, 7].map((sourceIndex) => ({ sourceIndex, label: "שלוש מילים כאן" }));
    expect(
      findPlanViolations(plan, timeline, 7, {
        minSteps: 5,
        notes: null,
        bounds,
        runtime: { minMs: 15_000, maxMs: 21_000 },
      }),
    ).toEqual([]);
  });

  it("a cut never passes the next screen's first state, whatever today's sample", () => {
    // An analysis made on the 200ms grid, read after a_analysis_fps was
    // lowered to 2 (a 500ms sample): the login screen's cut is bounded by the
    // dashboard's first state at 1400, not pushed to 1500 into it.
    const timeline: AnalysisState[] = [
      state({ timestampMs: 0, screenName: "התחברות", visibleText: ["אימייל"], actionType: "idle" }),
      state({
        timestampMs: 1000,
        screenName: "התחברות",
        visibleText: ["אימייל"],
        actionType: "type",
      }),
      state({
        timestampMs: 1400,
        screenName: "לוח בקרה",
        visibleText: ["פרויקטים"],
        actionType: "navigate",
      }),
    ];
    const stale: ClipBounds = { maxMs: 4000, sampleMs: 500, recordingEndMs: 2400 };
    expect(screenEnds(timeline, stale)).toEqual([1400, 1400, 2400]);
  });

  it("an absurd a_analysis_fps leaves a one-millisecond sample, never NaN", async () => {
    await db
      .insert(dbSchema.appConfig)
      .values({ key: "a_analysis_fps", value: 2000 })
      .onConflictDoUpdate({ target: dbSchema.appConfig.key, set: { value: 2000 } });
    try {
      const durations = await stepDurations(db);
      expect(durations).toEqual({ maxMs: 4000, sampleMs: 1 });
      expect(recordingEndMs(57_498, [{ timestampMs: 56_400 }], durations.sampleMs)).toBe(57_498);
    } finally {
      await db.delete(dbSchema.appConfig).where(eq(dbSchema.appConfig.key, "a_analysis_fps"));
    }
  });
});

describe("recordingEndMs (where the last step must stop)", () => {
  const last = [{ timestampMs: 88_000 }];

  it("floors the upload's length to the analysis grid", () => {
    // tavnit: demos.duration_ms 89582 -> 89400, the last 200ms sample inside it.
    expect(recordingEndMs(89_582, last, 200)).toBe(89_400);
    expect(recordingEndMs(89_400, last, 200)).toBe(89_400);
    // At 3 fps the grid is 333ms.
    expect(recordingEndMs(10_000, [{ timestampMs: 0 }], 333)).toBe(9990);
  });

  it("falls back to one sample past the last state when the length is unknown", () => {
    expect(recordingEndMs(null, last, 200)).toBe(88_200);
    expect(recordingEndMs(undefined, last, 200)).toBe(88_200);
  });

  it("never ends before one sample past the last state", () => {
    // A length that floors onto the last state itself (88100 -> 88000), or a
    // stored length shorter than the timeline: the last state's cluster still
    // holds a second sample, so that frame exists.
    expect(recordingEndMs(88_100, last, 200)).toBe(88_200);
    expect(recordingEndMs(50_000, last, 200)).toBe(88_200);
  });
});

describe("the tavnit recording's screens (measured)", () => {
  it("ends every state's screen where the code measured it", () => {
    const fixture = loadFixture("real-tavnit-system-opening.json");
    expect(fixture.recordingMs).toBe(89_582);
    const bounds = fixtureBounds(fixture);
    expect(bounds.recordingEndMs).toBe(89_400);
    // [first state, last state, where that screen ends]. The last screen runs
    // to the recording's end, floored to the 200ms grid.
    const runs: [number, number, number][] = [
      [0, 5, 4400],
      [6, 6, 5200],
      [7, 8, 6800],
      [9, 10, 9200],
      [11, 12, 11_200],
      [13, 13, 12_400],
      [14, 17, 17_600],
      [18, 19, 21_600],
      [20, 24, 31_600],
      [25, 30, 45_000],
      [31, 32, 49_200],
      [33, 42, 60_600],
      [43, 44, 66_200],
      [45, 46, 73_600],
      [47, 52, 89_400],
    ];
    const expected = runs.flatMap(([from, to, end]) =>
      Array.from({ length: to - from + 1 }, () => end),
    );
    expect(fixture.timeline).toHaveLength(expected.length);
    expect(screenEnds(fixture.timeline, bounds)).toEqual(expected);
  });
});

describe("every fixture: no step outruns its screen, its neighbour or the recording", () => {
  const range = (from: number, to: number, step: number): number[] => {
    const out: number[] = [];
    for (let i = from; i < to; i += step) out.push(i);
    return out;
  };
  /** Deterministic selections: every state, every 2nd/3rd/5th at each
   *  offset, sliding windows of 5 and 7 — and the fixture's own pinned plans. */
  const selections = (fixture: TimelineFixture): number[][] => {
    const n = fixture.timeline.length;
    const out: number[][] = [fixture.expected.sourceIndexes];
    if (fixture.expected.dryRunSourceIndexes) out.push(fixture.expected.dryRunSourceIndexes);
    for (const k of [1, 2, 3, 5]) for (let o = 0; o < k; o++) out.push(range(o, n, k));
    for (const size of [5, 7]) for (let s = 0; s + size <= n; s++) out.push(range(s, s + size, 1));
    return out;
  };

  it("holds for every assembled step of every selection", () => {
    expect(FIXTURE_FILES.length).toBeGreaterThanOrEqual(5);
    for (const file of FIXTURE_FILES) {
      const fixture = loadFixture(file);
      const { timeline } = fixture;
      const bounds = fixtureBounds(fixture);
      const ends = screenEnds(timeline, bounds);
      // Read off isNewScreen directly, not off screenEnds: the first screen
      // change after state i, or undefined when its screen runs to the end.
      const changeAfter = (i: number): number | undefined => {
        for (let j = i + 1; j < timeline.length; j++) {
          if (isNewScreen(timeline[j - 1]!, timeline[j]!)) return j;
        }
        return undefined;
      };
      for (const picked of selections(fixture)) {
        const steps = assembleSteps(
          picked.map((i) => ({ sourceIndex: i, label: "כיתוב" })),
          timeline,
          bounds,
        );
        steps.forEach((step, k) => {
          const where = `${file} [${picked.join(",")}] state ${step.sourceIndex}`;
          const end = step.timestampMs + step.durationMs;
          expect(step.durationMs, where).toBeGreaterThanOrEqual(bounds.sampleMs);
          expect(step.durationMs, where).toBeLessThanOrEqual(bounds.maxMs);
          expect(end, where).toBeLessThanOrEqual(ends[step.sourceIndex]!);
          expect(end, where).toBeLessThanOrEqual(bounds.recordingEndMs);
          const next = steps[k + 1];
          if (next) expect(end, where).toBeLessThanOrEqual(next.timestampMs);
          // No clip crosses a screen change: it stops one sample after the
          // last state before the change.
          const j = changeAfter(step.sourceIndex);
          if (j !== undefined) {
            expect(end, where).toBeLessThanOrEqual(timeline[j - 1]!.timestampMs + bounds.sampleMs);
          }
        });
      }
    }
  });
});

describe("timelineClipMs is what a one-step pick renders", () => {
  it("for every state of every fixture", () => {
    // The analysis route sends timelineClipMs to the picker as each state's
    // clipMs, and the model reads the same number in its timeline: a pick of
    // that state with nothing after it must render exactly that long.
    for (const file of FIXTURE_FILES) {
      const fixture = loadFixture(file);
      const bounds = fixtureBounds(fixture);
      const clips = timelineClipMs(fixture.timeline, bounds);
      fixture.timeline.forEach((_, i) => {
        expect(
          assembleSteps([{ sourceIndex: i, label: "כיתוב" }], fixture.timeline, bounds)[0]!
            .durationMs,
          `${file} state ${i}`,
        ).toBe(clips[i]);
      });
    }
  });
});

describe("the render lays the steps out at the length the customer was shown", () => {
  it("every tavnit step at exactly its planned frames, none clamped at the demo's end", () => {
    // totalRuntimeMs is the steps' length the wizard's plan step
    // (step-plan.tsx) and the confirm screen (stepsShapeSummary) show the
    // customer. The composition re-derives every step's frames from the same
    // startMs/durationMs against the demo's length (serviceAStepsTimeline in
    // packages/remotion), so a clamp at the recording's end or a rounding
    // drift would render a different length from the one they were quoted.
    const fixture = loadFixture("real-tavnit-system-opening.json");
    const bounds = fixtureBounds(fixture);
    const demoFrames = msToFrame(bounds.recordingEndMs);
    const hookFrames = 120;
    const picks = [
      fixture.expected.sourceIndexes,
      fixture.expected.dryRunSourceIndexes!,
      // The last state, on the screen that runs to the recording's end.
      [44, 47, 52],
      fixture.timeline.map((_, i) => i).filter((i) => i % 3 === 0),
    ];
    for (const picked of picks) {
      const steps = assembleSteps(
        picked.map((i) => ({ sourceIndex: i, label: "כיתוב" })),
        fixture.timeline,
        bounds,
      );
      const laid = serviceAStepsTimeline({
        hookFrames,
        demoFrames,
        steps: steps.map((s) => ({ startMs: s.timestampMs, durationMs: s.durationMs })),
      });
      // 30fps (FPS, packages/remotion/src/schema.ts).
      const frames = laid.steps.reduce((sum, s) => sum + s.durationInFrames, 0);
      expect(frames, `[${picked.join(",")}]`).toBe((totalRuntimeMs(steps) * 30) / 1000);
      expect(laid.durationInFrames).toBe(hookFrames + frames);
      steps.forEach((s, k) => {
        // Not clamped: the step's last wanted frame is inside the demo.
        expect(msToFrame(s.timestampMs + s.durationMs)).toBeLessThanOrEqual(demoFrames);
        expect(laid.steps[k]!.durationInFrames).toBe((s.durationMs * 30) / 1000);
      });
    }
  });
});

/**
 * The arithmetic the shipped constants must satisfy together. Steps follow
 * the footage since 0072, so no step count fills the band by construction any
 * more; what has to hold is that every count from the minimum to the maximum
 * CAN land inside it. b60b5b6 broke the older form of this — it raised the
 * band floor to 16s while every unsqueezed step clamped to the 3s floor, so
 * the 5-step minimum totalled 15s and could never validate; the prompt
 * licensed a shape the validator always rejected, and the live
 * 4-failures-in-a-row followed. Values re-read through the config path,
 * expectations spelled out: a test that recomputes from the constants cannot
 * catch them moving apart.
 */
describe("band coherence — every legal step count fits the shipped band", () => {
  it("5 through 7 steps can each total inside the band and validate with zero violations", async () => {
    const durations = await stepDurations(db);
    const band = await stepRuntimeBand(db);
    expect(durations).toEqual({ maxMs: 4000, sampleMs: 200 });
    expect(band).toEqual({ minMs: 15_000, maxMs: 21_000 });
    expect(A_STEPS_MIN_DEFAULT).toBe(5);
    expect(A_STEPS_MAX_DEFAULT).toBe(7);
    expect(MIN_GAP_MS).toBe(1600);
    // The minimum at the cap does not top the ceiling (5 x 4s = 20s)...
    expect(A_STEPS_MIN_DEFAULT * durations.maxMs).toBeLessThanOrEqual(band.maxMs);

    const words = ["אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע"];
    for (let n = A_STEPS_MIN_DEFAULT; n <= A_STEPS_MAX_DEFAULT; n++) {
      // ...every count at the cap reaches the floor, and every count at the
      // closest legal spacing fits under the ceiling.
      expect(n * durations.maxMs).toBeGreaterThanOrEqual(band.minMs);
      expect(n * MIN_GAP_MS).toBeLessThanOrEqual(band.maxMs);

      // A recording of n screens, each held `stepMs` (a navigation in, an
      // idle frame one sample before the next screen), so a step picked on a
      // screen's first frame runs the whole screen. stepMs aims the total at
      // the band's middle: 3600 x 5, 3000 x 6, 2400 x 7.
      const stepMs = Math.min(
        durations.maxMs,
        Math.floor((band.minMs + band.maxMs) / 2 / n / durations.sampleMs) * durations.sampleMs,
      );
      const timeline: AnalysisState[] = Array.from({ length: n }, (_, k) => [
        state({
          timestampMs: k * stepMs,
          screenName: `מסך ${words[k]}`,
          visibleText: [words[k]!],
          actionType: k === n - 1 ? "result" : "navigate",
        }),
        state({
          timestampMs: (k + 1) * stepMs - durations.sampleMs,
          screenName: `מסך ${words[k]}`,
          visibleText: [words[k]!],
          actionType: "idle",
        }),
      ]).flat();
      const bounds = clipBounds(durations, timeline, n * stepMs);
      const steps = Array.from({ length: n }, (_, k) => ({
        sourceIndex: 2 * k,
        label: `בוחרים את ${words[k]}`,
      }));
      const total = totalRuntimeMs(assembleSteps(steps, timeline, bounds));
      expect(total, `${n} steps`).toBe(n * stepMs);
      expect(total).toBeGreaterThanOrEqual(band.minMs);
      expect(total).toBeLessThanOrEqual(band.maxMs);
      expect(
        findPlanViolations(steps, timeline, A_STEPS_MAX_DEFAULT, {
          minSteps: A_STEPS_MIN_DEFAULT,
          notes: null,
          bounds,
          runtime: band,
        }),
        `${n} steps`,
      ).toEqual([]);
    }
  });
});

describe("demo notes (the questionnaire answer channel)", () => {
  it("appends trimmed notes to the persisted questionnaire; empty and questionnaire-less rejected", async () => {
    await expect(addDemoNote(db, businessId, "   ")).rejects.toThrow(/empty/);
    const bare = await createBusiness(db, { ownerEmail: "bare@example.com", name: "בלי שאלון" });
    await expect(addDemoNote(db, bare.id, "הערה")).rejects.toThrow(/no questionnaire/);

    const notes = await addDemoNote(db, businessId, "  ההסבר של הלקוח  ");
    expect(notes).toEqual(["ההסבר של הלקוח"]);
    // Lands on the questionnaire itself, where both passes read it.
    expect((await requireQuestionnaire(db, businessId)).demo_notes).toEqual(["ההסבר של הלקוח"]);
  });

  it("a questionnaire resubmit without demo_notes keeps them; explicit demo_notes replaces", async () => {
    // Questionnaire forms never carry demo_notes — a resubmit must not
    // silently discard answered moments.
    await setQuestionnaire(db, businessId, QUESTIONNAIRE);
    expect((await requireQuestionnaire(db, businessId)).demo_notes).toEqual(["ההסבר של הלקוח"]);

    await setQuestionnaire(db, businessId, { ...QUESTIONNAIRE, demo_notes: ["אחרת"] });
    expect((await requireQuestionnaire(db, businessId)).demo_notes).toEqual(["אחרת"]);
  });

  it("caps at MAX_DEMO_NOTES", async () => {
    await setQuestionnaire(db, businessId, {
      ...QUESTIONNAIRE,
      demo_notes: Array.from({ length: MAX_DEMO_NOTES }, (_, i) => `הערה ${i}`),
    });
    await expect(addDemoNote(db, businessId, "אחת יותר מדי")).rejects.toThrow(/limit/);
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

/**
 * The 8a move: readTimeMs/totalRuntimeMs live in plan-format (client-safe) and
 * demo-step-plans re-exports them. Reference equality — not equal output — is
 * the pin: a drifted private copy would still produce equal output today.
 */
describe("plan-format re-export identity", () => {
  it("the re-exports ARE the plan-format functions, not copies", async () => {
    const planFormat = await import("../src/plan-format");
    expect(readTimeMs).toBe(planFormat.readTimeMs);
    expect(totalRuntimeMs).toBe(planFormat.totalRuntimeMs);
    // The 0049 move: the tokenizer the editor's marks use is the one the
    // server flagged with — a drifted copy would mark the wrong words.
    expect(normalizeWord).toBe(planFormat.normalizeWord);
    expect(tokenizeWords).toBe(planFormat.tokenizeWords);
    expect(splitWords).toBe(planFormat.splitWords);
  });
});

/**
 * The 8b move: the label word band and the a_steps_min default live in
 * plan-format so the wizard's soft warnings share the server's numbers.
 * Value pins; the validator's own use of MAX_LABEL_WORDS is pinned by the
 * "over 6 words" violation test above.
 */
describe("plan-format editor constants (8b move)", () => {
  it("word band and min-steps default hold their shipped values", async () => {
    const planFormat = await import("../src/plan-format");
    expect(planFormat.MAX_LABEL_WORDS).toBe(6);
    expect(planFormat.MIN_LABEL_WORDS).toBe(3);
    expect(planFormat.A_STEPS_MIN_DEFAULT).toBe(5);
  });
});
