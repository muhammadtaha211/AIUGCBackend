import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Hoisted so the module factory below can close over it: generateStepPlan
// reaches the real Claude call on the non-DRY_RUN path, and the corrective
// ladder's contract is the behaviour under test.
const generateObject = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/anthropic", () => ({
  generateObject,
  generateRawWithImages: vi.fn(),
  CLAUDE_MODEL: "claude-sonnet-4-6",
}));

import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { enqueue } from "../src/jobs/queue";
import { runLane } from "../src/jobs/worker";
import { createBusiness, setQuestionnaire, type Questionnaire } from "../src/pipelines/businesses";
import type { AnalysisState } from "../src/pipelines/demo-analysis";
import {
  generateStepPlan,
  PlanViolationError,
  updatePlanSteps,
} from "../src/pipelines/demo-step-plans";
import { createTestDb } from "./helpers/pglite";

/**
 * The corrective-ladder contract (real DB, mocked Claude), pinned after the
 * a179f069 failure: each call is stateless, so "return the same plan with
 * minimal edits" only works if every corrective prompt echoes the previous
 * plan — without the echo the model reinvents the plan blind (seen live: the
 * retry dropped the success state the first call had correctly selected).
 * The ladder is capped at MAX_CORRECTIVE_CALLS=2 correctives — 3 model calls
 * total, ever — and a still-violating third answer is a PlanViolationError
 * carrying the diagnostics the 0029 columns record.
 */

const QUESTIONNAIRE: Questionnaire = {
  category: "app_or_digital",
  product_name: "קמפיינר",
  what_it_does: "יוצר קמפיינים אוטומטית",
  advantages: ["מהיר", "בעברית"],
  target_audience: "בעלי עסקים קטנים",
  tone: "friendly",
};

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

// The a179f069 shape in miniature: the success state (5) sits mid-recording
// and the timeline keeps going after it. One page worked down: every state
// carries the same screenName and none after the first navigates, so no
// screen change cuts a step (decision 0070) — each runs until the next
// selected state, or the 4s cap. 3s apart so the only violation these mocks
// produce is the one under test: states closer together than the shortest
// caption are a violation of their own, and every plan below lands inside
// the runtime band.
const PAGE = "קמפיין חדש";
const TIMELINE: AnalysisState[] = [
  state({ timestampMs: 0, screenName: PAGE, visibleText: ["פתיחה"], actionType: "navigate" }),
  state({ timestampMs: 3000, screenName: PAGE, visibleText: ["בחירה"] }),
  state({ timestampMs: 6000, screenName: PAGE, visibleText: ["הקלדה"], actionType: "type" }),
  state({ timestampMs: 9000, screenName: PAGE, visibleText: ["אישור"], actionType: "select" }),
  state({ timestampMs: 12_000, screenName: PAGE, visibleText: ["גלילה"], actionType: "scroll" }),
  state({ timestampMs: 15_000, screenName: PAGE, visibleText: ["הצלחה"], actionType: "result" }),
  state({ timestampMs: 18_000, screenName: PAGE, visibleText: ["המשך"], actionType: "tap" }),
];

/** demos.duration_ms of this recording: the last step's ceiling. 20s gives
 *  the success (15s) its full 4s cap and the trailing tap (18s) 2000ms —
 *  without it the recording would end one sample after the tap, and a
 *  200ms clip would put a read-time violation on top of the one under test. */
const RECORDING_MS = 20_000;

/** 7 legal labels (20000ms: six 3000ms gaps and the trailing tap's 2000ms),
 *  success state selected mid-plan, ends past it — exactly one violation
 *  (the last-step shape rule), like a179f069's first call. */
const ENDS_PAST_SUCCESS = {
  object: {
    steps: [
      { sourceIndex: 0, label: "פתיחה" },
      { sourceIndex: 1, label: "בחירה" },
      { sourceIndex: 2, label: "הקלדה" },
      { sourceIndex: 3, label: "אישור" },
      { sourceIndex: 4, label: "גלילה" },
      { sourceIndex: 5, label: "הצלחה" },
      { sourceIndex: 6, label: "המשך" },
    ],
    unexplainedMoments: [],
    notes: null,
  },
  usage: { inputTokens: 1000, outputTokens: 200 },
};

/** Still ends past the success state, but a DIFFERENT plan — state 1 dropped
 *  (6 steps, 18000ms: state 0 runs the 4s cap into the gap 1 left; still
 *  only the last-step violation) — so the third call's prompt provably
 *  echoes THIS plan, not the first one. */
