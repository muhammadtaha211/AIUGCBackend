import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { msToFrame, serviceAStepsTimeline } from "@aiugc/remotion/timing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordUsage } from "../src/budget";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { HEAVY_JOB_TYPES, runLane } from "../src/jobs/worker";
import { SIGNATURE_FPS } from "../src/pipelines/analysis-screens";
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
  analysisInstants,
  analysisSampleMs,
  approvePlan,
  assembleSteps,
  findOffScreenWords,
  findPlanViolations,
  generateStepPlan,
  getStepPlan,
  isNewScreen,
  momentClips,
  normalizeWord,
  PLAN_STEPS_OVERLAP_MESSAGE,
  placeClips,
  planPromptTimeline,
  planStepsSchema,
  planTimingMarkdown,
  readTimeMs,
  recordingEndMs,
  requestDemoPlan,
  runPlanRegression,
  screenEnds,
  splitWords,
  STEP_MS,
  stepClip,
  tokenizeWords,
  totalRuntimeMs,
  unexplainedMomentsSchema,
  updatePlanSteps,
  type PlacedClip,
  type PlanStep,
} from "../src/pipelines/demo-step-plans";
import { createDemo } from "../src/pipelines/demos";
import { FIXTURES_DIR, PROMPTS_DIR } from "../src/paths";
import {
  A_STEPS_MAX_DEFAULT,
  A_STEPS_MIN_DEFAULT,
  DEMO_FPS,
  demoFrame,
  labelTooLong,
  MAX_LABEL_WORDS,
  overlappingPairs,
  readableWords,
} from "../src/plan-format";
import { latestPromptVersion, renderPrompt } from "../src/prompts";
import { setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * Pass 2 of the step-plan format in DRY_RUN: plan generation over the canned
 * analysis, the deterministic plan-shape rules and label highlight, the
 * edit/approve/fork lifecycle with the 2s clip every stored step carries, and
 * the fixtures/timelines regression harness. How a clip is placed around the
 * footage's instants, and the model path, live in step-clips.test.ts.
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

/** One analysis sample at the shipped a_analysis_fps — what analysisSampleMs
 *  returns with no app_config row (pinned in "the shipped numbers" below). */
const SAMPLE_MS = 200;

/** Every state's clip on a recording that runs `tailMs` past the last state,
 *  with no footage instants known: each clip starts at its own moment. 4s by
 *  default, so no clip in a shape test is slid back from the recording's end —
 *  a test about that end passes a shorter tail. */
function clipsOver(timeline: AnalysisState[], tailMs = 4000): PlacedClip[] {
  return placeClips(timeline, {
    sampleMs: SAMPLE_MS,
    recordingEndMs: timeline[timeline.length - 1]!.timestampMs + tailMs,
    instants: null,
  });
}

/** A ready analysis carrying `timeline`, on a demo of its own (the stubbed 20s
 *  recording, no footage row) — for the tests that need a plan row over chosen
 *  moments rather than the canned ones. */
async function analysedDemo(
  file: string,
  timeline: AnalysisState[],
): Promise<{ demoId: string; analysisId: string }> {
  const demo = await createDemo(db, { businessId, filePath: tempFile(file) });
  await drainAll(); // ingest -> analysis ready
  const analysis = (await getLatestDemoAnalysis(db, demo.id))!;
  await db
    .update(dbSchema.demoAnalyses)
    .set({ timeline })
    .where(eq(dbSchema.demoAnalyses.id, analysis.id));
  return { demoId: demo.id, analysisId: analysis.id };
}

/** A ready plan row holding `steps` exactly as given — the way to put a plan
 *  of any stored shape under updatePlanSteps. */
async function readyPlan(
  demo: { demoId: string; analysisId: string },
  steps: PlanStep[],
  approvedAt: Date | null = null,
): Promise<string> {
  const inserted = await db
    .insert(dbSchema.demoStepPlans)
    .values({ ...demo, status: "ready", steps, approvedAt })
    .returning();
  return inserted[0]!.id;
}

/** What a saved row stores per step: [sourceIndex, startMs, durationMs]. */
function storedClips(steps: unknown): [number, number | undefined, number][] {
  return planStepsSchema.parse(steps).map((s) => [s.sourceIndex, s.startMs, s.durationMs]);
}

interface TimelineFixture {
  questionnaire: Questionnaire;
  timeline: AnalysisState[];
  demoDescription?: string;
  recordingMs?: number;
  instants?: number[];
  expected: { sourceIndexes: number[]; dryRunSourceIndexes?: number[] };
}

/** Every fixtures/timelines file, as `aiugc plan regress` reads them. */
const FIXTURE_FILES = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));

function loadFixture(file: string): TimelineFixture {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), "utf8")) as TimelineFixture;
}

/** A fixture's clips exactly as generateStepPlan places them. */
function fixtureClips(fixture: TimelineFixture) {
  return momentClips(db, {
    timeline: fixture.timeline,
    recordingMs: fixture.recordingMs,
    instants: fixture.instants ?? null,
  });
}

