import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordUsage } from "../src/budget";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { HEAVY_JOB_TYPES, runLane } from "../src/jobs/worker";
import {
  addDemoNote,
  createBusiness,
  MAX_DEMO_NOTES,
  requireQuestionnaire,
  setQuestionnaire,
  type Questionnaire,
} from "../src/pipelines/businesses";
import type { AnalysisState } from "../src/pipelines/demo-analysis";
import {
  approvePlan,
  findPlanViolations,
  getStepPlan,
  planStepsSchema,
  requestDemoPlan,
  runPlanRegression,
  unexplainedMomentsSchema,
  updatePlanSteps,
} from "../src/pipelines/demo-step-plans";
import { createDemo } from "../src/pipelines/demos";
import { setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * Pass 2 of the step-plan format in DRY_RUN: plan generation over the canned
 * analysis, the deterministic anti-fabrication rule, the edit/approve/fork
 * lifecycle, and the fixtures/timelines regression harness.
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
    expect(plan?.notes).toBeNull();

    const steps = planStepsSchema.parse(plan!.steps);
    // The canned analysis: idle/dup/low/unreadable states and the two login
    // states (screenKind skip rule) are skipped.
    expect(steps.map((s) => s.sourceIndex)).toEqual([3, 5, 6, 7, 10, 11]);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.timestampMs).toBeGreaterThan(steps[i - 1]!.timestampMs);
    }
    // The video ends on the success state, label lifted off the screen, no "!".
    const last = steps[steps.length - 1]!;
    expect(last.actionType).toBe("result");
    expect(last.label).toBe("הקמפיין נוצר");
    expect(last.durationMs).toBe(2800);
    // Total runtime: six product steps at the per-action duration defaults.
    // (The 12-17s band is a target for real recordings; the canned journey
    // sits just under it now that its login states are filtered.)
    const total = steps.reduce((ms, s) => ms + s.durationMs, 0);
    expect(total).toBe(11_800);

    const moments = unexplainedMomentsSchema.parse(plan!.unexplainedMoments);
    expect(moments).toHaveLength(1);
    expect(moments[0]!.timestampMs).toBe(11_000);
  });

  it("plan_demo_steps runs on the light lane", () => {
    expect(HEAVY_JOB_TYPES).not.toContain("plan_demo_steps");
  });

  it("regenerating creates a NEW plan row — never mutates the old one", { timeout: 60_000 }, async () => {
    const { planId: second } = await requestDemoPlan(db, demoId);
    expect(second).not.toBe(planId);
    await drainAll();
    expect((await getStepPlan(db, second))?.status).toBe("ready");
    expect((await getStepPlan(db, planId))?.status).toBe("ready");
  });

  it("a regenerate while one is still generating collapses onto the live job", { timeout: 60_000 }, async () => {
    // Every press must not be a fresh paid enqueue: the route's budget gate
    // reads usage that lags the queue, so uncollapsed presses outrun it.
    const first = await requestDemoPlan(db, demoId);
    const second = await requestDemoPlan(db, demoId);
    expect(second.planId).toBe(first.planId);
    expect(second.jobId).toBe(first.jobId);
    await drainAll();
    expect((await getStepPlan(db, first.planId))?.status).toBe("ready");
  });

  it("the job-level account-cap backstop fails a queued plan fast, in Hebrew", { timeout: 60_000 }, async () => {
    // A customer (not admin-bypassed) account at its 0027 llm_tokens ceiling:
    // the queued job must die as a fast PermanentError — never park, never
    // spend — even though it was enqueued before the cap was hit.
    const customer = await createBusiness(db, { ownerEmail: "capped@example.com", name: "עסק שמור" });
    await setQuestionnaire(db, customer.id, QUESTIONNAIRE);
    const demo = await createDemo(db, { businessId: customer.id, filePath: tempFile("capped.mp4") });
    await drainAll(); // ingest -> analysis ready

    await recordUsage(db, {
      provider: "anthropic",
      kind: "llm_tokens",
      quantity: 500_000,
      businessId: customer.id,
    });

    const { planId: cappedPlanId } = await requestDemoPlan(db, demo.id);
    await drainAll();
    const plan = await getStepPlan(db, cappedPlanId);
    expect(plan?.status).toBe("failed");
    expect(plan?.failReason).toMatch(/מכסת/);
  });
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
    expect(steps[0]!.timestampMs).toBe(1500);
    expect(steps[0]!.actionType).toBe("navigate");
    expect(steps[0]!.durationMs).toBe(1800); // derived, not client-supplied
    expect(steps[1]!.durationMs).toBe(2800);
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
    // State 9 of the canned timeline is unreadable — the server mirrors the
    // picker's filter regardless of who selected it.
    await expect(
      updatePlanSteps(db, { planId, steps: [{ sourceIndex: 9, label: "לא קריא" }] }),
    ).rejects.toThrow(/unreadable/);
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

