import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Hoisted so the module factory below can close over it — the ladder and the
// repair after it only run on the live path (plan-retry-contract.test.ts).
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
import { analysisTimelineSchema, type AnalysisState } from "../src/pipelines/demo-analysis";
import {
  ACCESS_LABEL,
  approvePlan,
  clipBounds,
  findAccessMoment,
  generateStepPlan,
  MIN_GAP_MS,
  planPromptTimeline,
  PlanViolationError,
  repairPlanSteps,
  runPlanRegression,
  timelineClipMs,
  totalRuntimeMs,
  type PlanStep,
} from "../src/pipelines/demo-step-plans";
import { createTestDb } from "./helpers/pglite";

/**
 * Decision 0074: the model is never offered a moment that cannot carry a
 * caption, and a plan that still violates after the last corrective call is
 * repaired by dropping steps instead of failed.
 *
 * The two real timelines are the analyses behind the two plans that failed
 * live on 2026-10-01 — bd0913b4 (analysis 4219e82e) and ce687d4a (analysis
 * 6658999c), two uploads of the same 84s tavnit.ai recording. Their timing,
 * action types and screen structure are production's; their TEXT is not —
 * every word is a placeholder token (test/data/, each file's _comment says
 * what was kept and why). Failed rows store no steps, so the model answers
 * below are reconstructions: bd0913b4's last round is the one whose total
 * matches the stored violation exactly (21600ms).
 */

function analysis(id: string): { link: string; recordingMs: number; timeline: AnalysisState[] } {
  const raw = JSON.parse(
    readFileSync(new URL(`./data/analysis-${id}.json`, import.meta.url), "utf8"),
  ) as { link: string; recordingMs: number; timeline: unknown };
  return {
    link: raw.link,
    recordingMs: raw.recordingMs,
    timeline: analysisTimelineSchema.parse(raw.timeline),
  };
}

const BD0913B4 = analysis("4219e82e");
const CE687D4A = analysis("6658999c");

const QUESTIONNAIRE: Questionnaire = {
  category: "app_or_digital",
  product_name: "תבנית",
  what_it_does: "יוצרת מודעות וידאו מהקלטת מסך",
  advantages: ["מהיר", "בעברית"],
  target_audience: "בעלי עסקים קטנים",
  tone: "friendly",
};

const DURATIONS = { maxMs: 4000, sampleMs: 200 };
const usage = { inputTokens: 1000, outputTokens: 200 };
const answer = (steps: [number, string][], notes: string | null = null) => ({
  object: {
    steps: steps.map(([sourceIndex, label]) => ({ sourceIndex, label })),
    unexplainedMoments: [],
    notes,
  },
  usage,
});
const picks = (steps: PlanStep[]): number[] => steps.map((s) => s.sourceIndex);
const promptOf = (call: number): string =>
  (generateObject.mock.calls[call]![0] as { prompt: string }).prompt;

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

