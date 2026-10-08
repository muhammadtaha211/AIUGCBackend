import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Hoisted so the module factory below can close over it — the ladder and the
// repair after it only run on the live path (plan-retry-contract.test.ts).
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
import { overlappingPairs } from "../src/plan-format";
import { SCREENS_DETECTOR } from "../src/pipelines/analysis-screens";
import { createBusiness, setQuestionnaire, type Questionnaire } from "../src/pipelines/businesses";
import { analysisTimelineSchema, type AnalysisState } from "../src/pipelines/demo-analysis";
import {
  ACCESS_LABEL,
  approvePlan,
  findAccessMoment,
  generateStepPlan,
  momentClips,
  PLAN_SKIP_SCREEN_KINDS,
  planPromptTimeline,
  PlanViolationError,
  repairPlanSteps,
  runPlanRegression,
  STEP_MS,
  stepClip,
  totalRuntimeMs,
  type PlacedClip,
  type PlanStep,
} from "../src/pipelines/demo-step-plans";
import { createTestDb } from "./helpers/pglite";

/**
 * Decision 0074 on fixed 2 s clips (0076, 0084): every moment is offered to
 * the model with its clip, and a plan that still violates after the last
 * corrective call is repaired by dropping steps instead of failed.
 *
 * Three real timelines. 4219e82e and 6658999c are the analyses behind the two
 * plans that failed live on 2026-10-01 — bd0913b4 and ce687d4a, two uploads of
 * the same 84s tavnit.ai recording. f6e343d1 is "T4", a 73s recording on which
 * no moment a plan may select has a calm clip. Their timing, action types,
 * screen structure and footage instants are production's; their TEXT is not —
 * every word is a placeholder token (test/data/, each file's _comment says
 * what was kept and why). Failed rows store no steps, so the model answers
 * below are picks by index made for each case, never a stored plan.
 */

interface Analysis {
  link: string;
  recordingMs: number;
  instants: number[];
  timeline: AnalysisState[];
}

function analysis(id: string): Analysis {
  const raw = JSON.parse(
    readFileSync(new URL(`./data/analysis-${id}.json`, import.meta.url), "utf8"),
  ) as { link: string; recordingMs: number; instants: number[]; timeline: unknown };
  return {
    link: raw.link,
    recordingMs: raw.recordingMs,
    instants: raw.instants,
    timeline: analysisTimelineSchema.parse(raw.timeline),
  };
}

const BD0913B4 = analysis("4219e82e");
const CE687D4A = analysis("6658999c");
const T4 = analysis("f6e343d1");

/**
 * Per recording: the access step code pins, the states it takes off the table
 * with it, and one clean answer — moments a plan may select (readable, no
 * skipped kind, not a duplicate frame, outside the pin's zone) whose clips
 * share no footage, ending on the success state.
 */
const RECORDINGS = [
  {
    id: "4219e82e",
    a: BD0913B4,
    pin: 6,
    zone: [0, 1, 2, 3, 4, 5, 7],
    clean: [8, 11, 33, 41, 49, 57],
  },
  {
    id: "6658999c",
    a: CE687D4A,
    pin: 6,
    zone: [0, 1, 2, 3, 4, 5, 7],
    clean: [8, 11, 33, 41, 49, 57],
  },
  { id: "f6e343d1", a: T4, pin: 2, zone: [0, 1, 3, 4], clean: [8, 9, 11, 13, 16, 19, 23] },
];

const QUESTIONNAIRE: Questionnaire = {
  category: "app_or_digital",
  product_name: "תבנית",
  what_it_does: "יוצרת מודעות וידאו מהקלטת מסך",
  advantages: ["מהיר", "בעברית"],
  target_audience: "בעלי עסקים קטנים",
  tone: "friendly",
};

const usage = { inputTokens: 1000, outputTokens: 200 };
const answer = (steps: [number, string][], notes: string | null = null) => ({
  object: {
    steps: steps.map(([sourceIndex, label]) => ({ sourceIndex, label })),
    unexplainedMoments: [],
    notes,
  },
  usage,
});
/** A three-word caption on each pick — inside the word ceiling, so a case's
 *  violations are only the ones it sets up. */
const say = (indexes: number[]): [number, string][] =>
  indexes.map((sourceIndex) => [sourceIndex, `ממשיכים לשלב ${sourceIndex}`]);
/** Six words: two over what a 2 s step can show. */
const SIX_WORDS = "בוחרים את הדמות שתציג את המוצר";
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

/** Every moment's clip, read the one way the plan job reads it. */
const clipsOf = (a: Analysis) =>
  momentClips(db, { timeline: a.timeline, recordingMs: a.recordingMs, instants: a.instants });

