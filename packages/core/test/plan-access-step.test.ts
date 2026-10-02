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
  momentClips,
  PlanViolationError,
  planStepsSchema,
  readTimeMs,
  registrableDomain,
  STEP_MS,
  updatePlanSteps,
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
  instants?: number[];
} {
  const raw = JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${name}.json`), "utf8")) as {
    timeline: unknown;
    questionnaire: unknown;
    recordingMs?: number;
    instants?: number[];
  };
  return {
    timeline: analysisTimelineSchema.parse(raw.timeline),
    questionnaire: questionnaireSchema.parse(raw.questionnaire),
    // demos.duration_ms and the footage instants, as `aiugc plan regress`
    // passes them: where the recording ends, which no clip runs past, and
    // what every clip is placed against.
    recordingMs: raw.recordingMs,
    instants: raw.instants,
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
 *  page worked down 3s apart, so no two clips share footage, the success at
 *  15s and a tap after it on a 20s recording. */
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

/** Every state's clip, with the sample and the recording's end it was placed
 *  against, read the one way generateStepPlan reads them: the shipped sample,
 *  the recording's length (absent: one sample past the last state), and the
 *  footage instants when a test has them (absent: not known, so a clip starts
 *  at its moment). The result spreads straight into findAccessMoment. */
function placed(timeline: AnalysisState[], recordingMs?: number, instants?: number[]) {
  return momentClips(db, { timeline, recordingMs, instants: instants ?? null });
}

/** The access moment exactly as generateStepPlan finds it. */
async function accessFor(
  timeline: AnalysisState[],
  opts: { recordingMs?: number; instants?: number[]; link?: string | null } = {},
) {
  return findAccessMoment(timeline, {
    ...(await placed(timeline, opts.recordingMs, opts.instants)),
    link: opts.link,
  });
}

/** One frame of the address bar with the site's address in it — a `type`
 *  state unless overridden. */
function addressBar(timestampMs: number, overrides: Partial<AnalysisState> = {}): AnalysisState {
  return state({
    timestampMs,
    actionType: "type",
    screenName: "New Tab",
    screenKind: "other",
    visibleText: ["tavnit.ai"],
    ...overrides,
  });
}

/** The loading screen the address bar gives way to. */
function loadingAt(timestampMs: number): AnalysisState {
  return state({
    timestampMs,
    actionType: "navigate",
    screenName: "טעינה",
    screenKind: "loading",
    visibleText: [],
  });
}

/** Distinct product screens — names and text differ in words, not digits
 *  (the screen test drops one-character tokens). */
const SCREENS = ["לוח בקרה", "פרויקט חדש", "בחירת תבנית"];
const TEXTS = ["הפרויקטים שלי", "שם הפרויקט", "מודעה פוסט"];

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
  // No app_config rows: the code constants (5–10 steps, a 200ms sample at 5 fps).
});

afterAll(async () => {
  await pg.close();
});

describe("findAccessMoment (the access moment, deterministic)", () => {
  it("pins the founder's system-kind opening: the latest candidate whose clip ends with the address bar still up", async () => {
    const { timeline, questionnaire, recordingMs, instants } = fixture(
      "real-tavnit-system-opening",
    );
    const access = await accessFor(timeline, { recordingMs, instants, link: questionnaire.link });
    // States 1, 2, 3 and 5 carry the address as it is typed (4 shows it a
    // letter short). The New Tab screen holds through 5 and ends one sample
    // after it, at 4400; 6 is the loading screen. 2's clip (1800-3800) is the
    // latest that ends before the page leaves the address bar — 3's
    // (2800-4800) runs into the loading screen — so 2 is the pin: the
    // address at its most typed, on a clip that never leaves the address
    // bar. The zone is the rest of that screen (1, 3, 4, 5) and 0, the state
    // before the typing, whose clip (400-2400) shares footage with the pin's.
    expect(access).toEqual({
      index: 2,
      run: [1, 2, 3, 5],
      runStartMs: 1200,
      runEndMs: 4400,
      zone: new Set([0, 1, 3, 4, 5]),
    });
    expect(timeline[2]!.screenKind).toBe("system");
  });

  it("v2-era study-app: no screenKind anywhere, the 15s bound alone, idle frames are not candidates", async () => {
    const { timeline, questionnaire, recordingMs, instants } = fixture("real-botteacher-study-app");
    const access = await accessFor(timeline, { recordingMs, instants, link: questionnaire.link });
    // Candidates 1 (type) and 4 (select) share the address-bar screen, which
    // ends one sample after 4, at 5600 (5 is BotTeacher's loading screen at
    // 10200). 1's clip (2600-4600) ends with the address bar still up; 4's
    // (5400-7400) runs well past it. The two idle frames between them are
    // not candidates, and are in the zone with 4: states on the run's screen.
    // So is 0, the state before the typing — nothing opens a plan ahead of
    // the pin.
    expect(access).toEqual({
      index: 1,
      run: [1, 4],
      runStartMs: 2600,
      runEndMs: 5600,
      zone: new Set([0, 2, 3, 4]),
    });
    expect(timeline[1]!.screenKind).toBeUndefined();
  });

  it("six-word-label: other/low address bar, the latest candidate whose clip ends by the screen's end", async () => {
    const { timeline, questionnaire, recordingMs, instants } = fixture(
      "real-botteacher-six-word-label",
    );
    const access = await accessFor(timeline, { recordingMs, instants, link: questionnaire.link });
    // The address bar holds through the tap at 5600 (7, not a candidate)
    // and ends one sample later, at 5800; 8 is the loading screen. 4's clip
    // (3600-5600) is the latest that ends by then — 5's (4200-6200) runs
    // past — and the tap is in the zone as a state on the run's screen, with
    // 0 and 1, the states before the typing.
    expect(access).toEqual({
      index: 4,
      run: [2, 3, 4, 5, 6],
      runStartMs: 1200,
      runEndMs: 5800,
      zone: new Set([0, 1, 2, 3, 5, 6, 7]),
    });
    expect(timeline[4]!.legibility).toBe("low");
  });

  it("jobnet shape: eleven address-bar states, the pin is the last whose clip ends by the screen's end", async () => {
    const access = await accessFor(JOBNET);
    // The address bar holds through the duplicate idle frame (7400) and ends
    // one sample later, at 7600, where the loading screen takes over. 8's
    // clip (5400-7400) is the latest that ends by then; 9's (6000-8000) runs
    // past. Everything else on the address bar is the zone, the duplicate
    // frame (11) included; the loading screen and the site are not.
    expect(access).toEqual({
      index: 8,
      run: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      runStartMs: 200,
      runEndMs: 7600,
      zone: new Set([0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11]),
    });
  });

  it("a recording that opens already on the product, or with no URL at all, is untouched", async () => {
    for (const name of ["real-botteacher-file-routing", "dry-run-campaign-app"]) {
      const { timeline, questionnaire, recordingMs, instants } = fixture(name);
      expect(
        await accessFor(timeline, { recordingMs, instants, link: questionnaire.link }),
      ).toBeNull();
    }
  });

  it("a loaded site read as `other` with its URL bar in frame is not the way in — navigate/idle never qualify", async () => {
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
    expect(await accessFor(loaded)).toBeNull();
  });

  it("a URL typed after a product state, or past 15s, is a search inside the product", async () => {
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
    expect(await accessFor(afterProduct)).toBeNull();
    const late = [
      state({ timestampMs: 400, actionType: "navigate", visibleText: ["לוח בקרה"] }),
      state({ timestampMs: 16_000, actionType: "type", visibleText: ["myapp.co.il"] }),
    ];
    expect(await accessFor(late)).toBeNull();
  });

  it("login/error pages carrying the domain and emails are skipped; the real typing state after them is the pin", async () => {
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
    expect(await accessFor(loginFirst)).toMatchObject({ index: 1, run: [1] });
    const errorPage = [
      state({
        timestampMs: 400,
        actionType: "type",
        screenKind: "error",
        visibleText: ["This site can't be reached", "tavnit.ai"],
      }),
    ];
    expect(await accessFor(errorPage)).toBeNull();
    // An email is not an address: the whole ENTRY is out, "@" or no "@" elsewhere.
    const email = [
      state({
        timestampMs: 400,
        actionType: "type",
        screenKind: "other",
        visibleText: ["support@tavnit.ai"],
      }),
    ];
    expect(await accessFor(email)).toBeNull();
  });

  it("unreadable and duplicate frames are never the pin", async () => {
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
    expect(await accessFor(dim)).toMatchObject({ index: 2, run: [2] });
  });

  it("file names, version numbers and abbreviations are not domains", async () => {
    const junk = [
      state({
        timestampMs: 400,
        actionType: "type",
        screenKind: "other",
        visibleText: ["Takin Syllabus.txt", "index.html", "3.5", "e.g.", "tavnit.", "Ask G"],
      }),
    ];
    expect(await accessFor(junk)).toBeNull();
  });

  it("the questionnaire link's registrable domain detects an off-list TLD, only inside the window", async () => {
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
    expect(await accessFor(typed)).toBeNull();
    expect(await accessFor(typed, { link: "https://www.myclinic.health/about" })).toMatchObject({
      index: 1,
    });
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
      await accessFor(afterBoundary, { link: "https://www.myclinic.health/about" }),
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

  it("a candidate on a later screen is a second typing, not this run", async () => {
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
    // The zone stops with it — the second typing stays selectable.
    expect(await accessFor(twoRuns)).toEqual({
      index: 1,
      run: [0, 1],
      runStartMs: 1000,
      runEndMs: 4400,
      zone: new Set([0, 2]),
    });
  });
});

describe("which run candidate is pinned", () => {
  it("the latest candidate whose clip ends by the run's end", async () => {
    // Typed at 1000, 2000, 3000 and 4000, then held: the address bar's screen
    // ends one sample after the held frame. A clip that ends by then stays on
    // the address bar for its whole 2s, and of those the latest shows the
    // address at its most typed.
    const heldUntil = (heldMs: number): AnalysisState[] => [
      addressBar(1000),
      addressBar(2000),
      addressBar(3000),
      addressBar(4000),
      addressBar(heldMs, { actionType: "idle", sameStateAsPrevious: true }),
      loadingAt(6000),
    ];
    // Held to 4800: the screen ends at 5000, exactly where 2's clip
    // (3000-5000) does — ending AT the run's end still counts. 3's
    // (4000-6000) runs a second into the loading screen.
    expect(await accessFor(heldUntil(4800), { recordingMs: 10_000 })).toMatchObject({
      index: 2,
      run: [0, 1, 2, 3],
      runEndMs: 5000,
    });
    // One sample shorter and 2's clip shows 200ms of the loading screen: the
    // pin moves back to 1 (2000-4000).
    expect(await accessFor(heldUntil(4600), { recordingMs: 10_000 })).toMatchObject({
      index: 1,
      run: [0, 1, 2, 3],
      runEndMs: 4800,
    });
  });

  it("when every candidate's clip runs past the run's end, the one that overshoots least", async () => {
    // An address typed and gone inside a second: the screen ends at 1000, one
    // sample after the last typed frame, and no 2s clip ends by then. There
    // is a pin all the same — the fixed caption reads in well under a step,
    // so any candidate can carry it — and it is the clip with the least of
    // the next screen in it: 0's (400-2400), not 1's (800-2800).
    expect(readTimeMs(ACCESS_LABEL)).toBeLessThan(STEP_MS);
    const quick = [addressBar(400), addressBar(800), loadingAt(1400)];
    expect(await accessFor(quick, { recordingMs: 10_000 })).toMatchObject({
      index: 0,
      run: [0, 1],
      runEndMs: 1000,
    });
  });

  it("a tie in the overshoot goes to the later candidate", async () => {
    // A recording that ends at 3000: no clip can start after 1000, so both
    // typed frames get the same clip (1000-3000) and run the same 1200ms past
    // the address bar's end (1800). The later one is the address more typed.
    const short = [addressBar(1200), addressBar(1600), loadingAt(2000)];
    const placement = await placed(short, 3000);
    expect(placement.clips.map((clip) => clip.startMs)).toEqual([1000, 1000, 1000]);
    expect(findAccessMoment(short, placement)).toMatchObject({
      index: 1,
      run: [0, 1],
      runEndMs: 1800,
    });
  });

  it("the choice follows the placed clip, not the timestamp", async () => {
    // Typed at 1000 and 3000 and held to 4400: the screen ends at 4600.
    const timeline = [
      addressBar(1000),
      addressBar(3000),
      addressBar(4400, { actionType: "idle", sameStateAsPrevious: true }),
      loadingAt(5000),
      state({
        timestampMs: 7000,
        actionType: "navigate",
        screenName: SCREENS[0]!,
        screenKind: "product",
        visibleText: [TEXTS[0]!],
      }),
      state({
        timestampMs: 10_000,
        actionType: "tap",
        screenName: SCREENS[0]!,
        screenKind: "product",
        visibleText: [TEXTS[0]!, TEXTS[1]!],
      }),
      state({
        timestampMs: 13_000,
        actionType: "result",
        screenName: "הצלחה",
        screenKind: "product",
        visibleText: ["נוצר בהצלחה"],
      }),
    ];
    const recordingMs = 16_000;
    // With no footage instants a clip starts at its moment: 1's (3000-5000)
    // runs past the address bar, so 0 (1000-3000) is the pin.
    expect(await accessFor(timeline, { recordingMs })).toMatchObject({ index: 0 });
    // The footage puts the page flip at 4700, and 1's clip is slid back to
    // the calm 2s before it (2500-4500): now it ends with the address bar
    // still up, and the later candidate is the pin. A choice read off the
    // timestamp would still have said 0.
    const instants = [4700];
    const placement = await placed(timeline, recordingMs, instants);
    expect(placement.clips[1]).toEqual({ startMs: 2500, calm: true, twoPages: false });
    expect(findAccessMoment(timeline, placement)).toEqual({
      index: 1,
      run: [0, 1],
      runStartMs: 1000,
      runEndMs: 4600,
      zone: new Set([0, 2]),
    });
    // The stored step is that clip — it starts before its own moment.
    const draft = await withDryRun(() =>
      generateStepPlan(db, { timeline, questionnaire: QUESTIONNAIRE, recordingMs, instants }),
    );
    expect(draft.steps[0]).toMatchObject({
      sourceIndex: 1,
      label: ACCESS_LABEL,
      timestampMs: 3000,
      startMs: 2500,
      durationMs: STEP_MS,
    });
  });
});

describe("the pin's zone", () => {
  it("every state on the run's screen is in it, however far from the pin's clip", async () => {
    const lingering = [
      addressBar(1000),
      addressBar(1600),
      // The finished address left up, untouched, long after the typing.
      addressBar(7800, { actionType: "idle" }),
      loadingAt(9000),
    ];
    // The screen ends at 8000, one sample after the idle frame, and 1's clip
    // (1600-3600) is the pin's. The idle frame is four seconds clear of it
    // and in the zone all the same: the address bar is one moment on screen,
    // and the pin already shows it.
    expect(await accessFor(lingering, { recordingMs: 12_000 })).toEqual({
      index: 1,
      run: [0, 1],
      runStartMs: 1000,
      runEndMs: 8000,
      zone: new Set([0, 2]),
    });
  });

  it("a state after the run whose clip shares footage with the pin's is in it; one whose clip only touches it is not; every state before the run is", async () => {
    // The founder's opening in miniature, browser chrome read as `system`: a
    // new tab, a tap on its address bar, ONE typed frame at 2400, and the
    // site is up at 3000. The run is that frame alone and its screen ends at
    // 2600, so the pin's clip (2400-4400) is most of it the loaded site.
    const site: AnalysisState[] = [
      state({
        timestampMs: 400,
        actionType: "navigate",
        screenName: "New Tab",
        screenKind: "system",
        visibleText: ["New Tab"],
      }),
      state({
        timestampMs: 1000,
        actionType: "tap",
        screenName: "New Tab",
        screenKind: "system",
        visibleText: ["Search Google or type a URL"],
      }),
      addressBar(2400, { screenKind: "system" }),
      state({
        timestampMs: 3000,
        actionType: "navigate",
        screenName: "דף הבית",
        screenKind: "other",
        visibleText: ["ברוכים הבאים", "התחילו"],
      }),
      state({
        timestampMs: 4400,
        actionType: "scroll",
        screenName: "דף הבית",
        screenKind: "other",
        visibleText: ["ברוכים הבאים", "מחירים"],
      }),
      ...[6400, 10_400, 14_400].map((timestampMs, k) =>
        state({
          timestampMs,
          actionType: "navigate",
          screenName: SCREENS[k]!,
          screenKind: "product",
          visibleText: [TEXTS[k]!],
        }),
      ),
      state({
        timestampMs: 18_400,
        actionType: "result",
        screenName: "הצלחה",
        screenKind: "product",
        visibleText: ["נוצר בהצלחה"],
      }),
    ];
    const recordingMs = 24_000;
    // The site is up after the run's screen ends, and is in the zone because
    // its clip (3000-5000) shares footage with the pin's. The scroll
    // (4400-6400) touches the pin's clip without sharing a frame of it, and
    // stays out. The new tab and the tap come before the typing: in the zone
    // whatever their clips, so neither can sit in front of the pin.
    expect(await accessFor(site, { recordingMs })).toEqual({
      index: 2,
      run: [2],
      runStartMs: 2400,
      runEndMs: 2600,
      zone: new Set([0, 1, 3]),
    });
    // The canned plan stays out of the zone, takes the scroll straight after
    // the pin, and passes its own validation.
    const draft = await withDryRun(() =>
      generateStepPlan(db, { timeline: site, questionnaire: QUESTIONNAIRE, recordingMs }),
    );
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([2, 4, 5, 6, 7, 8]);
    expect(draft.steps.slice(0, 2).map((s) => s.startMs)).toEqual([2400, 4400]);
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
  /** The founder-approved journey on this demo, minus his hand-added step 1,
   *  every caption inside the four words one step can be read in. The six
   *  clips share no footage with each other or with the pin's, and 49 is the
   *  recording's last result state. */
  const JOURNEY: [number, string][] = [
    [7, "מלאו שאלון על המוצר"],
    [16, "בחרו דמות שתציג אותו"],
    [23, "התסריט נכתב לכם בעברית"],
    [26, "האזינו להקלטה לפני שמאשרים"],
    [44, "הסרטון מוכן ליצירה"],
    [49, "הורידו את הסרטון המוכן"],
  ];
  /** The journey running on past its success state: 51 is an idle state
   *  after 49 — the ending-rule violation the ladder tests need, and the
   *  only one in the plan. */
  const PAST_SUCCESS: [number, string][] = [...JOURNEY, [51, "צפו בסרטון"]];

  it("pins כנסו לכאן first, drops the model's own way-in with the rest of the zone, keeps the journey", async () => {
    // The model followed the prompt's way-in rule on a `system` state (5,
    // 4200ms) — without the pin the validator would reject it and burn a
    // corrective call.
    generateObject.mockReset().mockResolvedValueOnce(plan([[5, "כנסו לtavnit.ai"], ...JOURNEY]));

    const draft = await generateStepPlan(db, tavnit);

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.retryViolations).toEqual([[]]);
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([2, 7, 16, 23, 26, 44, 49]);
    // The pin's stored step is its own placed clip, like every step's.
    expect(draft.steps[0]).toMatchObject({
      sourceIndex: 2,
      label: ACCESS_LABEL,
      timestampMs: 1800,
      actionType: "type",
      startMs: 1800,
      durationMs: STEP_MS,
      offScreenWords: [],
    });
    // The journey is intact, labels and all.
    expect(draft.steps.slice(1).map((s) => [s.sourceIndex, s.label])).toEqual(JOURNEY);
    // Pinned plans are distinguishable in the row.
    expect(draft.promptVersion).toBe("plan_demo_steps@v16+access-pin");

    // The model was told. One step is spoken for, so the 5–10 the combined
    // plan is held to reach it as 4–9, in the prompt's own count and in the
    // timing block's totals.
    const prompt = (generateObject.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain("select 4–9 states");
    expect(prompt).toContain("4 steps run 8.0s, 9 steps run 18.0s");
    // The notice names the rule it overrides by its heading — which the
    // prompt above it carries — the pinned state, the fixed caption, and
    // every state the pin already shows.
    expect(prompt).toContain("**4. Open with the way in.**");
    const notice = prompt.slice(prompt.indexOf("## The way in is already the first step"));
    expect(notice).toContain('Ignore the "Open with the way in" rule');
    expect(notice).toContain(
      `state 2 (1800ms, the customer typing the address), captioned "${ACCESS_LABEL}"`,
    );
    expect(notice).toContain("the system re-pins it");
    expect(notice).toContain(
      "Never select state 2 or any of states 0, 1, 3, 4, 5 — they come before the way in or show that same moment",
    );
    expect(notice).toContain("The 4–9 steps above already exclude that step");
    // Nothing is left to add up around the pin: every step is one clip.
    expect(notice).not.toMatch(/\bband\b|running|ms up to/);
  });

  it("with nothing beside the pin, the notice names the pinned state alone", async () => {
    // One typed frame and the page is gone: nothing else is on the address
    // bar, and the loading screen's clip (3200-5200) is clear of the pin's
    // (1000-3000).
    const timeline = [
      addressBar(1000),
      loadingAt(3200),
      ...[6000, 9000, 12_000].map((timestampMs, k) =>
        state({
          timestampMs,
          actionType: "navigate",
          screenName: SCREENS[k]!,
          screenKind: "product",
          visibleText: [TEXTS[k]!],
        }),
      ),
      state({
        timestampMs: 15_000,
        actionType: "result",
        screenName: "הצלחה",
        screenKind: "product",
        visibleText: ["נוצר בהצלחה"],
      }),
    ];
    const recordingMs = 20_000;
    const access = (await accessFor(timeline, { recordingMs }))!;
    expect(access.index).toBe(0);
    expect(access.zone.size).toBe(0);
    generateObject.mockReset().mockResolvedValueOnce(
      plan([
        [2, "פותחים את לוח הבקרה"],
        [3, "יוצרים פרויקט חדש"],
        [4, "בוחרים תבנית למודעה"],
        [5, "המודעה נוצרה בהצלחה"],
      ]),
    );
    const draft = await generateStepPlan(db, {
      timeline,
      questionnaire: QUESTIONNAIRE,
      recordingMs,
    });
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([0, 2, 3, 4, 5]);
    const prompt = (generateObject.mock.calls[0]![0] as { prompt: string }).prompt;
    const notice = prompt.slice(prompt.indexOf("## The way in is already the first step"));
    expect(notice).toContain("Never select state 0, and never write");
    expect(notice).not.toContain("any of states");
  });

  it("a model answer that selects zone states has them stripped, and the plan validates as it stands", async () => {
    // Every state beside the pin under a caption of its own, then the
    // journey. The zone picks go before any rule is checked, so nothing is
    // a violation, no corrective call is spent, and the stored plan is the
    // model's own journey — not marked repaired.
    const zonePicks = [0, 1, 3, 4, 5].map((i): [number, string] => [i, "הקלידו את הכתובת"]);
    generateObject.mockReset().mockResolvedValueOnce(plan([...zonePicks, ...JOURNEY]));

    const draft = await generateStepPlan(db, tavnit);

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.retryViolations).toEqual([[]]);
    expect(draft.steps.map((s) => [s.sourceIndex, s.label])).toEqual([
      [2, ACCESS_LABEL],
      ...JOURNEY,
    ]);
    expect(draft.promptVersion).toBe("plan_demo_steps@v16+access-pin");
  });

  it("a system-kind pin passes findPlanViolations only as the pin", async () => {
    const steps = [
      { sourceIndex: 2, label: ACCESS_LABEL },
      ...JOURNEY.map(([sourceIndex, label]) => ({ sourceIndex, label })),
    ];
    const placement = await placed(tavnit.timeline, tavnit.recordingMs, tavnit.instants);
    const access = findAccessMoment(tavnit.timeline, placement)!;
    const shape = { minSteps: 5, notes: null, clips: placement.clips };
    expect(findPlanViolations(steps, tavnit.timeline, 10, { ...shape, pinned: access })).toEqual(
      [],
    );
    // Without the pin the same plan is what it always was: a skip-kind pick.
    expect(
      findPlanViolations(steps, tavnit.timeline, 10, shape).some((v) => v.includes('"system"')),
    ).toBe(true);
  });

  it("the corrective prompt echoes the pin at index 0, and the fixed plan lands pinned", async () => {
    // Ends past the success state, and that is the only violation.
    generateObject
      .mockReset()
      .mockResolvedValueOnce(plan(PAST_SUCCESS))
      .mockResolvedValueOnce(plan(JOURNEY));

    const draft = await generateStepPlan(db, tavnit);

    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(draft.retryViolations[0]).toHaveLength(1);
    expect(draft.retryViolations[0]![0]).toContain("the last step must be the result/success");
    const retry = (generateObject.mock.calls[1]![0] as { prompt: string }).prompt;
    expect(retry).toContain("Your previous plan was:");
    // The echo is the COMBINED plan: the pin sits first, where "step 0" points.
    const echoed = retry.slice(retry.indexOf("Your previous plan was:"));
    const pinAt = echoed.indexOf('"sourceIndex": 2,');
    expect(pinAt).toBeGreaterThan(-1);
    expect(pinAt).toBeLessThan(echoed.indexOf('"sourceIndex": 7,'));
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

  it("a loaded site read as `other` with no loading state: the window runs long, the zone does not", async () => {
    // The 2-of-6 production shape (jobnet read as `other` throughout) minus
    // the loading screen those analyses happened to catch: nothing closes
    // the 15s window, so a zone as wide as the window would swallow states
    // 4-7. The board is one page — the field, the area and the form all open
    // on it — worked down 3s apart.
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
    // loads. 1's clip (1000-3000) is the latest that ends by then, and the
    // zone is the address bar alone — however far the window runs.
    expect(await accessFor(timeline, { recordingMs })).toEqual({
      index: 1,
      run: [0, 1, 2, 3],
      runStartMs: 200,
      runEndMs: 3200,
      zone: new Set([0, 2, 3]),
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
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([1, 4, 5, 6, 7, 8]);
  });

  it("study-app (v2-era) through the zone: address-bar picks go, the steps after the address bar stay", async () => {
    const study = fixture("real-botteacher-study-app");
    // The 2026-08-20 live selection [1,13,36,42,49,56,...] opened on the
    // address bar; with the pin at 1 the zone is the rest of that screen
    // (2, 3, 4), so the model's 3 goes and its own caption on 1 is replaced.
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
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([1, 13, 36, 42, 49, 56]);
    expect(draft.steps[0]).toMatchObject({
      label: ACCESS_LABEL,
      startMs: 2600,
      durationMs: STEP_MS,
      offScreenWords: [],
    });
  });

  it("no access moment: the prompt is v16 verbatim and the version carries no pin", async () => {
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
    expect(draft.promptVersion).toBe("plan_demo_steps@v16");
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    const prompt = (generateObject.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).not.toContain("The way in is already the first step");
    expect(prompt).toContain("select 5–10 states");
    expect(prompt).toContain("5 steps run 10.0s, 10 steps run 20.0s");
    // Byte for byte what renderPrompt gives for these inputs — nothing appended.
    const { text } = renderPrompt("plan_demo_steps", {
      questionnaire: JSON.stringify(QUESTIONNAIRE, null, 2),
      timeline: prompt.slice(prompt.indexOf("[\n"), prompt.indexOf("\n]") + 2),
      min: 5,
      max: 10,
      timing: "",
      demo_description: "(אין — התבסס על השאלון והמסכים בלבד)",
    });
    expect(prompt.endsWith(text.slice(text.lastIndexOf("## Before you answer")))).toBe(true);
  });

  it("a plan that still violates after the ladder fails with the marked version", async () => {
    // Every call ends past the success state and the ladder is 3 calls, ever.
    // Nothing in it for the last-round repair to drop: the ending rule stands.
    generateObject.mockReset().mockResolvedValue(plan(PAST_SUCCESS));
    const thrown = await generateStepPlan(db, tavnit).then(
      () => null,
      (err: unknown) => err,
    );
    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(thrown).toBeInstanceOf(PlanViolationError);
    expect((thrown as PlanViolationError).promptVersion).toBe("plan_demo_steps@v16+access-pin");
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
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([2, 9, 14, 16, 24, 26, 41, 44, 47, 49]);
    expect(draft.steps[0]).toMatchObject({
      sourceIndex: 2,
      label: ACCESS_LABEL,
      startMs: 1800,
      durationMs: STEP_MS,
      offScreenWords: [],
    });
    expect(draft.promptVersion).toBe("plan_demo_steps@dry-run+access-pin");
    expect(draft.notes).toBeNull();
  });

  it("study-app: the exclusion reaches the ending lookup too, so the keyless plan never throws", async () => {
    const study = fixture("real-botteacher-study-app");
    const draft = await generateStepPlan(db, study);
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([1, 5, 19, 40, 43, 49, 52, 64, 79]);
    // Nothing from the zone, which ends with the address bar at 5600.
    const access = (await accessFor(study.timeline, {
      recordingMs: study.recordingMs,
      instants: study.instants,
      link: study.questionnaire.link,
    }))!;
    for (const step of draft.steps.slice(1)) {
      expect(access.zone.has(step.sourceIndex)).toBe(false);
      expect(step.timestampMs).toBeGreaterThanOrEqual(access.runEndMs);
    }
  });

  it("six-word-label: an other/low pin carries the canned plan too", async () => {
    const draft = await generateStepPlan(db, fixture("real-botteacher-six-word-label"));
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([4, 42, 47, 48, 60, 74, 79]);
    expect(draft.steps[0]).toMatchObject({
      sourceIndex: 4,
      label: ACCESS_LABEL,
      startMs: 3600,
      durationMs: STEP_MS,
    });
    expect(draft.promptVersion).toBe("plan_demo_steps@dry-run+access-pin");
  });

  it("no access moment: exactly today's canned plan and today's version", async () => {
    const draft = await generateStepPlan(db, fixture("dry-run-campaign-app"));
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([1, 3, 5, 7, 10, 11]);
    expect(draft.promptVersion).toBe("plan_demo_steps@dry-run");
  });
});

describe("the waiver and the ending rule count around the pin and its zone", () => {
  it("states inside the zone are not counted as selectable, and the pin is", async () => {
    // Three legal address-bar states, a legal non-URL frame between them (the
    // autocomplete list, on the same screen), the loading screen, then three
    // product states ending on the success, in a 20s recording. With the pin
    // at 1 the zone is the rest of the address bar (0, 2, 3): the ONLY plan
    // there is has 4 steps.
    const timeline = [
      state({
        timestampMs: 0,
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
    const placement = await placed(timeline, 20_000);
    const access = findAccessMoment(timeline, placement)!;
    // The address bar ends at 5200, one sample after 3. 1's clip (2000-4000)
    // is the latest that ends by then; 3's (5000-7000) runs past.
    expect(access).toEqual({
      index: 1,
      run: [0, 1, 3],
      runStartMs: 0,
      runEndMs: 5200,
      zone: new Set([0, 2, 3]),
    });
    const shape = { minSteps: 5, notes: null, clips: placement.clips };
    // Naively six clips share no footage — 0, 2, 3, 5, 6, 7 — and the count
    // orders a fifth step no retry can add: the address-bar picks are
    // stripped from every answer.
    const naive = findPlanViolations(steps, timeline, 10, shape);
    expect(naive).toHaveLength(1);
    expect(naive[0]).toContain("fewer than the minimum 5 — this timeline offers 6 selectable");
    // With the pin known: 1 + {5, 6, 7} = 4 is all this timeline offers, and
    // the rule stands down.
    expect(findPlanViolations(steps, timeline, 10, { ...shape, pinned: access })).toEqual([]);
  });

  it("a result state inside the zone is never the ending a plan is asked for", async () => {
    // The vision pass typed the autocomplete suggestion under the address
    // bar as a `result`, and the recording has no other. It is on the run's
    // screen, so no plan can select it — and an ending rule that still
    // counted it would send every answer back for an ending it cannot have.
    const timeline = [
      addressBar(1000),
      addressBar(2000, { actionType: "result", visibleText: ["tavnit.ai - Google Search"] }),
      addressBar(3000),
      loadingAt(4000),
      ...[7000, 10_000, 13_000].map((timestampMs, k) =>
        state({
          timestampMs,
          actionType: "navigate",
          screenName: SCREENS[k]!,
          screenKind: "product",
          visibleText: [TEXTS[k]!],
        }),
      ),
    ];
    const steps = [
      { sourceIndex: 0, label: ACCESS_LABEL },
      { sourceIndex: 4, label: "פותחים את לוח הבקרה" },
      { sourceIndex: 5, label: "יוצרים פרויקט חדש" },
      { sourceIndex: 6, label: "בוחרים תבנית למודעה" },
    ];
    const placement = await placed(timeline, 16_000);
    const access = findAccessMoment(timeline, placement)!;
    // The screen ends at 3200: 0's clip (1000-3000) ends by then, 2's
    // (3000-5000) does not.
    expect(access).toEqual({
      index: 0,
      run: [0, 2],
      runStartMs: 1000,
      runEndMs: 3200,
      zone: new Set([1, 2]),
    });
    const shape = { minSteps: 5, notes: null, clips: placement.clips };
    const naive = findPlanViolations(steps, timeline, 10, shape);
    expect(naive).toHaveLength(1);
    expect(naive[0]).toContain("success candidates are at sourceIndex 1:");
    // With the pin known there is no success candidate to end on, and four
    // steps — the pin and the three product screens — are all there is.
    expect(findPlanViolations(steps, timeline, 10, { ...shape, pinned: access })).toEqual([]);
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

    // Relabel: the customer's words replace the fixed caption, marks stay [],
    // and the clip they were shown stays where it was.
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
      startMs: 1800,
      durationMs: STEP_MS,
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
    expect(afterDelete.map((s) => s.sourceIndex)).toEqual([9, 14, 16, 24, 26, 41, 44, 47, 49]);
    const stored = (
      await db
        .select()
        .from(dbSchema.demoStepPlans)
        .where(eq(dbSchema.demoStepPlans.id, planRow.id))
    )[0]!;
    expect(planStepsSchema.parse(stored.steps)).toHaveLength(9);
  });
});
