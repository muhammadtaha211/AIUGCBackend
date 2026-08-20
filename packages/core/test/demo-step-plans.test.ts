import { mkdirSync, writeFileSync } from "node:fs";
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
  readTimeMs,
  stepDurations,
  requestDemoPlan,
  runPlanRegression,
  totalRuntimeMs,
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
    // The last step has no neighbour to run into, so it gets the full
    // per-action default.
    expect(last.durationMs).toBe(2800);
    // Every other step is capped at the gap to the next one: the two states
    // 1500ms apart (5->6, 6->7) get 1500 instead of their 1600/2200 defaults.
    expect(steps.map((s) => s.durationMs)).toEqual([1800, 1500, 1500, 1800, 1600, 2800]);
    // No step's window may reach into the next step's: 200ms of source shown
    // twice back to back is the defect this model exists to make impossible.
    for (let i = 0; i < steps.length - 1; i++) {
      expect(steps[i]!.timestampMs + steps[i]!.durationMs).toBeLessThanOrEqual(
        steps[i + 1]!.timestampMs,
      );
    }
    // Total runtime: six product steps. (The 12-17s band is a target for real
    // recordings; the canned journey sits just under it now that its login
    // states are filtered and its tight pairs are capped at their gaps.)
    const total = steps.reduce((ms, s) => ms + s.durationMs, 0);
    expect(total).toBe(11_000);
    expect(totalRuntimeMs(steps)).toBe(total);

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
    expect(steps[0]!.timestampMs).toBe(1500);
    expect(steps[0]!.actionType).toBe("navigate");
    // Derived, not client-supplied. 1500ms -> 18500ms is a wide gap, so both
    // steps get what they asked for: step 0's 4-word label needs 2000ms to be
    // read, which outbids navigate's 1800ms default; step 1 is last and takes
    // result's 2800ms default over its label's 2000ms.
    expect(steps[0]!.durationMs).toBe(2000);
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
    expect(
      findPlanViolations(steps, tight, QUESTIONNAIRE, 8, {
        minSteps: 1,
        notes: null,
        minStepMs: 1400,
        runtime: band,
      }).find((x) => x.includes("total")),
    ).toContain("6600ms");
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
});

describe("step durations (the window model)", () => {
  /** Defaults: a missing app_config row IS the default, so this is what the
   *  pipeline passes when nothing is configured. */
  const DURATIONS = { byActionType: {}, minMs: 1400, maxMs: 4000 };

  it("with no app_config rows the code constants are the configuration", async () => {
    const defaults = await stepDurations(db);
    // Spelled out, not imported: a test that reads the constant cannot notice
    // the constant moving, and these two numbers ARE the shipped behaviour.
    expect(defaults.minMs).toBe(1400);
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
    expect((await stepDurations(db)).minMs).toBe(1400);
  });

  it("readTimeMs grows with the label — a 6-word label outlasts a 2-word one", () => {
    expect(readTimeMs("בוחרים מוצר")).toBeLessThan(
      readTimeMs("מתחברים לאפליקציה בוחרים מוצר ומשלמים בהעברה"),
    );
    // 400ms lead + 2.5 words/sec. Spelled out rather than recomputed from the
    // constants: a test that imports the guess cannot catch the guess moving.
    expect(readTimeMs("בוחרים מוצר")).toBe(1200);
    expect(readTimeMs("מתחברים לאפליקציה בוחרים מוצר ומשלמים בהעברה")).toBe(2800);
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
