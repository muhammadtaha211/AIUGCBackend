import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Hoisted so the module factory below can close over it: generateStepPlan
// reaches the real Claude call on the non-DRY_RUN path, and the corrective
// retry's contract is the behaviour under test.
const generateObject = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/anthropic", () => ({
  generateObject,
  generateObjectWithImages: vi.fn(),
  CLAUDE_MODEL: "claude-sonnet-4-6",
}));

import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import type { Questionnaire } from "../src/pipelines/businesses";
import type { AnalysisState } from "../src/pipelines/demo-analysis";
import { generateStepPlan } from "../src/pipelines/demo-step-plans";
import { createTestDb } from "./helpers/pglite";

/**
 * The corrective-retry contract (real DB, mocked Claude), pinned after the
 * a179f069 failure: each call is stateless, so "return the same plan with
 * minimal edits" only works if the retry prompt echoes the previous plan —
 * without the echo the model reinvents the plan blind (seen live: the retry
 * dropped the success state the first call had correctly selected). And the
 * retry happens exactly once: a still-violating second answer is a
 * PermanentError, never a third paid call.
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

// The a179f069 shape in miniature: the success state (4) sits mid-recording
// and the timeline keeps going after it. 2s apart so the only violation these
// mocks produce is the one under test — states closer together than a step is
// long are a violation of their own (see the window model).
const TIMELINE: AnalysisState[] = [
  state({ timestampMs: 0, visibleText: ["פתיחה"], actionType: "navigate" }),
  state({ timestampMs: 2000, visibleText: ["בחירה"] }),
  state({ timestampMs: 4000, visibleText: ["הקלדה"], actionType: "type" }),
  state({ timestampMs: 6000, visibleText: ["אישור"], actionType: "select" }),
  state({ timestampMs: 8000, visibleText: ["הצלחה"], actionType: "result" }),
  state({ timestampMs: 10_000, visibleText: ["המשך"], actionType: "navigate" }),
  state({ timestampMs: 12_000, visibleText: ["גלילה"], actionType: "scroll" }),
];

/** 6 legal labels, success state selected mid-plan, ends past it — exactly one
 *  violation (the last-step shape rule), like a179f069's first call. */
const ENDS_PAST_SUCCESS = {
  object: {
    steps: [
      { sourceIndex: 0, label: "פתיחה" },
      { sourceIndex: 1, label: "בחירה" },
      { sourceIndex: 2, label: "הקלדה" },
      { sourceIndex: 4, label: "הצלחה" },
      { sourceIndex: 5, label: "המשך" },
      { sourceIndex: 6, label: "גלילה" },
    ],
    unexplainedMoments: [],
    notes: null,
  },
  usage: { inputTokens: 1000, outputTokens: 200 },
};

/** The mechanical fix the violation message asks for: trailing steps dropped,
 *  the shortfall below the 6-step minimum explained in notes. */
const FIXED = {
  object: {
    steps: [
      { sourceIndex: 0, label: "פתיחה" },
      { sourceIndex: 1, label: "בחירה" },
      { sourceIndex: 2, label: "הקלדה" },
      { sourceIndex: 4, label: "הצלחה" },
    ],
    unexplainedMoments: [],
    notes: "אחרי מסך ההצלחה מתחיל מסע נפרד, לכן נשארו 4 צעדים בלבד",
  },
  usage: { inputTokens: 1100, outputTokens: 180 },
};

let db: Db;
let pg: { close(): Promise<void> };

beforeAll(async () => {
  // The retry only runs on the live path; DRY_RUN returns the canned plan.
  delete process.env.DRY_RUN;
  resetEnvCache();
  const testDb = await createTestDb();
  db = testDb.db;
  pg = testDb.pg;
});

afterAll(async () => {
  await pg.close();
});

describe("generateStepPlan corrective retry (real DB, mocked Claude)", () => {
  it("echoes the previous plan and the named fix into the one retry prompt", async () => {
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
    expect(retryPrompt).toContain("success candidates are at sourceIndex 4");
    expect(retryPrompt).toContain("drop every step after it");

    // The fixed plan lands: ends on the success state, shortfall explained.
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 4]);
    expect(draft.steps[draft.steps.length - 1]!.actionType).toBe("result");
    expect(draft.notes).toBeTruthy();
  });

  it("a still-violating retry is a PermanentError — never a third call", async () => {
    generateObject.mockReset().mockResolvedValue(ENDS_PAST_SUCCESS);

    await expect(
      generateStepPlan(db, { timeline: TIMELINE, questionnaire: QUESTIONNAIRE }),
    ).rejects.toThrow(/after retry/);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("a clean first call never pays for a second", async () => {
    generateObject.mockReset().mockResolvedValueOnce(FIXED);

    const draft = await generateStepPlan(db, { timeline: TIMELINE, questionnaire: QUESTIONNAIRE });

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 4]);
  });
});