/** A fixture's plan, asked for the way `aiugc plan regress` asks. */
function fixturePlan(fixture: TimelineFixture) {
  return generateStepPlan(db, {
    timeline: fixture.timeline,
    questionnaire: fixture.questionnaire,
    demoDescription: fixture.demoDescription,
    recordingMs: fixture.recordingMs,
    instants: fixture.instants,
  });
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

    const steps = planStepsSchema.parse(plan!.steps);
    // The canned analysis holds each of its five product screens for a second
    // state (a duplicate, a typing, a scroll, an unreadable frame). The happy
    // path selects the five first states — home, the new-project form, the
    // template list, the editor, the success screen. The typing at 8600ms is
    // a quality state too and stays out: its clip would share 800ms of footage
    // with the template list's at 9800ms.
    expect(steps.map((s) => s.sourceIndex)).toEqual([3, 5, 7, 9, 11]);
    expect(steps.map((s) => s.label)).toEqual([
      "הפרויקטים שלי",
      "פרויקט חדש",
      "בחרו תבנית",
      "שמירה",
      "הקמפיין נוצר",
    ]);
    // Every step is one 2s clip, stored with where it starts. A DRY_RUN
    // analysis writes no footage row, so nothing is known about the picture
    // between the moments and each clip starts at its own moment — the last
    // one ends at 18s of the stubbed 20s recording.
    expect(steps.map((s) => s.timestampMs)).toEqual([3000, 6000, 9800, 12_800, 16_000]);
    expect(steps.map((s) => s.startMs)).toEqual([3000, 6000, 9800, 12_800, 16_000]);
    expect(steps.map((s) => s.durationMs)).toEqual([2000, 2000, 2000, 2000, 2000]);
    expect(totalRuntimeMs(steps)).toBe(10_000);
    // No two steps show the same footage.
    expect(overlappingPairs(steps.map(stepClip))).toEqual([]);
    // None of the five clips runs onto a moment the analysis put on another page.
    expect(steps.some((s) => s.twoPages)).toBe(false);
    // Five is the minimum, so there is no shortfall to explain.
    expect(plan?.notes).toBeNull();

    const moments = unexplainedMomentsSchema.parse(plan!.unexplainedMoments);
    expect(moments).toHaveLength(1);
    expect(moments[0]!.timestampMs).toBe(9800);
  });

  it(
    "the canned plan reaches the minimum when index-even thinning would not",
    { timeout: 60_000 },
    async () => {
      // subsampleClusters thins by INDEX, so a burst of states close together
      // can spend most of the cap on clips that share footage — and the
      // minimum-step waiver counts the largest set of separate clips over the
      // whole legal pool, sees the states the thinning threw away, and refuses
      // to forgive the shortfall. generateStepPlan would then throw "dry-run
      // plan violates its own rules" on the path the whole suite, `aiugc plan
      // regress` keyless and a DRY_RUN worker all run. Twelve states 400ms
      // apart (the analyser's real grid), then four 2s apart ending on the
      // success, all one screen on a 16s recording. Thinned to the cap of ten
      // the pool is states 0, 1, 3, 4, 6, 8, 9, 11, 12 and 15, and dropping
      // every clip that shares footage with a later one leaves 4, 9, 12 and
      // 15. Walking back from the ending over every state finds seven.
      const ts = [...Array.from({ length: 12 }, (_, i) => i * 400), 6000, 8000, 10_000, 12_000];
      const timeline = ts.map((t, i) =>
        state({
          timestampMs: t,
          visibleText: [`צעד ${i}`],
          actionType: i === ts.length - 1 ? "result" : "tap",
        }),
      );
      const draft = await generateStepPlan(db, {
        timeline,
        questionnaire: QUESTIONNAIRE,
        recordingMs: 16_000,
      });
      // The ending is the one state the format cannot lose.
      expect(draft.steps.map((s) => s.sourceIndex)).toEqual([0, 5, 10, 12, 13, 14, 15]);
      expect(draft.steps.map((s) => s.startMs)).toEqual([
        0, 2000, 4000, 6000, 8000, 10_000, 12_000,
      ]);
      expect(draft.notes).toBeNull();
    },
  );

  it("the minimum counts only states the ending rule allows", { timeout: 60_000 }, async () => {
    // Real recordings keep rolling after the success screen, and a state after
    // it can never be a step — the last-step rule forbids it. Counting those
    // states as "selectable" would demand a plan the other rule rejects, which
    // is the other half of the keyless throw: the canned plan stops at the
    // ending, and so must the count. Here four states precede the success
    // screen and four follow it, against a minimum of five. The recording
    // runs 4s past the last state, so every one of them has a full clip.
    const ts = [0, 3200, 6400, 20_000, 25_000, 26_600, 28_200, 29_800];
    const words = ["אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה"];
    const timeline = ts.map((t, i) =>
      state({
        timestampMs: t,
        visibleText: [words[i]!],
        actionType: i === 3 ? "result" : "tap",
      }),
    );
    const draft = await generateStepPlan(db, {
      timeline,
      questionnaire: QUESTIONNAIRE,
      recordingMs: 33_800,
    });
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 3]);
    // Short, and said so: the canned planner explains a shortfall in `notes`.
    expect(draft.notes).not.toBeNull();
  });

  it("plan_demo_steps runs on the light lane", () => {
    expect(HEAVY_JOB_TYPES).not.toContain("plan_demo_steps");
  });

  it(
    "regenerating creates a NEW plan row — never mutates the old one",
    { timeout: 60_000 },
    async () => {
      const { planId: second } = await requestDemoPlan(db, demoId);
      expect(second).not.toBe(planId);
      await drainAll();
      expect((await getStepPlan(db, second))?.status).toBe("ready");
      expect((await getStepPlan(db, planId))?.status).toBe("ready");
    },
  );

  it(
    "a regenerate while one is still generating collapses onto the live job",
    { timeout: 60_000 },
    async () => {
      // Every press must not be a fresh paid enqueue: the route's budget gate
      // reads usage that lags the queue, so uncollapsed presses outrun it.
      const first = await requestDemoPlan(db, demoId);
      const second = await requestDemoPlan(db, demoId);
      expect(second.planId).toBe(first.planId);
      expect(second.jobId).toBe(first.jobId);
      await drainAll();
      expect((await getStepPlan(db, first.planId))?.status).toBe("ready");
    },
  );

  it(
    "the job-level account-cap backstop fails a queued plan fast, in Hebrew",
    { timeout: 60_000 },
    async () => {
      // A customer (not admin-bypassed) account at its 0027 llm_tokens ceiling:
      // the queued job must die as a fast PermanentError — never park, never
      // spend — even though it was enqueued before the cap was hit.
      const customer = await createBusiness(db, {
        ownerEmail: "capped@example.com",
        name: "עסק שמור",
      });
      await setQuestionnaire(db, customer.id, QUESTIONNAIRE);
      const demo = await createDemo(db, {
        businessId: customer.id,
        filePath: tempFile("capped.mp4"),
      });
      await drainAll(); // ingest -> analysis ready

      await recordUsage(db, {
        provider: "anthropic",
        kind: "llm_tokens",
        // Exactly the per-account cap: 0027 seeded 1_500_000, 0036 tightened it
        // to 500_000. Burning the cap exactly is the point — it proves the
        // queued-job backstop, so it moves with the cap.
        quantity: 500_000,
        businessId: customer.id,
      });

      const { planId: cappedPlanId } = await requestDemoPlan(db, demo.id);
      await drainAll();
      const plan = await getStepPlan(db, cappedPlanId);
      expect(plan?.status).toBe("failed");
      expect(plan?.failReason).toMatch(/מכסת/);
    },
  );
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
    expect(steps[0]!.timestampMs).toBe(1000);
    expect(steps[0]!.actionType).toBe("navigate");
    // Derived, not client-supplied — and from the moments, not the labels.
    // The hand-added login state is stored with its own moment's 2s clip; the
    // success step was stored with a clip already and keeps it under its new
    // label.
    expect(storedClips(updated.steps)).toEqual([
      [1, 1000, 2000],
      [11, 16_000, 2000],
    ]);
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
    // State 10 of the canned timeline is unreadable — the server mirrors the
    // picker's filter regardless of who selected it.
    await expect(
      updatePlanSteps(db, { planId, steps: [{ sourceIndex: 10, label: "לא קריא" }] }),
    ).rejects.toThrow(/unreadable/);
  });

  it("a selection whose clips share footage is refused, and nothing is stored", async () => {
    // updatePlanSteps has no violation channel and no retry: it stores what the
    // customer ticked or it throws. Two states 400ms apart are a VIOLATION on
    // the model path (below) and a refused save here — both clips would show
    // the same 1.6s of the recording, and the customer deletes one.
    const tight = await analysedDemo("tight.mp4", [
      state({ timestampMs: 0, visibleText: ["אחת"], actionType: "tap" }),
      state({ timestampMs: 400, visibleText: ["סוף"], actionType: "result" }),
    ]);
    const tightPlanId = await readyPlan(tight, []);

    await expect(
      updatePlanSteps(db, {
        planId: tightPlanId,
        steps: [
          { sourceIndex: 0, label: "אחת" },
          { sourceIndex: 1, label: "סוף" },
        ],
      }),
    ).rejects.toThrow(PLAN_STEPS_OVERLAP_MESSAGE);
    expect((await getStepPlan(db, tightPlanId))!.steps).toEqual([]);

    // Either of the two alone is a plan.
    const alone = await updatePlanSteps(db, {
      planId: tightPlanId,
      steps: [{ sourceIndex: 1, label: "סוף" }],
    });
    expect(storedClips(alone.steps)).toEqual([[1, 400, 2000]]);
  });

  it("a stored clip never moves under the customer, whatever the footage row says by the next save", async () => {
    // A clip the customer has watched in the editor is the clip that renders.
    // The footage row can arrive after the plan was first saved (a backfill of
    // an older analysis), and with it the same moment would be placed
    // elsewhere — that must reach only steps that have no clip yet.
    const timeline = [
      state({ timestampMs: 0, visibleText: ["אפס"], actionType: "navigate" }),
      state({ timestampMs: 5000, visibleText: ["אחת"], actionType: "tap" }),
      state({ timestampMs: 10_000, visibleText: ["שתיים"], actionType: "type" }),
      state({ timestampMs: 15_000, visibleText: ["סוף"], actionType: "result" }),
    ];
    const demo = await analysedDemo("kept.mp4", timeline);
    const keptPlanId = await readyPlan(demo, []);

    // No footage row yet: each clip starts at its own moment.
    expect(await analysisInstants(db, demo.analysisId)).toBeNull();
    const first = await updatePlanSteps(db, {
      planId: keptPlanId,
      steps: [
        { sourceIndex: 1, label: "אחת" },
        { sourceIndex: 3, label: "סוף" },
      ],
    });
    expect(storedClips(first.steps)).toEqual([
      [1, 5000, 2000],
      [3, 15_000, 2000],
    ]);

    // The footage arrives: the picture changes 1.5s after state 1 and 1s after
    // state 2. Placed now, each of those two clips slides back until the
    // change is 0.2s clear of its end — state 1's from 5000ms to 4300ms.
    await db.insert(dbSchema.demoAnalysisFootage).values({
      analysisId: demo.analysisId,
      fps: 5,
      fileSha: "0".repeat(64),
      moments: [],
      detector: "screens@1",
      instants: [
        { atMs: 6500, strength: 2, abrupt: 1 },
        { atMs: 11_000, strength: 2, abrupt: 1 },
      ],
    });
    const instants = await analysisInstants(db, demo.analysisId);
    expect(instants).toEqual([6500, 11_000]);
    const now = await momentClips(db, { timeline, recordingMs: 20_000, instants });
    expect(now.clips).toEqual(
      placeClips(timeline, { sampleMs: 200, recordingEndMs: 20_000, instants: [6500, 11_000] }),
    );
    expect(now.clips.map((c) => [c.startMs, c.calm])).toEqual([
      [0, false],
      [4300, true],
      [8800, true],
      [15_000, true],
    ]);

    // The next save relabels state 1 and adds state 2. State 1 keeps the clip
    // it was stored with, whatever its label; state 2 has none and gets the
    // one its moment is placed today.
    const second = await updatePlanSteps(db, {
      planId: keptPlanId,
      steps: [
        { sourceIndex: 1, label: "כיתוב אחר" },
        { sourceIndex: 2, label: "שתיים" },
        { sourceIndex: 3, label: "סוף" },
      ],
    });
    expect(second.id).toBe(keptPlanId);
    expect(storedClips(second.steps)).toEqual([
      [1, 5000, 2000],
      [2, 8800, 2000],
      [3, 15_000, 2000],
    ]);
  });

  it("a plan stored before steps had clips is re-placed to 2s clips on an edit", async () => {
    // Plans saved before every step became a fixed clip carry no startMs and
    // whatever length they were assembled with. Such a step plays from its
    // moment for that length (stepClip) until the plan is edited; the edit
    // stores every step — the untouched ones too — as its moment's 2s clip.
    const demo = await analysedDemo("old-shape.mp4", [
      state({ timestampMs: 0, visibleText: ["אפס"], actionType: "navigate" }),
      state({ timestampMs: 3000, visibleText: ["אחת"], actionType: "tap" }),
      state({ timestampMs: 6400, visibleText: ["שתיים"], actionType: "type" }),
      state({ timestampMs: 9000, visibleText: ["סוף"], actionType: "result" }),
    ]);
    const old: PlanStep[] = [
      {
        sourceIndex: 1,
        label: "כיתוב ראשון",
        timestampMs: 3000,
        actionType: "tap",
        durationMs: 3400,
      },
      {
        sourceIndex: 2,
        label: "כיתוב אמצעי",
        timestampMs: 6400,
        actionType: "type",
        durationMs: 2600,
      },
      {
        sourceIndex: 3,
        label: "כיתוב אחרון",
        timestampMs: 9000,
        actionType: "result",
        durationMs: 4000,
      },
    ];
    const oldPlanId = await readyPlan(demo, old);
    expect(old.map(stepClip)).toEqual([
      { startMs: 3000, durationMs: 3400 },
      { startMs: 6400, durationMs: 2600 },
      { startMs: 9000, durationMs: 4000 },
    ]);

    const edited = await updatePlanSteps(db, {
      planId: oldPlanId,
      steps: [
        { sourceIndex: 1, label: "כיתוב ראשון" },
        { sourceIndex: 2, label: "כיתוב חדש" },
        { sourceIndex: 3, label: "כיתוב אחרון" },
      ],
    });
    expect(edited.id).toBe(oldPlanId);
    expect(storedClips(edited.steps)).toEqual([
      [1, 3000, 2000],
      [2, 6400, 2000],
      [3, 9000, 2000],
    ]);
  });

  it("an approved plan from before clips opens for editing as an exact copy, the original untouched", async () => {
    // The editor's "edit a copy" PATCHes an approved plan with its own steps.
    // Nothing was edited yet, so nothing is re-placed and nothing can be
    // refused: the copy is the stored steps as they are. This plan could not
    // be re-placed at all — its first two moments are 1600ms apart, so their
    // 2s clips would share footage.
    const demo = await analysedDemo("approved-old.mp4", [
      state({ timestampMs: 0, visibleText: ["אפס"], actionType: "navigate" }),
      state({ timestampMs: 1600, visibleText: ["אחת"], actionType: "tap" }),
      state({ timestampMs: 5000, visibleText: ["סוף"], actionType: "result" }),
    ]);
    const old: PlanStep[] = [
      {
        sourceIndex: 0,
        label: "כיתוב ראשון",
        timestampMs: 0,
        actionType: "navigate",
        durationMs: 1600,
        offScreenWords: ["ראשון"],
      },
      {
        sourceIndex: 1,
        label: "כיתוב אמצעי",
        timestampMs: 1600,
        actionType: "tap",
        durationMs: 3400,
        offScreenWords: [],
      },
      {
        sourceIndex: 2,
        label: "כיתוב אחרון",
        timestampMs: 5000,
        actionType: "result",
        durationMs: 4000,
        offScreenWords: [],
      },
    ];
    const approvedId = await readyPlan(demo, old, new Date());
    const own = old.map(({ sourceIndex, label }) => ({ sourceIndex, label }));

    const copy = await updatePlanSteps(db, { planId: approvedId, steps: own });
    expect(copy.id).not.toBe(approvedId);
    expect(copy.approvedAt).toBeNull();
    expect(copy.status).toBe("ready");
    expect(copy.steps).toEqual(old);

    // The approved original still renders exactly what was signed off.
    const original = await getStepPlan(db, approvedId);
    expect(original?.approvedAt).not.toBeNull();
    expect(original?.steps).toEqual(old);

    // The first real edit of the copy is where the clips are placed — and
    // where the two moments 1600ms apart are refused until one of them goes.
    const relabelled = own.map((s) => (s.sourceIndex === 2 ? { ...s, label: "כיתוב חדש" } : s));
    await expect(updatePlanSteps(db, { planId: copy.id, steps: relabelled })).rejects.toThrow(
      PLAN_STEPS_OVERLAP_MESSAGE,
    );
    const trimmed = await updatePlanSteps(db, {
      planId: copy.id,
      steps: relabelled.filter((s) => s.sourceIndex !== 0),
    });
    expect(trimmed.id).toBe(copy.id);
    expect(storedClips(trimmed.steps)).toEqual([
      [1, 1600, 2000],
      [2, 5000, 2000],
    ]);
  });

  it("marks are carried by sourceIndex, not by position — a deleted step moves nobody's", async () => {
    // The rule (decision 0049): a step whose label is still the model's keeps
    // the row's marks; a changed or added one gets []. The KEY is sourceIndex.
    // plan-retry-contract.test.ts covers the edit-one-label case, but its
    // fixture gives only one step a non-empty mark, so a position-keyed
    // implementation passes it byte-identically. Here three steps carry three
    // DIFFERENT marks and the middle one is deleted: positions shift under the
    // survivors, so position keying drops step 3's mark and this test goes red.
    const demo = await createDemo(db, { businessId, filePath: tempFile("marks.mp4") });
    await drainAll(); // ingest -> analysis ready
    const analysis = (await getLatestDemoAnalysis(db, demo.id))!;
    await db
      .update(dbSchema.demoAnalyses)
      .set({
        timeline: [
          state({ timestampMs: 0, visibleText: ["אפס"], actionType: "navigate" }),
          state({ timestampMs: 3000, visibleText: ["אחת"], actionType: "tap" }),
          state({ timestampMs: 6000, visibleText: ["שתיים"], actionType: "type" }),
          state({ timestampMs: 9000, visibleText: ["סוף"], actionType: "result" }),
        ],
      })
      .where(eq(dbSchema.demoAnalyses.id, analysis.id));
    const inserted = await db
      .insert(dbSchema.demoStepPlans)
      .values({
        demoId: demo.id,
        analysisId: analysis.id,
        status: "ready",
        steps: [
          {
            sourceIndex: 1,
            label: "כיתוב ראשון",
            timestampMs: 3000,
            actionType: "tap",
            durationMs: 3000,
            offScreenWords: ["ראשון"],
          },
          {
            sourceIndex: 2,
            label: "כיתוב אמצעי",
            timestampMs: 6000,
            actionType: "type",
            durationMs: 3000,
            offScreenWords: ["אמצעי"],
          },
          {
            sourceIndex: 3,
            label: "כיתוב אחרון",
            timestampMs: 9000,
            actionType: "result",
            durationMs: 3000,
            offScreenWords: ["אחרון"],
          },
        ],
      })
      .returning();
    const marks = (steps: unknown) =>
      planStepsSchema.parse(steps).map((s) => [s.sourceIndex, s.offScreenWords]);

    // Delete the middle step; 1 and 3 are untouched and keep THEIR OWN marks.
    const afterDelete = await updatePlanSteps(db, {
      planId: inserted[0]!.id,
      steps: [
        { sourceIndex: 1, label: "כיתוב ראשון" },
        { sourceIndex: 3, label: "כיתוב אחרון" },
      ],
    });
    expect(marks(afterDelete.steps)).toEqual([
      [1, ["ראשון"]],
      [3, ["אחרון"]],
    ]);

    // Now rewrite step 3's label: its marks are the customer's problem no
    // longer, step 1's are untouched.
    const afterEdit = await updatePlanSteps(db, {
      planId: inserted[0]!.id,
      steps: [
        { sourceIndex: 1, label: "כיתוב ראשון" },
        { sourceIndex: 3, label: "כיתוב אחר לגמרי" },
      ],
    });
    expect(marks(afterEdit.steps)).toEqual([
      [1, ["ראשון"]],
      [3, []],
    ]);
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

describe("findPlanViolations (the plan-shape rules, deterministic)", () => {
  // Label provenance moved out to findOffScreenWords (decision 0049) — the
  // describe below carries those tests. 2s apart: these fixtures stand for
  // VALID plans, and two states closer together than one step's clip show the
  // same footage, a violation in its own right. Every timeline here sits on a
  // recording that runs on past it with no footage instants known (clipsOver),
  // so every clip starts at its own moment.
  const timeline: AnalysisState[] = [
    state({ timestampMs: 0, visibleText: ["פרויקט חדש", "שמירה"] }),
    state({ timestampMs: 2000, visibleText: ["הקמפיין נוצר!"], actionType: "result" }),
    state({ timestampMs: 4000, visibleText: [], legibility: "unreadable" }),
  ];
  const clips = clipsOver(timeline);

  it("shape rules: model plans must end on the result state and explain under-min counts", () => {
    // Ends mid-journey while a selectable result state exists -> violation.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "שמירה" }], timeline, 8, {
        minSteps: 1,
        notes: null,
        clips,
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
        8,
        { minSteps: 1, notes: null, clips },
      ),
    ).toEqual([]);
    // Ends mid-journey but `notes` explains (the timeline's only "result"
    // states may be mistyped error screens) -> the notes waive the rule.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "שמירה" }], timeline, 8, {
        minSteps: 1,
        notes: "אין בהקלטה מסך סיום ברור",
        clips,
      }),
    ).toEqual([]);
    // No selectable result in the timeline -> the rule cannot apply.
    const noResult = [state({ timestampMs: 0, visibleText: ["שמירה"] })];
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "שמירה" }], noResult, 8, {
        minSteps: 1,
        notes: null,
        clips: clipsOver(noResult),
      }),
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
      findPlanViolations(short, roomy, 8, {
        minSteps: 5,
        notes: null,
        clips: clipsOver(roomy),
      }).some((v) => v.includes("fewer than the minimum")),
    ).toBe(true);
    // ...and `notes` does NOT waive it any more. That hatch belongs to the
    // last-step rule alone; waiving both is how a 5-step plan with a
    // 26-second hole in the middle passed.
    expect(
      findPlanViolations(short, roomy, 8, {
        minSteps: 5,
        notes: "בסרטון אין יותר צעדים",
        clips: clipsOver(roomy),
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
        8,
        { minSteps: 6, notes: null, clips },
      ),
    ).toEqual([]);
  });

  it("the min-step waiver counts clips that share no footage, not legal states", () => {
    // Five legal states, but the last two sit 400ms apart: their clips share
    // 1.6s of footage, so at most four can ever be steps. A 4-step plan is the
    // longest plan this timeline has and must not be flagged.
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
      findPlanViolations(four, bunched, 8, {
        minSteps: 5,
        notes: null,
        clips: clipsOver(bunched),
      }),
    ).toEqual([]);
    // Space that pair out and the same 4-step plan IS a violation — one that
    // tells the retry how many separate clips there are to select from.
    const spread = bunched.map((s, i) => (i === 4 ? state({ ...s, timestampMs: 8000 }) : s));
    expect(
      findPlanViolations(four, spread, 8, { minSteps: 5, notes: null, clips: clipsOver(spread) }),
    ).toEqual([
      "the plan has 4 steps, fewer than the minimum 5 — this timeline offers 5 selectable states whose clips do not overlap, so select more genuinely distinct ones; `notes` does not waive this, and never pad with loading, duplicate or otherwise skipped states",
    ]);
  });

  it("the min-step waiver forgives a recording too short to hold the minimum", () => {
    // Five clips are 10s of footage. On a 9s recording the success screen's
    // clip cannot start at its 8000ms moment — it is slid back to end with the
    // recording, onto the footage of the state before it — so four steps are
    // all this recording has. One more second of recording and it has five.
    const short: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["אחת"] }),
      state({ timestampMs: 2000, visibleText: ["שתיים"] }),
      state({ timestampMs: 4000, visibleText: ["שלוש"] }),
      state({ timestampMs: 6000, visibleText: ["ארבע"] }),
      state({ timestampMs: 8000, visibleText: ["חמש"], actionType: "result" }),
    ];
    const four = [
      { sourceIndex: 0, label: "אחת" },
      { sourceIndex: 1, label: "שתיים" },
      { sourceIndex: 2, label: "שלוש" },
      { sourceIndex: 4, label: "חמש" },
    ];
    const nineSeconds = clipsOver(short, 1000);
    expect(nineSeconds.map((c) => c.startMs)).toEqual([0, 2000, 4000, 6000, 7000]);
    expect(
      findPlanViolations(four, short, 8, { minSteps: 5, notes: null, clips: nineSeconds }),
    ).toEqual([]);
    const tenSeconds = clipsOver(short, 2000);
    expect(tenSeconds.map((c) => c.startMs)).toEqual([0, 2000, 4000, 6000, 8000]);
    expect(
      findPlanViolations(four, short, 8, {
        minSteps: 5,
        notes: null,
        clips: tenSeconds,
      }).some((v) => v.includes("this timeline offers 5 selectable states")),
    ).toBe(true);
  });

  it("the min-step waiver stops counting at the ending — post-success filming offers nothing", () => {
    // Success at 6s, and the customer kept filming (the normal case, per the
    // last-step rule's own comment). An ending-compliant plan tops out at four
    // steps; the states at 8/10/12/14s can never be steps, so counting them
    // would order the model to add pre-ending states that do not exist, burn
    // the corrective calls, and fail the plan.
    const ts = [0, 2000, 4000, 6000, 8000, 10_000, 12_000, 14_000];
    const filmedOn: AnalysisState[] = ts.map((t, i) =>
      state({
        timestampMs: t,
        visibleText: [`מסך ${i}`],
        actionType: i === 3 ? "result" : "tap",
      }),
    );
    const plan = [0, 1, 2, 3].map((i) => ({ sourceIndex: i, label: `מסך ${i}` }));
    expect(
      findPlanViolations(plan, filmedOn, 8, {
        minSteps: 5,
        notes: null,
        clips: clipsOver(filmedOn),
      }),
    ).toEqual([]);
    // The same eight moments with no success screen among them have no ending
    // to stop at: all eight count, and the same four steps are short.
    const noEnding = filmedOn.map((s) => state({ ...s, actionType: "tap" }));
    expect(
      findPlanViolations(plan, noEnding, 8, {
        minSteps: 5,
        notes: null,
        clips: clipsOver(noEnding),
      }),
    ).toEqual([
      "the plan has 4 steps, fewer than the minimum 5 — this timeline offers 8 selectable states whose clips do not overlap, so select more genuinely distinct ones; `notes` does not waive this, and never pad with loading, duplicate or otherwise skipped states",
    ]);
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
      8,
      { minSteps: 6, notes: null, clips: clipsOver(continues) },
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

  it("flags skip-kind screens for the model, treats absent screenKind as no information", () => {
    const kinds: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["התחברות"], screenKind: "login" }),
      state({ timestampMs: 1000, visibleText: ["דף הבית"], screenKind: "product" }),
      state({
        timestampMs: 2000,
        visibleText: ["שגיאה"],
        actionType: "result",
        screenKind: "error",
      }),
      state({ timestampMs: 3000, visibleText: ["נשמר"] }), // v2-era: no screenKind
    ];
    // Login screens are never steps for the model.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "התחברות" }], kinds, 8).some((v) =>
        v.includes('"login"'),
      ),
    ).toBe(true);
    // product and absent screenKind both pass.
    expect(findPlanViolations([{ sourceIndex: 1, label: "דף הבית" }], kinds, 8)).toEqual([]);
    expect(findPlanViolations([{ sourceIndex: 3, label: "נשמר" }], kinds, 8)).toEqual([]);
    // The only "result" is an error screen the analysis mistyped — the shape
    // rule must not force the plan to end on a state it may never select.
    expect(
      findPlanViolations([{ sourceIndex: 1, label: "דף הבית" }], kinds, 8, {
        minSteps: 1,
        notes: null,
        clips: clipsOver(kinds),
      }),
    ).toEqual([]);
  });

  it("flags structural violations: unreadable states, dups, range, word count, step count", () => {
    expect(
      findPlanViolations([{ sourceIndex: 2, label: "שמירה" }], timeline, 8).some((v) =>
        v.includes("unreadable"),
      ),
    ).toBe(true);
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "שמירה" },
          { sourceIndex: 0, label: "שמירה" },
        ],
        timeline,
        8,
      ).some((v) => v.includes("twice")),
    ).toBe(true);
    expect(
      findPlanViolations([{ sourceIndex: 9, label: "שמירה" }], timeline, 8).some((v) =>
        v.includes("not in the timeline"),
      ),
    ).toBe(true);
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "שמירה" },
          { sourceIndex: 1, label: "נוצר" },
        ],
        timeline,
        1,
      ).some((v) => v.includes("maximum is 1")),
    ).toBe(true);
    expect(findPlanViolations([], timeline, 8)).toEqual(["the plan has zero steps"]);
  });

  it("a caption over four words is a violation — what cannot be read in one step", () => {
    // Four is the ceiling: four passes, five does not. The message carries the
    // reason and the fix, because the retry has no other way to know either.
    const four = "פרויקט חדש שמירה פרויקט";
    const five = "פרויקט חדש שמירה פרויקט חדש";
    expect(findPlanViolations([{ sourceIndex: 0, label: four }], timeline, 8)).toEqual([]);
    expect(findPlanViolations([{ sourceIndex: 0, label: five }], timeline, 8)).toEqual([
      `step 0: label "${five}" is over 4 words — a step is on screen for 2000ms and nothing longer can be read in it; cut it to 4 words or fewer`,
    ]);
    // The count is the viewer's: a spaced dash is not a word, here or in
    // readTimeMs, so a four-word caption written with one still fits its step.
    const dashed = "פרויקט חדש — שמירה פרויקט";
    expect(readTimeMs(dashed)).toBe(2000);
    expect(findPlanViolations([{ sourceIndex: 0, label: dashed }], timeline, 8)).toEqual([]);
  });

  it("allowLongLabels switches the word ceiling off, and nothing else", () => {
    // The last-round re-check: after the last corrective call a long caption
    // is kept for the editor's warning rather than failing the plan. Every
    // other rule still holds on that re-check.
    const long = "פרויקט חדש שמירה פרויקט חדש";
    const plan = [
      { sourceIndex: 0, label: long },
      { sourceIndex: 1, label: "נוצר" },
    ];
    expect(findPlanViolations(plan, timeline, 8, { minSteps: 1, notes: null, clips })).toEqual([
      `step 0: label "${long}" is over 4 words — a step is on screen for 2000ms and nothing longer can be read in it; cut it to 4 words or fewer`,
    ]);
    expect(
      findPlanViolations(plan, timeline, 8, {
        minSteps: 1,
        notes: null,
        clips,
        allowLongLabels: true,
      }),
    ).toEqual([]);
    // The 60-character ceiling is not a word rule and stays on.
    const endless = Array.from({ length: 13 }, () => "שמירה").join(" ");
    expect(endless.length).toBeGreaterThan(60);
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: endless },
          { sourceIndex: 1, label: "נוצר" },
        ],
        timeline,
        8,
        { minSteps: 1, notes: null, clips, allowLongLabels: true },
      ),
    ).toEqual(["step 0: label is over 60 characters"]);
  });
});