const STILL_PAST_SUCCESS = {
  object: {
    steps: [
      { sourceIndex: 0, label: "פתיחה" },
      { sourceIndex: 2, label: "הקלדה" },
      { sourceIndex: 3, label: "אישור" },
      { sourceIndex: 4, label: "גלילה" },
      { sourceIndex: 5, label: "הצלחה" },
      { sourceIndex: 6, label: "המשך" },
    ],
    unexplainedMoments: [],
    notes: null,
  },
  usage: { inputTokens: 1050, outputTokens: 190 },
};

/** The mechanical fix the violation message asks for: the trailing step
 *  dropped, leaving 6 steps (19000ms — the success, last now, runs the full
 *  4s cap) ending on the success state. `notes` is null on purpose — it
 *  waives the last-step rule only, and this plan does not need waiving. */
const FIXED = {
  object: {
    steps: [
      { sourceIndex: 0, label: "פתיחה" },
      { sourceIndex: 1, label: "בחירה" },
      { sourceIndex: 2, label: "הקלדה" },
      { sourceIndex: 3, label: "אישור" },
      { sourceIndex: 4, label: "גלילה" },
      { sourceIndex: 5, label: "הצלחה" },
    ],
    unexplainedMoments: [],
    notes: null,
  },
  usage: { inputTokens: 1100, outputTokens: 180 },
};

/** FIXED with step 0's label replaced by a word that is on no screen, in no
 *  questionnaire field and (with no description) nowhere else — the
 *  highlight's one true positive in this file. */
const OFF_SCREEN = {
  ...FIXED,
  object: {
    ...FIXED.object,
    steps: [{ sourceIndex: 0, label: "הפרטים" }, ...FIXED.object.steps.slice(1)],
  },
};

let db: Db;
let pg: { close(): Promise<void> };

beforeAll(async () => {
  // The ladder only runs on the live path; DRY_RUN returns the canned plan.
  delete process.env.DRY_RUN;
  resetEnvCache();
  const testDb = await createTestDb();
  db = testDb.db;
  pg = testDb.pg;
});

afterAll(async () => {
  await pg.close();
});

