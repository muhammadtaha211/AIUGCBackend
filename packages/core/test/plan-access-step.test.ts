import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Hoisted so the module factory below can close over it: the live branch of
// generateStepPlan reaches the real Claude call, and the pin's contract on
// that branch is what half of this file tests.
const generateObject = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/anthropic", () => ({
  generateObject,
  generateRawWithImages: vi.fn(),
  CLAUDE_MODEL: "claude-sonnet-4-6",
}));

import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { FIXTURES_DIR } from "../src/paths";
import {
  createBusiness,
  questionnaireSchema,
  type Questionnaire,
} from "../src/pipelines/businesses";
import { analysisTimelineSchema, type AnalysisState } from "../src/pipelines/demo-analysis";
import {
  ACCESS_LABEL,
  findAccessMoment,
  findPlanViolations,
  generateStepPlan,
  PlanViolationError,
  planStepsSchema,
  registrableDomain,
  stepDurations,
  updatePlanSteps,
  type StepDurationConfig,
} from "../src/pipelines/demo-step-plans";
import { renderPrompt } from "../src/prompts";
import { createTestDb } from "./helpers/pglite";

/**
 * The pinned "כנסו לכאן" access step (founder rule, 2026-09-23). Detection is
 * a pure function over the analysed timeline; the pin is guaranteed by code
 * on both generation branches; every downstream rule keeps holding; a
 * timeline with no access moment produces exactly today's plan.
 *
 * The real recordings: fixtures/timelines/real-tavnit-system-opening.json is
 * the founder's own demo, whose address bar analyze_demo@v3 read as `system`
 * (the case the pin exists for); real-botteacher-six-word-label.json is the
 * same moment read as `other`/low; real-botteacher-study-app.json is a
 * v2-era analysis with no screenKind at all.
 */