/** What every stored plan is, repaired or not: each step its moment's placed
 *  2 s clip, and no footage shown twice. */
async function expectPlacedSteps(a: Analysis, steps: PlanStep[]): Promise<void> {
  const { clips } = await clipsOf(a);
  for (const step of steps) {
    expect(step.durationMs).toBe(STEP_MS);
    expect(step.startMs).toBe(clips[step.sourceIndex]!.startMs);
    expect(step.twoPages).toBe(clips[step.sourceIndex]!.twoPages ? true : undefined);
  }
  expect(overlappingPairs(steps.map(stepClip))).toEqual([]);
  expect(totalRuntimeMs(steps)).toBe(steps.length * STEP_MS);
}

describe("every moment is offered to the model, with its clip (0084)", () => {
  it.each([
    { ...RECORDINGS[0]!, calm: 16, twoPages: 9 },
    { ...RECORDINGS[1]!, calm: 16, twoPages: 11 },
    { ...RECORDINGS[2]!, calm: 1, twoPages: 10 },
  ])(
    "analysis $id: no state is held back, and each says where its clip starts",
    async ({ a, pin, zone, clean, calm, twoPages }) => {
      const { clips, sampleMs, recordingEndMs } = await clipsOf(a);
      const offered = planPromptTimeline(a.timeline, clips);
      expect(offered).toHaveLength(a.timeline.length);
      offered.forEach((entry, i) => {
        // The index is the sourceIndex the model answers with.
        expect(entry.index).toBe(i);
        expect(entry.timestampMs).toBe(a.timeline[i]!.timestampMs);
        expect(entry.clipStartMs).toBe(clips[i]!.startMs);
        expect(entry.calm).toBe(clips[i]!.calm);
        // Only when true, so a one-page clip carries no such key in the JSON.
        expect(entry.twoPages).toBe(clips[i]!.twoPages ? true : undefined);
      });
      expect(offered.filter((entry) => entry.calm)).toHaveLength(calm);
      expect(offered.filter((entry) => entry.twoPages)).toHaveLength(twoPages);

      // The pin and the clean answer the cases below build on.
      const access = findAccessMoment(a.timeline, {
        clips,
        sampleMs,
        recordingEndMs,
        link: a.link,
      })!;
      expect(access.index).toBe(pin);
      expect([...access.zone].sort((x, y) => x - y)).toEqual(zone);
      for (const index of clean) {
        const s = a.timeline[index]!;
        expect(s.legibility).not.toBe("unreadable");
        expect(s.screenKind !== undefined && PLAN_SKIP_SCREEN_KINDS.has(s.screenKind)).toBe(false);
        expect(s.sameStateAsPrevious).toBe(false);
        expect(access.zone.has(index)).toBe(false);
      }
      expect(a.timeline[clean[clean.length - 1]!]!.actionType).toBe("result");
    },
  );

  it("no moment T4's plan may select has a calm clip", async () => {
    const { clips } = await clipsOf(T4);
    const selectable = T4.timeline
      .map((s, index) => ({ s, index }))
      .filter(
        ({ s }) =>
          s.legibility !== "unreadable" &&
          !(s.screenKind !== undefined && PLAN_SKIP_SCREEN_KINDS.has(s.screenKind)) &&
          !s.sameStateAsPrevious,
      );
    expect(selectable.map(({ index }) => index)).toEqual([
      6, 7, 8, 9, 11, 12, 13, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26,
    ]);
    expect(selectable.filter(({ index }) => clips[index]!.calm)).toEqual([]);
  });

  it.each(RECORDINGS)(
    "analysis $id: the prompt carries exactly that timeline",
    async ({ a, clean }) => {
      generateObject.mockReset().mockResolvedValueOnce(answer(say(clean)));
      const draft = await generateStepPlan(db, {
        timeline: a.timeline,
        questionnaire: { ...QUESTIONNAIRE, link: a.link },
        recordingMs: a.recordingMs,
        instants: a.instants,
      });
      const offered = planPromptTimeline(a.timeline, (await clipsOf(a)).clips);
      expect(promptOf(0)).toContain(JSON.stringify(offered, null, 2));
      expect(promptOf(0)).toMatch(/"clipStartMs": \d+,\n\s+"calm": (true|false)/);
      // A clean plan: the model's answer as given, the pin marked and nothing more.
      expect(draft.retryViolations).toEqual([[]]);
      expect(draft.promptVersion).toMatch(/^plan_demo_steps@v\d+\+access-pin$/);
    },
  );
});