describe("two steps never show the same footage (decision 0087)", () => {
  // Real timelines put states 400ms apart (fixtures/timelines: the botteacher
  // recordings both do). Selecting both is a selection bug — the corrective
  // retry has to see it, because both clips would play the same 1.6s.
  const timeline: AnalysisState[] = [
    state({ timestampMs: 0, visibleText: ["התחלה"] }),
    state({ timestampMs: 400, visibleText: ["המשך"] }),
    state({ timestampMs: 9000, visibleText: ["נשמר"], actionType: "result" }),
  ];
  const clips = clipsOver(timeline);
  const all = [
    { sourceIndex: 0, label: "התחלה" },
    { sourceIndex: 1, label: "המשך" },
    { sourceIndex: 2, label: "נשמר" },
  ];

  it("a pair whose clips overlap is a VIOLATION for the model, naming both clips", () => {
    expect(findPlanViolations(all, timeline, 8, { minSteps: 1, notes: null, clips })).toEqual([
      "states 0 and 1 show the same footage — their clips (0-2000ms and 400-2400ms) overlap, and two steps may never share footage; keep the one that shows the beat better (a `calm` one when there is one) and select a genuinely different state instead of the other",
    ]);
    // `notes` waives the last-step rule — it must NOT waive this one: nothing
    // explains showing the viewer the same footage twice.
    expect(
      findPlanViolations(all, timeline, 8, { minSteps: 1, notes: "הקלטה קצרה", clips }),
    ).toHaveLength(1);
    // Far enough apart -> silent.
    expect(
      findPlanViolations([all[0]!, all[2]!], timeline, 8, { minSteps: 1, notes: null, clips }),
    ).toEqual([]);
  });

  it("clips that only touch share nothing; one analysis sample closer and they do", () => {
    const pair = (gapMs: number): string[] => {
      const two: AnalysisState[] = [
        state({ timestampMs: 0, visibleText: ["התחלה"] }),
        state({ timestampMs: gapMs, visibleText: ["נשמר"], actionType: "result" }),
      ];
      return findPlanViolations(
        [
          { sourceIndex: 0, label: "התחלה" },
          { sourceIndex: 1, label: "נשמר" },
        ],
        two,
        8,
        { minSteps: 1, notes: null, clips: clipsOver(two) },
      );
    };
    expect(pair(2000)).toEqual([]);
    expect(pair(1800)).toHaveLength(1);
  });

  it("when one of the pair is the ending, the message says which to give up", () => {
    // Told only to keep whichever reads better, a retry may drop the success
    // state and fail the ending rule instead.
    const late: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["התחלה"] }),
      state({ timestampMs: 5000, visibleText: ["המשך"] }),
      state({ timestampMs: 5400, visibleText: ["נשמר"], actionType: "result" }),
    ];
    expect(
      findPlanViolations(all, late, 8, { minSteps: 1, notes: null, clips: clipsOver(late) }),
    ).toEqual([
      "states 1 and 2 show the same footage — their clips (5000-7000ms and 5400-7400ms) overlap, and two steps may never share footage; state 2 is the ending, so drop state 1, or select an earlier moment in its place",
    ]);
  });

  it("checks every pair, not neighbours only", () => {
    // The validator reads the clips it is handed and leans on nothing about
    // how they were placed. Here the third step's clip sits on the first
    // step's footage and clear of the second's: only that pair is named.
    const three: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["התחלה"] }),
      state({ timestampMs: 4000, visibleText: ["המשך"] }),
      state({ timestampMs: 8000, visibleText: ["נשמר"] }),
    ];
    const handPlaced: PlacedClip[] = [
      { startMs: 0, calm: false, twoPages: false },
      { startMs: 4000, calm: false, twoPages: false },
      { startMs: 1000, calm: false, twoPages: false },
    ];
    expect(
      findPlanViolations(all, three, 8, { minSteps: 1, notes: null, clips: handPlaced }),
    ).toEqual([
      "states 0 and 2 show the same footage — their clips (0-2000ms and 1000-3000ms) overlap, and two steps may never share footage; keep the one that shows the beat better (a `calm` one when there is one) and select a genuinely different state instead of the other",
    ]);
  });

  it("never fires without `shape` — the human path has its own refusal", () => {
    // Human edits go through updatePlanSteps, which never calls this at all
    // and refuses an overlap itself (PLAN_STEPS_OVERLAP_MESSAGE, above).
    expect(findPlanViolations(all, timeline, 8)).toEqual([]);
  });
});