describe("the model is offered only moments that can carry a caption (0074, D1)", () => {
  it.each([
    ["4219e82e", BD0913B4, 43],
    ["6658999c", CE687D4A, 41],
  ] as const)("analysis %s: nothing under 1600ms is offered, the pin excepted", (_id, a, shown) => {
    const bounds = clipBounds(DURATIONS, a.timeline, a.recordingMs);
    const clips = timelineClipMs(a.timeline, bounds);
    const access = findAccessMoment(a.timeline, { bounds, link: a.link })!;
    // D1 never touches the pin or its candidates: detection runs on the
    // whole timeline, the address-bar run included.
    expect(access).toMatchObject({ index: 0, pinMs: 3600, run: [0, 1, 2, 3, 4, 5, 6] });

    const offered = planPromptTimeline(a.timeline, clips, access.index);
    expect(offered).toHaveLength(shown);
    expect(offered[0]).toMatchObject({ index: 0, clipMs: 3600 });
    for (const entry of offered) {
      // The absolute index survives the gaps — it is the sourceIndex.
      expect(entry.timestampMs).toBe(a.timeline[entry.index]!.timestampMs);
      if (entry.index !== access.index) expect(entry.clipMs).toBeGreaterThanOrEqual(MIN_GAP_MS);
    }
    // And nothing that can carry a caption is held back.
    const hidden = a.timeline.map((_, i) => i).filter((i) => !offered.some((e) => e.index === i));
    for (const i of hidden) expect(clips[i]).toBeLessThan(MIN_GAP_MS);
    // State 9 — picked in both failed plans — is one of them.
    expect(hidden).toContain(9);
  });

  it("the picks ce687d4a kept returning are not in its timeline at all", () => {
    const bounds = clipBounds(DURATIONS, CE687D4A.timeline, CE687D4A.recordingMs);
    const clips = timelineClipMs(CE687D4A.timeline, bounds);
    // Round 1 picked 9 and 12, round 2 moved to 11, round 3 back to 12: each
    // a 200ms or 1200ms clip.
    expect([9, 11, 12].map((i) => clips[i])).toEqual([1200, 200, 200]);
    const offered = planPromptTimeline(CE687D4A.timeline, clips, 0).map((e) => e.index);
    expect(offered).not.toContain(9);
    expect(offered).not.toContain(11);
    expect(offered).not.toContain(12);
  });

  it("a pin whose own clip is under 1600ms stays in the timeline", () => {
    // The pin's caption needs 1200ms (G2), so its clip may be shorter than
    // any model caption could use.
    const timeline = [
      state({ timestampMs: 0 }),
      state({ timestampMs: 1000 }),
      state({ timestampMs: 2000 }),
    ];
    expect(planPromptTimeline(timeline, [1200, 200, 4000], 0).map((e) => e.index)).toEqual([0, 2]);
    expect(planPromptTimeline(timeline, [1200, 200, 4000]).map((e) => e.index)).toEqual([2]);
  });

  it("the prompt carries exactly that timeline, stamped +pickable", async () => {
    generateObject.mockReset().mockResolvedValueOnce(
      answer([
        [8, "נכנסים לדף הבית"],
        [45, "המערכת בונה תוכנית צעדים"],
        [51, "רואים איך המודעה תיבנה"],
        [57, "המודעה מוכנה להורדה"],
      ]),
    );
    const draft = await generateStepPlan(db, {
      timeline: CE687D4A.timeline,
      questionnaire: { ...QUESTIONNAIRE, link: CE687D4A.link },
      recordingMs: CE687D4A.recordingMs,
    });
    const bounds = clipBounds(DURATIONS, CE687D4A.timeline, CE687D4A.recordingMs);
    const offered = planPromptTimeline(
      CE687D4A.timeline,
      timelineClipMs(CE687D4A.timeline, bounds),
      0,
    );
    expect(promptOf(0)).toContain(JSON.stringify(offered, null, 2));
    expect(promptOf(0)).toMatch(/"index": 8,/);
    expect(promptOf(0)).not.toMatch(/"index": 12,/);
    // A clean plan: marked as generated from the pickable timeline, nothing more.
    expect(draft.retryViolations).toEqual([[]]);
    expect(draft.promptVersion).toMatch(/^plan_demo_steps@v\d+\+pickable\+access-pin$/);
  });
});

