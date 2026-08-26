import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  findPlanViolations,
  generateStepPlan,
  getStepPlan,
  planStepsSchema,
  planTimingMarkdown,
  readTimeMs,
  stepDurations,
  stepRuntimeBand,
  requestDemoPlan,
  runPlanRegression,
  totalRuntimeMs,
  unexplainedMomentsSchema,
  updatePlanSteps,
} from "../src/pipelines/demo-step-plans";
import { createDemo } from "../src/pipelines/demos";
import { FIXTURES_DIR, PROMPTS_DIR } from "../src/paths";
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
    // The canned analysis: idle/dup/low/unreadable states and the two login
    // states (screenKind skip rule) are skipped.
    expect(steps.map((s) => s.sourceIndex)).toEqual([3, 5, 6, 7, 10, 11]);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.timestampMs).toBeGreaterThan(steps[i - 1]!.timestampMs);
    }
    // The video ends on the success state, label lifted off the screen, no "!".
    const last = steps[steps.length - 1]!;
    expect(last.actionType).toBe("result");
    expect(last.label).toBe("הקמפיין נוצר");
    // Every per-action default sits under the 3s floor, so every step —
    // including the ending — runs exactly MIN_STEP_MS (the canned timeline's
    // selected states are all >= 3s apart, so the gap cap never bites).
    expect(last.durationMs).toBe(3000);
    expect(steps.map((s) => s.durationMs)).toEqual([3000, 3000, 3000, 3000, 3000, 3000]);
    // No step's window may reach into the next step's: 200ms of source shown
    // twice back to back is the defect this model exists to make impossible.
    for (let i = 0; i < steps.length - 1; i++) {
      expect(steps[i]!.timestampMs + steps[i]!.durationMs).toBeLessThanOrEqual(
        steps[i + 1]!.timestampMs,
      );
    }
    // Total runtime: six product steps at the 3s floor — inside the 16-21s
    // band real recordings are held to.
    const total = steps.reduce((ms, s) => ms + s.durationMs, 0);
    expect(total).toBe(18_000);
    expect(totalRuntimeMs(steps)).toBe(total);

    const moments = unexplainedMomentsSchema.parse(plan!.unexplainedMoments);
    expect(moments).toHaveLength(1);
    expect(moments[0]!.timestampMs).toBe(12_000);
  });

  it("the canned plan reaches the minimum when index-even thinning would not", { timeout: 60_000 }, async () => {
    // subsampleClusters thins by INDEX, so a cluster of states close together
    // can spend most of the cap before the min-gap walk runs — and the
    // minimum-step waiver counts a forward greedy over the legal pool, sees
    // the states the thinning threw away, and refuses to forgive the
    // shortfall. generateStepPlan then threw "dry-run plan violates its own
    // rules" on the path the whole suite, `aiugc plan regress` keyless and a
    // DRY_RUN worker all run. Timestamps are on the analyser's real grid
    // (multiples of 200ms, never closer than 400ms) over a 21.6s recording.
    const ts = [0, 3000, 4000, 5600, 10_000, 11_000, 12_600, 14_000, 20_000, 21_600];
    const words = ["אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע", "עשר"];
    const timeline = ts.map((t, i) =>
      state({
        timestampMs: t,
        visibleText: [words[i]!],
        actionType: i === ts.length - 1 ? "result" : "tap",
      }),
    );
    const draft = await generateStepPlan(db, { timeline, questionnaire: QUESTIONNAIRE });
    expect(draft.steps.length).toBeGreaterThanOrEqual(5);
    // The ending is the one state the format cannot lose.
    expect(draft.steps[draft.steps.length - 1]!.sourceIndex).toBe(ts.length - 1);
  });

  it("the minimum counts only states the ending rule allows", { timeout: 60_000 }, async () => {
    // Real recordings keep rolling after the success screen, and a state after
    // it can never be a step — the last-step rule forbids it. Counting those
    // states as "selectable" demanded a plan the other rule rejects, which is
    // the other half of the keyless throw: the canned plan stops at the ending
    // and this walk did not. Here four states precede the success screen and
    // four follow it, against a minimum of five.
    const ts = [0, 3200, 6400, 20_000, 25_000, 26_600, 28_200, 29_800];
    const words = ["אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה"];
    const timeline = ts.map((t, i) =>
      state({
        timestampMs: t,
        visibleText: [words[i]!],
        actionType: i === 3 ? "result" : "tap",
      }),
    );
    const draft = await generateStepPlan(db, { timeline, questionnaire: QUESTIONNAIRE });
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 3]);
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

  it("a regenerate while one is still generating collapses onto the live job", { timeout: 60_000 }, async () => {
    // Every press must not be a fresh paid enqueue: the route's budget gate
    // reads usage that lags the queue, so uncollapsed presses outrun it.
    const first = await requestDemoPlan(db, demoId);
    const second = await requestDemoPlan(db, demoId);
    expect(second.planId).toBe(first.planId);
    expect(second.jobId).toBe(first.jobId);
    await drainAll();
    expect((await getStepPlan(db, first.planId))?.status).toBe("ready");
  });

  it("the job-level account-cap backstop fails a queued plan fast, in Hebrew", { timeout: 60_000 }, async () => {
    // A customer (not admin-bypassed) account at its 0027 llm_tokens ceiling:
    // the queued job must die as a fast PermanentError — never park, never
    // spend — even though it was enqueued before the cap was hit.
    const customer = await createBusiness(db, { ownerEmail: "capped@example.com", name: "עסק שמור" });
    await setQuestionnaire(db, customer.id, QUESTIONNAIRE);
    const demo = await createDemo(db, { businessId: customer.id, filePath: tempFile("capped.mp4") });
    await drainAll(); // ingest -> analysis ready

    await recordUsage(db, {
      provider: "anthropic",
      kind: "llm_tokens",
      quantity: 500_000,
      businessId: customer.id,
    });

    const { planId: cappedPlanId } = await requestDemoPlan(db, demo.id);
    await drainAll();
    const plan = await getStepPlan(db, cappedPlanId);
    expect(plan?.status).toBe("failed");
    expect(plan?.failReason).toMatch(/מכסת/);
  });
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
    // Derived, not client-supplied. 1000ms -> 18500ms is a wide gap, so
    // nothing squeezes either step — and both their asks (step 0's 4-word
    // label needs 2000ms, step 1's result default is 2800ms) sit under the 3s
    // floor, so both steps run exactly MIN_STEP_MS.
    expect(steps[0]!.durationMs).toBe(3000);
    expect(steps[1]!.durationMs).toBe(3000);
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
  // 2s apart: these fixtures stand for VALID plans, and two states closer
  // together than one step is long are now a violation in their own right.
  const timeline: AnalysisState[] = [
    state({ timestampMs: 0, visibleText: ["פרויקט חדש", "שמירה"] }),
    state({ timestampMs: 2000, visibleText: ["הקמפיין נוצר!"], actionType: "result" }),
    state({ timestampMs: 4000, visibleText: [], legibility: "unreadable" }),
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

  it("demo-description words are allowed label words — the upload note widens the vocabulary", () => {
    // "קופון" is on no screen and in no questionnaire field; only the
    // customer's own note carries it — the same customer-authored-claims
    // principle as demo_notes, wired per-demo instead of per-business.
    const steps = [{ sourceIndex: 0, label: "קופון הנחה" }];
    expect(
      findPlanViolations(steps, timeline, QUESTIONNAIRE, 8, undefined, "מזינים קופון הנחה בקופה"),
    ).toEqual([]);
    // Absent everywhere -> still a violation. The description weakens the
    // rule by exactly its own words, nothing more.
    expect(
      findPlanViolations(steps, timeline, QUESTIONNAIRE, 8).some((v) =>
        v.includes("appears neither"),
      ),
    ).toBe(true);
    // Blank and null are the no-description case, not a wildcard.
    expect(
      findPlanViolations(steps, timeline, QUESTIONNAIRE, 8, undefined, "   ").some((v) =>
        v.includes("appears neither"),
      ),
    ).toBe(true);
  });

  it("shape rules: model plans must end on the result state and explain under-min counts", () => {
    // Ends mid-journey while a selectable result state exists -> violation.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "שמירה" }], timeline, QUESTIONNAIRE, 8, {
        minSteps: 1,
        notes: null,
        minStepMs: 1400,
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
        { minSteps: 1, notes: null, minStepMs: 1400 },
      ),
    ).toEqual([]);
    // Ends mid-journey but `notes` explains (the timeline's only "result"
    // states may be mistyped error screens) -> the notes waive the rule.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "שמירה" }], timeline, QUESTIONNAIRE, 8, {
        minSteps: 1,
        notes: "אין בהקלטה מסך סיום ברור",
        minStepMs: 1400,
      }),
    ).toEqual([]);
    // No selectable result in the timeline -> the rule cannot apply.
    expect(
      findPlanViolations(
        [{ sourceIndex: 0, label: "שמירה" }],
        [state({ timestampMs: 0, visibleText: ["שמירה"] })],
        QUESTIONNAIRE,
        8,
        { minSteps: 1, notes: null, minStepMs: 1400 },
      ),
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
      findPlanViolations(short, roomy, QUESTIONNAIRE, 8, {
        minSteps: 5,
        notes: null,
        minStepMs: 1400,
      }).some((v) => v.includes("fewer than the minimum")),
    ).toBe(true);
    // ...and `notes` does NOT waive it any more. That hatch belongs to the
    // last-step rule alone; waiving both is how a 5-step plan with a
    // 26-second hole in the middle passed.
    expect(
      findPlanViolations(short, roomy, QUESTIONNAIRE, 8, {
        minSteps: 5,
        notes: "בסרטון אין יותר צעדים",
        minStepMs: 1400,
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
        QUESTIONNAIRE,
        8,
        { minSteps: 6, notes: null, minStepMs: 1400 },
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
      findPlanViolations(four, bunched, QUESTIONNAIRE, 8, {
        minSteps: 5,
        notes: null,
        minStepMs: 1400,
      }),
    ).toEqual([]);
    // Space that pair out and the same 4-step plan IS a violation.
    const spread = bunched.map((s, i) =>
      i === 4 ? state({ ...s, timestampMs: 8000 }) : s,
    );
    expect(
      findPlanViolations(
        four.map((s) => (s.sourceIndex === 4 ? { ...s } : s)),
        spread,
        QUESTIONNAIRE,
        8,
        { minSteps: 5, notes: null, minStepMs: 1400 },
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
      QUESTIONNAIRE,
      8,
      { minSteps: 6, notes: null, minStepMs: 1400 },
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

  it("pools visibleText across a sameStateAsPrevious run (real BotTeacher state 36)", () => {
    // Exact strings from demo ba70c3d7 / analysis 6a1b247e: the anchor frame's
    // OCR clipped "נשלים" to "נשלי"; the dup frames of the SAME screen read it
    // fully. The label must match against the whole run, not the anchor alone.
    const run: AnalysisState[] = [
      state({
        timestampMs: 54_600,
        visibleText: ["עוד רגע לפני שמתחילים – בואו נשלי", "הפרטים האקדמיים קובעים איך נתאים לך את המערכת. אפשר לשנות ב", "Mohamed Taha", "סוג תואר"],
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
    // The word the anchor clipped, found on the dups: no violation.
    expect(findPlanViolations([{ sourceIndex: 0, label: "בואו נשלים" }], run, QUESTIONNAIRE, 8)).toEqual([]);
    // A word absent from the entire run still fails — pooling adds no slack.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "חוויה" }], run, QUESTIONNAIRE, 8).some((v) =>
        v.includes("חוויה"),
      ),
    ).toBe(true);
  });

  it("keeps the מלאה true positive (real BotTeacher state 72)", () => {
    // State 72's run is itself alone; the screen says "מבחן מלא", never "מלאה".
    const tourState = state({
      timestampMs: 109_800,
      visibleText: ["boteacher", "BRONZE · עוזר אקדמי אישי", "6/11", "מכונת המבחנים", "סימולציה של מבחן מלא על חומר הקורס, עם ציון בסוף – כדי", "שתגיע למבחן האמיתי בלי חן", "המשך", "חזור", "דלג על הכל"],
      actionType: "navigate",
    });
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "סימולציה מלאה" }], [tourState], QUESTIONNAIRE, 8).some(
        (v) => v.includes("מלאה"),
      ),
    ).toBe(true);
    // Words genuinely on that screen pass, including across the · separator.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "מכונת המבחנים" }], [tourState], QUESTIONNAIRE, 8),
    ).toEqual([]);
  });

  it("normalizes gershayim, glued separators and niqqud on both sides", () => {
    const noisy: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ['הלו"ז שלי', "BRONZE·עוזר אקדמי", "שָׁלוֹם"] }),
    ];
    // Hebrew gershayim (U+05F4) in the label vs ASCII quote on screen.
    expect(findPlanViolations([{ sourceIndex: 0, label: "לו״ז" }], noisy, QUESTIONNAIRE, 8)).toEqual([]);
    // The OCR glued a · onto the word; whitespace splitting left it stuck.
    expect(findPlanViolations([{ sourceIndex: 0, label: "עוזר" }], noisy, QUESTIONNAIRE, 8)).toEqual([]);
    // Screen carries niqqud, the label does not.
    expect(findPlanViolations([{ sourceIndex: 0, label: "שלום" }], noisy, QUESTIONNAIRE, 8)).toEqual([]);
  });

  it("words from demo_notes are allowed label words — an explained moment becomes copy", () => {
    // Not on state 0's screen and not elsewhere in the questionnaire...
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "תבניות מוכנות" }], timeline, QUESTIONNAIRE, 8)
        .length,
    ).toBeGreaterThan(0);
    // ...but once the customer's answer carries them, the label passes.
    const explained = { ...QUESTIONNAIRE, demo_notes: ["מסך בחירת תבניות מוכנות"] };
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "תבניות מוכנות" }], timeline, explained, 8),
    ).toEqual([]);
  });

  it("allows instruction verbs — a caption tells you what to DO (real a179f069 state 1)", () => {
    // Verbatim visibleText from the shipped analysis. The opening caption the
    // format wants is "go to boteacher.com", and every word of it has to
    // clear the anti-fabrication rule: "boteacher" off the screen, "כנסו" off
    // the instruction allowlist. Before the allowlist this failed on exactly
    // one word and cost a paid corrective re-request.
    const home = state({
      timestampMs: 2800,
      visibleText: ["Create /", "Higgsfe", "https://boteacher.com", "Ask about this page", "Apps", "boteacher", "שבוע", "יום", "היום", "מרחב לנשום"],
      actionType: "navigate",
      legibility: "low",
    });
    expect(findPlanViolations([{ sourceIndex: 0, label: "כנסו לboteacher" }], [home], QUESTIONNAIRE, 8)).toEqual([]);
    // Prefixed forms cost nothing either — Hebrew glues ו onto verbs too.
    expect(findPlanViolations([{ sourceIndex: 0, label: "ולחצו boteacher" }], [home], QUESTIONNAIRE, 8)).toEqual([]);
    // A verb that is NOT on the list still fails: the allowlist is a list, not
    // a morphology rule.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "הורידו boteacher" }], [home], QUESTIONNAIRE, 8).some(
        (v) => v.includes("הורידו"),
      ),
    ).toBe(true);
  });

  it("allows pronouns addressed to the viewer", () => {
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "שמירה שלכם" }], timeline, QUESTIONNAIRE, 8),
    ).toEqual([]);
    expect(
      findPlanViolations([{ sourceIndex: 1, label: "הוא נוצר" }], timeline, QUESTIONNAIRE, 8),
    ).toEqual([]);
  });

  it("still rejects a product claim absent from the screen and the questionnaire", () => {
    // The rule 2b loosens for instructions must NOT loosen for claims:
    // "automatically" is a promise about the product, and a promise the
    // recording does not show belongs in the questionnaire (which the
    // validator already reads) — never in a caption the model invented.
    const bare: Questionnaire = { ...QUESTIONNAIRE, what_it_does: "יוצר קמפיינים" };
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "שמירה אוטומטית" }], timeline, bare, 8).some((v) =>
        v.includes("אוטומטית"),
      ),
    ).toBe(true);
    // No root or morphology matching either: the questionnaire saying
    // "אוטומטי" does not license "אוטומטית".
    expect(
      findPlanViolations(
        [{ sourceIndex: 0, label: "שמירה אוטומטית" }],
        timeline,
        { ...bare, what_it_does: "יוצר קמפיינים אוטומטי" },
        8,
      ).some((v) => v.includes("אוטומטית")),
    ).toBe(true);
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

  it("flags skip-kind screens for the model, treats absent screenKind as no information", () => {
    const kinds: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["התחברות"], screenKind: "login" }),
      state({ timestampMs: 1000, visibleText: ["דף הבית"], screenKind: "product" }),
      state({ timestampMs: 2000, visibleText: ["שגיאה"], actionType: "result", screenKind: "error" }),
      state({ timestampMs: 3000, visibleText: ["נשמר"] }), // v2-era: no screenKind
    ];
    // Login screens are never steps for the model.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "התחברות" }], kinds, QUESTIONNAIRE, 8).some(
        (v) => v.includes('"login"'),
      ),
    ).toBe(true);
    // product and absent screenKind both pass.
    expect(
      findPlanViolations([{ sourceIndex: 1, label: "דף הבית" }], kinds, QUESTIONNAIRE, 8),
    ).toEqual([]);
    expect(
      findPlanViolations([{ sourceIndex: 3, label: "נשמר" }], kinds, QUESTIONNAIRE, 8),
    ).toEqual([]);
    // The only "result" is an error screen the analysis mistyped — the shape
    // rule must not force the plan to end on a state it may never select.
    expect(
      findPlanViolations([{ sourceIndex: 1, label: "דף הבית" }], kinds, QUESTIONNAIRE, 8, {
        minSteps: 1,
        notes: null,
        minStepMs: 1400,
      }),
    ).toEqual([]);
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
    // Six is the ceiling: five passes, seven does not.
    expect(
      findPlanViolations(
        [{ sourceIndex: 0, label: "פרויקט חדש שמירה פרויקט חדש" }],
        timeline,
        QUESTIONNAIRE,
        8,
      ),
    ).toEqual([]);
    expect(
      findPlanViolations(
        [{ sourceIndex: 0, label: "פרויקט חדש שמירה פרויקט חדש שמירה פרויקט" }],
        timeline,
        QUESTIONNAIRE,
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
        QUESTIONNAIRE,
        1,
      ).some((v) => v.includes("maximum is 1")),
    ).toBe(true);
    expect(findPlanViolations([], timeline, QUESTIONNAIRE, 8)).toEqual(["the plan has zero steps"]);
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
        visibleText: ["Takin Syllabus.txt", "זוהה סילבוס", "יעד ניתוב", "חומר קורס", "אישר ניתוב (1)"],
      }),
    ];
    const ok = (label: string) =>
      findPlanViolations([{ sourceIndex: 0, label }], confirm, QUESTIONNAIRE, 8).length === 0;
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

  it("morphology is still not matched — a claim and a plural stay rejected", () => {
    // Deliberate, and measured rather than papered over: "הקמפיין" is the
    // questionnaire's own noun in the definite singular and it still fails
    // against "קמפיינים", which is what keeps dry-run-campaign-app red.
    const screen = [state({ timestampMs: 0, visibleText: ["שמירה"] })];
    const words = (label: string) =>
      findPlanViolations([{ sourceIndex: 0, label }], screen, QUESTIONNAIRE, 8);
    expect(words("הקמפיין נוצר").some((v) => v.includes('"הקמפיין"'))).toBe(true);
    // A benefit the customer never claimed stays out. ("אוטומטית" would pass
    // here — it is in this questionnaire's what_it_does, which is the rule
    // working, not failing.)
    expect(words("בחינם").some((v) => v.includes('"בחינם"'))).toBe(true);
  });
});