describe("findOffScreenWords (the provenance highlight, deterministic)", () => {
  // The rule that used to fail plans (decision 0049): same tokenization, same
  // dup-run pooling, same three exemptions — it now returns the words instead
  // of violation strings, and generateStepPlan stores them on each step for
  // the editor to mark. Every test here is the gate's test ported one for one:
  // same inputs, same words; "rejects" became "flags".
  const timeline: AnalysisState[] = [
    state({ timestampMs: 0, visibleText: ["פרויקט חדש", "שמירה"] }),
    state({ timestampMs: 2000, visibleText: ["הקמפיין נוצר!"], actionType: "result" }),
    state({ timestampMs: 4000, visibleText: [], legibility: "unreadable" }),
  ];
  /** The flagged words of a one-step plan. */
  const flagged = (
    label: string,
    opts: {
      sourceIndex?: number;
      timeline?: AnalysisState[];
      questionnaire?: Questionnaire;
      description?: string | null;
    } = {},
  ): string[] =>
    findOffScreenWords(
      [{ sourceIndex: opts.sourceIndex ?? 0, label }],
      opts.timeline ?? timeline,
      opts.questionnaire ?? QUESTIONNAIRE,
      opts.description,
    )[0]!.words;

  it("returns one entry per step, in order, carrying the sourceIndex", () => {
    expect(
      findOffScreenWords(
        [
          { sourceIndex: 0, label: "פרויקט חדש" },
          { sourceIndex: 1, label: "הקמפיין נוצר" }, // punctuation-insensitive
        ],
        timeline,
        QUESTIONNAIRE,
      ),
    ).toEqual([
      { index: 0, sourceIndex: 0, words: [] },
      { index: 1, sourceIndex: 1, words: [] },
    ]);
  });

  it("passes labels lifted from the screen or the questionnaire", () => {
    expect(flagged("פרויקט חדש")).toEqual([]);
    expect(flagged("הקמפיין נוצר", { sourceIndex: 1 })).toEqual([]);
    // Questionnaire words pass on any step.
    expect(flagged("קמפיינר מהיר")).toEqual([]);
  });

  it("absorbs single-letter Hebrew prefixes on either side", () => {
    // Label adds a prefix the screen lacks...
    expect(flagged("בפרויקט")).toEqual([]);
    // ...and the screen carries a prefix the label lacks ("הקמפיין" -> "קמפיין").
    expect(flagged("קמפיין", { sourceIndex: 1 })).toEqual([]);
  });

  it("absorbs prefixed function words instead of marking them", () => {
    // Hebrew glues ו/ש onto function words; "וגם"/"שכבר" would be noise.
    expect(flagged("וגם שמירה")).toEqual([]);
    expect(flagged("שכבר שמירה")).toEqual([]);
  });

  it("demo-description words pass — the upload note widens the vocabulary", () => {
    // "קופון" is on no screen and in no questionnaire field; only the
    // customer's own note carries it — the same customer-authored-claims
    // principle as demo_notes, wired per-demo instead of per-business.
    expect(flagged("קופון הנחה", { description: "מזינים קופון הנחה בקופה" })).toEqual([]);
    // Absent everywhere -> marked. The description weakens the rule by
    // exactly its own words, nothing more.
    expect(flagged("קופון הנחה")).toEqual(["קופון", "הנחה"]);
    // Blank and null are the no-description case, not a wildcard.
    expect(flagged("קופון הנחה", { description: "   " })).toEqual(["קופון", "הנחה"]);
    expect(flagged("קופון הנחה", { description: null })).toEqual(["קופון", "הנחה"]);
  });

  it("pools visibleText across a sameStateAsPrevious run (real BotTeacher state 36)", () => {
    // Exact strings from demo ba70c3d7 / analysis 6a1b247e: the anchor frame's
    // OCR clipped "נשלים" to "נשלי"; the dup frames of the SAME screen read it
    // fully. The label must match against the whole run, not the anchor alone.
    const run: AnalysisState[] = [
      state({
        timestampMs: 54_600,
        visibleText: [
          "עוד רגע לפני שמתחילים – בואו נשלי",
          "הפרטים האקדמיים קובעים איך נתאים לך את המערכת. אפשר לשנות ב",
          "Mohamed Taha",
          "סוג תואר",
        ],
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
    // The word the anchor clipped, found on the dups: nothing marked.
    expect(flagged("בואו נשלים", { timeline: run })).toEqual([]);
    // A word absent from the entire run is still marked — pooling adds no slack.
    expect(flagged("חוויה", { timeline: run })).toEqual(["חוויה"]);
  });

  it("keeps the מלאה true positive (real BotTeacher state 72)", () => {
    // State 72's run is itself alone; the screen says "מבחן מלא", never "מלאה".
    const tourState = state({
      timestampMs: 109_800,
      visibleText: [
        "boteacher",
        "BRONZE · עוזר אקדמי אישי",
        "6/11",
        "מכונת המבחנים",
        "סימולציה של מבחן מלא על חומר הקורס, עם ציון בסוף – כדי",
        "שתגיע למבחן האמיתי בלי חן",
        "המשך",
        "חזור",
        "דלג על הכל",
      ],
      actionType: "navigate",
    });
    expect(flagged("סימולציה מלאה", { timeline: [tourState] })).toEqual(["מלאה"]);
    // Words genuinely on that screen pass, including across the · separator.
    expect(flagged("מכונת המבחנים", { timeline: [tourState] })).toEqual([]);
  });

  it("normalizes gershayim, glued separators and niqqud on both sides", () => {
    const noisy: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ['הלו"ז שלי', "BRONZE·עוזר אקדמי", "שָׁלוֹם"] }),
    ];
    // Hebrew gershayim (U+05F4) in the label vs ASCII quote on screen.
    expect(flagged("לו״ז", { timeline: noisy })).toEqual([]);
    // The OCR glued a · onto the word; whitespace splitting left it stuck.
    expect(flagged("עוזר", { timeline: noisy })).toEqual([]);
    // Screen carries niqqud, the label does not.
    expect(flagged("שלום", { timeline: noisy })).toEqual([]);
  });

  it("words from demo_notes pass — an explained moment becomes copy", () => {
    // Not on state 0's screen and not elsewhere in the questionnaire...
    expect(flagged("תבניות מוכנות")).toEqual(["תבניות", "מוכנות"]);
    // ...but once the customer's answer carries them, nothing is marked.
    const explained = { ...QUESTIONNAIRE, demo_notes: ["מסך בחירת תבניות מוכנות"] };
    expect(flagged("תבניות מוכנות", { questionnaire: explained })).toEqual([]);
  });

  it("never marks instruction verbs — a caption tells you what to DO (real a179f069 state 1)", () => {
    // Verbatim visibleText from the shipped analysis. The opening caption the
    // format wants is "go to boteacher.com": "boteacher" off the screen, "כנסו"
    // off the instruction allowlist.
    const home = state({
      timestampMs: 2800,
      visibleText: [
        "Create /",
        "Higgsfe",
        "https://boteacher.com",
        "Ask about this page",
        "Apps",
        "boteacher",
        "שבוע",
        "יום",
        "היום",
        "מרחב לנשום",
      ],
      actionType: "navigate",
      legibility: "low",
    });
    expect(flagged("כנסו לboteacher", { timeline: [home] })).toEqual([]);
    // Prefixed forms are not marked either — Hebrew glues ו onto verbs too.
    expect(flagged("ולחצו boteacher", { timeline: [home] })).toEqual([]);
    // A verb that is NOT on the list is marked: the allowlist is a list, not
    // a morphology rule.
    expect(flagged("הורידו boteacher", { timeline: [home] })).toEqual(["הורידו"]);
  });

  it("never marks pronouns addressed to the viewer", () => {
    expect(flagged("שמירה שלכם")).toEqual([]);
    expect(flagged("הוא נוצר", { sourceIndex: 1 })).toEqual([]);
  });

  it("still flags a product claim absent from the screen and the questionnaire", () => {
    // The rule loosens for instructions and must NOT loosen for claims:
    // "automatically" is a promise about the product, and a promise the
    // recording does not show belongs in the questionnaire — a caption that
    // invents it is exactly what the customer has to see marked.
    const bare: Questionnaire = { ...QUESTIONNAIRE, what_it_does: "יוצר קמפיינים" };
    expect(flagged("שמירה אוטומטית", { questionnaire: bare })).toEqual(["אוטומטית"]);
    // No root or morphology matching either: the questionnaire saying
    // "אוטומטי" does not license "אוטומטית".
    expect(
      flagged("שמירה אוטומטית", {
        questionnaire: { ...bare, what_it_does: "יוצר קמפיינים אוטומטי" },
      }),
    ).toEqual(["אוטומטית"]);
  });

  it("passes function words but flags fabricated content words", () => {
    expect(flagged("רק פרויקט חדש")).toEqual([]);
    expect(flagged("חוויה מדהימה")).toEqual(["חוויה", "מדהימה"]);
  });

  it("the confirm step can be an instruction instead of the button's own label", () => {
    // The real a179f069 confirm dialog. Before אשרו/אישרו were allowlisted,
    // EVERY instruction form was rejected here and reading the button label
    // back ("אישר ניתוב לחומר קורס") was the only caption that passed — the
    // validator forced the transcription the prompt forbids.
    const confirm = [
      state({
        timestampMs: 0,
        actionType: "select",
        visibleText: [
          "Takin Syllabus.txt",
          "זוהה סילבוס",
          "יעד ניתוב",
          "חומר קורס",
          "אישר ניתוב (1)",
        ],
      }),
    ];
    const ok = (label: string) => flagged(label, { timeline: confirm }).length === 0;
    expect(ok("אשרו את הניתוב")).toBe(true);
    expect(ok("אישרו את הניתוב")).toBe(true);
    // ה-prefixed forms need no entries of their own: unlike "היכנסו", which
    // halts prefix-stripping at the yod, these strip straight to the base.
    expect(ok("האשרו את הניתוב")).toBe(true);
    expect(ok("ואשרו את היעד")).toBe(true);
    expect(ok("התחילו ניתוב")).toBe(true);
    // במקום closed the file-routing fixture; שלו/שלה closed the pronoun set,
    // which passed "שלהם" by double-stripping while rejecting the singular.
    expect(ok("במקום זה")).toBe(true);
    expect(ok("שלו")).toBe(true);
    expect(ok("שלה")).toBe(true);
  });

  it("prepositions and narration verbs are never marked", () => {
    // "לפי" failed a live plan three rounds running (2026-09-14/15, docs/vault/
    // facts/label-rule-families-2026-09-15.md): a bare preposition carries no
    // product claim. This timeline shows neither it nor the QUESTIONNAIRE
    // (which has "בלי", deliberately not used here).
    expect(flagged("שמירה לפי פרויקט")).toEqual([]);
    // Glued ו, exactly like the other function words.
    expect(flagged("ולפי פרויקט")).toEqual([]);
    // The present-tense plural of a listed imperative narrates the screen the
    // way a friend does ("ממלאים" for "מלאו") and is exempt the same way.
    expect(flagged("ממלאים פרויקט חדש")).toEqual([]);
    // The verbs the census found off-screen whose imperatives are NOT listed
    // stay marked — the list is a list, not a morphology rule.
    expect(flagged("מצאו פרויקט")).toEqual(["מצאו"]);
    // A content word absent from the screen, the questionnaire and the
    // description is marked; the additions widen nothing else.
    expect(flagged("הפרטים של פרויקט")).toEqual(["הפרטים"]);
  });

  it("a verb of understanding is a claim — בין is not a function word, דרך is", () => {
    // "בין" was a member for one commit (a4c1339) and came back off: it
    // admits "הבין"/"מבין" by prefix-stripping, and a claim that the product
    // UNDERSTOOD something is exactly the class this highlight exists for.
    expect(flagged("הבין שמירה")).toEqual(["הבין"]);
    expect(flagged("מבין פרויקט")).toEqual(["מבין"]);
    // The price of that: the genuine preposition is marked too, which under
    // decision 0049 is an amber mark and not a rejection.
    expect(flagged("בין שמירה לפרויקט")).toEqual(["בין"]);
    // "דרך" stays — "הדרך"/"בדרך" say how something is done, never what the
    // product can do, so neither needs the screen to back it.
    expect(flagged("שמירה דרך פרויקט")).toEqual([]);
    expect(flagged("הדרך לפרויקט")).toEqual([]);
  });

  it("morphology is still not matched — a claim and a plural stay flagged", () => {
    // Deliberate, and measured rather than papered over: "הקמפיין" is the
    // questionnaire's own noun in the definite singular and it still fails
    // against "קמפיינים", which is what keeps dry-run-campaign-app red.
    const screen = [state({ timestampMs: 0, visibleText: ["שמירה"] })];
    expect(flagged("הקמפיין נוצר", { timeline: screen })).toContain("הקמפיין");
    // A benefit the customer never claimed stays marked. ("אוטומטית" would
    // pass here — it is in this questionnaire's what_it_does, which is the
    // rule working, not failing.)
    expect(flagged("בחינם", { timeline: screen })).toEqual(["בחינם"]);
  });

  it("returns the label's own tokens as written, so the editor can match them exactly", () => {
    // Normalization is for MATCHING only: the stored word keeps the label's
    // spelling and case, and edge punctuation is a separator, never part of
    // the word — the editor splits the same way (splitWords) and marks by
    // string equality.
    expect(flagged("חוויה, מדהימה!")).toEqual(["חוויה", "מדהימה"]);
    expect(flagged("Amazing שמירה")).toEqual(["Amazing"]);
    expect(splitWords("חוויה, מדהימה!")).toEqual(["חוויה", "מדהימה"]);
    expect(tokenizeWords("Amazing, לו״ז")).toEqual(["amazing", 'לו"ז']);
    expect(normalizeWord("שָׁלוֹם!")).toBe("שלום");
  });

  it("does not throw on a sourceIndex outside the timeline — the shape rule owns that", () => {
    expect(
      findOffScreenWords([{ sourceIndex: 9, label: "שמירה" }], timeline, QUESTIONNAIRE),
    ).toEqual([{ index: 0, sourceIndex: 9, words: ["שמירה"] }]);
  });
});