describe("repairPlanSteps (0074 — pure)", () => {
  // Seven moments, 3 s apart, the last one the success state. Only the order
  // and the result state are read off the timeline; the clips are hand-made.
  const MOMENTS: AnalysisState[] = [0, 1, 2, 3, 4, 5, 6].map((i) =>
    state({ timestampMs: i * 3000, actionType: i === 6 ? "result" : "tap" }),
  );
  const at = (startMs: number, calm = true, twoPages = false): PlacedClip => ({
    startMs,
    calm,
    twoPages,
  });
  /** Every clip calm and on its own moment — nothing shared — but the ones named. */
  const placed = (named: Record<number, PlacedClip> = {}): PlacedClip[] =>
    MOMENTS.map((s, i) => named[i] ?? at(s.timestampMs));
  const sel = (...indexes: number[]) =>
    indexes.map((sourceIndex) => ({ sourceIndex, label: "כיתוב" }));
  const kept = (steps: { sourceIndex: number; label: string }[] | null): number[] | null =>
    steps?.map((s) => s.sourceIndex) ?? null;
  const repair = (
    steps: { sourceIndex: number; label: string }[],
    clips: PlacedClip[],
    opts: { maxSteps?: number; pinnedIndex?: number } = {},
  ) => kept(repairPlanSteps(steps, MOMENTS, clips, { maxSteps: 10, ...opts }));

  it("of two steps sharing footage, the one with the calm clip stays", () => {
    // 1 runs 3000-5000 and 2 runs 4000-6000.
    expect(repair(sel(0, 1, 2, 6), placed({ 1: at(3000, false), 2: at(4000) }))).toEqual([0, 2, 6]);
    expect(repair(sel(0, 1, 2, 6), placed({ 1: at(3000), 2: at(4000, false) }))).toEqual([0, 1, 6]);
  });

  it("neither calm: the one whose clip does not show two pages stays", () => {
    expect(
      repair(sel(0, 1, 2, 6), placed({ 1: at(3000, false, true), 2: at(4000, false) })),
    ).toEqual([0, 2, 6]);
    expect(
      repair(sel(0, 1, 2, 6), placed({ 1: at(3000, false), 2: at(4000, false, true) })),
    ).toEqual([0, 1, 6]);
  });

  it("a tie keeps the earlier step", () => {
    expect(repair(sel(0, 1, 2, 6), placed({ 2: at(4000) }))).toEqual([0, 1, 6]);
    expect(repair(sel(0, 1, 2, 6), placed({ 1: at(3000, false), 2: at(4000, false) }))).toEqual([
      0, 1, 6,
    ]);
  });

  it("overlaps are resolved as a set, not pair by pair", () => {
    // 4 (not calm) shares footage with 5 (calm), and 5 with the ending. Pair
    // by pair the calm 5 beats 4 and then loses to the ending: two steps.
    // Dropping 5 alone leaves three.
    const tail = placed({ 4: at(15_000, false), 5: at(16_000), 6: at(17_500) });
    expect(repair(sel(0, 4, 5, 6), tail, { pinnedIndex: 0 })).toEqual([0, 4, 6]);
    // The same between unprotected steps: 2 is the calm one, but 1 and 3
    // clear each other, and two steps are more than one.
    const chain = placed({ 1: at(3000, false), 2: at(4500), 3: at(6000, false) });
    expect(repair(sel(1, 2, 3, 6), chain)).toEqual([1, 3, 6]);
  });

  it("a step sharing footage with the pin or the ending is the one dropped", () => {
    // 1 and 5 are the calm ones and still go: the way in and the way out are
    // what the format cannot lose.
    const clips = placed({ 0: at(0, false), 1: at(1000), 5: at(17_000), 6: at(18_000, false) });
    expect(repair(sel(0, 1, 3, 5, 6), clips, { pinnedIndex: 0 })).toEqual([0, 3, 6]);
  });

  it("the pin and the ending sharing footage: not a plan to repair", () => {
    expect(repair(sel(3, 5, 6), placed({ 5: at(17_000) }), { pinnedIndex: 5 })).toBeNull();
  });

  // Nothing shared. 3 shows two pages; 2 and 4 are not calm, and 4's clip
  // starts 2000ms before its neighbour's where 2's nearest is 3000ms away.
  const CROWDED: PlacedClip[] = [
    at(0),
    at(2000),
    at(5000, false),
    at(9000, false, true),
    at(12_000, false),
    at(14_000),
    at(20_000),
  ];

  it("over the maximum: a two-page step goes first, then a non-calm one, the most crowded first", () => {
    const all = sel(0, 1, 2, 3, 4, 5, 6);
    expect(repair(all, CROWDED, { maxSteps: 6 })).toEqual([0, 1, 2, 4, 5, 6]);
    expect(repair(all, CROWDED, { maxSteps: 5 })).toEqual([0, 1, 2, 5, 6]);
    expect(repair(all, CROWDED, { maxSteps: 4 })).toEqual([0, 1, 5, 6]);
    // Only calm ones left. 0 and 1 are equally crowded: the earlier goes.
    expect(repair(all, CROWDED, { maxSteps: 3 })).toEqual([1, 5, 6]);
  });

  it("over the maximum: never the pin, the ending or the last step", () => {
    const all = sel(0, 1, 2, 3, 4, 5, 6);
    expect(repair(all, CROWDED, { maxSteps: 3, pinnedIndex: 0 })).toEqual([0, 5, 6]);
    // The success state (5) with a step after it (6): both stay, and with the
    // pin they are all that is left — still over a maximum of 2, which is the
    // caller's to refuse.
    const trailing = MOMENTS.map((s, i) => ({
      ...s,
      actionType: i === 5 ? ("result" as const) : ("tap" as const),
    }));
    expect(kept(repairPlanSteps(all, trailing, CROWDED, { maxSteps: 2, pinnedIndex: 0 }))).toEqual([
      0, 5, 6,
    ]);
  });

  it("a pick the re-check will reject is the one to lose: the plan it would fail is not kept for it", () => {
    // An unreadable or skipped-kind pick still fails the plan. Where one
    // shares footage with a legal step, keeping it — it is the calm one —
    // would turn a storable draft into a failure.
    const withBad = (bad: Partial<AnalysisState>): AnalysisState[] =>
      MOMENTS.map((s, i) => (i === 2 ? { ...s, ...bad } : s));
    const clips = placed({ 1: at(3000, false), 2: at(4000) });
    const run = (timeline: AnalysisState[], maxSteps = 10) =>
      kept(repairPlanSteps(sel(0, 1, 2, 6), timeline, clips, { maxSteps }));
    expect(run(MOMENTS)).toEqual([0, 2, 6]);
    expect(run(withBad({ legibility: "unreadable" }))).toEqual([0, 1, 6]);
    expect(run(withBad({ screenKind: "loading" }))).toEqual([0, 1, 6]);
    // Over the maximum it is the first to go too, calm or not.
    const apart = placed();
    expect(
      kept(
        repairPlanSteps(sel(0, 1, 2, 6), withBad({ legibility: "unreadable" }), apart, {
          maxSteps: 3,
        }),
      ),
    ).toEqual([0, 1, 6]);
  });

  it("captions are never touched and never a reason to drop", () => {
    const steps = [
      { sourceIndex: 0, label: SIX_WORDS },
      { sourceIndex: 3, label: "" },
      { sourceIndex: 6, label: "א".repeat(70) },
    ];
    expect(repairPlanSteps(steps, MOMENTS, placed(), { maxSteps: 10 })).toEqual(steps);
  });

  it("leaves a plan with nothing to drop exactly as it came, in chronological order", () => {
    expect(repair(sel(6, 0, 3), placed())).toEqual([0, 3, 6]);
  });

  it("does not speak to an index outside the timeline or one picked twice", () => {
    expect(repair(sel(0, 99), placed())).toBeNull();
    expect(repair(sel(0, 1.5), placed())).toBeNull();
    expect(repair(sel(0, 3, 0), placed())).toBeNull();
  });
});