describe("the runtime band (steps only — the hook sits on top)", () => {
  const DURATIONS = { byActionType: {}, minMs: 1400, maxMs: 4000 };
  const band = { durations: DURATIONS, minMs: 11_000, maxMs: 16_000 };
  /** Six states 3s apart ending on a result: room for any plan shape. */
  const wide: AnalysisState[] = [
    state({ timestampMs: 0, visibleText: ["אחת"], actionType: "navigate" }),
    state({ timestampMs: 3000, visibleText: ["שתיים"], actionType: "tap" }),
    state({ timestampMs: 6000, visibleText: ["שלוש"], actionType: "type" }),
    state({ timestampMs: 9000, visibleText: ["ארבע"], actionType: "select" }),
    state({ timestampMs: 12_000, visibleText: ["חמש"], actionType: "scroll" }),
    state({ timestampMs: 15_000, visibleText: ["שש"], actionType: "result" }),
  ];
  const pick = (...i: number[]) =>
    i.map((n) => ({ sourceIndex: n, label: wide[n]!.visibleText[0]! }));
  const shape = (steps: { sourceIndex: number; label: string }[]) =>
    findPlanViolations(steps, wide, QUESTIONNAIRE, 8, {
      minSteps: 1,
      notes: null,
      minStepMs: 1400,
      runtime: band,
    });

  it("flags a plan that is too short, and says which way to move", () => {
    // 1800 + 1600 + 2800 = 6200ms.
    const v = shape(pick(0, 1, 5)).find((x) => x.includes("total"));
    expect(v).toContain("6200ms");
    expect(v).toContain("too SHORT");
    expect(v).toContain("11000-16000ms");
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
    // Eight states would be needed to overrun a 3s grid, so squeeze the band
    // instead — the rule is the comparison, not the constant.
    const v = findPlanViolations(pick(0, 1, 2, 3, 4, 5), wide, QUESTIONNAIRE, 8, {
      minSteps: 1,
      notes: null,
      minStepMs: 1400,
      runtime: { ...band, maxMs: 12_000 },
    }).find((x) => x.includes("total"));
    expect(v).toContain("12400ms");
    expect(v).toContain("too LONG");
  });

  it("is silent inside the band, and absent when no band is supplied", () => {
    // 1800 + 1600 + 2200 + 1800 + 2200 + 2800 = 12400ms.
    expect(shape(pick(0, 1, 2, 3, 4, 5))).toEqual([]);
    expect(
      findPlanViolations(pick(0, 1, 5), wide, QUESTIONNAIRE, 8, {
        minSteps: 1,
        notes: null,
        minStepMs: 1400,
      }),
    ).toEqual([]);
  });

  it("measures ASSEMBLED windows, not nominal per-action defaults", () => {
    // Nominal: navigate 1800 + tap 1600 + result 2800 = 6200 (in nobody's
    // band). Assembled: the 1000ms gap caps step 0 and a six-word label lifts
    // step 1 over its 1600 default. A check reading DEFAULT_STEP_MS would see
    // a number this video never shows.
    const tight: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["אחת"], actionType: "navigate" }),
      state({ timestampMs: 1000, visibleText: ["אחת שתיים שלוש ארבע חמש שש"], actionType: "tap" }),
      state({ timestampMs: 20_000, visibleText: ["שש"], actionType: "result" }),
    ];
    const steps = [
      { sourceIndex: 0, label: "אחת" },
      { sourceIndex: 1, label: "אחת שתיים שלוש ארבע חמש שש" },
      { sourceIndex: 2, label: "שש" },
    ];
    // 1000 (gap) + 2800 (six words, read-time) + 2800 (result) = 6600ms.
    // Asserted through the CEILING: this timeline's states are 1000ms apart,
    // so only two of them can ever be selected and the 11s floor is genuinely
    // unreachable — the floor's escape now says so and stays quiet. The
    // ceiling has no escape, and reports the same assembled number.
    expect(
      findPlanViolations(steps, tight, QUESTIONNAIRE, 8, {
        minSteps: 1,
        notes: null,
        minStepMs: 1400,
        runtime: { durations: DURATIONS, minMs: 5000, maxMs: 6000 },
      }).find((x) => x.includes("total")),
    ).toContain("6600ms");
  });

  it("waives the FLOOR when the recording is too short to reach it, never the ceiling", () => {
    // demos.ts accepts an 8-second recording. Every selectable state selected,
    // perfectly spaced, assembles to 10000ms — the floor is unreachable, so
    // "ADD one or two more distinct product states" is advice about states
    // that do not exist. Before the waiver this burned the retry and failed
    // the plan permanently, with a Hebrew "try again" that never would.
    const eightSeconds: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["אחת"], actionType: "navigate" }),
      state({ timestampMs: 2000, visibleText: ["שתיים"], actionType: "tap" }),
      state({ timestampMs: 4000, visibleText: ["שלוש"], actionType: "type" }),
      state({ timestampMs: 6000, visibleText: ["ארבע"], actionType: "select" }),
      state({ timestampMs: 8000, visibleText: ["חמש"], actionType: "result" }),
    ];
    const everything = eightSeconds.map((s, i) => ({
      sourceIndex: i,
      label: s.visibleText[0]!,
    }));
    expect(totalRuntimeMs(assembleSteps(everything, eightSeconds, DURATIONS))).toBe(10_000);
    expect(
      findPlanViolations(everything, eightSeconds, QUESTIONNAIRE, 8, {
        minSteps: 5,
        notes: null,
        minStepMs: 1400,
        runtime: band,
      }),
    ).toEqual([]);
    // The same 10000ms plan on a recording long enough to do better IS flagged
    // — the waiver is about the timeline, never about the total.
    expect(
      shape(pick(0, 1, 5)).some((v) => v.includes("too SHORT")),
    ).toBe(true);
    // And the ceiling never gets the escape: a long plan can always drop steps.
    expect(
      findPlanViolations(pick(0, 1, 2, 3, 4, 5), wide, QUESTIONNAIRE, 8, {
        minSteps: 1,
        notes: null,
        minStepMs: 1400,
        runtime: { ...band, minMs: 30_000, maxMs: 12_000 },
      }).some((v) => v.includes("too LONG")),
    ).toBe(true);
  });

  it("notes does not waive the band — a short ad is short however it is explained", () => {
    expect(
      findPlanViolations(pick(0, 1, 5), wide, QUESTIONNAIRE, 8, {
        minSteps: 1,
        notes: "בסרטון אין יותר מסכים",
        minStepMs: 1400,
        runtime: band,
      }).some((x) => x.includes("too SHORT")),
    ).toBe(true);
  });

  it("the floor's escape never strands the ending — a reachable floor stays enforced", () => {
    // The leftmost greedy this replaced took every state at the earliest legal
    // moment (maximum CARDINALITY) and then could not take the final state,
    // 600ms later — so it valued this timeline at 10800ms, declared the 11s
    // floor unreachable and switched the check OFF. A 9000ms plan then shipped
    // with zero violations. The floor IS reachable here: skipping 8000 to take
    // 8600 assembles 11000ms.
    const ts = [0, 1400, 2400, 3200, 5600, 6400, 8000, 8600];
    const words = ["אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה"];
    const grid: AnalysisState[] = ts.map((t, i) =>
      state({
        timestampMs: t,
        visibleText: [words[i]!],
        actionType: i === ts.length - 1 ? "result" : "tap",
      }),
    );
    const short = [0, 1, 3, 4, 7].map((i) => ({ sourceIndex: i, label: words[i]! }));
    expect(totalRuntimeMs(assembleSteps(short, grid, DURATIONS))).toBe(9000);
    expect(
      findPlanViolations(short, grid, QUESTIONNAIRE, 8, {
        minSteps: 5,
        notes: null,
        minStepMs: 1400,
        runtime: band,
      }).some((v) => v.includes("too SHORT")),
    ).toBe(true);
  });

  it("the floor's escape ignores states after the success — post-success filming cannot certify an unreachable floor", () => {
    // Success at 9s of a 21s recording, customer kept filming after it (the
    // normal case, per the last-step rule's own comment). An ending-compliant
    // plan tops out at 4 steps x 3000ms = 12000ms; the states at 12/15/18/21s
    // can never be steps, so counting their coverage (>= the 15s floor) would
    // order the model to add pre-ending states that do not exist, burn the one
    // retry, and fail the plan permanently. Bounded at the ending, the escape
    // forgives the shortfall — shipped at the 3s-floor change, when the raised
    // band moved this asymmetry onto ordinary short demos.
    const ts = [0, 3000, 6000, 9000, 12_000, 15_000, 18_000, 21_000];
    const grid: AnalysisState[] = ts.map((t, i) =>
      state({
        timestampMs: t,
        visibleText: [`מסך ${i}`],
        actionType: i === 3 ? "result" : "tap",
      }),
    );
    const plan = [0, 1, 2, 3].map((i) => ({ sourceIndex: i, label: `מסך ${i}` }));
    const floorEra = { byActionType: {}, minMs: 3000, maxMs: 4000 };
    expect(totalRuntimeMs(assembleSteps(plan, grid, floorEra))).toBe(12_000);
    expect(
      findPlanViolations(plan, grid, QUESTIONNAIRE, 7, {
        minSteps: 4,
        notes: null,
        minStepMs: 3000,
        runtime: { durations: floorEra, minMs: 15_000, maxMs: 21_000 },
      }),
    ).toEqual([]);
  });

  it("the floor's escape measures capped gaps, not wall clock", () => {
    // Two states 30 seconds apart. The wall clock says 30s is available, but a
    // step can only claim the gap to the state actually selected after it,
    // capped at one step's ceiling — so the most this timeline can ever
    // assemble is 2 x 2800 = 5600ms and the 11s floor is unreachable. The old
    // span-based bound read 30000 + 2800 and ordered the model to add states
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
        QUESTIONNAIRE,
        8,
        { minSteps: 1, notes: null, minStepMs: 1400, runtime: band },
      ),
    ).toEqual([]);
  });
});