describe("the prompt's timing block is generated from the code, not restated", () => {
  // The production defaults, spelled out rather than imported: a test that
  // reads the same constants the generator reads cannot catch either moving.
  // (With no pinned access step the model is asked for exactly these counts.)
  const block = planTimingMarkdown({ minSteps: 5, maxSteps: 10 });
  const label = (words: number) => Array.from({ length: words }, () => "אחת").join(" ");

  /** The word-ceiling violations of a one-step plan captioned `caption`. */
  const wordViolations = (caption: string): string[] =>
    findPlanViolations(
      [{ sourceIndex: 0, label: caption }],
      [state({ timestampMs: 0, visibleText: ["אחת"] })],
      10,
    ).filter((v) => v.includes("words"));

  const readRows = [...block.matchAll(/^\| (\d+) words \| ([\d.]+)s \|$/gm)].map((m) => ({
    words: Number(m[1]),
    ms: Math.round(Number(m[2]) * 1000),
  }));

  it("offers one row per legal caption length, with the seconds readTimeMs asks", () => {
    expect(readRows).toEqual([
      { words: 3, ms: 1600 },
      { words: 4, ms: 2000 },
    ]);
    // v10 hand-wrote this table and its first row drifted from readTimeMs, so
    // the prompt licensed plans the check then rejected. Each row is the
    // function's own answer.
    for (const row of readRows) expect(readTimeMs(label(row.words))).toBe(row.ms);
  });

  it("the longest row is the ceiling findPlanViolations enforces", () => {
    // The prompt points the model at "the longest row of the table" as the
    // hard ceiling: every row has to pass the check, the next length has to
    // fail it, and the longest row has to fit the step it is read in.
    for (const row of readRows) expect(wordViolations(label(row.words))).toEqual([]);
    const longest = readRows[readRows.length - 1]!;
    expect(longest.ms).toBe(2000);
    expect(wordViolations(label(longest.words + 1))).toHaveLength(1);
  });

  it("states the step length, what each timeline entry carries, and the totals", () => {
    expect(block).toContain("Every step runs exactly 2.0s: its clip.");
    // The three fields the model reads off every timeline entry.
    expect(block).toContain("`clipStartMs`");
    expect(block).toContain("`calm`");
    expect(block).toContain("`twoPages`");
    // The total is the step count and nothing else: 5 x 2.0s and 10 x 2.0s.
    expect(block).toContain(
      "A plan runs its step count times 2.0s: 5 steps run 10.0s, 10 steps run 20.0s.",
    );
    // Arithmetic only — no verdict, and no length for the model to aim at.
    expect(block).not.toContain("must total");
    expect(block).not.toContain("too SHORT");
    expect(block).not.toContain("passes");
  });

  it("names the distance two selected states must keep — the one the check holds a pair to", () => {
    expect(block).toContain(
      "Two selected states may never show the same footage: their `clipStartMs` values must be at least 2000 apart.",
    );
    // Walked through the check itself: at the stated distance a pair is legal,
    // one analysis sample under it is not.
    const pairViolations = (apartMs: number): string[] => {
      const timeline: AnalysisState[] = [
        state({ timestampMs: 0, visibleText: ["אחת"] }),
        state({ timestampMs: apartMs, visibleText: ["שתיים"], actionType: "result" }),
      ];
      const clips = clipsOver(timeline);
      expect(clips[1]!.startMs - clips[0]!.startMs).toBe(apartMs);
      return findPlanViolations(
        [
          { sourceIndex: 0, label: "אחת" },
          { sourceIndex: 1, label: "שתיים" },
        ],
        timeline,
        10,
        { minSteps: 1, notes: null, clips },
      );
    };
    expect(pairViolations(2000)).toEqual([]);
    expect(pairViolations(1800).filter((v) => v.includes("show the same footage"))).toHaveLength(1);
  });

  it("the latest prompt file asks for the block, and the caller's vars satisfy it", () => {
    // renderPrompt substitutes only what the template references, so a prompt
    // that stops asking for {{timing}} loses every derived number in silence —
    // and one that asks for a variable generateStepPlan does not pass throws on
    // the paid path only. Both are checked here, against whatever is latest.
    const version = latestPromptVersion("plan_demo_steps");
    const file = readFileSync(path.join(PROMPTS_DIR, "plan_demo_steps", `v${version}.md`), "utf8");
    expect(file).toContain("{{timing}}");

    const { text, promptVersion } = renderPrompt("plan_demo_steps", {
      questionnaire: "{}",
      timeline: "[]",
      min: 5,
      max: 10,
      timing: block,
      // v13+ — same one-way compatibility as {{timing}}: extra vars are
      // ignored by older templates, absent ones throw on the latest.
      demo_description: "(אין)",
    });
    expect(promptVersion).toBe(`plan_demo_steps@v${version}`);
    expect(text).toContain(block);
    expect(text).not.toContain("{{");
  });
});