function fixture(name: string): { timeline: AnalysisState[]; questionnaire: Questionnaire } {
  const raw = JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${name}.json`), "utf8")) as {
    timeline: unknown;
    questionnaire: unknown;
  };
  return {
    timeline: analysisTimelineSchema.parse(raw.timeline),
    questionnaire: questionnaireSchema.parse(raw.questionnaire),
  };
}

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

const QUESTIONNAIRE: Questionnaire = {
  category: "app_or_digital",
  product_name: "קמפיינר",
  what_it_does: "יוצר קמפיינים אוטומטית",
  advantages: ["מהיר", "בעברית"],
  target_audience: "בעלי עסקים קטנים",
  tone: "friendly",
};

/** The four jobnet.co.il production analyses in miniature (2026-08-27 to
 *  09-16): eleven `other`/high `type` states on the address bar from 200ms
 *  to 6800ms, a duplicate idle frame, the loading screen, the site. */
const JOBNET: AnalysisState[] = [
  ...[200, 600, 1400, 2400, 3000, 3400, 4200, 5000, 5400, 6000, 6800].map((timestampMs) =>
    state({
      timestampMs,
      actionType: "type",
      screenKind: "other",
      visibleText: ["jobnet.co.il", "חיפוש עבודה בחינם", "jobnet - Google Search"],
    }),
  ),
  state({
    timestampMs: 7400,
    actionType: "idle",
    screenKind: "other",
    sameStateAsPrevious: true,
    visibleText: ["jobnet.co.il"],
  }),
  state({
    timestampMs: 8400,
    actionType: "navigate",
    screenKind: "loading",
    legibility: "low",
    visibleText: ["jobnet.co.il"],
  }),
  state({
    timestampMs: 11200,
    actionType: "navigate",
    screenKind: "product",
    visibleText: ["לוח דרושים"],
  }),
  state({
    timestampMs: 15000,
    actionType: "tap",
    screenKind: "product",
    visibleText: ["בחירת תחום"],
  }),
  state({
    timestampMs: 18000,
    actionType: "result",
    screenKind: "product",
    visibleText: ["נמצאו משרות"],
  }),
];

/** A recording with no access moment at all — the retry-contract shape. */
const PLAIN: AnalysisState[] = [
  state({ timestampMs: 0, visibleText: ["פתיחה"], actionType: "navigate" }),
  state({ timestampMs: 3000, visibleText: ["בחירה"] }),
  state({ timestampMs: 6000, visibleText: ["הקלדה"], actionType: "type" }),
  state({ timestampMs: 9000, visibleText: ["אישור"], actionType: "select" }),
  state({ timestampMs: 12_000, visibleText: ["גלילה"], actionType: "scroll" }),
  state({ timestampMs: 15_000, visibleText: ["הצלחה"], actionType: "result" }),
  state({ timestampMs: 18_000, visibleText: ["המשך"], actionType: "navigate" }),
];

let db: Db;
let pg: { close(): Promise<void> };
let durations: StepDurationConfig;

/** Run one call on the keyless branch and put the env back. */
async function withDryRun<T>(fn: () => Promise<T>): Promise<T> {
  process.env.DRY_RUN = "1";
  resetEnvCache();
  try {
    return await fn();
  } finally {
    delete process.env.DRY_RUN;
    resetEnvCache();
  }
}

beforeAll(async () => {
  delete process.env.DRY_RUN;
  resetEnvCache();
  const testDb = await createTestDb();
  db = testDb.db;
  pg = testDb.pg;
  // No app_config rows: the code constants (3s floor, type 2200 / select 1800).
  durations = await stepDurations(db);
});

afterAll(async () => {
  await pg.close();
});

describe("findAccessMoment (the access moment, deterministic)", () => {
  it("pins the founder's system-kind opening: the latest candidate whose clip fits the run", () => {
    const { timeline, questionnaire } = fixture("real-tavnit-system-opening");
    const access = findAccessMoment(timeline, { durations, link: questionnaire.link });
    // States 1, 2, 3 and 5 type "tavnit.ai" (4 shows only "tavnit.a"); 6 is
    // the loading screen at 5000ms, so 5 (ends 7200) and 3 (ends 5800)
    // overrun and 2 (1800 -> 4800) is the latest that fits.
    expect(access).toEqual({
      index: 2,
      pinMs: 3000,
      run: [1, 2, 3, 5],
      runEndMs: 5000,
      runStartMs: 1200,
      dropUntilMs: 5000,
    });
    expect(timeline[2]!.screenKind).toBe("system");
  });

  it("v2-era study-app: no screenKind anywhere, the 15s bound alone, idle frames are not candidates", () => {
    const { timeline, questionnaire } = fixture("real-botteacher-study-app");
    const access = findAccessMoment(timeline, { durations, link: questionnaire.link });
    // Candidates 1 (type) and 4 (select), 2800ms apart — one run; the state
    // after it is the loading-named screen at 10200ms, so 4 (5400 -> 8400)
    // fits and the completed address is on screen from the clip's first frame.
    expect(access).toMatchObject({ index: 4, run: [1, 4], runEndMs: 10_200, dropUntilMs: 10_200 });
    expect(timeline[4]!.screenKind).toBeUndefined();
  });

  it("six-word-label: other/low address bar, the tap state ends the run, only the earliest fits", () => {
    const { timeline, questionnaire } = fixture("real-botteacher-six-word-label");
    const access = findAccessMoment(timeline, { durations, link: questionnaire.link });
    expect(access).toMatchObject({
      index: 2,
      run: [2, 3, 4, 5, 6],
      runEndMs: 5600,
      runStartMs: 1200,
      dropUntilMs: 5600,
    });
    expect(timeline[2]!.legibility).toBe("low");
  });

  it("jobnet shape: eleven address-bar states, the pin is the sixth (4200 -> 7200 fits the 7400 run end)", () => {
    const access = findAccessMoment(JOBNET, { durations });
    expect(access).toMatchObject({ index: 6, runEndMs: 7400, runStartMs: 200, dropUntilMs: 7400 });
    expect(access!.run).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("a recording that opens already on the product, or with no URL at all, is untouched", () => {
    const routing = fixture("real-botteacher-file-routing");
    expect(findAccessMoment(routing.timeline, { durations })).toBeNull();
    const campaign = fixture("dry-run-campaign-app");
    expect(findAccessMoment(campaign.timeline, { durations })).toBeNull();
  });

  it("a loaded site read as `other` with its URL bar in frame is not the way in — navigate/idle never qualify", () => {
    const loaded = [
      state({
        timestampMs: 400,
        actionType: "navigate",
        screenKind: "other",
        legibility: "low",
        visibleText: ["https://boteacher.com", "boteacher"],
      }),
      state({
        timestampMs: 2800,
        actionType: "idle",
        screenKind: "other",
        visibleText: ["https://boteacher.com", "הקורסים שלי"],
      }),
      state({
        timestampMs: 6000,
        actionType: "tap",
        screenKind: "other",
        visibleText: ["Black Hole"],
      }),
    ];
    expect(findAccessMoment(loaded, { durations })).toBeNull();
  });

  it("a URL typed after a product state, or past 15s, is a search inside the product", () => {
    const afterProduct = [
      state({
        timestampMs: 400,
        actionType: "navigate",
        screenKind: "product",
        visibleText: ["דף הבית"],
      }),
      state({
        timestampMs: 3000,
        actionType: "type",
        screenKind: "other",
        visibleText: ["boteacher.com"],
      }),
    ];
    expect(findAccessMoment(afterProduct, { durations })).toBeNull();
    const late = [
      state({ timestampMs: 400, actionType: "navigate", visibleText: ["לוח בקרה"] }),
      state({ timestampMs: 16_000, actionType: "type", visibleText: ["myapp.co.il"] }),
    ];
    expect(findAccessMoment(late, { durations })).toBeNull();
  });

  it("login/error pages carrying the domain and emails are skipped; the real typing state after them is the pin", () => {
    const loginFirst = [
      state({
        timestampMs: 400,
        actionType: "type",
        screenKind: "login",
        visibleText: ["app.tavnit.ai", "אימייל", "user@gmail.com"],
      }),
      state({
        timestampMs: 3000,
        actionType: "type",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({ timestampMs: 6000, actionType: "navigate", screenKind: "loading", visibleText: [] }),
    ];
    expect(findAccessMoment(loginFirst, { durations })).toMatchObject({ index: 1, run: [1] });
    const errorPage = [
      state({
        timestampMs: 400,
        actionType: "type",
        screenKind: "error",
        visibleText: ["This site can't be reached", "tavnit.ai"],
      }),
    ];
    expect(findAccessMoment(errorPage, { durations })).toBeNull();
    // An email is not an address: the whole ENTRY is out, "@" or no "@" elsewhere.
    const email = [
      state({
        timestampMs: 400,
        actionType: "type",
        screenKind: "other",
        visibleText: ["support@tavnit.ai"],
      }),
    ];
    expect(findAccessMoment(email, { durations })).toBeNull();
  });

  it("unreadable and duplicate frames are never the pin", () => {
    const dim = [
      state({
        timestampMs: 400,
        actionType: "type",
        screenKind: "other",
        legibility: "unreadable",
        visibleText: ["tavnit.ai"],
      }),
      state({
        timestampMs: 1200,
        actionType: "type",
        screenKind: "other",
        sameStateAsPrevious: true,
        visibleText: ["tavnit.ai"],
      }),
      state({
        timestampMs: 2000,
        actionType: "type",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({ timestampMs: 6000, actionType: "navigate", screenKind: "loading", visibleText: [] }),
    ];
    expect(findAccessMoment(dim, { durations })).toMatchObject({ index: 2, run: [2] });
  });

  it("file names, version numbers and abbreviations are not domains", () => {
    const junk = [
      state({
        timestampMs: 400,
        actionType: "type",
        screenKind: "other",
        visibleText: ["Takin Syllabus.txt", "index.html", "3.5", "e.g.", "tavnit.", "Ask G"],
      }),
    ];
    expect(findAccessMoment(junk, { durations })).toBeNull();
  });

  it("the questionnaire link's registrable domain detects an off-list TLD, only inside the window", () => {
    const typed = [
      state({
        timestampMs: 400,
        actionType: "navigate",
        screenKind: "system",
        visibleText: ["New Tab"],
      }),
      state({
        timestampMs: 1000,
        actionType: "type",
        screenKind: "system",
        visibleText: ["myclinic.health"],
      }),
      state({ timestampMs: 4000, actionType: "navigate", screenKind: "loading", visibleText: [] }),
    ];
    expect(findAccessMoment(typed, { durations })).toBeNull();
    expect(
      findAccessMoment(typed, { durations, link: "https://www.myclinic.health/about" }),
    ).toMatchObject({ index: 1 });
    const afterBoundary = [
      state({
        timestampMs: 400,
        actionType: "navigate",
        screenKind: "product",
        visibleText: ["לוח בקרה"],
      }),
      state({
        timestampMs: 2000,
        actionType: "type",
        screenKind: "other",
        visibleText: ["myclinic.health"],
      }),
    ];
    expect(
      findAccessMoment(afterBoundary, { durations, link: "https://www.myclinic.health/about" }),
    ).toBeNull();
  });

  it("registrableDomain: host minus www, two-label public suffixes kept whole, junk is undefined", () => {
    expect(registrableDomain("https://app.jobnet.co.il/NewStyle/x")).toBe("jobnet.co.il");
    expect(registrableDomain("www.Tavnit.AI")).toBe("tavnit.ai");
    expect(registrableDomain("https://www.myclinic.health/about")).toBe("myclinic.health");
    expect(registrableDomain("localhost")).toBeUndefined();
    expect(registrableDomain("not a url")).toBeUndefined();
    expect(registrableDomain("")).toBeUndefined();
    expect(registrableDomain(undefined)).toBeUndefined();
  });

  it("when no candidate's clip fits the run, the earliest is pinned", () => {
    const short = [
      state({
        timestampMs: 1000,
        actionType: "type",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({
        timestampMs: 1600,
        actionType: "type",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({ timestampMs: 2000, actionType: "navigate", screenKind: "loading", visibleText: [] }),
    ];
    // 1600 -> 4600 and 1000 -> 4000 both overrun the 2000ms run end.
    expect(findAccessMoment(short, { durations })).toMatchObject({
      index: 0,
      run: [0, 1],
      runEndMs: 2000,
      dropUntilMs: 4000,
    });
  });

  it("a candidate more than one step after the previous one is a second typing, not this run", () => {
    const twoRuns = [
      state({
        timestampMs: 1000,
        actionType: "type",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({
        timestampMs: 2000,
        actionType: "type",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({
        timestampMs: 5000,
        actionType: "navigate",
        screenKind: "other",
        visibleText: ["הגדרות"],
      }),
      state({
        timestampMs: 9000,
        actionType: "type",
        screenKind: "other",
        visibleText: ["tavnit.ai/help"],
      }),
    ];
    expect(findAccessMoment(twoRuns, { durations })).toMatchObject({
      run: [0, 1],
      runEndMs: 5000,
      index: 1,
      dropUntilMs: 5000,
    });
  });
});

describe("the pin on a model plan (real DB, mocked Claude)", () => {
  const tavnit = fixture("real-tavnit-system-opening");
  const usage = { inputTokens: 1000, outputTokens: 200 };
  const plan = (steps: [number, string][], notes: string | null = null) => ({
    object: {
      steps: steps.map(([sourceIndex, label]) => ({ sourceIndex, label })),
      unexplainedMoments: [],
      notes,
    },
    usage,
  });
  /** The founder-approved journey on this demo, minus his hand-added step 1. */
  const JOURNEY: [number, string][] = [
    [7, "מלאו שאלון קצר על המוצר"],
    [16, "בחרו דמות שתציג את המוצר"],
    [23, "התסריט נכתב לכם בעברית"],
    [26, "האזינו להקלטה לפני שמאשרים"],
    [44, "הסרטון מוכן ליצירה"],
    [49, "הורידו את הסרטון המוכן"],
  ];

  it("pins כנסו לכאן first, drops the model's own way-in and everything in the drop zone, keeps the journey", async () => {
    // The model followed the prompt's old §4 on a `system` state (5, 4200ms)
    // — today's validator would reject it and burn a corrective call.
    generateObject.mockReset().mockResolvedValueOnce(plan([[5, "כנסו לtavnit.ai"], ...JOURNEY]));

    const draft = await generateStepPlan(db, tavnit);

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.retryViolations).toEqual([[]]);
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([2, 7, 16, 23, 26, 44, 49]);
    const pin = draft.steps[0]!;
    expect(pin).toMatchObject({
      sourceIndex: 2,
      label: ACCESS_LABEL,
      timestampMs: 1800,
      actionType: "type",
      durationMs: 3000,
      offScreenWords: [],
    });
    // The journey is intact, labels and all.
    expect(draft.steps.slice(1).map((s) => [s.sourceIndex, s.label])).toEqual(JOURNEY);
    // Pinned plans are distinguishable in the row.
    expect(draft.promptVersion).toBe("plan_demo_steps@v14+access-pin");

    // The model was told: the reduced counts, the reduced band, the notice.
    const prompt = (generateObject.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("select 4–6 states");
    expect(prompt).toContain("The steps must total 12.0-18.0s");
    expect(prompt).toContain("## The way in is already the first step");
    expect(prompt).toContain(`captioned "${ACCESS_LABEL}", running 3.0s`);
    expect(prompt).toContain("any state from 1200ms up to 5000ms");
  });

  it("a system-kind pin passes findPlanViolations only as the pin", () => {
    const steps = [
      { sourceIndex: 2, label: ACCESS_LABEL },
      ...JOURNEY.map(([sourceIndex, label]) => ({ sourceIndex, label })),
    ];
    const access = findAccessMoment(tavnit.timeline, { durations })!;
    const shape = {
      minSteps: 5,
      notes: null,
      minStepMs: 3000,
      runtime: { durations, minMs: 15_000, maxMs: 21_000 },
    };
    expect(findPlanViolations(steps, tavnit.timeline, 7, { ...shape, pinned: access })).toEqual([]);
    // Without the pin the same plan is what it always was: a skip-kind pick.
    expect(
      findPlanViolations(steps, tavnit.timeline, 7, shape).some((v) => v.includes('"system"')),
    ).toBe(true);
  });

  it("the corrective prompt echoes the pin at index 0, and the fixed plan lands pinned", async () => {
    // Ends past the success state (52 is a tap after the last result, 49).
    generateObject
      .mockReset()
      .mockResolvedValueOnce(
        plan([...JOURNEY.slice(0, 4), [49, "הורידו את הסרטון"], [52, "צפו בסרטון"]]),
      )
      .mockResolvedValueOnce(plan(JOURNEY));

    const draft = await generateStepPlan(db, tavnit);

    expect(generateObject).toHaveBeenCalledTimes(2);
    const retry = (generateObject.mock.calls[1]![0] as { prompt: string }).prompt;
    expect(retry).toContain("Your previous plan was:");
    // The echo is the COMBINED plan: the pin sits first, where "step 0" points.
    const echoed = retry.slice(retry.indexOf("Your previous plan was:"));
    expect(echoed.indexOf('"sourceIndex": 2')).toBeLessThan(echoed.indexOf('"sourceIndex": 7'));
    expect(echoed).toContain(`"label": "${ACCESS_LABEL}"`);
    expect(retry).toContain("It appears as index 0 in any plan echoed back to you");
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([2, 7, 16, 23, 26, 44, 49]);
    expect(draft.retryViolations).toHaveLength(2);
  });

  it("the model repeating the pin under its own caption is re-pinned, never duplicated", async () => {
    generateObject
      .mockReset()
      .mockResolvedValueOnce(plan([[2, "כנסו לאתר tavnit.ai"], ...JOURNEY]));
    const draft = await generateStepPlan(db, tavnit);
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([2, 7, 16, 23, 26, 44, 49]);
    expect(draft.steps[0]!.label).toBe(ACCESS_LABEL);
  });

  it("a loaded site read as `other` with no loading state: the window runs long, the drop zone does not", async () => {
    // The 2-of-6 production shape (jobnet read as `other` throughout) minus
    // the loading screen those analyses happened to catch: nothing closes
    // the 15s window, so a whole-window drop would swallow states 4-7.
    const timeline = [
      ...[200, 1000, 2000, 3000].map((timestampMs) =>
        state({
          timestampMs,
          actionType: "type",
          screenKind: "other",
          visibleText: ["jobnet.co.il"],
        }),
      ),
      state({
        timestampMs: 4000,
        actionType: "navigate",
        screenKind: "other",
        visibleText: ["לוח דרושים"],
      }),
      state({
        timestampMs: 7000,
        actionType: "tap",
        screenKind: "other",
        visibleText: ["בחירת תחום"],
      }),
      state({
        timestampMs: 10_000,
        actionType: "select",
        screenKind: "other",
        visibleText: ["אזור"],
      }),
      state({
        timestampMs: 13_000,
        actionType: "navigate",
        screenKind: "other",
        visibleText: ["טופס"],
      }),
      state({
        timestampMs: 16_000,
        actionType: "result",
        screenKind: "other",
        visibleText: ["נשלח"],
      }),
    ];
    // Run [0..3], run end 4000: 3 (-> 6000), 2 (-> 5000) overrun, 1 (1000 -> 4000) fits.
    expect(findAccessMoment(timeline, { durations })).toMatchObject({
      index: 1,
      dropUntilMs: 4000,
    });
    generateObject.mockReset().mockResolvedValueOnce(
      plan([
        [4, "כנסו ללוח הדרושים"],
        [5, "בחרו תחום"],
        [6, "סמנו אזור"],
        [7, "מלאו את הטופס"],
        [8, "הטופס נשלח"],
      ]),
    );
    const draft = await generateStepPlan(db, { timeline, questionnaire: QUESTIONNAIRE });
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([1, 4, 5, 6, 7, 8]);
  });

  it("study-app (v2-era) through the drop zone: address-bar picks go, the steps at 10200ms and after stay", async () => {
    const study = fixture("real-botteacher-study-app");
    // The 2026-08-20 live selection [1,13,36,42,49,56,...] opened on the
    // address bar; with the pin at 4 the zone is [2600, 10200).
    generateObject.mockReset().mockResolvedValueOnce(
      plan(
        [
          [1, "כנסו לboteacher.com"],
          [3, "בחרו את האתר"],
          [13, "היכנסו לחשבון"],
          [36, "העלו את חומרי הקורס"],
          [42, "הקורס מסודר"],
          [49, "פתחו את המחברת"],
          [56, "התוכנית מוכנה"],
        ],
        "בסרטון אין סיום ברור — כדאי לצלם עד לפעולה שהושלמה",
      ),
    );
    const draft = await generateStepPlan(db, study);
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([4, 13, 36, 42, 49, 56]);
    expect(draft.steps[0]).toMatchObject({
      label: ACCESS_LABEL,
      durationMs: 3000,
      offScreenWords: [],
    });
  });

  it("no access moment: the prompt is v14 verbatim and the version is plain", async () => {
    generateObject.mockReset().mockResolvedValueOnce(
      plan([
        [0, "פתיחה"],
        [1, "בחירה"],
        [2, "הקלדה"],
        [3, "אישור"],
        [4, "גלילה"],
        [5, "הצלחה"],
      ]),
    );
    const draft = await generateStepPlan(db, { timeline: PLAIN, questionnaire: QUESTIONNAIRE });
    expect(draft.promptVersion).toBe("plan_demo_steps@v14");
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    const prompt = (generateObject.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).not.toContain("The way in is already the first step");
    expect(prompt).toContain("select 5–7 states");
    expect(prompt).toContain("The steps must total 15.0-21.0s");
    // Byte for byte what renderPrompt gives for these inputs — nothing appended.
    const { text } = renderPrompt("plan_demo_steps", {
      questionnaire: JSON.stringify(QUESTIONNAIRE, null, 2),
      timeline: prompt.slice(prompt.indexOf("[\n"), prompt.indexOf("\n]") + 2),
      min: 5,
      max: 7,
      timing: "",
      demo_description: "(אין — התבסס על השאלון והמסכים בלבד)",
    });
    expect(prompt.endsWith(text.slice(text.lastIndexOf("## Before you answer")))).toBe(true);
  });

  it("a plan that still violates after the ladder fails with the marked version", async () => {
    // Every call ends past the success state and the ladder is 3 calls, ever.
    generateObject
      .mockReset()
      .mockResolvedValue(
        plan([...JOURNEY.slice(0, 4), [49, "הורידו את הסרטון"], [52, "צפו בסרטון"]]),
      );
    const thrown = await generateStepPlan(db, tavnit).then(
      () => null,
      (err: unknown) => err,
    );
    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(thrown).toBeInstanceOf(PlanViolationError);
    expect((thrown as PlanViolationError).promptVersion).toBe("plan_demo_steps@v14+access-pin");
  });
});

describe("the pin on the canned DRY_RUN plan", () => {
  beforeAll(() => {
    process.env.DRY_RUN = "1";
    resetEnvCache();
  });
  afterAll(() => {
    delete process.env.DRY_RUN;
    resetEnvCache();
  });

  it("the founder's demo: pin first, the canned journey around it, and it passes its own validation", async () => {
    const draft = await generateStepPlan(db, fixture("real-tavnit-system-opening"));
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([2, 9, 14, 24, 29, 44, 49]);
    expect(draft.steps[0]).toMatchObject({
      sourceIndex: 2,
      label: ACCESS_LABEL,
      durationMs: 3000,
      offScreenWords: [],
    });
    expect(draft.promptVersion).toBe("plan_demo_steps@dry-run+access-pin");
    expect(draft.notes).toBeNull();
  });

  it("study-app: the exclusion reaches the ending lookup too, so the keyless plan never throws", async () => {
    const draft = await generateStepPlan(db, fixture("real-botteacher-study-app"));
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([4, 5, 20, 43, 50, 79]);
    for (const step of draft.steps.slice(1))
      expect(step.timestampMs).toBeGreaterThanOrEqual(10_200);
  });

  it("no access moment: exactly today's canned plan and today's version", async () => {
    const draft = await generateStepPlan(db, fixture("dry-run-campaign-app"));
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([1, 3, 5, 7, 11]);
    expect(draft.promptVersion).toBe("plan_demo_steps@dry-run");
  });
});

describe("the waiver and the reachability bound count around the pin", () => {
  // Three legal address-bar states, a legal non-URL frame between them, the
  // loading screen, then three product states ending on the success. With
  // the pin at 1 the zone is [0, 6000): the ONLY plan there is has 4 steps.
  const timeline = [
    state({ timestampMs: 0, actionType: "type", screenKind: "other", visibleText: ["tavnit.ai"] }),
    state({
      timestampMs: 2000,
      actionType: "type",
      screenKind: "other",
      visibleText: ["tavnit.ai"],
    }),
    state({
      timestampMs: 3000,
      actionType: "navigate",
      screenKind: "other",
      visibleText: ["הצעות"],
    }),
    state({
      timestampMs: 5000,
      actionType: "type",
      screenKind: "other",
      visibleText: ["tavnit.ai"],
    }),
    state({ timestampMs: 6000, actionType: "navigate", screenKind: "loading", visibleText: [] }),
    state({
      timestampMs: 9000,
      actionType: "navigate",
      screenKind: "product",
      visibleText: ["דף הבית"],
    }),
    state({
      timestampMs: 12_000,
      actionType: "tap",
      screenKind: "product",
      visibleText: ["התחלה"],
    }),
    state({
      timestampMs: 15_000,
      actionType: "result",
      screenKind: "product",
      visibleText: ["נשמר"],
    }),
  ];
  const steps = [
    { sourceIndex: 1, label: ACCESS_LABEL },
    { sourceIndex: 5, label: "פתחו את דף הבית" },
    { sourceIndex: 6, label: "לחצו על התחלה" },
    { sourceIndex: 7, label: "הכל נשמר" },
  ];

  it("states inside the drop zone are not counted as selectable, and the pin is", () => {
    const access = findAccessMoment(timeline, { durations })!;
    expect(access).toMatchObject({ index: 1, run: [0, 1, 3], runEndMs: 6000, dropUntilMs: 6000 });
    const shape = {
      minSteps: 5,
      notes: null,
      minStepMs: 3000,
      runtime: { durations, minMs: 15_000, maxMs: 21_000 },
    };
    // Naively the walk counts 0, 2, 5, 6, 7 — five — and orders a fifth step
    // no retry can add; the reachability bound likewise certifies 15000ms.
    const naive = findPlanViolations(steps, timeline, 7, shape);
    expect(naive.some((v) => v.includes("fewer than the minimum"))).toBe(true);
    expect(naive.some((v) => v.includes("too SHORT"))).toBe(true);
    // With the pin known: 1 + {5, 6, 7} = 4 is all this timeline offers, and
    // 12000ms is all it can reach — both rules stand down.
    expect(findPlanViolations(steps, timeline, 7, { ...shape, pinned: access })).toEqual([]);
  });
});

describe("the human path treats the pinned step as an ordinary step", () => {
  it("relabel and delete work on the pinned system-kind step like on any other", async () => {
    const business = await createBusiness(db, { ownerEmail: "access@example.com", name: "עסק" });
    const { timeline } = fixture("real-tavnit-system-opening");
    const demo = (
      await db
        .insert(dbSchema.demos)
        .values({ businessId: business.id, status: "ready", rawPath: "assets/x/raw.mp4" })
        .returning()
    )[0]!;
    const analysis = (
      await db
        .insert(dbSchema.demoAnalyses)
        .values({ demoId: demo.id, status: "ready", timeline, stateCount: timeline.length })
        .returning()
    )[0]!;
    const draft = await withDryRun(() =>
      generateStepPlan(db, fixture("real-tavnit-system-opening")),
    );
    const planRow = (
      await db
        .insert(dbSchema.demoStepPlans)
        .values({
          demoId: demo.id,
          analysisId: analysis.id,
          status: "ready",
          steps: draft.steps,
          promptVersion: draft.promptVersion,
        })
        .returning()
    )[0]!;

    // Relabel: the customer's words replace the fixed caption, marks stay [].
    const relabelled = await updatePlanSteps(db, {
      planId: planRow.id,
      steps: draft.steps.map((s) =>
        s.sourceIndex === 2
          ? { sourceIndex: 2, label: "כנסו לאתר" }
          : { sourceIndex: s.sourceIndex, label: s.label },
      ),
    });
    const afterRelabel = planStepsSchema.parse(relabelled.steps);
    expect(afterRelabel[0]).toMatchObject({
      sourceIndex: 2,
      label: "כנסו לאתר",
      offScreenWords: [],
    });
    expect(timeline[2]!.screenKind).toBe("system");

    // Delete: the plan simply starts on the next step.
    const deleted = await updatePlanSteps(db, {
      planId: planRow.id,
      steps: draft.steps
        .filter((s) => s.sourceIndex !== 2)
        .map((s) => ({ sourceIndex: s.sourceIndex, label: s.label })),
    });
    const afterDelete = planStepsSchema.parse(deleted.steps);
    expect(afterDelete.map((s) => s.sourceIndex)).toEqual([9, 14, 24, 29, 44, 49]);
    const stored = (
      await db
        .select()
        .from(dbSchema.demoStepPlans)
        .where(eq(dbSchema.demoStepPlans.id, planRow.id))
    )[0]!;
    expect(planStepsSchema.parse(stored.steps)).toHaveLength(6);
  });
});