describe("a caption must outlast its own read time", () => {
  const DURATIONS = { byActionType: {}, minMs: 1400, maxMs: 4000 };
  const band = { durations: DURATIONS, minMs: 11_000, maxMs: 16_000 };
  /** The shipped a179f069 shape: a long caption on a state only 1600ms before
   *  the next selected one, so the gap cap overrides the read-time floor. */
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
    findPlanViolations(steps(first), squeezed, QUESTIONNAIRE, 8, {
      minSteps: 1,
      notes: null,
      minStepMs: 1400,
      runtime: band,
    });

  it("flags the caption the gap cap squeezed, and names both exits", () => {
    // Six words need 2800ms; the window is 1600ms because state 1 is 1600ms
    // later. (1600 - 400 lead) at 2.5 words/sec = 3 words that would fit.
    const hit = check("אחת אחת אחת אחת אחת אחת").find((v) => v.includes("but needs"));
    expect(hit).toBeDefined();
    expect(hit).toContain("state 0");
    expect(hit).toContain("1600ms");
    expect(hit).toContain("2800ms");
    expect(hit).toContain("cut it to 3 words");
    // Rewriting alone often cannot fix it, so the merge exit must be offered.
    expect(hit).toContain("drop one of the two states");
  });

  it("stays silent when every caption fits its window", () => {
    expect(check("אחת").some((v) => v.includes("but needs"))).toBe(false);
  });

  it("never fires on the human path — no `shape`, no shape rules", () => {
    // Human edits go through updatePlanSteps, which never calls this at all;
    // this pins the same split the min-gap rule has, so a customer who picks
    // two nearby states gets a short clip rather than a blocked save.
    expect(
      findPlanViolations(steps("אחת אחת אחת אחת אחת אחת"), squeezed, QUESTIONNAIRE, 8),
    ).toEqual([]);
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
  const DURATIONS = {
    byActionType: {
      navigate: 1800,
      tap: 1600,
      type: 2200,
      select: 1800,
      scroll: 2200,
      result: 2800,
      idle: 1600,
    },
    minMs: 3000,
    maxMs: 4000,
  };
  const BAND = { minMs: 15_000, maxMs: 21_000 };
  const block = planTimingMarkdown({
    durations: DURATIONS,
    runtime: BAND,
    minSteps: 5,
    maxSteps: 7,
  });
  const label = (words: number) => Array.from({ length: words }, () => "אחת").join(" ");

  /** Only the read-time violations, for a caption on state 0 with `gapMs` to
   *  the next SELECTED state — the squeeze the gap ceiling describes. */
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
      QUESTIONNAIRE,
      8,
      {
        minSteps: 1,
        notes: null,
        minStepMs: DURATIONS.minMs,
        runtime: { durations: DURATIONS, ...BAND },
      },
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

  it("names the gap below which no pair is selectable — the step floor, which outruns every read time", () => {
    // The two rules share this boundary and the larger wins. At the shipped
    // a_step_ms_min (3000) the floor binds — every legal caption reads inside
    // it — so a block that only ever divides readTimeMs would understate the
    // gap by almost half.
    const shortest = readRows[0]!;
    expect(shortest.ms).toBe(1600);
    expect(block).toContain("Under a 3.0s gap");
  });

  it("the read time binds again when a config row drops the floor under it", () => {
    const dropped = planTimingMarkdown({
      durations: { ...DURATIONS, minMs: 1400 },
      runtime: BAND,
      minSteps: 5,
      maxSteps: 7,
    });
    expect(dropped).toContain("Under a 1.6s gap");
  });

  it("stops offering caption lengths a configured ceiling could never grant", () => {
    // a_step_ms_max below a row's read time caps every step under it, so the
    // row would advertise a window assembleSteps never hands out.
    const tight = planTimingMarkdown({
      durations: { ...DURATIONS, maxMs: 2000 },
      runtime: BAND,
      minSteps: 5,
      maxSteps: 7,
    });
    const rows = (text: string) =>
      [...text.matchAll(/^\| (\d+) words \| ([\d.]+)s \|$/gm)].map((m) => Number(m[1]));
    expect(rows(tight)).toEqual([3, 4]);
    // ...and never empties out, however low the ceiling goes.
    expect(
      rows(
        planTimingMarkdown({
          durations: { ...DURATIONS, minMs: 400, maxMs: 800 },
          runtime: BAND,
          minSteps: 5,
          maxSteps: 7,
        }),
      ),
    ).toEqual([3]);
  });

  it("every totals cell is a floor no legal plan of that shape can undercut", () => {
    // The cells used to carry a pass/fail verdict, and that verdict was right
    // only for `tap` — the one action type whose default equals a 3-word read
    // time. This walks EVERY action type: the cell must be the floor, `tap`
    // must sit exactly on it, and nothing may fall below it.
    const kinds = ["tap", "navigate", "select", "type", "scroll", "idle"] as const;
    const rows = [...block.matchAll(/^\| (\d+) \| (.+) \|$/gm)];
    expect(rows.map((m) => Number(m[1]))).toEqual([5, 6, 7]);
    for (const match of rows) {
      const stepCount = Number(match[1]);
      const cells = match[2]!.split(" | ");
      expect(cells).toHaveLength(readRows.length);
      cells.forEach((cell, i) => {
        const words = readRows[i]!.words;
        const floorMs = Math.round(Number(/^([\d.]+)s$/.exec(cell.trim())![1]) * 1000);
        // States 10s apart: nothing is capped by a neighbour, which is the
        // only condition the floor claims.
        const totalFor = (kind: (typeof kinds)[number]) => {
          const timeline: AnalysisState[] = Array.from({ length: stepCount }, (_, k) =>
            state({
              timestampMs: k * 10_000,
              visibleText: ["אחת"],
              actionType: k === stepCount - 1 ? "result" : kind,
            }),
          );
          return totalRuntimeMs(
            assembleSteps(
              timeline.map((_, k) => ({ sourceIndex: k, label: label(words) })),
              timeline,
              DURATIONS,
            ),
          );
        };
        for (const kind of kinds) {
          expect(totalFor(kind), `${cell} on ${kind}`).toBeGreaterThanOrEqual(floorMs);
        }
        expect(totalFor("tap"), `${cell} on tap`).toBe(floorMs);
      });
    }
  });

  it("prints no per-shape verdict, because the shape alone cannot decide one", () => {
    // At the shipped 3s floor every unsqueezed step clamps to the floor and
    // the cells collapse to n x 3.0s — but a config row raising a kind past
    // the floor un-collapses them, and then a per-cell verdict is wrong in
    // one direction or the other, exactly as the generator's comment argues.
    expect(block).not.toContain("too SHORT");
    expect(block).not.toContain("passes");
    expect(block).toContain("this is the LEAST each shape can run");
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
      path.join(
        PROMPTS_DIR,
        "plan_demo_steps",
        `v${latestPromptVersion("plan_demo_steps")}.md`,
      ),
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
  /** Defaults: a missing app_config row IS the default, so this is what the
   *  pipeline passes when nothing is configured. */
  const DURATIONS = { byActionType: {}, minMs: 1400, maxMs: 4000 };

  it("with no app_config rows the code constants are the configuration", async () => {
    const defaults = await stepDurations(db);
    // Spelled out, not imported: a test that reads the constant cannot notice
    // the constant moving, and these two numbers ARE the shipped behaviour.
    expect(defaults.minMs).toBe(3000);
    expect(defaults.maxMs).toBe(4000);
    expect(defaults.byActionType.result).toBe(2800);

    await db.insert(dbSchema.appConfig).values([
      { key: "a_step_ms_min", value: 2000 },
      { key: "a_step_ms_max", value: 3000 },
      { key: "a_step_ms_by_action", value: { result: 3300 } },
    ]);
    const configured = await stepDurations(db);
    expect(configured.minMs).toBe(2000);
    expect(configured.maxMs).toBe(3000);
    expect(configured.byActionType.result).toBe(3300);
    expect(configured.byActionType.tap).toBe(1600); // unlisted keys keep the default

    // A pair the wrong way round must not make the clamp incoherent.
    await db
      .update(dbSchema.appConfig)
      .set({ value: 900 })
      .where(eq(dbSchema.appConfig.key, "a_step_ms_max"));
    expect((await stepDurations(db)).maxMs).toBe(2000); // floored at minMs

    await db
      .delete(dbSchema.appConfig)
      .where(
        sql`${dbSchema.appConfig.key} in ('a_step_ms_min', 'a_step_ms_max', 'a_step_ms_by_action')`,
      );
    expect((await stepDurations(db)).minMs).toBe(3000);
  });

  it("with no app_config rows the runtime band is the code constants", async () => {
    // Every band in this file is a literal passed straight to
    // findPlanViolations, so without this the shipped 15-21s band was the one
    // duration default no test pinned: MIN_RUNTIME_MS could be edited to any
    // value and the suite stayed green. 15s exactly: the floor must equal
    // A_STEPS_MIN_DEFAULT x the 3s step floor or the minimum shape cannot
    // exist (the b60b5b6 regression, fixed 2026-08-25).
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

  it("caps a step at the gap to the next state, never at a flat per-action number", () => {
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
      DURATIONS,
    );
    expect(steps[0]!.durationMs).toBe(1600); // the gap, not type's 2200
    expect(steps[0]!.timestampMs + steps[0]!.durationMs).toBe(steps[1]!.timestampMs);
    expect(steps[1]!.durationMs).toBe(2800); // last step: no neighbour to hit
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
      DURATIONS,
    );
    expect(steps.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 3]);
    for (let i = 0; i < steps.length - 1; i++) {
      expect(steps[i]!.timestampMs + steps[i]!.durationMs).toBeLessThanOrEqual(
        steps[i + 1]!.timestampMs,
      );
    }
  });

  it("the gap beats the floor — a too-close pair renders short, never overlapping", () => {
    const timeline: AnalysisState[] = [
      state({ timestampMs: 0, actionType: "tap" }),
      // 400ms later: two states inside one step. The MODEL is stopped by
      // findPlanViolations; a human edit reaches here and is HONOURED. The
      // floor yielding is the decision: 1400ms here rewinds the video a full
      // second into the next step, which nobody picked. 400ms of what the
      // customer chose is honest; 1000ms of replayed source is not.
      state({ timestampMs: 400, actionType: "result" }),
    ];
    const tooClose = assembleSteps(
      [
        { sourceIndex: 0, label: "אחת" },
        { sourceIndex: 1, label: "סוף" },
      ],
      timeline,
      DURATIONS,
    );
    expect(tooClose[0]!.durationMs).toBe(400);
    expect(tooClose[0]!.timestampMs + tooClose[0]!.durationMs).toBe(tooClose[1]!.timestampMs);

    // The floor still binds when there IS room: a configured per-action length
    // under it is raised, because nothing is being run into.
    const roomy2: AnalysisState[] = [
      state({ timestampMs: 0, actionType: "tap" }),
      state({ timestampMs: 30_000, actionType: "result" }),
    ];
    expect(
      assembleSteps([{ sourceIndex: 0, label: "אחת" }, { sourceIndex: 1, label: "סוף" }], roomy2, {
        ...DURATIONS,
        byActionType: { tap: 900 },
      })[0]!.durationMs,
    ).toBe(1400);

    // Ceiling: a label nobody could read inside 4s, with all the room it wants.
    const roomy: AnalysisState[] = [state({ timestampMs: 0, actionType: "result" })];
    const long = assembleSteps(
      [{ sourceIndex: 0, label: "אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע עשר" }],
      roomy,
      DURATIONS,
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
    const dim: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["אחת"], actionType: "navigate", legibility: "low" }),
      state({ timestampMs: 3000, visibleText: ["שתיים"], actionType: "tap", legibility: "low" }),
      state({ timestampMs: 6000, visibleText: ["שלוש"], actionType: "type" }),
      state({ timestampMs: 9000, visibleText: ["ארבע"], actionType: "select" }),
      state({ timestampMs: 12_000, visibleText: ["חמש"], actionType: "scroll", legibility: "low" }),
      state({ timestampMs: 15_000, visibleText: ["שש"], actionType: "result" }),
    ];
    const draft = await generateStepPlan(db, { timeline: dim, questionnaire: QUESTIONNAIRE });
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
    // real recording puts under one step apart.
    const tight: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["פתיחה"], actionType: "navigate" }),
      state({ timestampMs: 4000, visibleText: ["בחירה"], actionType: "tap" }),
      state({ timestampMs: 8000, visibleText: ["הקלדה"], actionType: "type" }),
      state({ timestampMs: 44_600, visibleText: ["שמירה"], actionType: "tap" }),
      state({ timestampMs: 45_000, visibleText: ["נוצר"], actionType: "result" }),
    ];
    const draft = await generateStepPlan(db, { timeline: tight, questionnaire: QUESTIONNAIRE });
    const picked = draft.steps.map((s) => s.timestampMs);
    expect(picked).toContain(45_000); // the ending is the one state it cannot lose
    expect(picked).not.toContain(44_600); // its too-close neighbour is dropped
    for (let i = 1; i < picked.length; i++) {
      expect(picked[i]! - picked[i - 1]!).toBeGreaterThanOrEqual(1400);
    }
  });

  it("two states inside one step are a VIOLATION for the model, not a short clip", () => {
    // Real timelines put states 400ms apart (fixtures/timelines: the botteacher
    // recordings both do). Selecting both is a selection bug — the corrective
    // retry has to see it, because no duration can honour both windows.
    const timeline: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["התחלה"] }),
      state({ timestampMs: 400, visibleText: ["המשך"] }),
      state({ timestampMs: 9000, visibleText: ["נשמר"], actionType: "result" }),
    ];
    const violations = findPlanViolations(
      [
        { sourceIndex: 0, label: "התחלה" },
        { sourceIndex: 1, label: "המשך" },
        { sourceIndex: 2, label: "נשמר" },
      ],
      timeline,
      QUESTIONNAIRE,
      8,
      { minSteps: 1, notes: null, minStepMs: 1400 },
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
        QUESTIONNAIRE,
        8,
        { minSteps: 1, notes: "הקלטה קצרה", minStepMs: 1400 },
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
        QUESTIONNAIRE,
        8,
        { minSteps: 1, notes: null, minStepMs: 1400 },
      ),
    ).toEqual([]);
  });
});