describe("generateStepPlan corrective ladder (real DB, mocked Claude)", () => {
  it("echoes the previous plan and the named fix into the corrective prompt", async () => {
    generateObject
      .mockReset()
      .mockResolvedValueOnce(ENDS_PAST_SUCCESS)
      .mockResolvedValueOnce(FIXED);

    const draft = await generateStepPlan(db, {
      timeline: TIMELINE,
      questionnaire: QUESTIONNAIRE,
      recordingMs: RECORDING_MS,
    });

    expect(generateObject).toHaveBeenCalledTimes(2);
    const retryPrompt = (generateObject.mock.calls[1]![0] as { prompt: string }).prompt;
    // The model can only make "minimal edits" to a plan it can see.
    expect(retryPrompt).toContain("Your previous plan was:");
    expect(retryPrompt).toContain('"sourceIndex": 6'); // the offending trailing step, echoed
    // The violation names the candidates and the mechanical fix.
    expect(retryPrompt).toContain("success candidates are at sourceIndex 5");
    expect(retryPrompt).toContain("drop every step after it");
    // 0049: no flagged label words reach a corrective prompt any more, so the
    // "replace it with words copied from visibleText" instruction is gone.
    expect(retryPrompt).not.toContain("flagged label word");

    // The fixed plan lands: ends on the success state, nothing to explain.
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(draft.steps[draft.steps.length - 1]!.actionType).toBe("result");
    expect(draft.notes).toBeNull();
    // One round per call; a clean second call closes with an empty round.
    // The first round is the last-step rule alone — the clips on this
    // timeline put no read-time or band violation beside it.
    expect(draft.retryViolations).toHaveLength(2);
    expect(draft.retryViolations[0]).toHaveLength(1);
    expect(draft.retryViolations[1]).toEqual([]);
  });

  it("a second corrective call gets its shot, echoing the SECOND plan", async () => {
    generateObject
      .mockReset()
      .mockResolvedValueOnce(ENDS_PAST_SUCCESS)
      .mockResolvedValueOnce(STILL_PAST_SUCCESS)
      .mockResolvedValueOnce(FIXED);

    const draft = await generateStepPlan(db, {
      timeline: TIMELINE,
      questionnaire: QUESTIONNAIRE,
      recordingMs: RECORDING_MS,
    });

    expect(generateObject).toHaveBeenCalledTimes(3);
    const thirdPrompt = (generateObject.mock.calls[2]![0] as { prompt: string }).prompt;
    // STILL_PAST_SUCCESS dropped state 1 — a third call that echoed the FIRST
    // plan would still carry it.
    expect(thirdPrompt).toContain("Your previous plan was:");
    expect(thirdPrompt).not.toContain('"sourceIndex": 1');

    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(draft.retryViolations).toHaveLength(3);
    expect(draft.retryViolations[2]).toEqual([]);
  });

  it("a still-violating third call is a PlanViolationError — never a fourth", async () => {
    generateObject
      .mockReset()
      .mockResolvedValueOnce(ENDS_PAST_SUCCESS)
      .mockResolvedValue(STILL_PAST_SUCCESS);

    const thrown = await generateStepPlan(db, {
      timeline: TIMELINE,
      questionnaire: QUESTIONNAIRE,
      recordingMs: RECORDING_MS,
    }).then(
      () => null,
      (err: unknown) => err,
    );

    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(thrown).toBeInstanceOf(PlanViolationError);
    const violation = thrown as PlanViolationError;
    expect(violation.message).toMatch(/after retry/);
    expect(violation.failKind).toBe("validator");
    expect(violation.promptVersion).toMatch(/^plan_demo_steps@v\d+$/);
    expect(violation.rounds).toHaveLength(3);
    for (const round of violation.rounds) expect(round.length).toBeGreaterThan(0);
    // The last-step rule is neither fabrication nor a skip-kind pick, so the
    // customer line stays the generic one.
    expect(violation.customerMessage).toBe("יצירת תוכנית הצעדים נכשלה — נסו שוב");
  });

  it("a clean first call never pays for a second", async () => {
    generateObject.mockReset().mockResolvedValueOnce(FIXED);

    const draft = await generateStepPlan(db, {
      timeline: TIMELINE,
      questionnaire: QUESTIONNAIRE,
      recordingMs: RECORDING_MS,
    });

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(draft.retryViolations).toEqual([[]]);
    // Every label is on its screen: the highlight is empty on every step.
    expect(draft.steps.map((s) => s.offScreenWords)).toEqual([[], [], [], [], [], []]);
  });

  it("an off-screen content word is accepted on ONE call, and lands in that step's offScreenWords", async () => {
    // Decision 0049: label provenance is a highlight, not a gate. "הפרטים" is
    // on no screen, in no questionnaire field, and there is no description —
    // under the gate this cost a corrective call (every recorded round ever
    // was this rule and nothing else); now the plan is accepted as it came
    // and the word is stored on the step for the editor to mark.
    generateObject.mockReset().mockResolvedValueOnce(OFF_SCREEN);

    const draft = await generateStepPlan(db, {
      timeline: TIMELINE,
      questionnaire: QUESTIONNAIRE,
      recordingMs: RECORDING_MS,
    });

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.retryViolations).toEqual([[]]);
    expect(draft.steps[0]!.label).toBe("הפרטים");
    expect(draft.steps.map((s) => s.offScreenWords)).toEqual([["הפרטים"], [], [], [], [], []]);
  });

  it("the demo description reaches the prompt and empties the flags", async () => {
    // Step 0's label is a word that exists ONLY in the description — not on
    // the screen, not in the questionnaire. One call, nothing marked: the
    // description reached findOffScreenWords, and the prompt carries it.
    const descWord = {
      ...FIXED,
      object: {
        ...FIXED.object,
        steps: [{ sourceIndex: 0, label: "קופה" }, ...FIXED.object.steps.slice(1)],
      },
    };
    generateObject.mockReset().mockResolvedValueOnce(descWord);
    const draft = await generateStepPlan(db, {
      timeline: TIMELINE,
      questionnaire: QUESTIONNAIRE,
      demoDescription: "מצלמים את הקופה בסוף",
      recordingMs: RECORDING_MS,
    });
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect((generateObject.mock.calls[0]![0] as { prompt: string }).prompt).toContain(
      "מצלמים את הקופה בסוף",
    );
    expect(draft.steps[0]!.offScreenWords).toEqual([]);
  });

  it("no description renders the sentinel — v13's {{demo_description}} is always satisfied", async () => {
    // renderPrompt THROWS on a template var the caller does not pass, so a
    // v13 on disk with no demo_description in the vars fails every plan. The
    // sentinel is what makes the pair deployable.
    generateObject.mockReset().mockResolvedValueOnce(FIXED);
    await generateStepPlan(db, {
      timeline: TIMELINE,
      questionnaire: QUESTIONNAIRE,
      recordingMs: RECORDING_MS,
    });
    expect((generateObject.mock.calls[0]![0] as { prompt: string }).prompt).toContain(
      "(אין — התבסס על השאלון והמסכים בלבד)",
    );
  });
});