describe("findPlanViolations (the anti-fabrication rule, deterministic)", () => {
  const timeline: AnalysisState[] = [
    state({ timestampMs: 0, visibleText: ["פרויקט חדש", "שמירה"] }),
    state({ timestampMs: 1000, visibleText: ["הקמפיין נוצר!"], actionType: "result" }),
    state({ timestampMs: 2000, visibleText: [], legibility: "unreadable" }),
  ];

  it("accepts labels lifted from the screen or the questionnaire", () => {
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "פרויקט חדש" },
          { sourceIndex: 1, label: "הקמפיין נוצר" }, // punctuation-insensitive
        ],
        timeline,
        QUESTIONNAIRE,
        8,
      ),
    ).toEqual([]);
    // Questionnaire words are allowed on any step.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "קמפיינר מהיר" }], timeline, QUESTIONNAIRE, 8),
    ).toEqual([]);
  });

  it("absorbs single-letter Hebrew prefixes on either side", () => {
    // Label adds a prefix the screen lacks...
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "בפרויקט" }], timeline, QUESTIONNAIRE, 8),
    ).toEqual([]);
    // ...and the screen carries a prefix the label lacks ("הקמפיין" -> "קמפיין").
    expect(
      findPlanViolations([{ sourceIndex: 1, label: "קמפיין" }], timeline, QUESTIONNAIRE, 8),
    ).toEqual([]);
  });

  it("absorbs prefixed function words instead of flagging them as fabricated", () => {
    // Hebrew glues ו/ש onto function words; "וגם"/"שכבר" must not cost a paid
    // corrective re-request.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "וגם שמירה" }], timeline, QUESTIONNAIRE, 8),
    ).toEqual([]);
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "שכבר שמירה" }], timeline, QUESTIONNAIRE, 8),
    ).toEqual([]);
  });

  it("shape rules: model plans must end on the result state and explain under-min counts", () => {
    // Ends mid-journey while a selectable result state exists -> violation.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "שמירה" }], timeline, QUESTIONNAIRE, 8, {
        minSteps: 1,
        notes: null,
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
        QUESTIONNAIRE,
        8,
        { minSteps: 1, notes: null },
      ),
    ).toEqual([]);
    // Ends mid-journey but `notes` explains (the timeline's only "result"
    // states may be mistyped error screens) -> the notes waive the rule.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "שמירה" }], timeline, QUESTIONNAIRE, 8, {
        minSteps: 1,
        notes: "אין בהקלטה מסך סיום ברור",
      }),
    ).toEqual([]);
    // No selectable result in the timeline -> the rule cannot apply.
    expect(
      findPlanViolations(
        [{ sourceIndex: 0, label: "שמירה" }],
        [state({ timestampMs: 0, visibleText: ["שמירה"] })],
        QUESTIONNAIRE,
        8,
        { minSteps: 1, notes: null },
      ),
    ).toEqual([]);
    // Under the minimum: silent -> violation; explained in notes -> allowed.
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "שמירה" },
          { sourceIndex: 1, label: "נוצר" },
        ],
        timeline,
        QUESTIONNAIRE,
        8,
        { minSteps: 6, notes: null },
      ).some((v) => v.includes("fewer than the minimum")),
    ).toBe(true);
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "שמירה" },
          { sourceIndex: 1, label: "נוצר" },
        ],
        timeline,
        QUESTIONNAIRE,
        8,
        { minSteps: 6, notes: "יש רק שני מסכים מובחנים" },
      ),
    ).toEqual([]);
  });

  it("pools visibleText across a sameStateAsPrevious run (real BotTeacher state 36)", () => {
    // Exact strings from demo ba70c3d7 / analysis 6a1b247e: the anchor frame's
    // OCR clipped "נשלים" to "נשלי"; the dup frames of the SAME screen read it
    // fully. The label must match against the whole run, not the anchor alone.
    const run: AnalysisState[] = [
      state({
        timestampMs: 54_600,
        visibleText: ["עוד רגע לפני שמתחילים – בואו נשלי", "הפרטים האקדמיים קובעים איך נתאים לך את המערכת. אפשר לשנות ב", "Mohamed Taha", "סוג תואר"],
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
    // The word the anchor clipped, found on the dups: no violation.
    expect(findPlanViolations([{ sourceIndex: 0, label: "בואו נשלים" }], run, QUESTIONNAIRE, 8)).toEqual([]);
    // A word absent from the entire run still fails — pooling adds no slack.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "חוויה" }], run, QUESTIONNAIRE, 8).some((v) =>
        v.includes("חוויה"),
      ),
    ).toBe(true);
  });

  it("keeps the מלאה true positive (real BotTeacher state 72)", () => {
    // State 72's run is itself alone; the screen says "מבחן מלא", never "מלאה".
    const tourState = state({
      timestampMs: 109_800,
      visibleText: ["boteacher", "BRONZE · עוזר אקדמי אישי", "6/11", "מכונת המבחנים", "סימולציה של מבחן מלא על חומר הקורס, עם ציון בסוף – כדי", "שתגיע למבחן האמיתי בלי חן", "המשך", "חזור", "דלג על הכל"],
      actionType: "navigate",
    });
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "סימולציה מלאה" }], [tourState], QUESTIONNAIRE, 8).some(
        (v) => v.includes("מלאה"),
      ),
    ).toBe(true);
    // Words genuinely on that screen pass, including across the · separator.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "מכונת המבחנים" }], [tourState], QUESTIONNAIRE, 8),
    ).toEqual([]);
  });

  it("normalizes gershayim, glued separators and niqqud on both sides", () => {
    const noisy: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ['הלו"ז שלי', "BRONZE·עוזר אקדמי", "שָׁלוֹם"] }),
    ];
    // Hebrew gershayim (U+05F4) in the label vs ASCII quote on screen.
    expect(findPlanViolations([{ sourceIndex: 0, label: "לו״ז" }], noisy, QUESTIONNAIRE, 8)).toEqual([]);
    // The OCR glued a · onto the word; whitespace splitting left it stuck.
    expect(findPlanViolations([{ sourceIndex: 0, label: "עוזר" }], noisy, QUESTIONNAIRE, 8)).toEqual([]);
    // Screen carries niqqud, the label does not.
    expect(findPlanViolations([{ sourceIndex: 0, label: "שלום" }], noisy, QUESTIONNAIRE, 8)).toEqual([]);
  });

  it("words from demo_notes are allowed label words — an explained moment becomes copy", () => {
    // Not on state 0's screen and not elsewhere in the questionnaire...
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "תבניות מוכנות" }], timeline, QUESTIONNAIRE, 8)
        .length,
    ).toBeGreaterThan(0);
    // ...but once the customer's answer carries them, the label passes.
    const explained = { ...QUESTIONNAIRE, demo_notes: ["מסך בחירת תבניות מוכנות"] };
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "תבניות מוכנות" }], timeline, explained, 8),
    ).toEqual([]);
  });

  it("allows function words but flags fabricated content words", () => {
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "רק פרויקט חדש" }], timeline, QUESTIONNAIRE, 8),
    ).toEqual([]);
    const violations = findPlanViolations(
      [{ sourceIndex: 0, label: "חוויה מדהימה" }],
      timeline,
      QUESTIONNAIRE,
      8,
    );
    expect(violations.some((v) => v.includes("חוויה"))).toBe(true);
    expect(violations.some((v) => v.includes("מדהימה"))).toBe(true);
  });

  it("flags skip-kind screens for the model, treats absent screenKind as no information", () => {
    const kinds: AnalysisState[] = [
      state({ timestampMs: 0, visibleText: ["התחברות"], screenKind: "login" }),
      state({ timestampMs: 1000, visibleText: ["דף הבית"], screenKind: "product" }),
      state({ timestampMs: 2000, visibleText: ["שגיאה"], actionType: "result", screenKind: "error" }),
      state({ timestampMs: 3000, visibleText: ["נשמר"] }), // v2-era: no screenKind
    ];
    // Login screens are never steps for the model.
    expect(
      findPlanViolations([{ sourceIndex: 0, label: "התחברות" }], kinds, QUESTIONNAIRE, 8).some(
        (v) => v.includes('"login"'),
      ),
    ).toBe(true);
    // product and absent screenKind both pass.
    expect(
      findPlanViolations([{ sourceIndex: 1, label: "דף הבית" }], kinds, QUESTIONNAIRE, 8),
    ).toEqual([]);
    expect(
      findPlanViolations([{ sourceIndex: 3, label: "נשמר" }], kinds, QUESTIONNAIRE, 8),
    ).toEqual([]);
    // The only "result" is an error screen the analysis mistyped — the shape
    // rule must not force the plan to end on a state it may never select.
    expect(
      findPlanViolations([{ sourceIndex: 1, label: "דף הבית" }], kinds, QUESTIONNAIRE, 8, {
        minSteps: 1,
        notes: null,
      }),
    ).toEqual([]);
  });

  it("flags structural violations: unreadable states, dups, range, word count, step count", () => {
    expect(
      findPlanViolations([{ sourceIndex: 2, label: "שמירה" }], timeline, QUESTIONNAIRE, 8).some(
        (v) => v.includes("unreadable"),
      ),
    ).toBe(true);
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "שמירה" },
          { sourceIndex: 0, label: "שמירה" },
        ],
        timeline,
        QUESTIONNAIRE,
        8,
      ).some((v) => v.includes("twice")),
    ).toBe(true);
    expect(
      findPlanViolations([{ sourceIndex: 9, label: "שמירה" }], timeline, QUESTIONNAIRE, 8).some(
        (v) => v.includes("not in the timeline"),
      ),
    ).toBe(true);
    expect(
      findPlanViolations(
        [{ sourceIndex: 0, label: "פרויקט חדש שמירה פרויקט חדש" }],
        timeline,
        QUESTIONNAIRE,
        8,
      ).some((v) => v.includes("over 4 words")),
    ).toBe(true);
    expect(
      findPlanViolations(
        [
          { sourceIndex: 0, label: "שמירה" },
          { sourceIndex: 1, label: "נוצר" },
        ],
        timeline,
        QUESTIONNAIRE,
        1,
      ).some((v) => v.includes("maximum is 1")),
    ).toBe(true);
    expect(findPlanViolations([], timeline, QUESTIONNAIRE, 8)).toEqual(["the plan has zero steps"]);
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
  it("runs green on the shipped fixture", { timeout: 60_000 }, async () => {
    const results = await runPlanRegression(db);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const shipped = results.find((r) => r.fixture === "dry-run-campaign-app.json");
    expect(shipped).toBeDefined();
    expect(shipped!.error).toBeUndefined();
    expect(shipped!.pass).toBe(true);
    for (const r of results) expect(r.pass).toBe(true);
  });
});