/**
 * The one arithmetic the constants must satisfy together: every shape between
 * the step minimum and maximum, assembled at production durations, lands
 * inside the production band. b60b5b6 broke exactly this — it raised the band
 * floor to 16s while every unsqueezed step clamps to the 3s floor, so the
 * 5-step minimum totalled 15s and could never validate; the prompt licensed a
 * shape the validator always rejected, and the live 4-failures-in-a-row
 * followed. Values re-read through the config path, expectations spelled out:
 * a test that recomputes from the constants cannot catch them moving apart.
 */
describe("band coherence — every legal shape fits the shipped band", () => {
  it("5 through 7 well-spaced steps validate with zero violations", async () => {
    const durations = await stepDurations(db);
    const band = await stepRuntimeBand(db);
    expect(durations.minMs).toBe(3000);
    expect(band).toEqual({ minMs: 15_000, maxMs: 21_000 });
    const { A_STEPS_MIN_DEFAULT, A_STEPS_MAX_DEFAULT } = await import("../src/plan-format");
    expect(A_STEPS_MIN_DEFAULT).toBe(5);
    expect(A_STEPS_MAX_DEFAULT).toBe(7);

    for (let n = A_STEPS_MIN_DEFAULT; n <= A_STEPS_MAX_DEFAULT; n++) {
      // States 10s apart: nothing is squeezed by a neighbour, so every step
      // renders exactly the 3s floor and the total is the LEAST this shape
      // can run — the number that has to clear the band floor.
      const timeline: AnalysisState[] = Array.from({ length: n }, (_, i) =>
        state({
          timestampMs: i * 10_000,
          visibleText: [`מסך ${i}`],
          actionType: i === n - 1 ? "result" : "tap",
        }),
      );
      const steps = timeline.map((_, i) => ({ sourceIndex: i, label: `מסך ${i}` }));
      expect(totalRuntimeMs(assembleSteps(steps, timeline, durations))).toBe(n * 3000);
      expect(
        findPlanViolations(steps, timeline, QUESTIONNAIRE, A_STEPS_MAX_DEFAULT, {
          minSteps: A_STEPS_MIN_DEFAULT,
          notes: null,
          minStepMs: durations.minMs,
          runtime: { durations, ...band },
        }),
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
