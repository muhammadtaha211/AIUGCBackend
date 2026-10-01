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
  clipBounds,
  findAccessMoment,
  findPlanViolations,
  generateStepPlan,
  PlanViolationError,
  planStepsSchema,
  readTimeMs,
  registrableDomain,
  stepDurations,
  updatePlanSteps,
  type ClipBounds,
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

function fixture(name: string): {
  timeline: AnalysisState[];
  questionnaire: Questionnaire;
  recordingMs?: number;
} {
  const raw = JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${name}.json`), "utf8")) as {
    timeline: unknown;
    questionnaire: unknown;
    recordingMs?: number;
  };
  return {
    timeline: analysisTimelineSchema.parse(raw.timeline),
    questionnaire: questionnaireSchema.parse(raw.questionnaire),
    // demos.duration_ms, as `aiugc plan regress` passes it: the last step's
    // ceiling.
    recordingMs: raw.recordingMs,
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
 *  to 6800ms, a duplicate idle frame, the loading screen, the site — each
 *  screen under its own screenName, the way analyze_demo names them. */
const JOBNET: AnalysisState[] = [
  ...[200, 600, 1400, 2400, 3000, 3400, 4200, 5000, 5400, 6000, 6800].map((timestampMs) =>
    state({
      timestampMs,
      actionType: "type",
      screenName: "New Tab - jobnet.co.il",
      screenKind: "other",
      visibleText: ["jobnet.co.il", "חיפוש עבודה בחינם", "jobnet - Google Search"],
    }),
  ),
  state({
    timestampMs: 7400,
    actionType: "idle",
    screenName: "New Tab - jobnet.co.il",
    screenKind: "other",
    sameStateAsPrevious: true,
    visibleText: ["jobnet.co.il"],
  }),
  state({
    timestampMs: 8400,
    actionType: "navigate",
    screenName: "jobnet.co.il - טעינה",
    screenKind: "loading",
    legibility: "low",
    visibleText: ["jobnet.co.il"],
  }),
  state({
    timestampMs: 11200,
    actionType: "navigate",
    screenName: "לוח דרושים",
    screenKind: "product",
    visibleText: ["לוח דרושים"],
  }),
  state({
    timestampMs: 15000,
    actionType: "tap",
    screenName: "לוח דרושים",
    screenKind: "product",
    visibleText: ["בחירת תחום"],
  }),
  state({
    timestampMs: 18000,
    actionType: "result",
    screenName: "לוח דרושים",
    screenKind: "product",
    visibleText: ["נמצאו משרות"],
  }),
];

/** A recording with no access moment at all — the retry-contract shape: one
 *  page worked down 3s apart (one screenName, no navigation after the first
 *  state, so no screen change cuts a step), the success at 15s and a tap
 *  after it on a 20s recording. Each step runs to the next selected state;
 *  the success, the full 4s cap. */
const PAGE = "קמפיין חדש";
const PLAIN: AnalysisState[] = [
  state({ timestampMs: 0, screenName: PAGE, visibleText: ["פתיחה"], actionType: "navigate" }),
  state({ timestampMs: 3000, screenName: PAGE, visibleText: ["בחירה"] }),
  state({ timestampMs: 6000, screenName: PAGE, visibleText: ["הקלדה"], actionType: "type" }),
  state({ timestampMs: 9000, screenName: PAGE, visibleText: ["אישור"], actionType: "select" }),
  state({ timestampMs: 12_000, screenName: PAGE, visibleText: ["גלילה"], actionType: "scroll" }),
  state({ timestampMs: 15_000, screenName: PAGE, visibleText: ["הצלחה"], actionType: "result" }),
  state({ timestampMs: 18_000, screenName: PAGE, visibleText: ["המשך"], actionType: "tap" }),
];
const PLAIN_RECORDING_MS = 20_000;

let db: Db;
let pg: { close(): Promise<void> };
let durations: StepDurationConfig;

/** Clip bounds exactly as generateStepPlan builds them: the shipped cap and
 *  sample, ending at the recording's length (absent: one sample past the
 *  last state). */
function boundsFor(timeline: AnalysisState[], recordingMs?: number): ClipBounds {
  return clipBounds(durations, timeline, recordingMs);
}

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
  // No app_config rows: the code constants (the 4s cap, a 200ms sample at 5 fps).
  durations = await stepDurations(db);
});

afterAll(async () => {
  await pg.close();
});

describe("findAccessMoment (the access moment, deterministic)", () => {
  it("pins the founder's system-kind opening: the earliest candidate whose clip reaches the screen's end", () => {
    const { timeline, questionnaire, recordingMs } = fixture("real-tavnit-system-opening");
    const access = findAccessMoment(timeline, {
      bounds: boundsFor(timeline, recordingMs),
      link: questionnaire.link,
    });
    // States 1, 2, 3 and 5 type "tavnit.ai" (4 shows only "tavnit.a"). The
    // New Tab screen holds through 5 and ends one sample after it, at 4400;
    // 6 is the loading screen. 1 (1200 + the 4s cap = 5200) already reaches
    // that end, so it is the pin and runs 3200ms. The EARLIEST candidate
    // that reaches the end wins because its clip is the longest that still
    // runs to the moment the page leaves the address bar — the typing and
    // the finished address both — where a later one shows less of the
    // typing, and one that cannot reach the end is cut by the cap first.
    expect(access).toEqual({
      index: 1,
      pinMs: 3200,
      run: [1, 2, 3, 5],
      runEndMs: 4400,
      runStartMs: 1200,
      dropUntilMs: 4400,
    });
    expect(timeline[1]!.screenKind).toBe("system");
  });

  it("v2-era study-app: no screenKind anywhere, the 15s bound alone, idle frames are not candidates", () => {
    const { timeline, questionnaire, recordingMs } = fixture("real-botteacher-study-app");
    const access = findAccessMoment(timeline, {
      bounds: boundsFor(timeline, recordingMs),
      link: questionnaire.link,
    });
    // Candidates 1 (type) and 4 (select) share the address-bar screen, which
    // ends one sample after 4, at 5600 (5 is BotTeacher's loading screen at
    // 10200). 1 (2600 + 4000 = 6600) reaches that end inside the cap, so it
    // is the pin and runs 3000ms; 4, the last frame before the page goes,
    // would get a single sample.
    expect(access).toEqual({
      index: 1,
      pinMs: 3000,
      run: [1, 4],
      runEndMs: 5600,
      runStartMs: 2600,
      dropUntilMs: 5600,
    });
    expect(timeline[1]!.screenKind).toBeUndefined();
  });

  it("six-word-label: other/low address bar, the earliest candidate within a cap of the screen's end", () => {
    const { timeline, questionnaire, recordingMs } = fixture("real-botteacher-six-word-label");
    const access = findAccessMoment(timeline, {
      bounds: boundsFor(timeline, recordingMs),
      link: questionnaire.link,
    });
    // The address bar holds through the tap at 5600 (7, not a candidate)
    // and ends one sample later, at 5800; 8 is the loading screen. 2 (1200 +
    // 4000 = 5200) stops short of that end, 3 (3200 + 4000 = 7200) is the
    // earliest that reaches it, so it runs 2600ms.
    expect(access).toEqual({
      index: 3,
      pinMs: 2600,
      run: [2, 3, 4, 5, 6],
      runEndMs: 5800,
      runStartMs: 1200,
      dropUntilMs: 5800,
    });
    expect(timeline[3]!.legibility).toBe("low");
  });

  it("jobnet shape: eleven address-bar states, the pin is the first within a cap of the screen's end", () => {
    const access = findAccessMoment(JOBNET, { bounds: boundsFor(JOBNET) });
    // The address bar holds through the duplicate idle frame (7400) and ends
    // one sample later, at 7600, where the loading screen takes over. Every
    // candidate before 3600 would be cut by the cap short of that; 6 (4200)
    // is the first that runs to it.
    expect(access).toMatchObject({
      index: 6,
      pinMs: 3400,
      runEndMs: 7600,
      runStartMs: 200,
      dropUntilMs: 7600,
    });
    expect(access!.run).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("a recording that opens already on the product, or with no URL at all, is untouched", () => {
    const routing = fixture("real-botteacher-file-routing");
    expect(
      findAccessMoment(routing.timeline, {
        bounds: boundsFor(routing.timeline, routing.recordingMs),
      }),
    ).toBeNull();
    const campaign = fixture("dry-run-campaign-app");
    expect(
      findAccessMoment(campaign.timeline, {
        bounds: boundsFor(campaign.timeline, campaign.recordingMs),
      }),
    ).toBeNull();
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
    expect(findAccessMoment(loaded, { bounds: boundsFor(loaded) })).toBeNull();
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
    expect(findAccessMoment(afterProduct, { bounds: boundsFor(afterProduct) })).toBeNull();
    const late = [
      state({ timestampMs: 400, actionType: "navigate", visibleText: ["לוח בקרה"] }),
      state({ timestampMs: 16_000, actionType: "type", visibleText: ["myapp.co.il"] }),
    ];
    expect(findAccessMoment(late, { bounds: boundsFor(late) })).toBeNull();
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
      // The address bar held while the page loads. A screen ends one sample
      // after its last state, so this frame is what gives the typing a clip
      // long enough for its caption (under 1200ms there is no pin — below).
      state({
        timestampMs: 5400,
        actionType: "idle",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({ timestampMs: 6000, actionType: "navigate", screenKind: "loading", visibleText: [] }),
    ];
    expect(findAccessMoment(loginFirst, { bounds: boundsFor(loginFirst) })).toMatchObject({
      index: 1,
      run: [1],
    });
    const errorPage = [
      state({
        timestampMs: 400,
        actionType: "type",
        screenKind: "error",
        visibleText: ["This site can't be reached", "tavnit.ai"],
      }),
    ];
    expect(findAccessMoment(errorPage, { bounds: boundsFor(errorPage) })).toBeNull();
    // An email is not an address: the whole ENTRY is out, "@" or no "@" elsewhere.
    const email = [
      state({
        timestampMs: 400,
        actionType: "type",
        screenKind: "other",
        visibleText: ["support@tavnit.ai"],
      }),
    ];
    expect(findAccessMoment(email, { bounds: boundsFor(email) })).toBeNull();
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
      // Held while the page loads, as above.
      state({
        timestampMs: 5400,
        actionType: "idle",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({ timestampMs: 6000, actionType: "navigate", screenKind: "loading", visibleText: [] }),
    ];
    expect(findAccessMoment(dim, { bounds: boundsFor(dim) })).toMatchObject({ index: 2, run: [2] });
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
    expect(findAccessMoment(junk, { bounds: boundsFor(junk) })).toBeNull();
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
      // Held while the page loads, as above.
      state({
        timestampMs: 3400,
        actionType: "idle",
        screenKind: "system",
        visibleText: ["myclinic.health"],
      }),
      state({ timestampMs: 4000, actionType: "navigate", screenKind: "loading", visibleText: [] }),
    ];
    expect(findAccessMoment(typed, { bounds: boundsFor(typed) })).toBeNull();
    expect(
      findAccessMoment(typed, {
        bounds: boundsFor(typed),
        link: "https://www.myclinic.health/about",
      }),
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
      findAccessMoment(afterBoundary, {
        bounds: boundsFor(afterBoundary),
        link: "https://www.myclinic.health/about",
      }),
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

  it("when every candidate sits more than a cap before the screen's end, the latest is pinned", () => {
    const lingering = [
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
      // The finished address left up, untouched, long after the typing.
      state({
        timestampMs: 7800,
        actionType: "idle",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({ timestampMs: 9000, actionType: "navigate", screenKind: "loading", visibleText: [] }),
    ];
    // The screen ends at 8000, one sample after the idle frame. 1000 + 4000
    // and 1600 + 4000 both stop short of it, so no clip can run to the
    // moment the page leaves; the latest candidate's comes closest, and it
    // runs the full cap. The drop zone is still the whole screen.
    expect(findAccessMoment(lingering, { bounds: boundsFor(lingering) })).toEqual({
      index: 1,
      pinMs: 4000,
      run: [0, 1],
      runEndMs: 8000,
      runStartMs: 1000,
      dropUntilMs: 8000,
    });
  });

  it("a candidate on a later screen is a second typing, not this run", () => {
    const twoRuns = [
      state({
        timestampMs: 1000,
        actionType: "type",
        screenName: "New Tab",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({
        timestampMs: 2000,
        actionType: "type",
        screenName: "New Tab",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({
        timestampMs: 4200,
        actionType: "idle",
        screenName: "New Tab",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({
        timestampMs: 5000,
        actionType: "navigate",
        screenName: "הגדרות",
        screenKind: "other",
        visibleText: ["הגדרות"],
      }),
      state({
        timestampMs: 9000,
        actionType: "type",
        screenName: "עזרה",
        screenKind: "other",
        visibleText: ["tavnit.ai/help"],
      }),
    ];
    // 4, inside the window and a candidate, sits on the help screen: the run
    // is the New Tab screen's candidates only, and that screen ends at 4400.
    expect(findAccessMoment(twoRuns, { bounds: boundsFor(twoRuns) })).toMatchObject({
      run: [0, 1],
      runEndMs: 4400,
      index: 0,
      dropUntilMs: 4400,
    });
  });

  it("no pin when the address bar leaves before its caption can be read", () => {
    // The pin is re-pinned every round, so a pin whose clip is shorter than
    // its own caption's read time would be a read-time violation no
    // corrective call could ever fix. "כנסו לכאן" needs 1200ms.
    expect(readTimeMs(ACCESS_LABEL)).toBe(1200);
    const heldUntil = (heldMs: number): AnalysisState[] => [
      state({
        timestampMs: 1000,
        actionType: "type",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({
        timestampMs: heldMs,
        actionType: "idle",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({ timestampMs: 3000, actionType: "navigate", screenKind: "loading", visibleText: [] }),
    ];
    // Held to 1800: the screen ends at 2000 and the only clip is 1000ms.
    const short = heldUntil(1800);
    expect(findAccessMoment(short, { bounds: boundsFor(short) })).toBeNull();
    // One sample longer is exactly the read time, and that pins.
    const enough = heldUntil(2000);
    expect(findAccessMoment(enough, { bounds: boundsFor(enough) })).toMatchObject({
      index: 0,
      pinMs: 1200,
    });
  });

  it("falls back to an earlier readable candidate when the one reaching the end is too short", () => {
    // The address typed at 1000ms, then held, then the autocomplete entry
    // picked at 5000ms — the last frame before the page loads (screen ends
    // 5200). The candidate that reaches the end is that 200ms frame; the
    // typing at 1000ms is capped at 4000ms but readable, so it is the pin
    // rather than no pin at all (the review of 0072 found the null).
    const held: AnalysisState[] = [
      state({
        timestampMs: 1000,
        actionType: "type",
        screenName: "New Tab",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({
        timestampMs: 2600,
        actionType: "idle",
        screenName: "New Tab",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({
        timestampMs: 4000,
        actionType: "idle",
        screenName: "New Tab",
        screenKind: "other",
        visibleText: ["tavnit.ai"],
      }),
      state({
        timestampMs: 5000,
        actionType: "select",
        screenName: "New Tab",
        screenKind: "other",
        visibleText: ["tavnit.ai/"],
      }),
      state({
        timestampMs: 5600,
        actionType: "navigate",
        screenName: "תבנית - דף הבית",
        screenKind: "other",
        visibleText: ["מה מפרסמים?"],
      }),
      state({
        timestampMs: 7000,
        actionType: "tap",
        screenName: "תבנית - דף הבית",
        screenKind: "other",
        visibleText: ["מה מפרסמים?"],
      }),
    ];
    const bounds = boundsFor(held, 7400);
    expect(findAccessMoment(held, { bounds, link: "https://tavnit.ai" })).toMatchObject({
      index: 0,
      pinMs: 4000,
      run: [0, 3],
      runEndMs: 5200,
      dropUntilMs: 5200,
    });
  });

  it("the drop zone covers the pin's min-gap shadow, so nothing licensed next to it is a violation", () => {
    // A 1200ms pin (readable) whose screen ends at 2200, and the loaded site
    // at 2400 — 1400ms after the pin, under MIN_GAP_MS. The zone runs to the
    // pin + 1600, so neither the model nor the canned plan may select 2400,
    // and the keyless plan passes its own validation.
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
      state({
        timestampMs: 2400,
        actionType: "navigate",
        screenName: "דף הבית",
        screenKind: "other",
        visibleText: ["ברוכים הבאים", "התחילו"],
      }),
      state({
        timestampMs: 4000,
        actionType: "scroll",
        screenName: "דף הבית",
        screenKind: "other",
        visibleText: ["ברוכים הבאים", "מחירים"],
      }),
      ...[6400, 10_400, 14_400].flatMap((t, k) => [
        state({
          timestampMs: t,
          actionType: "navigate",
          screenName: SCREENS[k]!,
          screenKind: "product",
          visibleText: [TEXTS[k]!],
        }),
        state({
          timestampMs: t + 3000,
          actionType: "idle",
          screenName: SCREENS[k]!,
          screenKind: "product",
          visibleText: [TEXTS[k]!],
        }),
      ]),
      state({
        timestampMs: 18_400,
        actionType: "result",
        screenName: "הצלחה",
        screenKind: "product",
        visibleText: ["נוצר בהצלחה"],
      }),
    ];
    const access = findAccessMoment(site, { bounds: boundsFor(site, 24_000), link: "tavnit.ai" });
    expect(access).toMatchObject({ index: 0, pinMs: 1200, runEndMs: 2200, dropUntilMs: 2600 });
    // The canned plan stays out of the shadow and validates.
    return withDryRun(async () => {
      const draft = await generateStepPlan(db, {
        timeline: site,
        questionnaire: { ...QUESTIONNAIRE, link: "tavnit.ai" },
        recordingMs: 24_000,
      });
      const picked = draft.steps.map((s) => s.sourceIndex);
      expect(picked[0]).toBe(0);
      expect(picked).not.toContain(2);
    });
  });

  it("the reachability bound counts the pin as fixed, never as a slot a longer state could take", () => {
    // Pin at 1000ms (clip 1200). The landing state at 2400 has a 4000ms clip
    // but sits in the pin's shadow; three product screens follow, the last one
    // the success. With the pin, the most any plan can run is 1200 + 3 x 4000
    // = 13200ms — under the band, so "too SHORT" must stand down rather than
    // order a retry that cannot succeed.
    const screens: AnalysisState[] = [
      state({
        timestampMs: 1000,
        actionType: "type",
        screenName: "New Tab",
        screenKind: "other",
        visibleText: ["example.com"],
      }),
      state({
        timestampMs: 2000,
        actionType: "idle",
        screenName: "New Tab",
        screenKind: "other",
        visibleText: ["example.com"],
        sameStateAsPrevious: true,
      }),
      ...[2400, 6800, 11_000].flatMap((t, k) => [
        state({
          timestampMs: t,
          actionType: "navigate",
          screenName: SCREENS[k]!,
          screenKind: "product",
          visibleText: [TEXTS[k]!],
        }),
        state({
          timestampMs: t + 3800,
          actionType: "idle",
          screenName: SCREENS[k]!,
          screenKind: "product",
          visibleText: [TEXTS[k]!],
          sameStateAsPrevious: true,
        }),
      ]),
      state({
        timestampMs: 15_200,
        actionType: "result",
        screenName: "הצלחה",
        screenKind: "product",
        visibleText: ["נוצר"],
      }),
    ];
    const bounds = boundsFor(screens, 19_200);
    const pinned = findAccessMoment(screens, { bounds, link: "example.com" })!;
    expect(pinned).toMatchObject({ index: 0, pinMs: 1200, dropUntilMs: 2600 });
    const plan = [
      { sourceIndex: 0, label: ACCESS_LABEL },
      { sourceIndex: 4, label: "פותחים את המסך הבא" },
      { sourceIndex: 6, label: "ממשיכים לשלב הבא" },
      { sourceIndex: 8, label: "וזה מוכן" },
    ];
    expect(
      findPlanViolations(plan, screens, 7, {
        minSteps: 5,
        notes: null,
        bounds,
        runtime: { minMs: 15_000, maxMs: 21_000 },
        pinned,
      }),
    ).toEqual([]);
  });
});

/** Distinct product screens — names and text differ in words, not digits
 *  (the screen test drops one-character tokens). */
const SCREENS = ["לוח בקרה", "פרויקט חדש", "בחירת תבנית"];
const TEXTS = ["הפרויקטים שלי", "שם הפרויקט", "מודעה פוסט"];

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
  /** The founder-approved journey on this demo, minus his hand-added step 1
   *  — re-picked for decision 0070. His 7, 16 and 44 run 1200, 800 and
   *  200ms before the app leaves their screens, under the 1600ms the
   *  shortest caption needs, so the validator now rejects them: the
   *  character choice moves to 14, the first state on that screen; the
   *  questionnaire (7-12, none captionable) goes; "ready to create" moves to
   *  31, the continue-to-creation screen, whose 1600ms fits its three words
   *  exactly. Pin included, the plan runs 19.2s, inside the 15-21s band. */
  const JOURNEY: [number, string][] = [
    [14, "בחרו דמות שתציג את המוצר"],
    [23, "התסריט נכתב לכם בעברית"],
    [26, "האזינו להקלטה לפני שמאשרים"],
    [31, "הסרטון מוכן ליצירה"],
    [49, "הורידו את הסרטון המוכן"],
  ];

  it("pins כנסו לכאן first, drops the model's own way-in and everything in the drop zone, keeps the journey", async () => {
    // The model followed the prompt's rule 4 on a `system` state (5, 4200ms)
    // — without the pin the validator would reject it and burn a corrective
    // call.
    generateObject.mockReset().mockResolvedValueOnce(plan([[5, "כנסו לtavnit.ai"], ...JOURNEY]));

    const draft = await generateStepPlan(db, tavnit);

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.retryViolations).toEqual([[]]);
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([1, 14, 23, 26, 31, 49]);
    const pin = draft.steps[0]!;
    expect(pin).toMatchObject({
      sourceIndex: 1,
      label: ACCESS_LABEL,
      timestampMs: 1200,
      actionType: "type",
      durationMs: 3200,
      offScreenWords: [],
    });
    // The journey is intact, labels and all.
    expect(draft.steps.slice(1).map((s) => [s.sourceIndex, s.label])).toEqual(JOURNEY);
    // Pinned plans are distinguishable in the row.
    expect(draft.promptVersion).toBe("plan_demo_steps@v15+access-pin");

    // The model was told: the reduced counts, the reduced band (15-21s minus
    // the pin's 3.2s), the notice.
    const prompt = (generateObject.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("select 4–6 states");
    expect(prompt).toContain("The steps must total 11.8-17.8s");
    expect(prompt).toContain("## The way in is already the first step");
    expect(prompt).toContain(`captioned "${ACCESS_LABEL}", running 3.2s`);
    expect(prompt).toContain("any state from 1200ms up to 4400ms");
  });

  it("a system-kind pin passes findPlanViolations only as the pin", () => {
    const steps = [
      { sourceIndex: 1, label: ACCESS_LABEL },
      ...JOURNEY.map(([sourceIndex, label]) => ({ sourceIndex, label })),
    ];
    const bounds = boundsFor(tavnit.timeline, tavnit.recordingMs);
    const access = findAccessMoment(tavnit.timeline, { bounds })!;
    const shape = {
      minSteps: 5,
      notes: null,
      bounds,
      runtime: { minMs: 15_000, maxMs: 21_000 },
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
    const pinAt = echoed.indexOf('"sourceIndex": 1,');
    expect(pinAt).toBeGreaterThan(-1);
    expect(pinAt).toBeLessThan(echoed.indexOf('"sourceIndex": 14,'));
    expect(echoed).toContain(`"label": "${ACCESS_LABEL}"`);
    expect(retry).toContain("It appears as index 0 in any plan echoed back to you");
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([1, 14, 23, 26, 31, 49]);
    expect(draft.retryViolations).toHaveLength(2);
  });

  it("the model repeating the pin under its own caption is re-pinned, never duplicated", async () => {
    generateObject
      .mockReset()
      .mockResolvedValueOnce(plan([[1, "כנסו לאתר tavnit.ai"], ...JOURNEY]));
    const draft = await generateStepPlan(db, tavnit);
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([1, 14, 23, 26, 31, 49]);
    expect(draft.steps[0]!.label).toBe(ACCESS_LABEL);
  });

  it("a loaded site read as `other` with no loading state: the window runs long, the drop zone does not", async () => {
    // The 2-of-6 production shape (jobnet read as `other` throughout) minus
    // the loading screen those analyses happened to catch: nothing closes
    // the 15s window, so a whole-window drop would swallow states 4-7. The
    // board is one page — the field, the area and the form all open on it —
    // so each step runs to the next, and the 20s recording gives the success
    // its full clip.
    const timeline = [
      ...[200, 1000, 2000, 3000].map((timestampMs) =>
        state({
          timestampMs,
          actionType: "type",
          screenName: "New Tab - jobnet.co.il",
          screenKind: "other",
          visibleText: ["jobnet.co.il"],
        }),
      ),
      state({
        timestampMs: 4000,
        actionType: "navigate",
        screenName: "לוח דרושים",
        screenKind: "other",
        visibleText: ["לוח דרושים"],
      }),
      state({
        timestampMs: 7000,
        actionType: "tap",
        screenName: "לוח דרושים",
        screenKind: "other",
        visibleText: ["בחירת תחום"],
      }),
      state({
        timestampMs: 10_000,
        actionType: "select",
        screenName: "לוח דרושים",
        screenKind: "other",
        visibleText: ["אזור"],
      }),
      state({
        timestampMs: 13_000,
        actionType: "tap",
        screenName: "לוח דרושים",
        screenKind: "other",
        visibleText: ["טופס"],
      }),
      state({
        timestampMs: 16_000,
        actionType: "result",
        screenName: "לוח דרושים",
        screenKind: "other",
        visibleText: ["נשלח"],
      }),
    ];
    const recordingMs = 20_000;
    // The address bar ends one sample after 3, at 3200, where the board
    // loads. 0 (200 + the 4s cap) already reaches that end, so it is the pin
    // and the zone stops at 3200 — however far the window runs.
    expect(findAccessMoment(timeline, { bounds: boundsFor(timeline, recordingMs) })).toMatchObject({
      index: 0,
      pinMs: 3000,
      dropUntilMs: 3200,
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
    const draft = await generateStepPlan(db, {
      timeline,
      questionnaire: QUESTIONNAIRE,
      recordingMs,
    });
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([0, 4, 5, 6, 7, 8]);
  });

  it("study-app (v2-era) through the drop zone: address-bar picks go, the steps at 5600ms and after stay", async () => {
    const study = fixture("real-botteacher-study-app");
    // The 2026-08-20 live selection [1,13,36,42,49,56,...] opened on the
    // address bar; with the pin at 1 the zone is [2600, 5600). Its 13, 42
    // and 49 run 1400, 200 and 200ms before the app leaves their screens
    // (0070) — too short for any caption — so the mock takes states that
    // hold in their place: 16, 47 and 52.
    generateObject.mockReset().mockResolvedValueOnce(
      plan(
        [
          [1, "כנסו לboteacher.com"],
          [3, "בחרו את האתר"],
          [16, "היכנסו לחשבון"],
          [36, "העלו את חומרי הקורס"],
          [47, "הקורס מסודר"],
          [52, "פתחו את המחברת"],
          [56, "התוכנית מוכנה"],
        ],
        "בסרטון אין סיום ברור — כדאי לצלם עד לפעולה שהושלמה",
      ),
    );
    const draft = await generateStepPlan(db, study);
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([1, 16, 36, 47, 52, 56]);
    expect(draft.steps[0]).toMatchObject({
      label: ACCESS_LABEL,
      durationMs: 3000,
      offScreenWords: [],
    });
  });

  it("no access moment: the prompt is v15 verbatim and the version is plain", async () => {
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
    const draft = await generateStepPlan(db, {
      timeline: PLAIN,
      questionnaire: QUESTIONNAIRE,
      recordingMs: PLAIN_RECORDING_MS,
    });
    expect(draft.promptVersion).toBe("plan_demo_steps@v15");
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
    expect((thrown as PlanViolationError).promptVersion).toBe("plan_demo_steps@v15+access-pin");
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
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([1, 14, 26, 29, 47, 49]);
    expect(draft.steps[0]).toMatchObject({
      sourceIndex: 1,
      label: ACCESS_LABEL,
      durationMs: 3200,
      offScreenWords: [],
    });
    expect(draft.promptVersion).toBe("plan_demo_steps@dry-run+access-pin");
    expect(draft.notes).toBeNull();
  });

  it("study-app: the exclusion reaches the ending lookup too, so the keyless plan never throws", async () => {
    const draft = await generateStepPlan(db, fixture("real-botteacher-study-app"));
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([1, 5, 20, 43, 52, 61, 78]);
    // Nothing from the drop zone, which ends with the address bar at 5600.
    for (const step of draft.steps.slice(1)) expect(step.timestampMs).toBeGreaterThanOrEqual(5600);
  });

  it("no access moment: exactly today's canned plan and today's version", async () => {
    const draft = await generateStepPlan(db, fixture("dry-run-campaign-app"));
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([1, 3, 5, 8]);
    expect(draft.promptVersion).toBe("plan_demo_steps@dry-run");
  });
});

describe("the waiver and the reachability bound count around the pin", () => {
  // Three legal address-bar states, a legal non-URL frame between them (the
  // autocomplete list, on the same screen), the loading screen, then three
  // product states on one page ending on the success, in a 20s recording.
  // With the pin at 1 the zone is the address bar, [0, 5200): the ONLY plan
  // there is has 4 steps.
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
      actionType: "tap",
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
    const bounds = boundsFor(timeline, 20_000);
    const access = findAccessMoment(timeline, { bounds })!;
    // 0 (0 + 4000) falls short of the address bar's end at 5200; 1 is the
    // earliest candidate that reaches it.
    expect(access).toMatchObject({
      index: 1,
      pinMs: 3200,
      run: [0, 1, 3],
      runEndMs: 5200,
      dropUntilMs: 5200,
    });
    const shape = {
      minSteps: 5,
      notes: null,
      bounds,
      runtime: { minMs: 15_000, maxMs: 21_000 },
    };
    // Naively the walk counts 0, 1, 5, 6, 7 — five (2 is 1000ms after 1; 3,
    // the last frame before the loading screen, has a 200ms clip) — and
    // orders a fifth step no retry can add; the reachability bound likewise
    // certifies 0 -> 1 -> 5 -> 6 -> 7 at 15200ms.
    const naive = findPlanViolations(steps, timeline, 7, shape);
    expect(naive.some((v) => v.includes("fewer than the minimum"))).toBe(true);
    expect(naive.some((v) => v.includes("too SHORT"))).toBe(true);
    // With the pin known: 1 + {5, 6, 7} = 4 is all this timeline offers, and
    // 13200ms is all it can reach — both rules stand down.
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
        s.sourceIndex === 1
          ? { sourceIndex: 1, label: "כנסו לאתר" }
          : { sourceIndex: s.sourceIndex, label: s.label },
      ),
    });
    const afterRelabel = planStepsSchema.parse(relabelled.steps);
    expect(afterRelabel[0]).toMatchObject({
      sourceIndex: 1,
      label: "כנסו לאתר",
      offScreenWords: [],
    });
    expect(timeline[1]!.screenKind).toBe("system");

    // Delete: the plan simply starts on the next step.
    const deleted = await updatePlanSteps(db, {
      planId: planRow.id,
      steps: draft.steps
        .filter((s) => s.sourceIndex !== 1)
        .map((s) => ({ sourceIndex: s.sourceIndex, label: s.label })),
    });
    const afterDelete = planStepsSchema.parse(deleted.steps);
    expect(afterDelete.map((s) => s.sourceIndex)).toEqual([14, 26, 29, 47, 49]);
    const stored = (
      await db
        .select()
        .from(dbSchema.demoStepPlans)
        .where(eq(dbSchema.demoStepPlans.id, planRow.id))
    )[0]!;
    expect(planStepsSchema.parse(stored.steps)).toHaveLength(5);
  });
});