describe("the last-round repair, through the plan job (0074)", () => {
  async function seedPlanRow(
    email: string,
    a: { link?: string; recordingMs: number; instants?: number[]; timeline: AnalysisState[] },
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
    // The footage row the job reads the instants from — without it nothing is
    // calm and every clip starts on its moment.
    if (a.instants) {
      await db.insert(dbSchema.demoAnalysisFootage).values({
        analysisId: row.id,
        fps: 5,
        fileSha: "x",
        moments: [],
        detector: SCREENS_DETECTOR,
        instants: a.instants.map((atMs) => ({ atMs, strength: 1, abrupt: 1 })),
      });
    }
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
    a: { link?: string; recordingMs: number; instants?: number[]; timeline: AnalysisState[] },
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

  const REPAIRED = /^plan_demo_steps@v\d+\+access-pin\+repaired$/;
  const NOT_REPAIRED = /^plan_demo_steps@v\d+\+access-pin$/;

  it.each(RECORDINGS)(
    "analysis $id: a clean answer is stored as given — one call, 2 s clips, no mark",
    async ({ id, a, pin, clean }) => {
      generateObject.mockReset().mockResolvedValue(answer(say(clean)));
      const { planId, row, steps } = await run(`clean-${id}@example.com`, a);

      expect(generateObject).toHaveBeenCalledTimes(1);
      expect(row.status).toBe("ready");
      expect(row.failKind).toBeNull();
      expect(row.failReason).toBeNull();
      expect(picks(steps)).toEqual([pin, ...clean]);
      expect(steps[0]!.label).toBe(ACCESS_LABEL);
      await expectPlacedSteps(a, steps);
      expect(rounds(row)).toEqual([[]]);
      expect(row.promptVersion).toMatch(NOT_REPAIRED);
      expect((await approvePlan(db, planId)).approvedAt).not.toBeNull();
    },
  );

  it.each([
    // 35's clip is calm and 36's is not.
    {
      id: "4219e82e",
      a: BD0913B4,
      picked: [8, 35, 36, 45, 51, 57],
      pair: "states 35 and 36",
      stored: [6, 8, 35, 45, 51, 57],
    },
    // 18 and 19 were placed on one and the same clip, not calm: the earlier stays.
    {
      id: "6658999c",
      a: CE687D4A,
      picked: [8, 18, 19, 45, 51, 57],
      pair: "states 18 and 19",
      stored: [6, 8, 18, 45, 51, 57],
    },
    // Neither is calm, and 12's clip shows two pages.
    {
      id: "f6e343d1",
      a: T4,
      picked: [8, 9, 12, 13, 19, 23],
      pair: "states 12 and 13",
      stored: [2, 8, 9, 13, 19, 23],
    },
  ])(
    "analysis $id: a last round with two steps on the same footage is stored ready with one of them",
    async ({ id, a, picked, pair, stored }) => {
      generateObject.mockReset().mockResolvedValue(answer(say(picked)));
      const { planId, row, steps } = await run(`overlap-${id}@example.com`, a);

      expect(generateObject).toHaveBeenCalledTimes(3);
      expect(row.status).toBe("ready");
      expect(row.failKind).toBeNull();
      expect(row.failReason).toBeNull();
      expect(picks(steps)).toEqual(stored);
      await expectPlacedSteps(a, steps);
      // Distinguishable on the row: the mark, and the round that says why.
      expect(row.promptVersion).toMatch(REPAIRED);
      expect(rounds(row)).toHaveLength(3);
      for (const round of rounds(row)) {
        expect(round).toEqual([expect.stringContaining(`${pair} show the same footage`)]);
      }
      // A repaired draft is an ordinary ready plan: it approves like any other.
      expect((await approvePlan(db, planId)).approvedAt).not.toBeNull();
    },
  );

  it.each(
    RECORDINGS.flatMap((recording) => [
      { ...recording, where: "a middle step", at: 1 },
      { ...recording, where: "the ending", at: recording.clean.length - 1 },
    ]),
  )(
    "analysis $id: a six-word caption on $where is kept for the editor to warn about — ready, not marked",
    async ({ id, a, pin, clean, at }) => {
      // Under a fixed clip the remedy is cutting a word, which is the
      // customer's to do (decision 0086): the step stays, the ending included.
      const captions = say(clean);
      captions[at] = [clean[at]!, SIX_WORDS];
      generateObject.mockReset().mockResolvedValue(answer(captions));
      const { row, steps } = await run(`six-words-${at}-${id}@example.com`, a);

      expect(generateObject).toHaveBeenCalledTimes(3);
      expect(row.status).toBe("ready");
      expect(picks(steps)).toEqual([pin, ...clean]);
      // The pin is step 0 of the plan the violation numbers.
      expect(steps[at + 1]!.label).toBe(SIX_WORDS);
      await expectPlacedSteps(a, steps);
      // Nothing was dropped, so the plan is the model's own answer: no mark.
      // The last round is what tells it from a clean one.
      expect(row.promptVersion).toMatch(NOT_REPAIRED);
      expect(rounds(row)).toHaveLength(3);
      for (const round of rounds(row)) {
        expect(round).toEqual([
          expect.stringContaining(`step ${at + 1}: label "${SIX_WORDS}" is over 4 words`),
        ]);
      }
    },
  );

  it.each([
    { id: "4219e82e", a: BD0913B4, picked: [45, 57], stored: [6, 45, 57], offers: 22 },
    { id: "6658999c", a: CE687D4A, picked: [45, 57], stored: [6, 45, 57], offers: 22 },
    { id: "f6e343d1", a: T4, picked: [19, 23], stored: [2, 19, 23], offers: 8 },
  ])(
    "analysis $id: a last round that is only short of the minimum is stored as it came",
    async ({ id, a, picked, stored, offers }) => {
      // Nothing for code to drop: 3 steps on a timeline that offers 5 and
      // more. A short draft the customer can extend beats a failure.
      generateObject.mockReset().mockResolvedValue(answer(say(picked)));
      const { row, steps } = await run(`short-${id}@example.com`, a);

      expect(generateObject).toHaveBeenCalledTimes(3);
      expect(row.status).toBe("ready");
      expect(picks(steps)).toEqual(stored);
      await expectPlacedSteps(a, steps);
      expect(row.promptVersion).toMatch(NOT_REPAIRED);
      expect(rounds(row)).toHaveLength(3);
      for (const round of rounds(row)) {
        expect(round).toEqual([
          expect.stringContaining(
            `the plan has 3 steps, fewer than the minimum 5 — this timeline offers ${offers} selectable states`,
          ),
        ]);
      }
    },
  );

  it.each([
    // 56's clip shares footage with the ending's (57).
    { id: "4219e82e", a: BD0913B4, pin: 6, middle: 45, sharing: 56, ending: 57 },
    { id: "6658999c", a: CE687D4A, pin: 6, middle: 45, sharing: 56, ending: 57 },
    // And 22's with 23's.
    { id: "f6e343d1", a: T4, pin: 2, middle: 19, sharing: 22, ending: 23 },
  ])(
    "analysis $id: a repair that leaves 3 steps is stored; one that leaves 2 fails as it always did",
    async ({ id, a, pin, middle, sharing, ending }) => {
      generateObject.mockReset().mockResolvedValue(answer(say([middle, sharing, ending])));
      const three = await run(`floor-3-${id}@example.com`, a);
      expect(three.row.status).toBe("ready");
      expect(picks(three.steps)).toEqual([pin, middle, ending]);
      expect(three.row.promptVersion).toMatch(REPAIRED);

      // The same answer without the middle step: the pin and the ending are
      // all that is left. One or two steps is a failure shown as a ready plan.
      generateObject.mockReset().mockResolvedValue(answer(say([sharing, ending])));
      const two = await run(`floor-2-${id}@example.com`, a);
      expect(generateObject).toHaveBeenCalledTimes(3);
      expect(two.row.status).toBe("failed");
      expect(two.row.failKind).toBe("validator");
      expect(two.row.failReason).toBe("יצירת תוכנית הצעדים נכשלה — נסו שוב");
      expect(two.row.steps).toBeNull();
      // Failed rows carry the generation mark too, and never the repair's.
      expect(two.row.promptVersion).toMatch(NOT_REPAIRED);
      expect(rounds(two.row)).toHaveLength(3);
      expect(
        rounds(two.row)[2]!.some((v) =>
          v.includes(`states ${sharing} and ${ending} show the same footage`),
        ),
      ).toBe(true);
    },
  );

  // T4 has no such case: with the pin it offers 8 steps up to its success
  // state (the count the short-plan violation above names), so no answer on
  // it is still over the maximum once its shared footage is resolved.
  it.each([
    // 12 shows two pages and goes first; then, of the non-calm ones, 8 — its
    // clip starts 2400ms after the pin's — and 15, tied with 18 and earlier.
    { id: "4219e82e", a: BD0913B4, stored: [6, 9, 11, 18, 24, 33, 41, 45, 49, 57] },
    // Here 12 and 15 both show two pages, and 8 is again the most crowded.
    { id: "6658999c", a: CE687D4A, stored: [6, 9, 11, 18, 24, 33, 41, 45, 49, 57] },
  ])(
    "analysis $id: a last round of 13 steps is trimmed to the maximum 10",
    async ({ id, a, stored }) => {
      // No footage shared anywhere: the count alone is over.
      const picked = [8, 9, 11, 12, 15, 18, 24, 33, 41, 45, 49, 57];
      generateObject.mockReset().mockResolvedValue(answer(say(picked)));
      const { row, steps } = await run(`over-max-${id}@example.com`, a);

      expect(generateObject).toHaveBeenCalledTimes(3);
      expect(row.status).toBe("ready");
      expect(picks(steps)).toEqual(stored);
      await expectPlacedSteps(a, steps);
      expect(row.promptVersion).toMatch(REPAIRED);
      expect(rounds(row)).toHaveLength(3);
      for (const round of rounds(row)) {
        expect(round).toEqual(["the plan has 13 steps — the maximum is 10"]);
      }
    },
  );

  it.each([
    [
      "does not end on the success state",
      say([8, 9, 11, 13, 16, 19]),
      "the last step must be the result/success state",
    ],
    ["selects a loading screen", say([5, 9, 11, 13, 19, 23]), 'state 5 is a "loading" screen'],
    [
      "selects an unreadable state",
      say([9, 11, 15, 16, 19, 23]),
      'state 15 is legibility "unreadable"',
    ],
    [
      "carries an empty caption",
      [...say([8, 9, 11, 13, 19]), [23, " "]] as [number, string][],
      "label is empty",
    ],
    [
      "carries a caption over 60 characters",
      [...say([8, 9, 11, 13, 19]), [23, "א".repeat(61)]] as [number, string][],
      "label is over 60 characters",
    ],
    [
      "names a state outside the timeline",
      say([8, 9, 11, 13, 19, 23, 99]),
      "sourceIndex 99 is not in the timeline",
    ],
    ["selects a state twice", say([8, 9, 9, 13, 19, 23]), "sourceIndex 9 is selected twice"],
  ])(
    "a last round that %s still fails — dropping steps does not fix it",
    async (_what, steps, names) => {
      // T4, through the same code the job runs. None of these is shared footage
      // or a count over the maximum, and none is one of the two things a draft
      // is forgiven.
      generateObject.mockReset().mockResolvedValue(answer(steps));
      const thrown = await generateStepPlan(db, {
        timeline: T4.timeline,
        questionnaire: { ...QUESTIONNAIRE, link: T4.link },
        recordingMs: T4.recordingMs,
        instants: T4.instants,
      }).then(
        () => null,
        (err: unknown) => err,
      );
      expect(generateObject).toHaveBeenCalledTimes(3);
      expect(thrown).toBeInstanceOf(PlanViolationError);
      const violation = thrown as PlanViolationError;
      expect(violation.rounds).toHaveLength(3);
      expect(violation.rounds[2]!.some((v) => v.includes(names))).toBe(true);
      expect(violation.promptVersion).toMatch(NOT_REPAIRED);
    },
  );

  // One page worked down, no address typed: no pin. No footage instants
  // either, so every clip starts on its moment — and the clips of states 1
  // and 2, 1400ms apart, share footage.
  const PAGE = "קמפיין חדש";
  const NO_PIN: AnalysisState[] = [
    state({ timestampMs: 0, screenName: PAGE, visibleText: ["פתיחה"], actionType: "navigate" }),
    state({ timestampMs: 3000, screenName: PAGE, visibleText: ["בחירה"] }),
    state({ timestampMs: 4400, screenName: PAGE, visibleText: ["הקלדה"], actionType: "type" }),
    state({ timestampMs: 8000, screenName: PAGE, visibleText: ["אישור"], actionType: "select" }),
    state({ timestampMs: 12_000, screenName: PAGE, visibleText: ["גלילה"], actionType: "scroll" }),
    state({ timestampMs: 15_000, screenName: PAGE, visibleText: ["הצלחה"], actionType: "result" }),
  ];
  const noPin = () =>
    generateStepPlan(db, { timeline: NO_PIN, questionnaire: QUESTIONNAIRE, recordingMs: 19_000 });

  it("without a pin the marks are the same, less +access-pin", async () => {
    generateObject.mockReset().mockResolvedValue(answer(say([0, 1, 2, 3, 4, 5])));
    const repaired = await noPin();
    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(picks(repaired.steps)).toEqual([0, 1, 3, 4, 5]);
    expect(repaired.steps.map((s) => s.startMs)).toEqual([0, 3000, 8000, 12_000, 15_000]);
    expect(repaired.promptVersion).toMatch(/^plan_demo_steps@v\d+\+repaired$/);
    // The violation names both clips, so the round on the row says what was shared.
    expect(repaired.retryViolations[2]).toEqual([
      expect.stringContaining(
        "states 1 and 2 show the same footage — their clips (3000-5000ms and 4400-6400ms) overlap",
      ),
    ]);

    // Something left over and nothing dropped: the plain stamp.
    generateObject
      .mockReset()
      .mockResolvedValue(answer([...say([0, 1, 3, 4]), [5, SIX_WORDS]] as [number, string][]));
    const kept = await noPin();
    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(picks(kept.steps)).toEqual([0, 1, 3, 4, 5]);
    expect(kept.steps[4]!.label).toBe(SIX_WORDS);
    expect(kept.promptVersion).toMatch(/^plan_demo_steps@v\d+$/);
    expect(kept.retryViolations[2]).toEqual([expect.stringContaining("is over 4 words")]);

    // And a failure carries the same plain stamp.
    generateObject.mockReset().mockResolvedValue(answer(say([0, 1, 3, 4])));
    const thrown = await noPin().then(
      () => null,
      (err: unknown) => err,
    );
    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(thrown).toBeInstanceOf(PlanViolationError);
    expect((thrown as PlanViolationError).promptVersion).toMatch(/^plan_demo_steps@v\d+$/);
  });

  it("a recording that offers two steps keeps a two-step plan, long caption or not", async () => {
    // 10 s, and only the last two moments are the product. With short captions
    // the first answer is stored (the minimum is waived: nothing more to
    // select). A six-word caption is kept (0086), so the same two steps must
    // not fail for being under the repair's floor.
    const SHORT: AnalysisState[] = [
      state({ timestampMs: 0, screenName: "כניסה", screenKind: "login" }),
      state({ timestampMs: 2000, screenName: "טעינה", screenKind: "loading" }),
      state({ timestampMs: 4000, screenName: PAGE, visibleText: ["בחירה"] }),
      state({ timestampMs: 7000, screenName: PAGE, visibleText: ["הצלחה"], actionType: "result" }),
    ];
    const short = () =>
      generateStepPlan(db, { timeline: SHORT, questionnaire: QUESTIONNAIRE, recordingMs: 10_000 });

    generateObject.mockReset().mockResolvedValue(answer(say([2, 3])));
    const clean = await short();
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(picks(clean.steps)).toEqual([2, 3]);

    generateObject.mockReset().mockResolvedValue(answer([...say([2]), [3, SIX_WORDS]]));
    const kept = await short();
    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(picks(kept.steps)).toEqual([2, 3]);
    expect(kept.steps[1]!.label).toBe(SIX_WORDS);
    expect(kept.promptVersion).toMatch(/^plan_demo_steps@v\d+$/);
  });
});

describe("plan regress shows a repair (0074)", () => {
  const isTavnit = (prompt: string) => prompt.includes("הורים לילדים קטנים");
  // The study-app fixture: BotTeacher's questionnaire on the one analysis of
  // it that carries no screenKind. Its expectation is `allowNotes`, so a plan
  // with notes is green whatever it selects — the selection cannot be what
  // turns it red below.
  const isStudyApp = (prompt: string) =>
    prompt.includes("BotTeacher") && !prompt.includes('"screenKind": "');
  const STUDY_APP = [13, 36, 43, 49, 56, 64];
  const NO_SUCCESS = "בהקלטה אין מסך הצלחה אמיתי";
  const outside = answer([[9999, "כיתוב"]]);

  it("a plan code changed, or one stored with something left over, is never green — and the result carries the model's last round", async () => {
    // The tavnit fixture gets two steps on the same footage (20 and 21):
    // repaired. The study-app fixture gets a six-word caption: stored as it
    // came. The other fixtures get an index outside their timeline, which
    // nothing repairs. The regress measures the model's own answer, so both
    // stored plans are red and say why.
    generateObject
      .mockReset()
      .mockImplementation(async ({ prompt }: { prompt: string }) =>
        isTavnit(prompt)
          ? answer(say([14, 20, 21, 23, 31, 49]))
          : isStudyApp(prompt)
            ? answer([[13, SIX_WORDS], ...say(STUDY_APP.slice(1))], NO_SUCCESS)
            : outside,
      );
    const results = await runPlanRegression(db);

    const tavnit = results.find((r) => r.fixture === "real-tavnit-system-opening.json")!;
    expect(tavnit.error).toBeUndefined();
    expect(tavnit.actual).toEqual([2, 14, 20, 23, 31, 49]);
    expect(tavnit.repaired).toEqual([
      expect.stringContaining("states 20 and 21 show the same footage"),
    ]);
    expect(tavnit.dropped).toBe(true);
    expect(tavnit.pass).toBe(false);

    const studyApp = results.find((r) => r.fixture === "real-botteacher-study-app.json")!;
    expect(studyApp.error).toBeUndefined();
    expect(studyApp.actual).toEqual([1, ...STUDY_APP]);
    expect(studyApp.notes).toBe(NO_SUCCESS);
    expect(studyApp.repaired).toEqual([expect.stringContaining("is over 4 words")]);
    // Nothing was dropped: the CLI must not call it repaired by code.
    expect(studyApp.dropped).toBeUndefined();
    expect(studyApp.pass).toBe(false);

    const others = results.filter((r) => r !== tavnit && r !== studyApp);
    expect(others).toHaveLength(3);
    for (const r of others) {
      expect(r.error).toContain("sourceIndex 9999 is not in the timeline");
      expect(r.repaired).toBeUndefined();
    }
  });

  it("the same plan with nothing left over is green", async () => {
    generateObject
      .mockReset()
      .mockImplementation(async ({ prompt }: { prompt: string }) =>
        isStudyApp(prompt) ? answer(say(STUDY_APP), NO_SUCCESS) : outside,
      );
    const results = await runPlanRegression(db);
    const studyApp = results.find((r) => r.fixture === "real-botteacher-study-app.json")!;
    expect(studyApp.error).toBeUndefined();
    expect(studyApp.actual).toEqual([1, ...STUDY_APP]);
    expect(studyApp.repaired).toBeUndefined();
    expect(studyApp.pass).toBe(true);
  });
});
