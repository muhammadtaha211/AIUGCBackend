import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Hoisted so the module factory below can close over it: both generators
// reach the real Claude call on the non-DRY_RUN path, and what they send is
// the behaviour under test.
const generateObject = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/anthropic", () => ({
  generateObject,
  generateRawWithImages: vi.fn(),
  CLAUDE_MODEL: "claude-sonnet-5-5",
}));

import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { enqueue } from "../src/jobs/queue";
import { runLane } from "../src/jobs/worker";
import { createBusiness, setQuestionnaire, type Questionnaire } from "../src/pipelines/businesses";
import { generateVoScript } from "../src/pipelines/copy";
import type { AnalysisState } from "../src/pipelines/demo-analysis";
import { setDemoName } from "../src/pipelines/demos";
import { createTestDb } from "./helpers/pglite";

/**
 * A demo's name is a label for people, never a model input (decision 0125).
 * The same demo, unnamed and then named, through the two generators that read
 * the demo row's description — the step-plan job and the (retired) VO script:
 * the prompt each one sends is identical, the name is in neither, the stored
 * plan is identical, and the VO script's params are identical. The plan's
 * label highlight is the second place the description reaches (decision 0049):
 * a label word that exists only in the name stays flagged off-screen, so the
 * name never widens the allowed vocabulary either.
 */

const QUESTIONNAIRE: Questionnaire = {
  category: "app_or_digital",
  product_name: "קמפיינר",
  what_it_does: "יוצר קמפיינים אוטומטית",
  advantages: ["מהיר", "בעברית"],
  target_audience: "בעלי עסקים קטנים",
  tone: "friendly",
};

/** "שלוחה" is on no screen, in no questionnaire field and not in the
 *  description — only in the name. */
const NAME = "Tavnit שלוחה צפונית";
const NAME_WORD = "שלוחה";
const DESCRIPTION = "מצלמים את הקופה בסוף";