describe("repairPlanSteps (0074, D2 — pure)", () => {
  // Three screens. A: a0 0ms, a1 2400ms, a2 3800ms — it ends at 4000ms, so
  // a0's own clip is 4000 and a1's 1600. B and C each open with a full 4s.
  const SCREENS: AnalysisState[] = [
    state({
      timestampMs: 0,
      screenName: "לוח בקרה",
      visibleText: ["קורסים", "משימות"],
      actionType: "navigate",
    }),
    state({ timestampMs: 2400, screenName: "לוח בקרה", visibleText: ["קורסים", "משימות"] }),
    state({ timestampMs: 3800, screenName: "לוח בקרה", visibleText: ["קורסים", "משימות"] }),
    state({
      timestampMs: 5000,
      screenName: "העלאת קובץ",
      visibleText: ["גררו לכאן", "בחירה"],
      actionType: "navigate",
    }),
    state({ timestampMs: 9000, screenName: "העלאת קובץ", visibleText: ["גררו לכאן", "בחירה"] }),
    state({
      timestampMs: 10_000,
      screenName: "סיכום מוכן",
      visibleText: ["הסיכום", "הורדה"],
      actionType: "navigate",
    }),
    state({ timestampMs: 14_000, screenName: "סיכום מוכן", visibleText: ["הסיכום", "הורדה"] }),
  ];
  const screens = clipBounds(DURATIONS, SCREENS, 15_000);

  // One page worked down, a state every 4s: every clip is the 4s cap.
  const PAGE: AnalysisState[] = [0, 1, 2, 3, 4, 5, 6].map((i) =>
    state({
      timestampMs: i * 4000,
      screenName: "קמפיין חדש",
      visibleText: [`שלב ${i}`],
      actionType: i === 0 ? "navigate" : i === 6 ? "result" : "tap",
    }),
  );
  const page = clipBounds(DURATIONS, PAGE, 28_000);
  const all = (timeline: AnalysisState[]) =>
    timeline.map((_, sourceIndex) => ({ sourceIndex, label: "כיתוב" }));
  const kept = (steps: { sourceIndex: number; label: string }[] | null): number[] | null =>
    steps?.map((s) => s.sourceIndex) ?? null;

  it("the fixture's clips are what the cases below assume", () => {
    expect(timelineClipMs(SCREENS, screens)).toEqual([4000, 1600, 200, 4000, 200, 4000, 1000]);
    expect(timelineClipMs(PAGE, page)).toEqual([4000, 4000, 4000, 4000, 4000, 4000, 4000]);
  });

  it("drops a step whose caption cannot be read in its clip, and only that step", () => {
    const steps = [
      { sourceIndex: 0, label: "פותחים את לוח הבקרה" }, // 2000ms in a 2400ms window
      { sourceIndex: 1, label: "כל הקורסים והמשימות במקום אחד" }, // 2400ms in 1600ms
      { sourceIndex: 3, label: "מעלים קובץ" },
      { sourceIndex: 5, label: "הסיכום מוכן" },
    ];
    expect(kept(repairPlanSteps(steps, SCREENS, screens, { maxMs: 21_000 }))).toEqual([0, 3, 5]);
  });

  it("works last to first: dropping a later step rescues the one it was cutting", () => {
    // a0's six words need 2800ms and a1 cuts it at 2400ms; a1's four words
    // need 2000ms of a 1600ms clip. First to last would drop both. Last to
    // first drops a1, and a0 then runs its own 4000ms.
    const steps = [
      { sourceIndex: 0, label: "כל הקורסים והמשימות שלכם במקום אחד" },
      { sourceIndex: 1, label: "בוחרים קורס מתוך הרשימה" },
      { sourceIndex: 3, label: "מעלים קובץ" },
      { sourceIndex: 5, label: "הסיכום מוכן" },
    ];
    expect(kept(repairPlanSteps(steps, SCREENS, screens, { maxMs: 21_000 }))).toEqual([0, 3, 5]);
  });

  it("over the ceiling: the shortest step that is enough goes", () => {
    // 2400 + 1600 + 4000 + 4000 = 12000 against an 11000 ceiling. Dropping a1
    // frees nothing (a0 absorbs its 1600ms: still 12000), b0 leaves 8000, a0
    // leaves 9600 — the longest ad at or under the ceiling. Every total is
    // re-assembled; subtracting a1's 1600ms would have "landed" at 10400.
    const steps = [0, 1, 3, 5].map((sourceIndex) => ({ sourceIndex, label: "כיתוב" }));
    expect(kept(repairPlanSteps(steps, SCREENS, screens, { maxMs: 11_000 }))).toEqual([1, 3, 5]);
  });

  it("when one drop is not enough the biggest cut goes first; ties go to the earlier step", () => {
    // Seven 4s steps = 28000. No single drop reaches 21000, all cut the same
    // 4000: the earliest goes, then again the earliest of the five that are
    // each enough.
    expect(kept(repairPlanSteps(all(PAGE), PAGE, page, { maxMs: 21_000 }))).toEqual([
      2, 3, 4, 5, 6,
    ]);
  });

  it("never trims the pin", () => {
    expect(kept(repairPlanSteps(all(PAGE), PAGE, page, { maxMs: 21_000, pinnedIndex: 0 }))).toEqual(
      [0, 3, 4, 5, 6],
    );
  });

  it("never trims the last step or the last selected result state", () => {
    // The success state (1) is cut to 2000ms by a trailing tap (2): 4000 +
    // 2000 + 4000 = 10000 against 8000. By length alone the success would go
    // (it is the shortest step that is enough); it is the ending, so state 0
    // goes instead.
    const timeline = [
      state({ timestampMs: 16_000, screenName: "קמפיין חדש", actionType: "navigate" }),
      state({ timestampMs: 20_000, screenName: "קמפיין חדש", actionType: "result" }),
      state({ timestampMs: 22_000, screenName: "קמפיין חדש" }),
    ];
    const bounds = clipBounds(DURATIONS, timeline, 26_000);
    expect(kept(repairPlanSteps(all(timeline), timeline, bounds, { maxMs: 8000 }))).toEqual([1, 2]);
  });

  it("an ending whose caption cannot be read is not dropped: the plan is not one to repair", () => {
    // PAGE's last state is its result. Five words need 2400ms; a 26000ms
    // recording leaves that state a 2000ms clip.
    const short = clipBounds(DURATIONS, PAGE, 26_000);
    const steps = [
      { sourceIndex: 4, label: "כיתוב" },
      { sourceIndex: 5, label: "כיתוב" },
      { sourceIndex: 6, label: "הקמפיין שלכם מוכן ועלה לאוויר" },
    ];
    expect(repairPlanSteps(steps, PAGE, short, { maxMs: 21_000 })).toBeNull();
    // The same unreadable caption on a last step that is NOT a result state
    // is an ordinary step: it goes, and the plan ends one step earlier.
    const noResult = PAGE.map((s) => ({ ...s, actionType: "tap" as const }));
    expect(kept(repairPlanSteps(steps, noResult, short, { maxMs: 21_000 }))).toEqual([4, 5]);
  });

  it("leaves a plan with nothing to drop exactly as it came, in chronological order", () => {
    const steps = [5, 0, 3].map((sourceIndex) => ({ sourceIndex, label: "כיתוב" }));
    expect(kept(repairPlanSteps(steps, SCREENS, screens, { maxMs: 21_000 }))).toEqual([0, 3, 5]);
  });

  it("does not speak to an index outside the timeline or one picked twice", () => {
    const one = { sourceIndex: 0, label: "כיתוב" };
    expect(
      repairPlanSteps([one, { sourceIndex: 99, label: "כיתוב" }], SCREENS, screens, {
        maxMs: 21_000,
      }),
    ).toBeNull();
    expect(repairPlanSteps([one, one], SCREENS, screens, { maxMs: 21_000 })).toBeNull();
  });
});