describe("the one-beat test's calibration", () => {
  // v11 replaced v10's "if most of the entries are the same" with a measured
  // threshold, because "most" reads as a majority and the real one-beat pair
  // sits at 44% — so the model correctly called it two screens, twice.
  const timeline = (
    JSON.parse(
      readFileSync(path.join(FIXTURES_DIR, "real-botteacher-file-routing.json"), "utf8"),
    ) as { timeline: AnalysisState[] }
  ).timeline;
  const sharedEntries = (a: number, b: number): string[] => {
    const left = new Set(timeline[a]!.visibleText);
    return timeline[b]!.visibleText.filter((t) => left.has(t));
  };
  /** v11's rule: shared entries over the LONGER of the two arrays. */
  const overlap = (a: number, b: number): number =>
    sharedEntries(a, b).length /
    Math.max(timeline[a]!.visibleText.length, timeline[b]!.visibleText.length);

  it("puts the one-beat pair and the two-beat pair on opposite sides of a third", () => {
    // The counts v11's two worked pairs quote. A re-snapshotted fixture that
    // moves them makes the prompt's examples wrong, and that is worth a red.
    expect(timeline[11]!.visibleText).toHaveLength(9);
    expect(timeline[12]!.visibleText).toHaveLength(6);
    expect(timeline[2]!.visibleText).toHaveLength(17);
    expect(timeline[3]!.visibleText).toHaveLength(5);

    // The STRINGS, not just the counts. v11 quotes these seven entries by
    // name; counts alone stay green when a re-OCR swaps which entries overlap
    // (state 12 re-reading `Black Hole` as `boteacher` keeps the count at 4),
    // and the prompt would then be citing entries that are no longer shared.
    expect(sharedEntries(11, 12)).toEqual([
      "Black Hole",
      "Takin Syllabus.txt",
      "זוהה סילבוס",
      "יעד ניתוב",
    ]);
    expect(sharedEntries(2, 3)).toEqual([
      "שפוך פה הכל",
      "boteacher יעשה לך סדר",
      "מבחן ללא פתרון לא ייקלט למערכת",
    ]);
    // The LATEST prompt, not a pinned version: the quoted entries have to
    // survive into whatever is actually being sent.
    const prompt = readFileSync(
      path.join(PROMPTS_DIR, "plan_demo_steps", `v${latestPromptVersion("plan_demo_steps")}.md`),
      "utf8",
    );
    for (const entry of [...sharedEntries(11, 12), ...sharedEntries(2, 3)]) {
      expect(prompt, `v11 quotes ${entry}`).toContain(entry);
    }

    expect(overlap(11, 12)).toBeGreaterThanOrEqual(1 / 3);
    expect(overlap(2, 3)).toBeLessThan(1 / 3);
    // And below a majority, which is why v10's wording merged neither pair.
    expect(overlap(11, 12)).toBeLessThan(0.5);
  });

  it("also merges 12/13, the pair that decides where the dialog run ends", () => {
    // The founder's brief named 11/12 AND 12/13 as pairs v10's "most of the
    // entries" failed to merge. 12/13 is the one the prompt has no worked
    // example for, and it is what extends the run past state 12 — so it is
    // pinned here rather than left to be rediscovered.
    expect(sharedEntries(12, 13)).toEqual(["Black Hole", "יעד ניתוב", "חומר קורס"]);
    expect(overlap(12, 13)).toBeGreaterThanOrEqual(1 / 3);
    // Exact matching misses the OCR near-miss v11 tells the model to count.
    expect(timeline[12]!.visibleText).toContain("אישר ניתוב (1)");
    expect(timeline[13]!.visibleText).toContain("אישור ניתוב (1)");
  });

  it("dividing by the SHORTER array is what would merge the two-beat pair", () => {
    // States 2 and 3 are the dashboard and the panel that opens over it: most
    // of the small panel's text is also on the dashboard behind it. The rule
    // has to name its divisor or it swallows every dialog in the timeline.
    const short = Math.min(timeline[2]!.visibleText.length, timeline[3]!.visibleText.length);
    expect(sharedEntries(2, 3).length / short).toBeGreaterThan(0.5);
  });
});

describe("the shipped numbers", () => {
  it("with no app_config row the analysis sample is 200ms, and it follows a_analysis_fps", async () => {
    // Spelled out, not imported: a test that reads the constant cannot notice
    // the constant moving, and this number IS the shipped behaviour — how far
    // before its moment a clip may start is 2s less one of these.
    expect(await analysisSampleMs(db)).toBe(200);

    await db.insert(dbSchema.appConfig).values({ key: "a_analysis_fps", value: 3 });
    // The sample follows the analysis's own fps, floored (1000 / 3 -> 333) so
    // it never passes the next sample on that grid.
    expect(await analysisSampleMs(db)).toBe(333);

    await db.delete(dbSchema.appConfig).where(eq(dbSchema.appConfig.key, "a_analysis_fps"));
    expect(await analysisSampleMs(db)).toBe(200);
  });

  it("an absurd a_analysis_fps leaves a one-millisecond sample, never NaN", async () => {
    await db
      .insert(dbSchema.appConfig)
      .values({ key: "a_analysis_fps", value: 2000 })
      .onConflictDoUpdate({ target: dbSchema.appConfig.key, set: { value: 2000 } });
    try {
      const sampleMs = await analysisSampleMs(db);
      expect(sampleMs).toBe(1);
      expect(recordingEndMs(57_498, [{ timestampMs: 56_400 }], sampleMs)).toBe(57_498);
    } finally {
      await db.delete(dbSchema.appConfig).where(eq(dbSchema.appConfig.key, "a_analysis_fps"));
    }
  });

  it("a step is 2s and a four-word caption reads in exactly that", () => {
    expect(STEP_MS).toBe(2000);
    // The word ceiling is not a second number: it is what can be read in one
    // step. Four words take exactly the step; a fifth outlasts it.
    expect(readTimeMs("אחת שתיים שלוש ארבע")).toBe(STEP_MS);
    expect(readTimeMs("אחת שתיים שלוש ארבע חמש")).toBe(2400);
    expect(readTimeMs("אחת שתיים שלוש ארבע חמש")).toBeGreaterThan(STEP_MS);
    expect(readableWords(STEP_MS)).toBe(MAX_LABEL_WORDS);
    // The wizard's soft warning is the same comparison.
    expect(labelTooLong("אחת שתיים שלוש ארבע", STEP_MS)).toBe(false);
    expect(labelTooLong("אחת שתיים שלוש ארבע חמש", STEP_MS)).toBe(true);
  });

  it("one frame rate: the normalized demo, the footage detector and the render", () => {
    // Clips are placed in demo frames, the instants they are placed around are
    // found on every frame at the detector's rate, and the render lays a step
    // out in composition frames. Three constants in three modules; a clip is
    // exactly 60 frames only while they agree.
    expect(DEMO_FPS).toBe(30);
    expect(SIGNATURE_FPS).toBe(DEMO_FPS);
    // @aiugc/remotion keeps its FPS in schema.ts, which the timing subpath
    // does not re-export: one second through its own conversion is the rate.
    expect(msToFrame(1000)).toBe(DEMO_FPS);
    expect(msToFrame(STEP_MS)).toBe(60);
    // And the same rounding, on and off the frame grid.
    for (const ms of [0, 16, 17, 400, 1033, 4300, 89_582]) {
      expect(demoFrame(ms), `${ms}ms`).toBe(msToFrame(ms));
    }
  });

  it("readTimeMs grows with the label — a 6-word label outlasts a 2-word one", () => {
    expect(readTimeMs("בוחרים מוצר")).toBeLessThan(
      readTimeMs("מתחברים לאפליקציה בוחרים מוצר ומשלמים בהעברה"),
    );
    // 400ms lead + 2.5 words/sec. Spelled out rather than recomputed from the
    // constants: a test that imports the guess cannot catch the guess moving.
    expect(readTimeMs("בוחרים מוצר")).toBe(1200);
    expect(readTimeMs("מתחברים לאפליקציה בוחרים מוצר ומשלמים בהעברה")).toBe(2800);
    // A punctuation-only token (spaced dash) is not a read word — the word
    // ceiling already skips it, so counting it here would make a caption the
    // ceiling accepts read as one word longer than its step.
    expect(readTimeMs("פתחו את התפריט — בחרו פרויקט חדש")).toBe(
      readTimeMs("פתחו את התפריט בחרו פרויקט חדש"),
    );
    expect(readTimeMs("   ")).toBe(400); // no words: the lead alone
  });
});

describe("assembleSteps (a selection as stored steps)", () => {
  it("gives every step its moment's clip, ordered by the moment whatever order the selection arrives in", () => {
    // The client sends steps unsorted (the picker is a grid), and labels as
    // typed. Chronology is a property of the format, not a client convention.
    const timeline: AnalysisState[] = [
      state({ timestampMs: 0, actionType: "navigate" }),
      state({ timestampMs: 2000, actionType: "tap" }),
      state({ timestampMs: 4000, actionType: "type" }),
      state({ timestampMs: 30_000, actionType: "result" }),
    ];
    const steps = assembleSteps(
      [
        { sourceIndex: 2, label: "שלוש" },
        { sourceIndex: 0, label: "  אחת " },
        { sourceIndex: 3, label: "סוף" },
        { sourceIndex: 1, label: "שתיים" },
      ],
      timeline,
      clipsOver(timeline),
    );
    expect(steps).toEqual([
      {
        sourceIndex: 0,
        label: "אחת",
        timestampMs: 0,
        actionType: "navigate",
        startMs: 0,
        durationMs: 2000,
      },
      {
        sourceIndex: 1,
        label: "שתיים",
        timestampMs: 2000,
        actionType: "tap",
        startMs: 2000,
        durationMs: 2000,
      },
      {
        sourceIndex: 2,
        label: "שלוש",
        timestampMs: 4000,
        actionType: "type",
        startMs: 4000,
        durationMs: 2000,
      },
      {
        sourceIndex: 3,
        label: "סוף",
        timestampMs: 30_000,
        actionType: "result",
        startMs: 30_000,
        durationMs: 2000,
      },
    ]);
  });

  it("never refuses and never shortens: the clip is the moment's, whatever sits next to it or on it", () => {
    // The real defect this format grew out of (fixtures/timelines/
    // real-botteacher-file-routing.json): a `type` state 1600ms before the
    // next selected one. A step is no longer cut to the gap — both moments get
    // their full clip here, and the 400ms they share is for findPlanViolations
    // (the model) and updatePlanSteps (the customer) to refuse, before
    // anything is stored.
    const timeline: AnalysisState[] = [
      state({ timestampMs: 10_000, actionType: "type" }),
      state({ timestampMs: 11_600, actionType: "result" }),
    ];
    const steps = assembleSteps(
      [
        { sourceIndex: 0, label: "ממלאים פרטים" },
        // A caption nobody could read in 2s asks for no more of the recording.
        { sourceIndex: 1, label: "אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע עשר" },
      ],
      timeline,
      clipsOver(timeline),
    );
    expect(readTimeMs(steps[1]!.label)).toBe(4400);
    expect(steps.map(stepClip)).toEqual([
      { startMs: 10_000, durationMs: 2000 },
      { startMs: 11_600, durationMs: 2000 },
    ]);
    expect(overlappingPairs(steps.map(stepClip))).toEqual([[0, 1]]);
  });

  it("a kept clip wins over the placed one, and twoPages rides along only when set", () => {
    const timeline: AnalysisState[] = [
      state({ timestampMs: 5000, actionType: "tap" }),
      state({ timestampMs: 10_000, actionType: "type" }),
      state({ timestampMs: 15_000, actionType: "result" }),
    ];
    const placed: PlacedClip[] = [
      { startMs: 4300, calm: true, twoPages: false },
      { startMs: 8800, calm: false, twoPages: true },
      { startMs: 15_000, calm: true, twoPages: false },
    ];
    const selection = [0, 1, 2].map((sourceIndex) => ({ sourceIndex, label: "כיתוב" }));
    // What the footage says about a clip (`calm`) is for choosing it; it is
    // not stored. What the customer must be told before approving is.
    expect(assembleSteps(selection, timeline, placed).map((s) => [s.startMs, s.twoPages])).toEqual([
      [4300, undefined],
      [8800, true],
      [15_000, undefined],
    ]);
    expect(assembleSteps(selection, timeline, placed)[0]).not.toHaveProperty("calm");
    expect(assembleSteps(selection, timeline, placed)[0]).not.toHaveProperty("twoPages");

    // A clip already stored for a moment replaces the placed one whole — its
    // start and its two-page mark both.
    const keep = new Map([
      [0, { startMs: 5000, twoPages: true }],
      [1, { startMs: 10_000 }],
    ]);
    expect(
      assembleSteps(selection, timeline, placed, keep).map((s) => [s.startMs, s.twoPages]),
    ).toEqual([
      [5000, true],
      [10_000, undefined],
      [15_000, undefined],
    ]);
  });
});