function state(overrides: Partial<AnalysisState>): AnalysisState {
  return {
    timestampMs: 0,
    screenName: "קמפיין חדש",
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

// plan-retry-contract.test.ts's timeline: one page, states 3s apart, the
// success at 15s, so a six-step plan ending on it is valid in one call.
const TIMELINE: AnalysisState[] = [
  state({ timestampMs: 0, visibleText: ["פתיחה"], actionType: "navigate" }),
  state({ timestampMs: 3000, visibleText: ["בחירה"] }),
  state({ timestampMs: 6000, visibleText: ["הקלדה"], actionType: "type" }),
  state({ timestampMs: 9000, visibleText: ["אישור"], actionType: "select" }),
  state({ timestampMs: 12_000, visibleText: ["גלילה"], actionType: "scroll" }),
  state({ timestampMs: 15_000, visibleText: ["הצלחה"], actionType: "result" }),
];
const RECORDING_MS = 19_000;

/** A valid plan whose first label is the name's word. */
const PLAN = {
  object: {
    steps: [
      { sourceIndex: 0, label: NAME_WORD },
      { sourceIndex: 1, label: "בחירה" },
      { sourceIndex: 2, label: "הקלדה" },
      { sourceIndex: 3, label: "אישור" },
      { sourceIndex: 4, label: "גלילה" },
      { sourceIndex: 5, label: "הצלחה" },
    ],
    unexplainedMoments: [],
    notes: null,
  },
  usage: { inputTokens: 1000, outputTokens: 180 },
};

const SCRIPT = {
  object: { script: "טקסט קריינות" },
  usage: { inputTokens: 500, outputTokens: 40 },
};

let db: Db;
let pg: { close(): Promise<void> };
let businessId: string;
let demoId: string;
let analysisId: string;

beforeAll(async () => {
  delete process.env.DRY_RUN;
  resetEnvCache();
  const testDb = await createTestDb();
  db = testDb.db;
  pg = testDb.pg;

  const business = await createBusiness(db, { ownerEmail: "names@example.com", name: "עסק" });
  businessId = business.id;
  await setQuestionnaire(db, businessId, QUESTIONNAIRE);
  const demo = (
    await db
      .insert(dbSchema.demos)
      .values({
        businessId,
        status: "ready",
        rawPath: "assets/x/raw.mp4",
        description: DESCRIPTION,
        durationMs: RECORDING_MS,
      })
      .returning()
  )[0]!;
  demoId = demo.id;
  const analysis = (
    await db
      .insert(dbSchema.demoAnalyses)
      .values({ demoId, status: "ready", timeline: TIMELINE, stateCount: TIMELINE.length })
      .returning()
  )[0]!;
  analysisId = analysis.id;
});

afterAll(async () => {
  await pg.close();
});

/** One plan job on the demo as it stands; the call Claude got and the plan stored. */
async function planOnce() {
  generateObject.mockReset().mockResolvedValueOnce(PLAN);
  const plan = (
    await db
      .insert(dbSchema.demoStepPlans)
      .values({ demoId, analysisId, status: "pending" })
      .returning()
  )[0]!;
  await enqueue(db, {
    type: "plan_demo_steps",
    idempotencyKey: `plan:${plan.id}`,
    payload: { planId: plan.id },
  });
  await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
  const stored = (
    await db.select().from(dbSchema.demoStepPlans).where(eq(dbSchema.demoStepPlans.id, plan.id))
  )[0]!;
  expect(stored.status).toBe("ready");
  expect(generateObject).toHaveBeenCalledTimes(1);
  return {
    call: generateObject.mock.calls[0]![0] as { prompt: string },
    steps: stored.steps,
    notes: stored.notes,
    unexplainedMoments: stored.unexplainedMoments,
  };
}

/** One VO script on the demo as it stands; the call Claude got and the row stored. */
async function scriptOnce() {
  generateObject.mockReset().mockResolvedValueOnce(SCRIPT);
  const script = await generateVoScript(db, {
    businessId,
    demoId,
    selectedAdvantages: ["מהיר"],
  });
  expect(generateObject).toHaveBeenCalledTimes(1);
  return {
    call: generateObject.mock.calls[0]![0] as { prompt: string },
    text: script.text,
    params: script.params,
    promptVersion: script.promptVersion,
  };
}

describe("a demo's name never reaches a model (decision 0125)", () => {
  it("the plan and the VO script get the same input with and without a name", async () => {
    const unnamedPlan = await planOnce();
    const unnamedScript = await scriptOnce();

    await setDemoName(db, { demoId, name: NAME });
    const [named] = await db.select().from(dbSchema.demos).where(eq(dbSchema.demos.id, demoId));
    expect(named!.name).toBe(NAME);

    const namedPlan = await planOnce();
    const namedScript = await scriptOnce();

    // The description still reaches both prompts — the comparison is live.
    expect(unnamedPlan.call.prompt).toContain(DESCRIPTION);
    expect(unnamedScript.call.prompt).toContain(DESCRIPTION);

    expect(namedPlan.call.prompt).toBe(unnamedPlan.call.prompt);
    expect(namedPlan.call).toEqual(unnamedPlan.call);
    expect(namedScript.call.prompt).toBe(unnamedScript.call.prompt);
    expect(namedScript.call).toEqual(unnamedScript.call);
    for (const prompt of [namedPlan.call.prompt, namedScript.call.prompt]) {
      expect(prompt).not.toContain(NAME);
      expect(prompt).not.toContain(NAME_WORD);
    }

    expect(namedPlan.steps).toEqual(unnamedPlan.steps);
    expect(namedPlan.notes).toEqual(unnamedPlan.notes);
    expect(namedPlan.unexplainedMoments).toEqual(unnamedPlan.unexplainedMoments);
    expect(namedScript).toEqual(unnamedScript);
  });

  it("with no description either, the name still reaches neither prompt", async () => {
    // The path a name fallback would most likely take: a named demo whose note
    // is blank renders the sentinel, never the name.
    await db.update(dbSchema.demos).set({ description: null }).where(eq(dbSchema.demos.id, demoId));
    await setDemoName(db, { demoId, name: "" });
    const unnamedPlan = await planOnce();
    const unnamedScript = await scriptOnce();
    await setDemoName(db, { demoId, name: NAME });
    const namedPlan = await planOnce();
    const namedScript = await scriptOnce();

    expect(namedPlan.call).toEqual(unnamedPlan.call);
    expect(namedScript).toEqual(unnamedScript);
    expect(namedPlan.steps).toEqual(unnamedPlan.steps);
    for (const prompt of [namedPlan.call.prompt, namedScript.call.prompt]) {
      expect(prompt).not.toContain(NAME);
      expect(prompt).not.toContain(NAME_WORD);
    }
    await db
      .update(dbSchema.demos)
      .set({ description: DESCRIPTION })
      .where(eq(dbSchema.demos.id, demoId));
  });

  it("a label word found only in the name stays flagged off-screen", async () => {
    // Named here, not relied on from the cases above, so it proves the same
    // thing when run on its own.
    await setDemoName(db, { demoId, name: NAME });
    const plan = await planOnce();
    const steps = plan.steps as { label: string; offScreenWords: string[] }[];
    expect(steps[0]!.label).toBe(NAME_WORD);
    expect(steps[0]!.offScreenWords).toEqual([NAME_WORD]);
  });
});