describe("the last-round repair, through the plan job (0074, D2-D4)", () => {
  async function seedPlanRow(
    email: string,
    a: { link?: string; recordingMs: number; timeline: AnalysisState[] },
  ): Promise<string> {
    const business = await createBusiness(db, { ownerEmail: email, name: "עסק" });
    await setQuestionnaire(
      db,
      business.id,
      a.link ? { ...QUESTIONNAIRE, link: a.link } : QUESTIONNAIRE,
    );
    const demo = (
      await db
        .insert(dbSchema.demos)
        .values({
          businessId: business.id,
          status: "ready",
          rawPath: "assets/x/raw.mp4",
          durationMs: a.recordingMs,
        })
        .returning()
    )[0]!;
    const row = (
      await db
        .insert(dbSchema.demoAnalyses)
        .values({
          demoId: demo.id,
          status: "ready",
          timeline: a.timeline,
          stateCount: a.timeline.length,
        })
        .returning()
    )[0]!;
    const plan = (
      await db
        .insert(dbSchema.demoStepPlans)
        .values({ demoId: demo.id, analysisId: row.id, status: "pending" })
        .returning()
    )[0]!;
    await enqueue(db, {
      type: "plan_demo_steps",
      idempotencyKey: `plan:${plan.id}`,
      payload: { planId: plan.id },
    });
    return plan.id;
  }

  async function run(
    email: string,
    a: { link?: string; recordingMs: number; timeline: AnalysisState[] },
  ) {
    const planId = await seedPlanRow(email, a);
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
    const row = (
      await db.select().from(dbSchema.demoStepPlans).where(eq(dbSchema.demoStepPlans.id, planId))
    )[0]!;
    return { planId, row, steps: (row.steps ?? []) as PlanStep[] };
  }
  const rounds = (row: { retryViolations: unknown }): string[][] =>
    row.retryViolations as string[][];

  const REPAIRED = /^plan_demo_steps@v\d+\+pickable\+access-pin\+repaired$/;
  const NOT_REPAIRED = /^plan_demo_steps@v\d+\+pickable\+access-pin$/;

  it("bd0913b4's last round (21.6s) is stored ready at 19.6s, the 2.0s step dropped", async () => {
    // The plan's own steps, reconstructed: 3600 (pin) + 4000 + 2000 + 4000 +
    // 4000 + 4000 = 21600ms — the total its stored round 3 names. Dropping
    // 8, 45 or 51 would leave 17600; dropping 12 leaves 19600, the longest.
    generateObject.mockReset().mockResolvedValue(
      answer([
        [8, "נכנסים לדף הבית של תבנית"],
        [12, "בחרו דמות לפתיחה"],
        [45, "המערכת בונה לכם תוכנית צעדים"],
        [51, "רואים איך המודעה תיבנה"],
        [57, "המודעה מוכנה להורדה ולפרסום"],
      ]),
    );
    const { planId, row, steps } = await run("repair-bd0913b4@example.com", BD0913B4);

    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(row.status).toBe("ready");
    expect(row.failKind).toBeNull();
    expect(row.failReason).toBeNull();
    expect(picks(steps)).toEqual([0, 8, 45, 51, 57]);
    expect(steps[0]!.label).toBe(ACCESS_LABEL);
    expect(steps.map((s) => s.durationMs)).toEqual([3600, 4000, 4000, 4000, 4000]);
    expect(totalRuntimeMs(steps)).toBe(19_600);
    // Distinguishable on the row (D4): the mark, and the round that says why.
    expect(row.promptVersion).toMatch(REPAIRED);
    expect(rounds(row)).toHaveLength(3);
    for (const round of rounds(row)) {
      expect(round).toHaveLength(1);
      expect(round[0]).toContain("the steps total 21600ms");
      expect(round[0]).toContain("too LONG by 600ms");
    }
    // A repaired draft is an ordinary ready plan: it approves like any other.
    expect((await approvePlan(db, planId)).approvedAt).not.toBeNull();
  });

  it("4219e82e: state 9, the pick bd0913b4 made twice, is stripped and never echoed back", async () => {
    // Round 1 is bd0913b4's last round plus state 9 (a 1200ms clip): without
    // 9 it is the same 21.6s plan. Round 2 is clean and picks nothing hidden,
    // so the stored plan is the model's answer as given — not marked.
    generateObject
      .mockReset()
      .mockResolvedValueOnce(
        answer([
          [8, "נכנסים לדף הבית של תבנית"],
          [9, "יוצרים תוכן שיווקי"],
          [12, "בחרו דמות לפתיחה"],
          [45, "המערכת בונה לכם תוכנית צעדים"],
          [51, "רואים איך המודעה תיבנה"],
          [57, "המודעה מוכנה להורדה ולפרסום"],
        ]),
      )
      .mockResolvedValueOnce(
        answer([
          [8, "נכנסים לדף הבית של תבנית"],
          [45, "המערכת בונה לכם תוכנית צעדים"],
          [51, "רואים איך המודעה תיבנה"],
          [57, "המודעה מוכנה להורדה ולפרסום"],
        ]),
      );
    const { row, steps } = await run("repair-state-9@example.com", BD0913B4);

    expect(generateObject).toHaveBeenCalledTimes(2);
    // The only violation is the total, and state 9 is in neither the
    // violation's list of runs nor the plan echoed to the model.
    expect(rounds(row)[0]).toEqual([expect.stringContaining("the steps total 21600ms")]);
    expect(rounds(row)[0]![0]).not.toContain("state 9 ");
    const echoed = promptOf(1).slice(promptOf(1).indexOf("Your previous plan was:"));
    expect(echoed).toMatch(/"sourceIndex": 8,/);
    expect(echoed).not.toMatch(/"sourceIndex": 9,/);
    expect(row.status).toBe("ready");
    expect(picks(steps)).toEqual([0, 8, 45, 51, 57]);
    expect(rounds(row)[1]).toEqual([]);
    expect(row.promptVersion).toMatch(NOT_REPAIRED);
  });

  it("a pin whose clip is under 1600ms is never stripped as a hidden pick", async () => {
    // The address bar leaves 1200ms after the pinned state: enough for
    // "כנסו לכאן" (G2), under what any model caption needs. The pin stays in
    // the model's timeline and in the plan; state 1, the same screen's last
    // 200ms, does not.
    const site: AnalysisState[] = [
      state({
        timestampMs: 1000,
        actionType: "type",
        screenName: "New Tab",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({
        timestampMs: 2000,
        actionType: "idle",
        screenName: "New Tab",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      ...SHORT_ENDING.map((s) => ({ ...s, timestampMs: s.timestampMs + 3000 })),
    ];
    generateObject.mockReset().mockResolvedValueOnce(
      answer([
        [2, "פתיחה"],
        [3, "בחירה"],
        [4, "הקלדה"],
        [5, "אישור"],
        [6, "גלילה"],
        [7, "הצלחה"],
      ]),
    );
    const draft = await generateStepPlan(db, {
      timeline: site,
      questionnaire: { ...QUESTIONNAIRE, link: "tavnit.ai" },
      recordingMs: 22_000,
    });

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.steps[0]).toMatchObject({ sourceIndex: 0, label: ACCESS_LABEL, durationMs: 1200 });
    expect(picks(draft.steps)).toEqual([0, 2, 3, 4, 5, 6, 7]);
    expect(draft.promptVersion).toMatch(NOT_REPAIRED);
    expect(promptOf(0)).toMatch(/"index": 0,/);
    expect(promptOf(0)).not.toMatch(/"index": 1,/);
  });

  it("6658999c: a pick of state 12 never reaches the plan — one call, ready, marked", async () => {
    // State 12 is a one-state screen with a 200ms clip. The rest is a clean
    // plan, so there is nothing to correct and nothing to repair; the mark
    // records that the stored plan is not the model's answer as given.
    generateObject.mockReset().mockResolvedValue(
      answer([
        [8, "נכנסים לדף הבית"],
        [12, "בוחרים דמות לפתיח הסרטון"],
        [45, "המערכת בונה תוכנית צעדים"],
        [51, "רואים איך המודעה תיבנה"],
        [57, "המודעה מוכנה להורדה"],
      ]),
    );
    const { row, steps } = await run("repair-ce687d4a-clean@example.com", CE687D4A);

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(row.status).toBe("ready");
    expect(picks(steps)).toEqual([0, 8, 45, 51, 57]);
    expect(totalRuntimeMs(steps)).toBe(19_600);
    expect(rounds(row)).toEqual([[]]);
    expect(row.promptVersion).toMatch(REPAIRED);
  });

  it("6658999c: a last round carrying state 12 is stored ready without it, though only 4 steps are left", async () => {
    // Without state 12 the plan is one step under the minimum on a timeline
    // that offers more, so every round violates and the third is the last.
    // The step code dropped counts: the draft is held to no minimum (D3).
    generateObject.mockReset().mockResolvedValue(
      answer([
        [12, "בוחרים דמות לפתיח הסרטון"],
        [45, "המערכת בונה תוכנית צעדים"],
        [51, "רואים איך המודעה תיבנה"],
        [57, "המודעה מוכנה להורדה"],
      ]),
    );
    const { row, steps } = await run("repair-ce687d4a-last@example.com", CE687D4A);

    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(row.status).toBe("ready");
    expect(picks(steps)).toEqual([0, 45, 51, 57]);
    expect(totalRuntimeMs(steps)).toBe(15_600);
    expect(row.promptVersion).toMatch(REPAIRED);
    expect(rounds(row)).toHaveLength(3);
    for (const round of rounds(row)) {
      expect(round).toHaveLength(1);
      expect(round[0]).toContain("fewer than the minimum 5");
    }
    // The corrective prompt never showed the model the stripped step.
    expect(promptOf(1)).not.toMatch(/"sourceIndex": 12,/);
  });

  it("a last round that is only too short is stored as it came", async () => {
    // Nothing for code to drop: 3 steps, 11.6s, under the floor and the
    // minimum on a timeline that could reach both. A short draft the
    // customer can extend beats a failure (founder, 0074).
    generateObject.mockReset().mockResolvedValue(
      answer([
        [45, "המערכת בונה תוכנית צעדים"],
        [57, "המודעה מוכנה להורדה"],
      ]),
    );
    const { row, steps } = await run("repair-short@example.com", BD0913B4);

    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(row.status).toBe("ready");
    expect(picks(steps)).toEqual([0, 45, 57]);
    expect(totalRuntimeMs(steps)).toBe(11_600);
    expect(row.promptVersion).toMatch(REPAIRED);
    const last = rounds(row)[2]!;
    expect(last.some((v) => v.includes("fewer than the minimum 5"))).toBe(true);
    expect(last.some((v) => v.includes("too SHORT"))).toBe(true);
  });

  it("a repair that leaves 3 steps is stored; one that leaves 2 fails as it always did", async () => {
    // State 12's clip is 2000ms and six words need 2800ms: the step goes.
    const unreadable: [number, string] = [12, "בחרו את הדמות שתציג את המוצר"];
    generateObject
      .mockReset()
      .mockResolvedValue(
        answer([unreadable, [45, "המערכת בונה תוכנית צעדים"], [57, "המודעה מוכנה להורדה"]]),
      );
    const three = await run("repair-floor-3@example.com", BD0913B4);
    expect(three.row.status).toBe("ready");
    expect(picks(three.steps)).toEqual([0, 45, 57]);
    expect(three.row.promptVersion).toMatch(REPAIRED);

    // The same answer without state 45: the pin and the ending are all that
    // is left. One or two steps is a failure shown as a ready plan.
    generateObject.mockReset().mockResolvedValue(answer([unreadable, [57, "המודעה מוכנה להורדה"]]));
    const two = await run("repair-floor-2@example.com", BD0913B4);
    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(two.row.status).toBe("failed");
    expect(two.row.failKind).toBe("validator");
    expect(two.row.failReason).toBe("יצירת תוכנית הצעדים נכשלה — נסו שוב");
    expect(two.row.steps).toBeNull();
    // Failed rows carry the generation mark too, and never the repair's.
    expect(two.row.promptVersion).toMatch(NOT_REPAIRED);
    expect(rounds(two.row)).toHaveLength(3);
  });

  // One page worked down, no address typed: no pin. The success state's own
  // clip is the 2000ms the recording has left after it.
  const PAGE = "קמפיין חדש";
  const SHORT_ENDING: AnalysisState[] = [
    state({ timestampMs: 0, screenName: PAGE, visibleText: ["פתיחה"], actionType: "navigate" }),
    state({ timestampMs: 3000, screenName: PAGE, visibleText: ["בחירה"] }),
    state({ timestampMs: 6000, screenName: PAGE, visibleText: ["הקלדה"], actionType: "type" }),
    state({ timestampMs: 9000, screenName: PAGE, visibleText: ["אישור"], actionType: "select" }),
    state({ timestampMs: 12_000, screenName: PAGE, visibleText: ["גלילה"], actionType: "scroll" }),
    state({ timestampMs: 15_000, screenName: PAGE, visibleText: ["הצלחה"], actionType: "result" }),
  ];

  it("an ending whose caption cannot be read is not dropped into a stored plan", async () => {
    // Five words need 2400ms of the ending's 2000ms. A plan that loses its
    // success state is not a draft worth storing, so the repair never drops
    // it: the job fails as it always did (founder, 0074).
    generateObject.mockReset().mockResolvedValue(
      answer([
        [0, "פתיחה"],
        [1, "בחירה"],
        [2, "הקלדה"],
        [3, "אישור"],
        [4, "גלילה"],
        [5, "הקמפיין שלכם מוכן ועלה לאוויר"],
      ]),
    );
    const thrown = await generateStepPlan(db, {
      timeline: SHORT_ENDING,
      questionnaire: QUESTIONNAIRE,
      recordingMs: 17_000,
    }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(thrown).toBeInstanceOf(PlanViolationError);
    const violation = thrown as PlanViolationError;
    expect(violation.rounds).toHaveLength(3);
    expect(violation.rounds[2]).toHaveLength(1);
    expect(violation.rounds[2]![0]).toContain("the caption on state 5");
    expect(violation.promptVersion).toMatch(/^plan_demo_steps@v\d+\+pickable$/);
  });

  it("nor when the model's notes waive the ending rule", async () => {
    // With notes set the validator no longer asks for a success ending, so
    // nothing downstream would catch the missing step: the repair itself
    // refuses to drop the last selected result state.
    generateObject.mockReset().mockResolvedValue(
      answer(
        [
          [0, "פתיחה"],
          [1, "בחירה"],
          [2, "הקלדה"],
          [3, "אישור"],
          [4, "גלילה"],
          [5, "הקמפיין שלכם מוכן ועלה לאוויר"],
        ],
        "בהקלטה אין סיום ברור",
      ),
    );
    const thrown = await generateStepPlan(db, {
      timeline: SHORT_ENDING,
      questionnaire: QUESTIONNAIRE,
      recordingMs: 17_000,
    }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(thrown).toBeInstanceOf(PlanViolationError);
    expect((thrown as PlanViolationError).rounds[2]).toEqual([
      expect.stringContaining("the caption on state 5"),
    ]);
  });

  // The same page with two states 1400ms apart (1 and 2).
  const CLOSE_PAIR: AnalysisState[] = [
    state({ timestampMs: 0, screenName: PAGE, visibleText: ["פתיחה"], actionType: "navigate" }),
    state({ timestampMs: 3000, screenName: PAGE, visibleText: ["בחירה"] }),
    state({ timestampMs: 4400, screenName: PAGE, visibleText: ["הקלדה"], actionType: "type" }),
    state({ timestampMs: 8000, screenName: PAGE, visibleText: ["אישור"], actionType: "select" }),
    state({ timestampMs: 12_000, screenName: PAGE, visibleText: ["גלילה"], actionType: "scroll" }),
    state({ timestampMs: 15_000, screenName: PAGE, visibleText: ["הצלחה"], actionType: "result" }),
  ];
  const closePair = (earlier: string) =>
    answer([
      [0, "פתיחה"],
      [1, earlier],
      [2, "הקלדה"],
      [3, "אישור"],
      [4, "גלילה"],
      [5, "הצלחה"],
    ]);

  it("two picks under 1600ms apart: repaired when the earlier caption cannot be read in the gap", async () => {
    // Three words need 1600ms of a 1400ms window: the step is dropped, and
    // the too-close pair goes with it.
    generateObject.mockReset().mockResolvedValue(closePair("בוחרים את הקמפיין"));
    const draft = await generateStepPlan(db, {
      timeline: CLOSE_PAIR,
      questionnaire: QUESTIONNAIRE,
      recordingMs: 19_000,
    });
    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(picks(draft.steps)).toEqual([0, 2, 3, 4, 5]);
    expect(draft.promptVersion).toMatch(/^plan_demo_steps@v\d+\+pickable\+repaired$/);
    expect(draft.retryViolations[2]!.some((v) => v.includes("only 1400ms apart"))).toBe(true);
  });

  it("two picks under 1600ms apart with a readable two-word caption still fail", async () => {
    // Two words need 1200ms and have 1400ms: nothing the repair drops. The
    // too-close rule is not one of the two it covers, so it stands.
    generateObject.mockReset().mockResolvedValue(closePair("בוחרים קמפיין"));
    const thrown = await generateStepPlan(db, {
      timeline: CLOSE_PAIR,
      questionnaire: QUESTIONNAIRE,
      recordingMs: 19_000,
    }).then(
      () => null,
      (err: unknown) => err,
    );
    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(thrown).toBeInstanceOf(PlanViolationError);
    expect((thrown as PlanViolationError).rounds[2]).toEqual([
      expect.stringContaining("states 1 and 2 are only 1400ms apart"),
    ]);
  });
});

describe("plan regress shows a repair (0074)", () => {
  it("a plan code changed is never green, and the result carries what the model's last call left", async () => {
    // The tavnit fixture's journey (plan-access-step.test.ts) plus state 44, a
    // result state with a 200ms clip: stripped, and what is left is clean. The
    // other fixtures get an index outside their timeline, which nothing
    // repairs. The regress measures the model's own answer, so the stripped
    // plan is red and says so — before the repair existed it could not occur.
    generateObject.mockReset().mockImplementation(async ({ prompt }: { prompt: string }) =>
      prompt.includes("הורים לילדים קטנים")
        ? answer([
            [14, "בחרו דמות שתציג את המוצר"],
            [23, "התסריט נכתב לכם בעברית"],
            [26, "האזינו להקלטה לפני שמאשרים"],
            [31, "הסרטון מוכן ליצירה"],
            [44, "הסרטון נוצר בהצלחה"],
            [49, "הורידו את הסרטון המוכן"],
          ])
        : answer([[9999, "כיתוב"]]),
    );
    const results = await runPlanRegression(db);
    const tavnit = results.find((r) => r.fixture === "real-tavnit-system-opening.json")!;
    expect(tavnit.error).toBeUndefined();
    expect(tavnit.actual).toEqual([1, 14, 23, 26, 31, 49]);
    // A strip alone: the model's last call left no violation behind.
    expect(tavnit.repaired).toEqual([]);
    expect(tavnit.pass).toBe(false);
    const others = results.filter((r) => r !== tavnit);
    expect(others).toHaveLength(4);
    for (const r of others) {
      expect(r.error).toContain("sourceIndex 9999 is not in the timeline");
      expect(r.repaired).toBeUndefined();
    }
  });
});