describe("the canned DRY_RUN plan", () => {
  it("tops up from the legal pool rather than throwing", async () => {
    // dryRunPlan prefers "high"/non-idle states; findPlanViolations' min-step
    // waiver counts every LEGAL state, "low" and idle included. On mostly-dim
    // footage the quality pool alone lands under the minimum on a timeline the
    // waiver does not forgive, and the keyless path threw — on the very path
    // the whole suite, `aiugc plan regress` and a DRY_RUN worker all run.
    const dim: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["אחת"], actionType: "navigate", legibility: "low" }),
      state({ timestampMs: 3000, visibleText: ["שתיים"], actionType: "tap", legibility: "low" }),
      state({ timestampMs: 6000, visibleText: ["שלוש"], actionType: "type" }),
      state({ timestampMs: 9000, visibleText: ["ארבע"], actionType: "select" }),
      state({ timestampMs: 12_000, visibleText: ["חמש"], actionType: "scroll", legibility: "low" }),
      state({ timestampMs: 15_000, visibleText: ["שש"], actionType: "result" }),
    ];
    const draft = await generateStepPlan(db, {
      timeline: dim,
      questionnaire: QUESTIONNAIRE,
      recordingMs: 19_000,
    });
    // The quality pool holds three states; the legal pool holds six, so the
    // plan tops up instead of dying under the 5-step minimum.
    expect(draft.steps.map((s) => s.sourceIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(draft.steps[draft.steps.length - 1]!.actionType).toBe("result");
  });

  it("obeys the no-shared-footage rule it is validated against", async () => {
    // dryRunPlan is run through the SAME findPlanViolations as a real plan, so
    // a canned plan that trips the rule throws instead of producing a plan —
    // and subsampleClusters always keeps its last element before lastResult is
    // appended, so (final candidate, success screen) is exactly the pair a
    // real recording puts on the same footage.
    const tight: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["פתיחה"], actionType: "navigate" }),
      state({ timestampMs: 4000, visibleText: ["בחירה"], actionType: "tap" }),
      state({ timestampMs: 8000, visibleText: ["הקלדה"], actionType: "type" }),
      state({ timestampMs: 44_600, visibleText: ["שמירה"], actionType: "tap" }),
      state({ timestampMs: 45_000, visibleText: ["נוצר"], actionType: "result" }),
    ];
    const draft = await generateStepPlan(db, {
      timeline: tight,
      questionnaire: QUESTIONNAIRE,
      recordingMs: 49_000,
    });
    // The ending is the one state it cannot lose; the neighbour whose clip
    // would share 1.6s with it is the one dropped.
    expect(draft.steps.map((s) => s.timestampMs)).toEqual([0, 4000, 8000, 45_000]);
    expect(overlappingPairs(draft.steps.map(stepClip))).toEqual([]);
  });
});

describe("isNewScreen — two of three signals (decision 0070)", () => {
  const dashboard = state({
    screenName: "לוח בקרה",
    visibleText: ["הפרויקטים שלי", "פרויקט חדש", "הגדרות"],
    actionType: "navigate",
  });
  const settings = state({
    screenName: "הגדרות חשבון",
    visibleText: ["שם משתמש", "סיסמה", "שמירה"],
    actionType: "navigate",
  });

  it("a popup, a typing run and a scroll stay on the screen; a navigation leaves it", () => {
    // A dialog over the page keeps its name and most of its text.
    const dialog = state({
      screenName: "לוח בקרה",
      visibleText: ["הפרויקטים שלי", "פרויקט חדש", "למחוק את הפרויקט?", "ביטול"],
      actionType: "tap",
    });
    expect(isNewScreen(dashboard, dialog)).toBe(false);
    // Typing grows the text on the same form.
    expect(
      isNewScreen(
        state({ screenName: "הרשמה", visibleText: ["שם מלא", "אימייל"], actionType: "type" }),
        state({
          screenName: "הרשמה",
          visibleText: ["שם מלא", "דנה כהן", "אימייל"],
          actionType: "type",
        }),
      ),
    ).toBe(false);
    // A scroll moves rows off and new ones in, under the same name.
    expect(
      isNewScreen(
        state({
          screenName: "מוצרים",
          visibleText: ["חולצה לבנה", "נעלי ספורט", "מחיר"],
          actionType: "scroll",
        }),
        state({
          screenName: "מוצרים",
          visibleText: ["נעלי ספורט", "כובע קש", "מחיר"],
          actionType: "scroll",
        }),
      ),
    ).toBe(false);
    // All three signals: a navigation, a new name, none of the old text.
    expect(isNewScreen(dashboard, settings)).toBe(true);
  });

  it("one signal alone never cuts, and a duplicate frame never starts a screen", () => {
    // The model called it a navigation, but the name and text are the page's own.
    expect(isNewScreen(dashboard, { ...dashboard })).toBe(false);
    // Everything changed, but the model called the frame a duplicate.
    expect(isNewScreen(dashboard, { ...settings, sameStateAsPrevious: true })).toBe(false);
  });

  it("names a site's pages alike by the text before ' - '", () => {
    const product = state({
      screenName: "tavnit.ai - שם המוצר",
      visibleText: ["שם המוצר", "תיאור"],
      actionType: "tap",
    });
    const pricing = state({
      screenName: "tavnit.ai - תמחור",
      visibleText: ["מחיר", "המשך"],
      actionType: "tap",
    });
    // Same site before the dash: the names agree, so only the text votes.
    expect(isNewScreen(product, pricing)).toBe(false);
    // Another site with the same change of text: the names vote too.
    expect(isNewScreen(product, { ...pricing, screenName: "boteacher.com - תמחור" })).toBe(true);
  });

  it("two frames with no text read are no evidence of a change", () => {
    const blank = state({ screenName: "עורך", visibleText: [], actionType: "scroll" });
    const unread = state({ screenName: "לא ברור", visibleText: [], actionType: "idle" });
    // Renamed, nothing transcribed on either side: only the name votes.
    expect(isNewScreen(blank, unread)).toBe(false);
    // Text appearing on the renamed frame is the second vote.
    expect(isNewScreen(blank, { ...unread, visibleText: ["שמירה"] })).toBe(true);
  });
});

describe("screenEnds — when the analysis's own screen ends (decision 0070)", () => {
  /** The dashboard: a delete dialog opens over it at 800ms, a project name is
   *  typed at 1600ms, the list is scrolled at 2400ms — one screen throughout.
   *  The app navigates to settings at 6000ms. */
  const screens: AnalysisState[] = [
    state({
      timestampMs: 0,
      screenName: "לוח בקרה",
      visibleText: ["הפרויקטים שלי", "פרויקט חדש", "הגדרות"],
      actionType: "navigate",
    }),
    state({
      timestampMs: 800,
      screenName: "לוח בקרה",
      visibleText: ["הפרויקטים שלי", "פרויקט חדש", "למחוק את הפרויקט?", "ביטול"],
      actionType: "tap",
    }),
    state({
      timestampMs: 1600,
      screenName: "לוח בקרה",
      visibleText: ["הפרויקטים שלי", "פרויקט חדש", "קמפיין קיץ"],
      actionType: "type",
    }),
    state({
      timestampMs: 2400,
      screenName: "לוח בקרה",
      visibleText: ["פרויקט חדש", "קמפיין קיץ", "קמפיין חורף"],
      actionType: "scroll",
    }),
    state({
      timestampMs: 6000,
      screenName: "הגדרות חשבון",
      visibleText: ["שם משתמש", "סיסמה", "שמירה"],
      actionType: "navigate",
    }),
  ];

  it("rides through a popup, a typing run and a scroll, and ends one sample after the screen's last state", () => {
    // Not at the dialog (800), the typing (1600) or the scroll (2400), and not
    // where the settings screen's first state sits (6000): one sample after
    // the scroll, the last frame known to show the dashboard. The last screen
    // runs to the recording's end.
    expect(screenEnds(screens, { sampleMs: 200, recordingEndMs: 20_000 })).toEqual([
      2600, 2600, 2600, 2600, 20_000,
    ]);
    expect(screenEnds(screens, { sampleMs: 200, recordingEndMs: 7000 })).toEqual([
      2600, 2600, 2600, 2600, 7000,
    ]);
  });

  it("an end never passes the next screen's first state, whatever today's sample", () => {
    // An analysis made on the 200ms grid, read after a_analysis_fps was
    // lowered to 2 (a 500ms sample): the login screen's end is bounded by the
    // dashboard's first state at 1400, not pushed to 1500 into it.
    const timeline: AnalysisState[] = [
      state({ timestampMs: 0, screenName: "התחברות", visibleText: ["אימייל"], actionType: "idle" }),
      state({
        timestampMs: 1000,
        screenName: "התחברות",
        visibleText: ["אימייל"],
        actionType: "type",
      }),
      state({
        timestampMs: 1400,
        screenName: "לוח בקרה",
        visibleText: ["פרויקטים"],
        actionType: "navigate",
      }),
    ];
    expect(screenEnds(timeline, { sampleMs: 500, recordingEndMs: 2400 })).toEqual([
      1400, 1400, 2400,
    ]);
  });
});

describe("recordingEndMs (where the last step must stop)", () => {
  const last = [{ timestampMs: 88_000 }];

  it("floors the upload's length to the analysis grid", () => {
    // tavnit: demos.duration_ms 89582 -> 89400, the last 200ms sample inside it.
    expect(recordingEndMs(89_582, last, 200)).toBe(89_400);
    expect(recordingEndMs(89_400, last, 200)).toBe(89_400);
    // At 3 fps the grid is 333ms.
    expect(recordingEndMs(10_000, [{ timestampMs: 0 }], 333)).toBe(9990);
  });

  it("falls back to one sample past the last state when the length is unknown", () => {
    expect(recordingEndMs(null, last, 200)).toBe(88_200);
    expect(recordingEndMs(undefined, last, 200)).toBe(88_200);
  });

  it("never ends before one sample past the last state", () => {
    // A length that floors onto the last state itself (88100 -> 88000), or a
    // stored length shorter than the timeline: the last state's cluster still
    // holds a second sample, so that frame exists.
    expect(recordingEndMs(88_100, last, 200)).toBe(88_200);
    expect(recordingEndMs(50_000, last, 200)).toBe(88_200);
  });
});

