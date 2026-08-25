import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Hoisted so the module factory below can close over it: generateStepPlan
// reaches the real Claude call on the non-DRY_RUN path, and the corrective
// ladder's contract is the behaviour under test.
const generateObject = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/anthropic", () => ({
  generateObject,
  generateObjectWithImages: vi.fn(),
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
import { generateStepPlan, PlanViolationError } from "../src/pipelines/demo-step-plans";
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
// and the timeline keeps going after it. 3s apart so the only violation these
// mocks produce is the one under test — states closer together than a step is
// long are a violation of their own, and every plan below lands inside the
// runtime band (each unsqueezed step runs the 3s floor).
const TIMELINE: AnalysisState[] = [
  state({ timestampMs: 0, visibleText: ["פתיחה"], actionType: "navigate" }),
  state({ timestampMs: 3000, visibleText: ["בחירה"] }),
  state({ timestampMs: 6000, visibleText: ["הקלדה"], actionType: "type" }),
  state({ timestampMs: 9000, visibleText: ["אישור"], actionType: "select" }),
  state({ timestampMs: 12_000, visibleText: ["גלילה"], actionType: "scroll" }),
  state({ timestampMs: 15_000, visibleText: ["הצלחה"], actionType: "result" }),
  state({ timestampMs: 18_000, visibleText: ["המשך"], actionType: "navigate" }),
];

/** 7 legal labels (21000ms at the 3s floor), success state selected mid-plan,
 *  ends past it — exactly one violation (the last-step shape rule), like
 *  a179f069's first call. */
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
 *  (6 steps, 18000ms, still only the last-step violation) — so the third
 *  call's prompt provably echoes THIS plan, not the first one. */
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
 *  dropped, leaving 6 steps (18000ms) ending on the success state. `notes` is
 *  null on purpose — it waives the last-step rule only, and this plan does
 *  not need waiving. */
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

    const draft = await generateStepPlan(db, { timeline: TIMELINE, questionnaire: QUESTIONNAIRE });

    expect(generateObject).toHaveBeenCalledTimes(2);
    const retryPrompt = (generateObject.mock.calls[1]![0] as { prompt: string }).prompt;
    // The model can only make "minimal edits" to a plan it can see.
    expect(retryPrompt).toContain("Your previous plan was:");
    expect(retryPrompt).toContain('"sourceIndex": 6'); // the offending trailing step, echoed
    // The violation names the candidates and the mechanical fix.
    expect(retryPrompt).toContain("success candidates are at sourceIndex 5");
    expect(retryPrompt).toContain("drop every step after it");

    // The fixed plan lands: ends on the success state, nothing to explain.
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(draft.steps[draft.steps.length - 1]!.actionType).toBe("result");
    expect(draft.notes).toBeNull();
    // One round per call; a clean second call closes with an empty round.
    expect(draft.retryViolations).toHaveLength(2);
    expect(draft.retryViolations[0]!.length).toBeGreaterThan(0);
    expect(draft.retryViolations[1]).toEqual([]);
  });

  it("a second corrective call gets its shot, echoing the SECOND plan", async () => {
    generateObject
      .mockReset()
      .mockResolvedValueOnce(ENDS_PAST_SUCCESS)
      .mockResolvedValueOnce(STILL_PAST_SUCCESS)
      .mockResolvedValueOnce(FIXED);

    const draft = await generateStepPlan(db, { timeline: TIMELINE, questionnaire: QUESTIONNAIRE });

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

    const draft = await generateStepPlan(db, { timeline: TIMELINE, questionnaire: QUESTIONNAIRE });

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(draft.retryViolations).toEqual([[]]);
  });

  it("the demo description reaches the prompt and widens the legal vocabulary", async () => {
    // Step 0's label is a word that exists ONLY in the description — not on
    // the screen, not in the questionnaire. One call, no violations: the
    // description reached findPlanViolations, and the prompt carries it.
    const descWord = {
      ...FIXED,
      object: {
        ...FIXED.object,
        steps: [{ sourceIndex: 0, label: "קופה" }, ...FIXED.object.steps.slice(1)],
      },
    };
    generateObject.mockReset().mockResolvedValueOnce(descWord);
    await generateStepPlan(db, {
      timeline: TIMELINE,
      questionnaire: QUESTIONNAIRE,
      demoDescription: "מצלמים את הקופה בסוף",
    });
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect((generateObject.mock.calls[0]![0] as { prompt: string }).prompt).toContain(
      "מצלמים את הקופה בסוף",
    );
  });

  it("no description renders the sentinel — v13's {{demo_description}} is always satisfied", async () => {
    // renderPrompt THROWS on a template var the caller does not pass, so a
    // v13 on disk with no demo_description in the vars fails every plan. The
    // sentinel is what makes the pair deployable.
    generateObject.mockReset().mockResolvedValueOnce(FIXED);
    await generateStepPlan(db, { timeline: TIMELINE, questionnaire: QUESTIONNAIRE });
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
    expect((generateObject.mock.calls[0]![0] as { prompt: string }).prompt).toContain(
      "תיאור הדמו",
    );
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
    expect(ready.retryViolations).toEqual([expect.any(Array), []]);
    expect((ready.retryViolations as string[][])[0]!.length).toBeGreaterThan(0);
  });
});