describe("handlePlanDemoSteps diagnostics (0029)", () => {
  async function seedPlanRow(email: string): Promise<string> {
    const business = await createBusiness(db, { ownerEmail: email, name: "עסק" });
    await setQuestionnaire(db, business.id, QUESTIONNAIRE);
    const demo = (
      await db
        .insert(dbSchema.demos)
        .values({
          businessId: business.id,
          status: "ready",
          rawPath: "assets/x/raw.mp4",
          description: "תיאור הדמו",
          // The handler and updatePlanSteps read the recording's end here.
          durationMs: RECORDING_MS,
        })
        .returning()
    )[0]!;
    const analysis = (
      await db
        .insert(dbSchema.demoAnalyses)
        .values({
          demoId: demo.id,
          status: "ready",
          timeline: TIMELINE,
          stateCount: TIMELINE.length,
        })
        .returning()
    )[0]!;
    const plan = (
      await db
        .insert(dbSchema.demoStepPlans)
        .values({ demoId: demo.id, analysisId: analysis.id, status: "pending" })
        .returning()
    )[0]!;
    await enqueue(db, {
      type: "plan_demo_steps",
      idempotencyKey: `plan:${plan.id}`,
      payload: { planId: plan.id },
    });
    return plan.id;
  }

  async function planRow(planId: string) {
    return (
      await db.select().from(dbSchema.demoStepPlans).where(eq(dbSchema.demoStepPlans.id, planId))
    )[0]!;
  }

  it("a validator failure writes fail_kind, prompt_version and every round", async () => {
    generateObject.mockReset().mockResolvedValue(ENDS_PAST_SUCCESS);
    const planId = await seedPlanRow("diag-fail@example.com");
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });

    const failed = await planRow(planId);
    expect(failed.status).toBe("failed");
    expect(failed.failKind).toBe("validator");
    // In hand before the throw — the NULL-on-failure defect, closed.
    expect(failed.promptVersion).toMatch(/^plan_demo_steps@v\d+$/);
    const rounds = failed.retryViolations as string[][];
    expect(rounds).toHaveLength(3);
    for (const round of rounds) expect(round.length).toBeGreaterThan(0);
    // The handler passed demos.description through to the prompt.
    expect((generateObject.mock.calls[0]![0] as { prompt: string }).prompt).toContain("תיאור הדמו");
  });

  it("a success writes the rounds too, with an empty final round", async () => {
    generateObject
      .mockReset()
      .mockResolvedValueOnce(ENDS_PAST_SUCCESS)
      .mockResolvedValueOnce(FIXED);
    const planId = await seedPlanRow("diag-ok@example.com");
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });

    const ready = await planRow(planId);
    expect(ready.status).toBe("ready");
    expect(ready.failKind).toBeNull();
    // The highlight is stored with the steps — every FIXED label is on its
    // screen, so each step carries an empty array, never an absent field.
    expect(
      (ready.steps as { offScreenWords?: string[] }[]).map((step) => step.offScreenWords),
    ).toEqual([[], [], [], [], [], []]);
    expect(ready.retryViolations).toEqual([expect.any(Array), []]);
    expect((ready.retryViolations as string[][])[0]!.length).toBeGreaterThan(0);
  });

  it("a human edit clears the marks on the label it changed and keeps the rest", async () => {
    // Approve is disabled while the draft is dirty, so any edit, delete or
    // added step forces a save before approval. A save that wiped every mark
    // would take the highlight off the labels the customer never touched —
    // so updatePlanSteps carries the stored marks onto unchanged labels and
    // writes [] only where the text changed (or the step is new).
    generateObject.mockReset().mockResolvedValueOnce(OFF_SCREEN);
    const planId = await seedPlanRow("diag-edit@example.com");
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
    const ready = await planRow(planId);
    const words = (steps: unknown) =>
      (steps as { sourceIndex: number; offScreenWords?: string[] }[]).map((s) => [
        s.sourceIndex,
        s.offScreenWords,
      ]);
    expect(words(ready.steps)).toEqual([
      [0, ["הפרטים"]],
      [1, []],
      [2, []],
      [3, []],
      [4, []],
      [5, []],
    ]);

    // Change step 1's label only; step 0 keeps its mark, step 1 is the customer's now.
    const edited = await updatePlanSteps(db, {
      planId,
      steps: [
        { sourceIndex: 0, label: "הפרטים" },
        { sourceIndex: 1, label: "בחירה שלכם" },
        { sourceIndex: 2, label: "הקלדה" },
        { sourceIndex: 3, label: "אישור" },
        { sourceIndex: 4, label: "גלילה" },
        { sourceIndex: 5, label: "הצלחה" },
      ],
    });
    expect(words(edited.steps)).toEqual([
      [0, ["הפרטים"]],
      [1, []],
      [2, []],
      [3, []],
      [4, []],
      [5, []],
    ]);

    // Now rewrite step 0 itself (and drop a step): its mark goes, nothing else changes.
    const rewritten = await updatePlanSteps(db, {
      planId,
      steps: [
        { sourceIndex: 0, label: "פתיחה" },
        { sourceIndex: 2, label: "הקלדה" },
        { sourceIndex: 5, label: "הצלחה" },
      ],
    });
    expect(words(rewritten.steps)).toEqual([
      [0, []],
      [2, []],
      [5, []],
    ]);
  });
});