describe("the tavnit recording's screens (measured)", () => {
  it("ends every state's screen where the code measured it", async () => {
    const fixture = loadFixture("real-tavnit-system-opening.json");
    expect(fixture.recordingMs).toBe(89_582);
    const { sampleMs, recordingEndMs: endMs } = await fixtureClips(fixture);
    expect(endMs).toBe(89_400);
    // [first state, last state, where that screen ends]. The last screen runs
    // to the recording's end, floored to the 200ms grid.
    const runs: [number, number, number][] = [
      [0, 5, 4400],
      [6, 6, 5200],
      [7, 8, 6800],
      [9, 10, 9200],
      [11, 12, 11_200],
      [13, 13, 12_400],
      [14, 17, 17_600],
      [18, 19, 21_600],
      [20, 24, 31_600],
      [25, 30, 45_000],
      [31, 32, 49_200],
      [33, 42, 60_600],
      [43, 44, 66_200],
      [45, 46, 73_600],
      [47, 52, 89_400],
    ];
    const expected = runs.flatMap(([from, to, end]) =>
      Array.from({ length: to - from + 1 }, () => end),
    );
    expect(fixture.timeline).toHaveLength(expected.length);
    expect(screenEnds(fixture.timeline, { sampleMs, recordingEndMs: endMs })).toEqual(expected);
  });
});

describe("every fixture's canned plan: 2s clips, inside the recording, each on its moment", () => {
  it(
    "holds for every step of every fixture, and no two share footage",
    { timeout: 60_000 },
    async () => {
      expect(FIXTURE_FILES.length).toBeGreaterThanOrEqual(5);
      for (const file of FIXTURE_FILES) {
        const fixture = loadFixture(file);
        const { recordingEndMs: endMs } = await fixtureClips(fixture);
        const { steps } = await fixturePlan(fixture);
        expect(steps.length, file).toBeGreaterThanOrEqual(A_STEPS_MIN_DEFAULT);
        expect(steps.length, file).toBeLessThanOrEqual(A_STEPS_MAX_DEFAULT);
        for (const step of steps) {
          const where = `${file} state ${step.sourceIndex}`;
          expect(step.durationMs, where).toBe(2000);
          // Stored, not left for stepClip to default to the moment.
          expect(step.startMs, where).toBeTypeOf("number");
          const startMs = step.startMs!;
          // The clip holds its own moment...
          expect(startMs, where).toBeLessThanOrEqual(step.timestampMs);
          expect(step.timestampMs, where).toBeLessThan(startMs + 2000);
          // ...and all of it is footage the recording has.
          expect(startMs, where).toBeGreaterThanOrEqual(0);
          expect(startMs + 2000, where).toBeLessThanOrEqual(endMs);
        }
        expect(overlappingPairs(steps.map(stepClip)), file).toEqual([]);
      }
    },
  );

  it(
    "an ending inside the recording's last 2s is slid back to end with it",
    { timeout: 60_000 },
    async () => {
      // The one place a clip leaves its moment when no footage instants are
      // known: the campaign-app success screen sits at 18.5s of a 20s recording.
      const fixture = loadFixture("dry-run-campaign-app.json");
      expect(fixture.recordingMs).toBe(20_000);
      expect(fixture.instants).toBeUndefined();
      const { steps } = await fixturePlan(fixture);
      const ending = steps[steps.length - 1]!;
      expect([ending.sourceIndex, ending.timestampMs, ending.startMs]).toEqual([
        11, 18_500, 18_000,
      ]);
      // Every other step of that plan starts at its own moment.
      for (const step of steps.slice(0, -1)) expect(step.startMs).toBe(step.timestampMs);
    },
  );
});

describe("the clip the model is shown is the clip a pick of that state stores", () => {
  it("for every state of every fixture", async () => {
    // The plan pass reads `clipStartMs` off its timeline and the picker shows
    // the same clip; a pick of that state must store exactly it, or the model
    // spaces its selection against clips that are not the ones rendered.
    for (const file of FIXTURE_FILES) {
      const fixture = loadFixture(file);
      const { clips } = await fixtureClips(fixture);
      const shown = planPromptTimeline(fixture.timeline, clips);
      // Every state is offered: each has a full clip, so none is hidden.
      expect(shown.map((entry) => entry.index)).toEqual(fixture.timeline.map((_, i) => i));
      shown.forEach((entry, i) => {
        const where = `${file} state ${i}`;
        const step = assembleSteps(
          [{ sourceIndex: i, label: "כיתוב" }],
          fixture.timeline,
          clips,
        )[0]!;
        expect(stepClip(step), where).toEqual({ startMs: entry.clipStartMs, durationMs: 2000 });
        // `twoPages` rides along only when true, on the entry and on the step.
        expect(entry.twoPages, where).toBe(step.twoPages);
        expect(entry.twoPages === undefined || entry.twoPages === true, where).toBe(true);
        // Without footage instants nothing is known to be calm.
        if (!fixture.instants) expect(entry.calm, where).toBe(false);
      });
    }
  });
});

describe("the render lays the steps out at the length the customer was shown", () => {
  it(
    "every tavnit step at exactly 60 frames, none clamped at the demo's end",
    { timeout: 60_000 },
    async () => {
      // totalRuntimeMs is the steps' length the wizard's plan step
      // (step-plan.tsx) and the confirm screen (stepsShapeSummary) show the
      // customer. The composition re-derives every step's frames from the same
      // stepClip reading the render uses (renders.ts) against the demo's length
      // (serviceAStepsTimeline in packages/remotion), so a clamp at the
      // recording's end or a rounding drift would render a different length
      // from the one they were quoted.
      const fixture = loadFixture("real-tavnit-system-opening.json");
      const { steps } = await fixturePlan(fixture);
      expect(steps).toHaveLength(10);
      expect(totalRuntimeMs(steps)).toBe(20_000);
      // The demo's frames from the upload's own length (demos.duration_ms,
      // 89582ms -> 2687 whole frames) — NOT from the recordingEndMs the clips
      // were placed against, which would only prove placeClips agrees with
      // itself. How many frames the normalized file really decodes to is
      // checked elsewhere, not here.
      const demoFrames = Math.floor((fixture.recordingMs! * 30) / 1000);
      expect(demoFrames).toBe(2687);
      const hookFrames = 120;
      const laid = serviceAStepsTimeline({ hookFrames, demoFrames, steps: steps.map(stepClip) });
      // 30fps (FPS, packages/remotion/src/schema.ts).
      expect(laid.steps.map((s) => s.durationInFrames)).toEqual(steps.map(() => 60));
      const frames = laid.steps.reduce((sum, s) => sum + s.durationInFrames, 0);
      expect(frames).toBe((totalRuntimeMs(steps) * 30) / 1000);
      expect(laid.durationInFrames).toBe(hookFrames + frames);
      // Each step plays from where its clip starts — which is not always its moment.
      expect(laid.steps.map((s) => s.trimBeforeFrames)).toEqual(
        steps.map((s) => msToFrame(s.startMs!)),
      );
      // Back to back, hard cuts, in the stored order.
      expect(laid.steps.map((s) => s.fromFrame)).toEqual(steps.map((_, k) => hookFrames + 60 * k));
    },
  );
});

/**
 * The arithmetic the shipped constants must satisfy together. Every step is
 * one 2s clip, so a plan's length is its step count and nothing else: what has
 * to hold is that every count from the minimum to the maximum is a plan the
 * validator accepts, on the shortest recording that can hold it. Constants
 * that license a shape the validator always rejects fail every plan of that
 * shape — b60b5b6 shipped such a pair, and four live failures in a row
 * followed. Expectations spelled out: a test that recomputes from the
 * constants cannot catch them moving apart.
 */
describe("step-count coherence — every legal step count is a plan the validator accepts", () => {
  it("5 through 10 steps each validate with zero violations and run 2s a step", () => {
    expect(A_STEPS_MIN_DEFAULT).toBe(5);
    expect(A_STEPS_MAX_DEFAULT).toBe(10);

    const words = ["אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע", "עשר"];
    for (let n = A_STEPS_MIN_DEFAULT; n <= A_STEPS_MAX_DEFAULT; n++) {
      // A recording of exactly n x 2s with a moment every 2s, ending on the
      // success: the shortest footage n steps can be cut from — 10s for the
      // minimum, 20s for the maximum.
      const timeline: AnalysisState[] = Array.from({ length: n }, (_, k) =>
        state({
          timestampMs: k * 2000,
          visibleText: [words[k]!],
          actionType: k === n - 1 ? "result" : "tap",
        }),
      );
      const clips = placeClips(timeline, {
        sampleMs: SAMPLE_MS,
        recordingEndMs: n * 2000,
        instants: null,
      });
      // Captions at the ceiling: four words each.
      const steps = Array.from({ length: n }, (_, k) => ({
        sourceIndex: k,
        label: `בוחרים את מסך ${words[k]}`,
      }));
      expect(totalRuntimeMs(assembleSteps(steps, timeline, clips)), `${n} steps`).toBe(n * 2000);
      expect(
        findPlanViolations(steps, timeline, A_STEPS_MAX_DEFAULT, {
          minSteps: A_STEPS_MIN_DEFAULT,
          notes: null,
          clips,
        }),
        `${n} steps`,
      ).toEqual([]);
    }
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
  it("runs green on every shipped fixture", { timeout: 60_000 }, async () => {
    const results = await runPlanRegression(db);
    expect(results.map((r) => r.fixture).sort()).toEqual([...FIXTURE_FILES].sort());
    expect(results.length).toBeGreaterThanOrEqual(5);
    for (const r of results) {
      expect(r.error, r.fixture).toBeUndefined();
      expect(r.pass, r.fixture).toBe(true);
      // Green means the plan's own answer: nothing dropped by the last-round
      // repair and nothing left over from a last call (keyless there is none).
      expect(r.repaired, r.fixture).toBeUndefined();
      // Under DRY_RUN the selection pinned is the canned planner's.
      const pinned = loadFixture(r.fixture).expected.dryRunSourceIndexes;
      expect(pinned, r.fixture).toBeDefined();
      expect(r.actual, r.fixture).toEqual([...pinned!].sort((a, b) => a - b));
    }
  });
});

/**
 * The 8a move: readTimeMs/totalRuntimeMs live in plan-format (client-safe) and
 * demo-step-plans re-exports them. Reference equality — not equal output — is
 * the pin: a drifted private copy would still produce equal output today.
 */
describe("plan-format re-export identity", () => {
  it("the re-exports ARE the plan-format functions, not copies", async () => {
    const planFormat = await import("../src/plan-format");
    expect(readTimeMs).toBe(planFormat.readTimeMs);
    expect(totalRuntimeMs).toBe(planFormat.totalRuntimeMs);
    // The one reading of a stored step: the render and the editor's preview
    // must go through the same function, or they can disagree about a clip.
    expect(stepClip).toBe(planFormat.stepClip);
    // The 0049 move: the tokenizer the editor's marks use is the one the
    // server flagged with — a drifted copy would mark the wrong words.
    expect(normalizeWord).toBe(planFormat.normalizeWord);
    expect(tokenizeWords).toBe(planFormat.tokenizeWords);
    expect(splitWords).toBe(planFormat.splitWords);
  });
});

/**
 * The 8b move: the label word band and the step-count defaults live in
 * plan-format so the wizard's soft warnings share the server's numbers.
 * Value pins; the validator's own use of MAX_LABEL_WORDS is pinned by the
 * "over 4 words" violation test above.
 */
describe("plan-format editor constants (8b move)", () => {
  it("word band and step-count defaults hold their shipped values", async () => {
    const planFormat = await import("../src/plan-format");
    expect(planFormat.MAX_LABEL_WORDS).toBe(4);
    expect(planFormat.MIN_LABEL_WORDS).toBe(3);
    expect(planFormat.A_STEPS_MIN_DEFAULT).toBe(5);
    expect(planFormat.A_STEPS_MAX_DEFAULT).toBe(10);
  });
});
