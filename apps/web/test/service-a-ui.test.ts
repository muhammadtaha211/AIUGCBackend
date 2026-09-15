import { describe, expect, it } from "vitest";
import { readTimeMs } from "@aiugc/core/plan-format";
import {
  addWarning,
  analysisBackgroundLine,
  analysisIndexBatches,
  analysisWaitView,
  aRenderStageIndex,
  aWizardSteps,
  clampRestoredStep,
  clientDemoAspectError,
  clientDemoFileError,
  deleteWarning,
  demoDurationError,
  DUPLICATE_DURATION_TOLERANCE_MS,
  duplicateDemoMatch,
  fmtElapsedHe,
  ingestPhaseView,
  ingestStuckView,
  clipWindow,
  draftBlockedReason,
  endingForRemainder,
  endingSentence,
  estimatedEnding,
  estimateVoSeconds,
  hookHalfOptions,
  identityFromSearch,
  identitySearch,
  insertDraftStep,
  inventorySections,
  isSkippedScreenKind,
  isActiveARenderStatus,
  isActivePlanStatus,
  isAnalysisWorkingStatus,
  isIngestingDemoStatus,
  labelRuns,
  labelWordCount,
  labelWordWarning,
  marksAfterEdit,
  pickerPools,
  pinnedPlanFrom,
  planFailureNotice,
  planWaitView,
  renderCompositionKey,
  renderWaitView,
  planStepsDirty,
  restoredDemo,
  retryableCreateFailure,
  retryOutcome,
  sameSpeakerGender,
  shapeSummary,
  shouldSyncIdentity,
  sortedPlanSteps,
  stepHeadroomMs,
  stepsBalanceLine,
  stepsConfirmLabel,
  stepsPayload,
  stepsShapeSummary,
  type AnalysisStateWire,
  type HookBatch,
  type HookLineOption,
  type JobProgressWire,
  type PlanStepWire,
  type ReadyDemoDuration,
} from "../src/lib/service-a-ui";

describe("wizard steps (format-aware, mirrors B's wizardSteps)", () => {
  it("steps format: six steps, persona-first, no script, no audio", () => {
    // The persona comes before the gallery because the hook bank is a
    // persona × clip matrix — the gallery is one persona's column.
    expect(aWizardSteps("steps")).toEqual([
      "persona",
      "hook",
      "hookStudio",
      "demo",
      "plan",
      "render",
    ]);
  });

  it("full format keeps the voiced seven-step path (CLI-only today)", () => {
    expect(aWizardSteps("full")).toEqual([
      "persona",
      "hook",
      "hookStudio",
      "demo",
      "script",
      "audio",
      "render",
    ]);
  });
});

describe("durable identity (?demo=&step=)", () => {
  const STEPS = aWizardSteps("steps");
  const DEMO = "9553ea19-7313-46db-9214-4011e4bdee34";

  it("round-trips demo id and step index through the search string", () => {
    const search = identitySearch(DEMO, 3);
    expect(search).toBe(`?demo=${DEMO}&step=3`);
    expect(identityFromSearch(search, STEPS.length)).toEqual({ demoId: DEMO, step: 3 });
  });

  it("serializes nothing when there is nothing worth persisting", () => {
    expect(identitySearch(null, 0)).toBe("");
  });

  it("degrades malformed input to a fresh wizard instead of trusting it", () => {
    expect(identityFromSearch("?demo=not-a-uuid&step=3", STEPS.length).demoId).toBeNull();
    expect(identityFromSearch(`?demo=${DEMO}&step=99`, STEPS.length).step).toBe(0);
    expect(identityFromSearch(`?demo=${DEMO}&step=-1`, STEPS.length).step).toBe(0);
    expect(identityFromSearch("", STEPS.length)).toEqual({ demoId: null, step: 0 });
  });

  it("clamps a restored step to what the surviving state can support", () => {
    const ready = { status: "ready" };
    // With a READY demo the plan step is restorable; render never is — it is
    // reachable only through continue, with the pinned plan in hand.
    expect(clampRestoredStep(STEPS.indexOf("render"), STEPS, ready)).toBe(STEPS.indexOf("plan"));
    expect(clampRestoredStep(STEPS.indexOf("plan"), STEPS, ready)).toBe(STEPS.indexOf("plan"));
    expect(clampRestoredStep(STEPS.indexOf("demo"), STEPS, ready)).toBe(STEPS.indexOf("demo"));
  });

  /**
   * A mid-ingest demo lands on the DEMO step, never the plan step: the demo
   * step owns ingest polling and rejection, while the plan step would promise
   * an analysis that a later ingest rejection guarantees never comes.
   */
  it("routes a not-ready demo to the demo step, not the plan step", () => {
    for (const status of ["uploaded", "probing", "normalizing"]) {
      expect(clampRestoredStep(STEPS.indexOf("plan"), STEPS, { status })).toBe(
        STEPS.indexOf("demo"),
      );
    }
  });

  /**
   * The gallery needs the session-local persona (it lists that persona's
   * column of the hook matrix) and hookStudio needs the session-local hook —
   * no reload can restore either, so ?step=1 and ?step=2 must land on the
   * persona step, not on a step card that renders nothing (below lg the rail
   * has no jump buttons, so a blank card is a dead end).
   */
  it("reroutes a restored hook or hookStudio index to the persona step", () => {
    const ready = { status: "ready" };
    expect(STEPS.indexOf("hook")).toBe(1);
    expect(STEPS.indexOf("hookStudio")).toBe(2);
    expect(clampRestoredStep(1, STEPS, ready)).toBe(STEPS.indexOf("persona"));
    expect(clampRestoredStep(2, STEPS, ready)).toBe(STEPS.indexOf("persona"));
  });

  it("without a demo everything clamps to the persona step", () => {
    // Persona and hook are both session-local: with no demo either, nothing
    // past the first step has any state to stand on.
    for (let index = 0; index < STEPS.length; index += 1) {
      expect(clampRestoredStep(index, STEPS, null)).toBe(STEPS.indexOf("persona"));
    }
  });

  /**
   * A TRANSIENT restore failure must not let the URL-sync replaceState the
   * durable link away — a reload is the retry. The hold releases the moment
   * the customer actually moves.
   */
  it("holds the URL after a transient restore failure until the customer moves", () => {
    const failed = { restoring: false, restoreFailed: true, demoId: null, step: 0 };
    expect(shouldSyncIdentity(failed)).toBe(false);
    expect(shouldSyncIdentity({ ...failed, demoId: DEMO })).toBe(true);
    expect(shouldSyncIdentity({ ...failed, step: 1 })).toBe(true);
    expect(shouldSyncIdentity({ ...failed, restoreFailed: false })).toBe(true);
    expect(
      shouldSyncIdentity({ restoring: true, restoreFailed: false, demoId: DEMO, step: 3 }),
    ).toBe(false);
  });

  /**
   * The risk case the URL identity creates: an account with TWO businesses
   * carries ?demo= across the sidebar switch. requireUser + requireBusiness
   * both pass (same user), so the business scope check here is the only thing
   * stopping business A's demo being edited under business B's chrome.
   */
  it("refuses a demo owned by a different business than the wizard's", () => {
    const body = { status: "ready", businessId: "biz-a", durationMs: 88089 };
    expect(restoredDemo(DEMO, body, "biz-b")).toBeNull();
    expect(restoredDemo(DEMO, body, "biz-a")).toEqual({
      demo: { id: DEMO, status: "ready", durationMs: 88089, thumbUrl: undefined },
      description: "",
    });
  });

  /**
   * The stored footage note rides along on restore. Without it, restore +
   * back-to-demo + continue PATCHes "" over the saved note ("blank clears").
   */
  it("carries the stored description so continue cannot blank-clear it", () => {
    const body = { status: "ready", businessId: "biz-a", description: "גלילה בתפריט" };
    expect(restoredDemo(DEMO, body, "biz-a")?.description).toBe("גלילה בתפריט");
  });

  it("refuses a body with no businessId at all (old server, no scope proof)", () => {
    expect(restoredDemo(DEMO, { status: "ready" }, "biz-a")).toBeNull();
  });

  it("does not resume a rejected demo — the demo step starts over", () => {
    expect(restoredDemo(DEMO, { status: "rejected", businessId: "biz-a" }, "biz-a")).toBeNull();
  });
});

describe("plan surface helpers", () => {
  it("pending/planning are the in-flight window (poll on, retry off)", () => {
    expect(isActivePlanStatus("pending")).toBe(true);
    expect(isActivePlanStatus("planning")).toBe(true);
    expect(isActivePlanStatus("ready")).toBe(false);
    expect(isActivePlanStatus("failed")).toBe(false);
  });

  /**
   * The pg enum spells it "analysing" (British). The American spelling once
   * shipped here and deactivated the analysis poll mid-run — the customer sat
   * on a blank card with no spinner until they left and re-entered the step.
   */
  it("analysis working statuses match the stored enum spelling exactly", () => {
    expect(isAnalysisWorkingStatus("pending")).toBe(true);
    expect(isAnalysisWorkingStatus("analysing")).toBe(true);
    expect(isAnalysisWorkingStatus("analyzing")).toBe(false); // not a DB value
    expect(isAnalysisWorkingStatus("ready")).toBe(false);
    expect(isAnalysisWorkingStatus("failed")).toBe(false);
    expect(isAnalysisWorkingStatus("rejected")).toBe(false);
  });

  /**
   * a_steps_max is a config knob: a plan can outgrow the route's 12-index cap,
   * and one oversized ?indexes= request would 400 on every retry. Chunking is
   * the client's job.
   */
  it("splits a plan's sourceIndexes into route-sized batches, deduped", () => {
    expect(analysisIndexBatches([3, 17, 3, 29])).toEqual([[3, 17, 29]]);
    const thirteen = Array.from({ length: 13 }, (_, i) => i * 2);
    const batches = analysisIndexBatches(thirteen);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(12);
    expect(batches[1]).toEqual([24]);
    expect(analysisIndexBatches([])).toEqual([]);
  });

  it("clipWindow: stored duration plays as-is, zero falls back to the render floor", () => {
    // A saved step previews exactly its assembled window; a draft-added step
    // or raw inventory state (durationMs 0) previews the 3s floor every
    // unsqueezed step actually renders.
    expect(clipWindow(12_000, 3400)).toEqual({ startMs: 12_000, endMs: 15_400 });
    expect(clipWindow(9000, 0)).toEqual({ startMs: 9000, endMs: 12_000 });
  });

  it("Hebrew failReason passes through untouched, with no raw leftover", () => {
    const notice = planFailureNotice("יצירת התוכנית נכשלה — נסו שוב");
    expect(notice.message).toBe("יצירת התוכנית נכשלה — נסו שוב");
    expect(notice.raw).toBeUndefined();
  });

  it("a raw English failReason shows the Hebrew generic and keeps the string", () => {
    const notice = planFailureNotice("demo 9553ea19 not found");
    expect(notice.message).toMatch(/[֐-׿]/);
    expect(notice.message).not.toContain("9553ea19");
    expect(notice.raw).toBe("demo 9553ea19 not found");
  });

  /**
   * The plan JOB re-checks the account cap at execution and stores this exact
   * Hebrew as fail_reason (packages/core/src/pipelines/demo-step-plans.ts,
   * the AccountBudgetError catch). It is the one plan failure a retry cannot
   * fix, so the card must not offer one. If this string is reworded, this
   * test goes red BEFORE the lying button ships.
   */
  it("a quota fail_reason is shown verbatim and marked not retryable", () => {
    const stored = "הגעתם למכסת יצירת התוכן היומית של החשבון — נסו שוב מחר.";
    const notice = planFailureNotice(stored);
    expect(notice.message).toBe(stored);
    expect(notice.retryable).toBe(false);
  });

  it("the GPU and TTS quota lines are equally not retryable", () => {
    for (const line of [
      "הגעתם למכסת יצירת הסרטונים היומית של החשבון — נסו שוב מחר.",
      "הגעתם למכסת ההקלטות היומית של החשבון — נסו שוב מחר.",
    ]) {
      expect(planFailureNotice(line).retryable).toBe(false);
    }
  });

  it("an ordinary validator failure stays retryable", () => {
    expect(planFailureNotice("יצירת תוכנית הצעדים נכשלה — נסו שוב").retryable).toBe(true);
    expect(planFailureNotice("demo 9553ea19 not found").retryable).toBe(true);
    expect(planFailureNotice(undefined).retryable).toBe(true);
  });

  /**
   * fail_kind (0029) is the structured signal; the Hebrew substring above is
   * only the fallback for rows from before the column existed. With a kind
   * present the wording of fail_reason decides NOTHING — the reworded-quota
   * hazard the substring guard could never actually protect against
   * (docs/vault/defects/quota-marker-test-does-not-protect-it.md).
   */
  it("failKind decides retryability over the wording when present", () => {
    // A reworded quota line with the marker gone: kind still kills the button.
    expect(planFailureNotice("חרגתם מהמכסה היומית.", "quota").retryable).toBe(false);
    // A validator line that happens to contain the marker: kind keeps it.
    expect(planFailureNotice("משהו נכשל — נסו שוב מחר אולי", "validator").retryable).toBe(true);
    expect(planFailureNotice("יצירת תוכנית הצעדים נכשלה — נסו שוב", "transient").retryable).toBe(
      true,
    );
  });

  it("no failReason at all still yields the Hebrew generic", () => {
    const notice = planFailureNotice(undefined);
    expect(notice.message).toMatch(/[֐-׿]/);
    expect(notice.raw).toBeUndefined();
  });

  /**
   * requestDemoPlan returns the SAME planId when it collapses onto the
   * in-flight job — the response shape is identical to a fresh create, so
   * planId comparison is the only signal, and it must render as "already
   * running", never as a silent nothing.
   */
  it("same planId back means the retry collapsed onto the in-flight job", () => {
    expect(retryOutcome("plan-1", { planId: "plan-1" })).toBe("already_running");
    expect(retryOutcome("plan-1", { planId: "plan-2" })).toBe("started");
    expect(retryOutcome(null, { planId: "plan-1" })).toBe("started");
  });

  /**
   * Pins that the surface uses the SHIPPED readTimeMs, not a client-side copy:
   * 3 words at 2.5 w/s + 400ms lead = 1600ms. If plan-format's formula moves,
   * this number moves with it and the assertion still holds; a private copy
   * would freeze it and this test would catch the drift.
   */
  it("read-time headroom = assembled duration minus the shipped readTimeMs", () => {
    const step = { label: "פותחים את האפליקציה", durationMs: 2000 };
    expect(stepHeadroomMs(step)).toBe(2000 - readTimeMs(step.label));
    // A caption on screen for less than its read time goes negative.
    expect(stepHeadroomMs({ label: "אחת שתיים שלוש", durationMs: 1400 })).toBe(1400 - 1600);
  });

  it("display order derives from timestamp, nothing else", () => {
    const steps = [
      { timestampMs: 9000, actionType: "result", label: "ג", sourceIndex: 40, durationMs: 2000 },
      { timestampMs: 1000, actionType: "tap", label: "א", sourceIndex: 3, durationMs: 2000 },
      { timestampMs: 5000, actionType: "scroll", label: "ב", sourceIndex: 17, durationMs: 2000 },
    ];
    expect(sortedPlanSteps(steps).map((s) => s.label)).toEqual(["א", "ב", "ג"]);
    // And the input array is not mutated.
    expect(steps[0]!.label).toBe("ג");
  });
});

describe("VO length estimate (inverted word-budget mapping)", () => {
  // 20s demo at 2.2 w/s -> budget 44: implied wps = 44/20 = 2.2 exactly.
  it("recovers the seconds from the word count via the stored budget", () => {
    expect(estimateVoSeconds(44, 20, 44)).toBeCloseTo(20);
    expect(estimateVoSeconds(55, 20, 44)).toBeCloseTo(25);
    expect(estimateVoSeconds(22, 20, 44)).toBeCloseTo(10);
  });

  it("degrades to 0 on impossible inputs instead of dividing by zero", () => {
    expect(estimateVoSeconds(30, 20, 0)).toBe(0);
    expect(estimateVoSeconds(30, 0, 44)).toBe(0);
  });

  it("script fits the demo -> the ending is none", () => {
    expect(estimatedEnding(40, 20, 44)).toBe("none");
    expect(estimatedEnding(44, 20, 44)).toBe("none");
  });

  it("rounded estimate equals the rounded demo length -> still none", () => {
    // 45 words -> ~20.45s on a 20s demo: over by raw remainder, but both
    // display as 20 — the prose must never contradict the numbers beside it.
    expect(estimatedEnding(45, 20, 44)).toBe("none");
  });

  it("small overrun points at a freeze, large at an avatar ending", () => {
    // 47 words -> ~21.4s on a 20s demo: remainder < 2s.
    expect(estimatedEnding(47, 20, 44)).toBe("freeze");
    // 55 words -> ~25s on a 20s demo: remainder >= 2s.
    expect(estimatedEnding(55, 20, 44)).toBe("avatar");
  });

  it("degrades to null on impossible inputs (no budget yet)", () => {
    expect(estimatedEnding(30, 20, 0)).toBeNull();
    expect(estimatedEnding(0, 20, 44)).toBeNull();
  });

  /**
   * The budget is the length that FILLS the demo, so falling under it is the
   * failure — the demo is muted beneath the voiceover and nothing downstream
   * can fill the gap. It must never share a state with "ends together".
   */
  it("a narration ending well before the demo is its own state, not none", () => {
    // 30 words -> ~13.6s on a 20s demo: 6.4s of the ad would play in silence.
    expect(estimatedEnding(30, 20, 44)).toBe("short");
    // 54 words against a budget of 90 on a 29.5s demo — the shape that shipped
    // a 4.38s silent tail, and read as "ends together with the video".
    expect(estimatedEnding(54, 29.5, 90)).toBe("short");
  });

  it("tolerates a shortfall too small to hear before saying so", () => {
    // 40 words -> ~18.2s on a 20s demo: 1.8s under, inside the tolerance.
    expect(estimatedEnding(40, 20, 44)).toBe("none");
    // 39 words -> ~17.7s: 2.3s under, past it.
    expect(estimatedEnding(39, 20, 44)).toBe("short");
  });
});

describe("ending threshold (mirrors planAOutro's a_outro_min_seconds default)", () => {
  it("maps a positive remainder onto the three endings", () => {
    expect(endingForRemainder(0)).toBe("none");
    expect(endingForRemainder(1.9)).toBe("freeze");
    expect(endingForRemainder(2)).toBe("avatar");
    expect(endingForRemainder(8)).toBe("avatar");
  });

  /**
   * The audio step reads the MEASURED recording through this. A recording that
   * ends early reported "none" — the same value as a perfect fit — which is how
   * a render with a 4.38s silent tail was approved without anyone being told.
   */
  it("a recording that ends well before the demo is short, not none", () => {
    expect(endingForRemainder(-4.38)).toBe("short");
    expect(endingForRemainder(-2.1)).toBe("short");
    expect(endingForRemainder(-1.9)).toBe("none"); // inside the tolerance
  });
});

describe("ending sentence (script step: estimate; audio step: exact)", () => {
  it("estimates are framed as such (בערך)", () => {
    for (const mode of ["none", "freeze", "avatar"] as const) {
      expect(endingSentence(mode, false)).toContain("בערך");
    }
  });

  it("names the right ending in both framings", () => {
    for (const exact of [false, true]) {
      expect(endingSentence("freeze", exact)).toContain("הפריים האחרון");
      expect(endingSentence("avatar", exact)).toContain("הדמות");
      expect(endingSentence("none", exact)).toContain("יחד עם סרטון המוצר");
    }
  });

  it("exact sentences speak about the recording, not an estimate", () => {
    for (const mode of ["none", "freeze", "avatar"] as const) {
      expect(endingSentence(mode, true)).toContain("ההקלטה");
      expect(endingSentence(mode, true)).not.toContain("בערך");
    }
  });

  it("the short state names the silence, and never calls the script wrong", () => {
    for (const exact of [false, true]) {
      const text = endingSentence("short", exact);
      expect(text).toContain("בלי קול");
      expect(text).toContain("לפני סרטון המוצר");
      expect(text).not.toContain("קצר מדי"); // no verdict on the script itself
      // Inform, never restrict: name the gap AND the one thing that closes it.
      expect(text).toContain("תסריט ארוך יותר");
    }
  });

  it("the short state forks estimate/measured like every other mode", () => {
    expect(endingSentence("short", false)).toContain("לפי האורך הנוכחי");
    expect(endingSentence("short", true)).toContain("ההקלטה");
    expect(endingSentence("short", true)).not.toContain("לפי האורך הנוכחי");
  });

  /**
   * The customer meets the ending three steps before its price. The estimate
   * says an avatar ending costs extra; the figure appears once, in
   * shapeSummary, after the recording makes it exact.
   */
  it("the estimated avatar ending says it costs extra, with no figure", () => {
    const text = endingSentence("avatar", false);
    expect(text).toContain("תוספת");
    expect(text).not.toMatch(/\d/);
  });

  it("the estimated avatar ending names its projected length when given one", () => {
    const text = endingSentence("avatar", false, 6);
    expect(text).toContain("בערך 6 שניות");
    expect(text).toContain("תוספת");
    // The seconds are the ONLY number — the credit figure still waits for shapeSummary.
    expect(text.match(/\d+/g)).toEqual(["6"]);
  });

  it("the exact avatar sentence carries no cost clause — shapeSummary owns it", () => {
    expect(endingSentence("avatar", true)).not.toContain("תוספת");
  });
});

describe("client demo pre-checks", () => {
  it("mirrors the server rules", () => {
    expect(clientDemoFileError({ type: "video/mp4", size: 1000 })).toBeNull();
    expect(clientDemoFileError({ type: "image/png", size: 1000 })).toMatch(/MP4 או MOV/);
  });

  it("gates duration to the ingest limits (8s-3min)", () => {
    expect(demoDurationError(7.9)).toMatch(/8 שניות ל-3 דקות/);
    expect(demoDurationError(8)).toBeNull();
    expect(demoDurationError(180)).toBeNull();
    expect(demoDurationError(181)).toMatch(/8 שניות ל-3 דקות/);
  });
});

describe("ingest polling", () => {
  it("polls through the moving statuses and stops on ready/rejected", () => {
    expect(isIngestingDemoStatus("uploaded")).toBe(true);
    expect(isIngestingDemoStatus("probing")).toBe(true);
    expect(isIngestingDemoStatus("normalizing")).toBe(true);
    expect(isIngestingDemoStatus("ready")).toBe(false);
    expect(isIngestingDemoStatus("rejected")).toBe(false);
  });
});

describe("shape summary (the advisory display)", () => {
  const base = { hookSeconds: 2, demoSeconds: 20, voSeconds: 20, outroCredits: 0 };

  it("exact fit: the VO ends with the demo", () => {
    const text = shapeSummary({ ...base, outroMode: "none", outroSeconds: 0 });
    expect(text).toContain("פתיח 2 שנ׳");
    expect(text).toContain("20 שנ׳");
    expect(text).toContain("מסתיימת יחד");
  });

  it("freeze: names the held remainder", () => {
    const text = shapeSummary({ ...base, voSeconds: 21.5, outroMode: "freeze", outroSeconds: 1.5 });
    expect(text).toContain("1.5 שנ׳");
    expect(text).toContain("הפריים האחרון");
  });

  it("avatar: names the avatar ending and its length", () => {
    const text = shapeSummary({
      ...base,
      voSeconds: 28,
      outroMode: "avatar",
      outroSeconds: 8,
      outroCredits: 8,
    });
    expect(text).toContain("סיום עם הדמות");
    expect(text).toContain("8 שנ׳");
  });
});

/**
 * The ending and its price are one sentence: an overrun is a choice with a
 * cost, not a fact announced beside an unrelated number.
 */
describe("shape summary names what the ending costs", () => {
  const base = { hookSeconds: 2, demoSeconds: 20, voSeconds: 28 };
  const avatar = { ...base, outroMode: "avatar" as const, outroSeconds: 8 };

  it("an avatar ending that adds credits says so, in the same sentence", () => {
    const text = shapeSummary({ ...avatar, outroCredits: 8 });
    expect(text).toContain("סיום עם הדמות");
    expect(text).toContain("תוספת של 8 קרדיטים");
  });

  it("a zero delta reads as included, never as +0 credits", () => {
    // The minimum can absorb the ending entirely — quoteASet differences two
    // ceiled quotes, so "the outro component is 2.1" and "it costs 0" coexist.
    const text = shapeSummary({ ...avatar, outroCredits: 0 });
    expect(text).toContain("כלול במחיר");
    expect(text).not.toContain("תוספת של"); // the "+N credits" phrasing
    expect(text).not.toContain("קרדיטים");
  });

  it("a freeze ending is free, and says that rather than staying silent", () => {
    const text = shapeSummary({
      ...base,
      voSeconds: 21.5,
      outroMode: "freeze",
      outroSeconds: 1.5,
      outroCredits: 0,
    });
    expect(text).toContain("הפריים האחרון");
    expect(text).toContain("כלול במחיר");
  });

  it("the admin bypass names no credits at all", () => {
    const text = shapeSummary({ ...avatar, outroCredits: null });
    expect(text).toContain("סיום עם הדמות");
    expect(text).not.toContain("קרדיט");
    expect(text).not.toContain("כלול");
  });

  it("ending none never carries a cost clause either way", () => {
    for (const outroCredits of [0, 5, null]) {
      const text = shapeSummary({ ...base, outroMode: "none", outroSeconds: 0, outroCredits });
      expect(text).not.toContain("קרדיט");
      expect(text).not.toContain("כלול");
    }
  });
});

describe("A render timeline", () => {
  it("has no QC stage and maps statuses onto it", () => {
    expect(aRenderStageIndex("queued")).toBe(0);
    expect(aRenderStageIndex("rendering")).toBe(1);
    expect(aRenderStageIndex("released")).toBe(2);
    expect(aRenderStageIndex("failed")).toBe(-1);
  });

  it("keeps polling while the render moves", () => {
    expect(isActiveARenderStatus("queued")).toBe(true);
    expect(isActiveARenderStatus("rendering")).toBe(true);
    expect(isActiveARenderStatus("released")).toBe(false);
    expect(isActiveARenderStatus("failed")).toBe(false);
  });
});

describe("hook-line batch halves", () => {
  const options: HookLineOption[] = Array.from({ length: 10 }, (_, i) => ({
    scriptId: `id-${i}`,
    text: `line ${i}`,
    angle: `frame_${i}`,
  }));

  for (const parity of [0, 1] as const) {
    it(`splits ten frames into two disjoint fives (parity ${parity})`, () => {
      const batch: HookBatch = { options, parity };
      const a = hookHalfOptions(batch, 0);
      const b = hookHalfOptions(batch, 1);

      expect(a).toHaveLength(5);
      expect(b).toHaveLength(5);
      const angles = (half: HookLineOption[]) => half.map((option) => option.angle);
      expect(angles(a).filter((angle) => angles(b).includes(angle))).toEqual([]);
      expect([...angles(a), ...angles(b)].sort()).toEqual(
        options.map((option) => option.angle).sort(),
      );
    });

    it(`interleaves rather than cutting down the middle (parity ${parity})`, () => {
      // A rank-ordered split would serve the weaker five on reroll. Each half
      // must take every OTHER frame, so both halves span the frame library.
      const half = hookHalfOptions({ options, parity }, 0);
      const indices = half.map((option) => options.indexOf(option));
      expect(indices).toEqual([parity, parity + 2, parity + 4, parity + 6, parity + 8]);
    });
  }

  it("puts a different frame first depending on the batch's parity", () => {
    // Fixed parity would pin frame 1 (POV) to the first screen forever.
    const first = (parity: 0 | 1) => hookHalfOptions({ options, parity }, 0)[0]!.angle;
    expect(first(0)).not.toBe(first(1));
  });
});

describe("speaker gender (hook-line invalidation)", () => {
  // The wizard clears hookBatch/hookLine exactly when this returns false.
  it("keeps the batch across a same-gender persona swap", () => {
    expect(sameSpeakerGender("female", "female")).toBe(true);
    expect(sameSpeakerGender("male", "male")).toBe(true);
  });

  it("clears it across a cross-gender swap", () => {
    expect(sameSpeakerGender("female", "male")).toBe(false);
    expect(sameSpeakerGender("male", "female")).toBe(false);
  });

  it("treats a null gender as female, because that is what core generates", () => {
    expect(sameSpeakerGender(null, "female")).toBe(true);
    expect(sameSpeakerGender("female", null)).toBe(true);
    expect(sameSpeakerGender(null, null)).toBe(true);
    expect(sameSpeakerGender(null, "male")).toBe(false);
  });
});

describe("plan editor helpers (8b)", () => {
  const step = (
    sourceIndex: number,
    label: string,
    timestampMs = sourceIndex * 1000,
  ): PlanStepWire => ({ sourceIndex, label, timestampMs, actionType: "tap", durationMs: 1600 });

  it("counts whitespace words the way readTimeMs does", () => {
    expect(labelWordCount("לחצו על הכפתור")).toBe(3);
    expect(labelWordCount("  מילה  ")).toBe(1);
    expect(labelWordCount("   ")).toBe(0);
  });

  it("soft word warning fires at 6 words and stays silent through 5", () => {
    expect(labelWordWarning("אחת שתיים שלוש ארבע חמש")).toBeNull();
    expect(labelWordWarning("אחת שתיים שלוש ארבע חמש שש")).not.toBeNull();
    expect(labelWordWarning("אחת שתיים שלוש ארבע חמש שש שבע")).not.toBeNull();
  });

  it("delete warning names plans below the a_steps_min default only", () => {
    expect(deleteWarning(6)).toBeNull();
    expect(deleteWarning(5)).toBeNull();
    expect(deleteWarning(4)).not.toBeNull();
    expect(deleteWarning(1)).not.toBeNull();
  });

  it("add warning names plans above the a_steps_max default only — 7 stays silent", () => {
    expect(addWarning(6)).toBeNull();
    expect(addWarning(7)).toBeNull();
    expect(addWarning(8)).not.toBeNull();
    expect(addWarning(12)).not.toBeNull();
  });

  it("only an empty label blocks saving — content is never judged", () => {
    // The anti-fabrication rule constrains the MODEL; no helper here reads
    // visibleText, so any non-empty human label saves.
    expect(draftBlockedReason([step(0, "כיתוב"), step(1, "עוד כיתוב")])).toBeNull();
    expect(draftBlockedReason([step(0, "כיתוב"), step(1, "   ")])).not.toBeNull();
  });

  it("payload carries exactly sourceIndex + trimmed label, in draft order", () => {
    expect(stepsPayload([step(3, " לחצו כאן "), step(1, "סיום")])).toEqual([
      { sourceIndex: 3, label: "לחצו כאן" },
      { sourceIndex: 1, label: "סיום" },
    ]);
  });

  describe("dirty detection", () => {
    // Wire order is unsorted on purpose — dirty comparison must sort stored.
    const stored = [step(2, "שני", 2000), step(1, "ראשון", 1000)];

    it("a freshly seeded draft is clean, whatever order the wire delivered", () => {
      expect(planStepsDirty(sortedPlanSteps(stored), stored)).toBe(false);
    });

    it("a label edit is dirty; a whitespace-only edit is not (the payload trims)", () => {
      expect(planStepsDirty([step(1, "אחר", 1000), step(2, "שני", 2000)], stored)).toBe(true);
      expect(planStepsDirty([step(1, " ראשון ", 1000), step(2, "שני", 2000)], stored)).toBe(false);
    });

    it("a deletion is dirty", () => {
      expect(planStepsDirty([step(1, "ראשון", 1000)], stored)).toBe(true);
    });
  });
});

describe("inventory picker (8c)", () => {
  const wire = (index: number, over: Partial<AnalysisStateWire> = {}): AnalysisStateWire => ({
    index,
    timestampMs: index * 1000,
    screenName: `מסך ${index}`,
    visibleText: [],
    action: "פעולה",
    actionType: "tap",
    sameStateAsPrevious: false,
    legibility: "high",
    ...over,
  });

  it("absent screenKind means no information — stays visible (the v1 case, on the data)", () => {
    expect(isSkippedScreenKind(undefined)).toBe(false);
    expect(isSkippedScreenKind("login")).toBe(true);
    expect(isSkippedScreenKind("product")).toBe(false);
  });

  it("splits quality from legal-but-poor and drops unreadable entirely", () => {
    const states = [
      wire(0),
      wire(1, { legibility: "low" }),
      wire(2, { sameStateAsPrevious: true }),
      wire(3, { actionType: "idle" }),
      wire(4, { screenKind: "login" }),
      wire(5, { legibility: "unreadable" }), // no tile — the server rejects it anyway
      wire(6, { screenKind: "product" }),
    ];
    const { quality, other } = pickerPools(states);
    expect(quality.map((s) => s.index)).toEqual([0, 6]);
    expect(other.map((s) => s.index)).toEqual([1, 2, 3, 4]);
  });

  it("a v1 timeline (no screenKind anywhere) fills the main grid on the data alone", () => {
    const { quality, other } = pickerPools([wire(0), wire(1), wire(2)]);
    expect(quality).toHaveLength(3);
    expect(other).toHaveLength(0);
  });

  describe("inventorySections (0030)", () => {
    const quality = [wire(0), wire(2), wire(5), wire(7)];

    it("no grouping collapses to one untitled section — exactly the flat grid", () => {
      expect(inventorySections(quality)).toEqual([{ title: null, states: quality }]);
      expect(inventorySections(quality, [])).toEqual([{ title: null, states: quality }]);
    });

    it("groups the quality pool, buckets leftovers, drops junk indexes", () => {
      const sections = inventorySections(quality, [
        // 3 is not in the quality pool (grouped server-side over a wider
        // predicate era, say) — dropped; 0 claimed twice — second claim
        // dropped; order inside a section re-sorts chronologically.
        { title: "פרסום פוסט", stateIndexes: [2, 0, 3] },
        { title: "מעקב", stateIndexes: [5, 0] },
      ]);
      expect(sections.map((s) => s.title)).toEqual(["פרסום פוסט", "מעקב", "עוד מסכים"]);
      expect(sections[0]!.states.map((s) => s.index)).toEqual([0, 2]);
      expect(sections[1]!.states.map((s) => s.index)).toEqual([5]);
      expect(sections[2]!.states.map((s) => s.index)).toEqual([7]);
    });

    it("a grouping that matches nothing in the pool degrades to the flat grid", () => {
      const sections = inventorySections(quality, [{ title: "ריקה", stateIndexes: [99] }]);
      expect(sections).toEqual([{ title: null, states: quality }]);
    });
  });

  describe("insertDraftStep (add-a-step)", () => {
    const step = (sourceIndex: number, label: string, timestampMs: number): PlanStepWire => ({
      sourceIndex,
      label,
      timestampMs,
      actionType: "tap",
      durationMs: 1600,
    });
    const draft = [step(1, "ראשון", 1000), step(3, "אחרון", 3000)];

    it("inserts chronologically, trimmed, flagged, with no invented duration", () => {
      const next = insertDraftStep(
        draft,
        wire(2, { timestampMs: 2000, actionType: "result" }),
        "  חדש  ",
      );
      expect(next.map((s) => s.sourceIndex)).toEqual([1, 2, 3]);
      expect(next[1]).toMatchObject({
        label: "חדש",
        actionType: "result",
        durationMs: 0,
        added: true,
      });
      expect(draft).toHaveLength(2); // the input draft is untouched
    });

    it("an added step makes the draft dirty; removing it restores clean", () => {
      const next = insertDraftStep(draft, wire(2, { timestampMs: 2000 }), "חדש");
      expect(planStepsDirty(next, draft)).toBe(true);
      expect(
        planStepsDirty(
          next.filter((s) => !s.added),
          draft,
        ),
      ).toBe(false);
    });

    it("re-adding a deleted step with its stored label round-trips to clean", () => {
      // The addStep path relies on this: dirty=false after such a re-add is
      // what lets the editor reseed from the stored plan (real durations)
      // instead of keeping a permanent "computed on save" card.
      const withoutLast = [step(1, "ראשון", 1000)];
      const readded = insertDraftStep(withoutLast, wire(3, { timestampMs: 3000 }), "אחרון");
      expect(planStepsDirty(readded, draft)).toBe(false);
    });
  });
});

describe("the render step, steps format (8e)", () => {
  const step = (sourceIndex: number, durationMs: number): PlanStepWire => ({
    sourceIndex,
    label: "צעד",
    timestampMs: sourceIndex * 1000,
    actionType: "tap",
    durationMs,
  });

  it("pinnedPlanFrom pins the id and sums the stored durations", () => {
    expect(pinnedPlanFrom({ planId: "p1", steps: [step(0, 1600), step(1, 2400)] })).toEqual({
      planId: "p1",
      stepCount: 2,
      stepsTotalMs: 4000,
    });
  });

  it("stepsShapeSummary names the hook, the step count, the total and the silence", () => {
    expect(stepsShapeSummary({ stepCount: 5, stepsTotalMs: 16_500 }, 3_500)).toBe(
      "פתיח 3.5 שנ׳ ← 5 צעדים מסרטון המוצר שלכם — סך הכול 20 שנ׳, בלי קריינות.",
    );
  });

  it("retryableCreateFailure: only the approval 409 takes the retry away", () => {
    expect(retryableCreateFailure(409)).toBe(false);
    // 402 stays retryable — the refreshed quote's shortfall gate is what
    // decides the button, and after a top-up the retry is legitimate.
    expect(retryableCreateFailure(402)).toBe(true);
    expect(retryableCreateFailure(500)).toBe(true);
    expect(retryableCreateFailure(0)).toBe(true);
  });

  it("the confirm button itself carries the price; the line carries the balance", () => {
    // Founder ruling after the 8e walkthrough: the small gray quoteLine did
    // not read as a price — the cost belongs on the thing being clicked.
    expect(stepsConfirmLabel({ credits: 5 })).toBe("צור סרטון · 5 קרדיטים");
    // Admin bypass: nothing is charged, so no price is named anywhere.
    expect(stepsConfirmLabel(null)).toBe("צור סרטון");
    expect(stepsBalanceLine({ balance: 142 })).toBe("היתרה שלכם: 142 קרדיטים.");
  });

  it("renderCompositionKey changes when ANY composition input changes", () => {
    // Review finding: keying the render reset on planId alone let a same-plan
    // hook swap re-show the old video as the new ad. All four inputs count.
    const base = renderCompositionKey("p1", { id: "h1" }, { scriptId: "s1" }, null);
    expect(renderCompositionKey("p1", { id: "h1" }, { scriptId: "s1" }, null)).toBe(base);
    expect(renderCompositionKey("p2", { id: "h1" }, { scriptId: "s1" }, null)).not.toBe(base);
    expect(renderCompositionKey("p1", { id: "h2" }, { scriptId: "s1" }, null)).not.toBe(base);
    expect(renderCompositionKey("p1", { id: "h1" }, { scriptId: "s2" }, null)).not.toBe(base);
    const rect = { x: 40, y: 900, w: 1000, h: 300 };
    expect(renderCompositionKey("p1", { id: "h1" }, { scriptId: "s1" }, rect)).not.toBe(base);
    expect(
      renderCompositionKey("p1", { id: "h1" }, { scriptId: "s1" }, { ...rect, y: 901 }),
    ).not.toBe(renderCompositionKey("p1", { id: "h1" }, { scriptId: "s1" }, rect));
  });
});

describe("the demo step rework (8d)", () => {
  it("aspect gate: horizontal and square fail with the probe's own Hebrew; vertical passes", () => {
    // Same string the ingest probe stores as rejectReason — the gate only
    // moves the rejection before the (possibly 1GB) upload.
    expect(clientDemoAspectError(1920, 1080)).toBe("הסרטון אופקי — צריך וידאו אנכי (9:16)");
    expect(clientDemoAspectError(1080, 1080)).not.toBeNull(); // mirrors the probe's height <= width
    expect(clientDemoAspectError(1080, 1920)).toBeNull();
    // Undecodable metadata skips the gate — the server re-checks.
    expect(clientDemoAspectError(undefined, undefined)).toBeNull();
    expect(clientDemoAspectError(0, 0)).toBeNull(); // audio-only track
  });

  describe("duplicate-upload brake", () => {
    const row = (id: string, durationMs: number | undefined, createdAt: string) =>
      ({ id, durationMs, createdAt }) as ReadyDemoDuration;

    it("matches within the tolerance, inclusive, and not past it", () => {
      const rows = [row("a", 30_000, "2026-08-01")];
      expect(duplicateDemoMatch(30, rows)?.id).toBe("a");
      expect(duplicateDemoMatch((30_000 + DUPLICATE_DURATION_TOLERANCE_MS) / 1000, rows)?.id).toBe(
        "a",
      );
      expect(duplicateDemoMatch((30_000 + DUPLICATE_DURATION_TOLERANCE_MS + 1) / 1000, rows)).toBe(
        null,
      );
      expect(duplicateDemoMatch(31, rows)).toBe(null);
    });

    it("skips rows without a duration and offers the newest match", () => {
      const rows = [
        row("old", 30_000, "2026-08-01T10:00:00Z"),
        row("nodur", undefined, "2026-08-20T10:00:00Z"),
        row("new", 30_100, "2026-08-15T10:00:00Z"),
      ];
      expect(duplicateDemoMatch(30, rows)?.id).toBe("new");
      expect(duplicateDemoMatch(30, [])).toBe(null);
    });
  });

  it("fmtElapsedHe speaks whole minutes, never seconds", () => {
    expect(fmtElapsedHe(0)).toBe("פחות מדקה");
    expect(fmtElapsedHe(59_000)).toBe("פחות מדקה");
    expect(fmtElapsedHe(60_000)).toBe("דקה");
    expect(fmtElapsedHe(119_000)).toBe("דקה");
    expect(fmtElapsedHe(5 * 60_000)).toBe("5 דקות");
  });

  describe("analysisWaitView", () => {
    const job = (over: Partial<JobProgressWire>): JobProgressWire => ({
      state: "queued",
      heartbeat: "alive",
      ...over,
    });

    it("no payload degrades to the pre-8d generic line", () => {
      expect(analysisWaitView(undefined)).toEqual({
        kind: "waiting",
        line: "הסרטון בתור לניתוח — זה לוקח כמה דקות.",
      });
    });

    it("a dead analyze job is a failure, never an eternal spinner — even with a stale heartbeat", () => {
      expect(analysisWaitView(job({ state: "failed" })).kind).toBe("failed");
      expect(analysisWaitView(job({ state: "failed", heartbeat: "stale" })).kind).toBe("failed");
    });

    it("a stale heartbeat over live work reads as stuck; unknown does NOT (fresh envs)", () => {
      expect(analysisWaitView(job({ heartbeat: "stale" })).kind).toBe("stuck");
      expect(analysisWaitView(job({ state: "running", heartbeat: "stale" })).kind).toBe("stuck");
      expect(analysisWaitView(job({ heartbeat: "unknown" })).kind).toBe("waiting");
    });

    it("queued: position when known, 'soon' at zero, silence when unknown", () => {
      expect(analysisWaitView(job({ ahead: 2 }))).toMatchObject({
        kind: "waiting",
        sub: "לפני הסרטון שלכם יש עוד 2 עבודות בתור.",
      });
      // Singular — "עוד 1 עבודות" is not Hebrew.
      expect(analysisWaitView(job({ ahead: 1 }))).toMatchObject({
        sub: "לפני הסרטון שלכם יש עוד עבודה אחת בתור.",
      });
      expect(analysisWaitView(job({ ahead: 0 }))).toMatchObject({ sub: "הניתוח יתחיל בקרוב." });
      // Unknown queue depth must not promise "soon" from behind three renders.
      expect(analysisWaitView(job({}))).toEqual({
        kind: "waiting",
        line: "הסרטון בתור לניתוח — זה לוקח כמה דקות.",
      });
    });

    it("a budget-parked or deep-backoff job reads as paused, never 'starts soon'", () => {
      // resumeAtMs wins over ahead: the position is meaningless for a job
      // that will not be runnable for hours.
      expect(analysisWaitView(job({ ahead: 0, resumeAtMs: 4_000_000_000_000 }))).toMatchObject({
        kind: "waiting",
        sub: "הניתוח מושהה כרגע ויתחדש אוטומטית מאוחר יותר.",
      });
    });

    it("running: elapsed on a minutes scale", () => {
      expect(analysisWaitView(job({ state: "running", elapsedMs: 3 * 60_000 }))).toEqual({
        kind: "waiting",
        line: "מנתחים את הסרטון עכשיו — רץ כבר 3 דקות.",
      });
      expect(analysisWaitView(job({ state: "running" }))).toEqual({
        kind: "waiting",
        line: "מנתחים את הסרטון עכשיו.",
      });
    });
  });

  describe("ingestStuckView", () => {
    const job = (over: Partial<JobProgressWire>): JobProgressWire => ({
      state: "queued",
      heartbeat: "alive",
      ...over,
    });

    it("null while the pipeline is genuinely working (or unreported)", () => {
      expect(ingestStuckView(undefined)).toBe(null);
      expect(ingestStuckView(job({}))).toBe(null);
      expect(ingestStuckView(job({ state: "running" }))).toBe(null);
      expect(ingestStuckView(job({ heartbeat: "unknown" }))).toBe(null);
    });

    it("a dead job is dead (re-upload is the remedy); a stale worker is not", () => {
      expect(ingestStuckView(job({ state: "failed" }))?.dead).toBe(true);
      expect(ingestStuckView(job({ heartbeat: "stale" }))?.dead).toBe(false);
      expect(ingestStuckView(job({ state: "running", heartbeat: "stale" }))?.dead).toBe(false);
    });
  });

  describe("ingestPhaseView", () => {
    const job = (over: Partial<JobProgressWire>): JobProgressWire => ({
      state: "queued",
      heartbeat: "alive",
      ...over,
    });

    it("stages ride the real demo.status transitions", () => {
      expect(ingestPhaseView("uploaded").line).toBe("הסרטון בתור לעיבוד…");
      expect(ingestPhaseView("probing").line).toBe("בודקים את הסרטון…");
      expect(ingestPhaseView("normalizing").line).toBe("מכינים את הסרטון…");
    });

    it("elapsed rides only a RUNNING job payload, whole minutes", () => {
      expect(
        ingestPhaseView("normalizing", job({ state: "running", elapsedMs: 2 * 60_000 })),
      ).toEqual({ line: "מכינים את הסרטון…", sub: "רץ כבר 2 דקות." });
      expect(ingestPhaseView("normalizing", job({ elapsedMs: 2 * 60_000 })).sub).toBeUndefined();
      expect(ingestPhaseView("probing", job({ state: "running" })).sub).toBeUndefined();
    });
  });

  describe("planWaitView", () => {
    const job = (over: Partial<JobProgressWire>): JobProgressWire => ({
      state: "queued",
      heartbeat: "alive",
      ...over,
    });

    it("pending vs planning are the two honest stages; no payload still works", () => {
      expect(planWaitView("pending", undefined)).toEqual({
        kind: "waiting",
        line: "התוכנית ממתינה בתור…",
      });
      expect(planWaitView("planning", undefined)).toEqual({
        kind: "waiting",
        line: "בונים את תוכנית הצעדים…",
      });
    });

    it("planning + running job shows elapsed", () => {
      expect(planWaitView("planning", job({ state: "running", elapsedMs: 60_000 }))).toEqual({
        kind: "waiting",
        line: "בונים את תוכנית הצעדים…",
        sub: "רץ כבר דקה.",
      });
    });

    it("a dead plan job is a failure, never an eternal spinner", () => {
      expect(planWaitView("pending", job({ state: "failed" })).kind).toBe("failed");
      expect(planWaitView("planning", job({ state: "failed", heartbeat: "stale" })).kind).toBe(
        "failed",
      );
    });

    it("a stale heartbeat over live work reads as stuck; unknown does NOT", () => {
      expect(planWaitView("pending", job({ heartbeat: "stale" })).kind).toBe("stuck");
      expect(planWaitView("planning", job({ state: "running", heartbeat: "stale" })).kind).toBe(
        "stuck",
      );
      expect(planWaitView("pending", job({ heartbeat: "unknown" })).kind).toBe("waiting");
    });

    it("a budget-parked plan job reads as paused — even when the row already says planning", () => {
      expect(planWaitView("pending", job({ resumeAtMs: 4_000_000_000_000 }))).toMatchObject({
        kind: "waiting",
        sub: "יצירת התוכנית מושהית כרגע ותתחדש אוטומטית מאוחר יותר.",
      });
      // The real park: the row flips to "planning" BEFORE the paid call, so a
      // mid-call BudgetError leaves planning + a queued job hours out — the
      // active "building now" line over that park would be a lie.
      expect(planWaitView("planning", job({ resumeAtMs: 4_000_000_000_000 }))).toMatchObject({
        kind: "waiting",
        line: "התוכנית ממתינה בתור…",
        sub: "יצירת התוכנית מושהית כרגע ותתחדש אוטומטית מאוחר יותר.",
      });
    });
  });

  describe("renderWaitView", () => {
    const job = (over: Partial<JobProgressWire>): JobProgressWire => ({
      state: "queued",
      heartbeat: "alive",
      ...over,
    });

    /** The bar every "still moving, nothing measurable" case must produce. */
    const MOVING = { paused: false };

    it("queued: position when known, silence when unknown", () => {
      expect(renderWaitView("queued", job({ ahead: 2 }))).toEqual({
        kind: "waiting",
        sub: "לפני הסרטון שלכם יש עוד 2 עבודות בתור.",
        bar: MOVING,
      });
      expect(renderWaitView("queued", job({ ahead: 1 }))).toEqual({
        kind: "waiting",
        sub: "לפני הסרטון שלכם יש עוד עבודה אחת בתור.",
        bar: MOVING,
      });
      expect(renderWaitView("queued", job({ ahead: 0 }))).toEqual({
        kind: "waiting",
        sub: "העיבוד יתחיל בקרוב.",
        bar: MOVING,
      });
      expect(renderWaitView("queued", job({}))).toEqual({ kind: "waiting", bar: MOVING });
      expect(renderWaitView("queued", undefined)).toEqual({ kind: "waiting", bar: MOVING });
    });

    it("a backoff-parked render says nothing and keeps the bar running", () => {
      // The retry resumes on its own within minutes, so the customer is told
      // nothing at all — no queue position (it is not in line), no "paused"
      // sentence (founder call 2026-09-02: it read like a fault and flickered
      // as the job hopped queued<->running).
      expect(renderWaitView("queued", job({ ahead: 0, resumeAtMs: 4_000_000_000_000 }))).toEqual({
        kind: "waiting",
        bar: { paused: false },
      });
    });

    it("rendering: the percent goes to the bar, the sentence keeps elapsed", () => {
      expect(
        renderWaitView("rendering", job({ state: "running", progress: 0.437, elapsedMs: 60_000 })),
      ).toEqual({ kind: "waiting", sub: "רץ כבר דקה.", bar: { percent: 43, paused: false } });
      expect(renderWaitView("rendering", job({ state: "running", progress: 0.437 }))).toEqual({
        kind: "waiting",
        bar: { percent: 43, paused: false },
      });
      expect(renderWaitView("rendering", job({ state: "running", elapsedMs: 3 * 60_000 }))).toEqual(
        { kind: "waiting", sub: "רץ כבר 3 דקות.", bar: MOVING },
      );
      expect(renderWaitView("rendering", undefined)).toEqual({ kind: "waiting", bar: MOVING });
    });

    it("percent is never invented and never latched — a cleared checkpoint drops it", () => {
      // handleRenderVideo clears jobs.state at the top of every attempt, so a
      // retry serves state:"running" with no fraction. The bar must fall back
      // to indeterminate rather than hold the dead attempt's 95%.
      const at95 = renderWaitView("rendering", job({ state: "running", progress: 0.95 }));
      expect(at95.bar.percent).toBe(95);
      expect(renderWaitView("rendering", job({ state: "running" })).bar.percent).toBeUndefined();
      // Nothing outside the running frame loop may carry a percent.
      expect(renderWaitView("queued", job({ progress: 0.5 })).bar.percent).toBeUndefined();
    });

    it("a parked retry after the ROW moved to rendering shows no queue position", () => {
      // handleRenderVideo flips the row to "rendering" before the attempt and
      // failTransient re-queues the job without touching the row, so a parked
      // retry arrives as status "rendering" + state "queued" + resumeAtMs.
      // Keyed on the job, so it never falls through to the queue-position
      // branch and promises a place in a line it is not standing in.
      expect(
        renderWaitView(
          "rendering",
          job({ state: "queued", resumeAtMs: 4_000_000_000_000, heartbeat: "alive" }),
        ),
      ).toEqual({ kind: "waiting", bar: { paused: false } });
    });

    it("a missing job with no live worker is paused, not working", () => {
      // No job under this key AND nothing known to be alive: there is nothing
      // to justify animating. A live worker is the one thing that makes
      // "working" defensible without a job row (the render's real job may be
      // the lipsync one).
      expect(renderWaitView("queued", job({ state: "missing", heartbeat: "stale" })).bar).toEqual({
        paused: true,
      });
      expect(renderWaitView("queued", job({ state: "missing", heartbeat: "unknown" })).bar).toEqual(
        {
          paused: true,
        },
      );
      expect(renderWaitView("queued", job({ state: "missing", heartbeat: "alive" })).bar).toEqual({
        paused: false,
      });
    });

    it("stuck freezes the bar", () => {
      expect(
        renderWaitView("rendering", job({ state: "running", heartbeat: "stale" })).bar,
      ).toEqual({ paused: true });
    });

    it("a stale heartbeat over live work reads as stuck; unknown does NOT", () => {
      expect(renderWaitView("queued", job({ heartbeat: "stale" })).kind).toBe("stuck");
      expect(renderWaitView("rendering", job({ state: "running", heartbeat: "stale" })).kind).toBe(
        "stuck",
      );
      expect(renderWaitView("queued", job({ heartbeat: "unknown" })).kind).toBe("waiting");
    });
  });

  it("the ready card's background line shows only while the analysis is still owed", () => {
    for (const status of ["missing", "pending", "analysing"]) {
      expect(analysisBackgroundLine(status)).toBe(
        "הסרטון נשלח לניתוח שרץ ברקע כמה דקות — אפשר להמשיך בינתיים.",
      );
    }
    for (const status of ["ready", "failed", "rejected"]) {
      expect(analysisBackgroundLine(status)).toBe(null);
    }
    // Absent status = a locally-constructed reuse row — say nothing.
    expect(analysisBackgroundLine(undefined)).toBe(null);
  });
});

/**
 * The provenance highlight (decision 0049): the server stores each step's
 * off-screen words as the label's own tokens; labelRuns splits the label the
 * same way (core's splitWords) and marks by exact match, so the editor can
 * render the words inline without re-implementing the tokenizer.
 */
describe("labelRuns (the provenance highlight)", () => {
  it("splits a label into marked and unmarked runs by exact token match", () => {
    expect(labelRuns("בחרו תחום וחפשו משרות", ["תחום"])).toEqual([
      { text: "בחרו ", marked: false },
      { text: "תחום", marked: true },
      { text: " וחפשו משרות", marked: false },
    ]);
  });

  it("keeps separators with their unmarked neighbours and merges adjacent runs", () => {
    expect(labelRuns("מלאו קורות חיים, ושלחו", ["קורות", "חיים"])).toEqual([
      { text: "מלאו ", marked: false },
      { text: "קורות", marked: true },
      { text: " ", marked: false },
      { text: "חיים", marked: true },
      { text: ", ושלחו", marked: false },
    ]);
  });

  it("no marks is one unmarked run, and an empty label is no run at all", () => {
    expect(labelRuns("כנסו לjobnet.co.il", [])).toEqual([
      { text: "כנסו לjobnet.co.il", marked: false },
    ]);
    expect(labelRuns("", ["x"])).toEqual([]);
  });

  it("matches tokens as written — a prefixed form is not its bare word", () => {
    // The server flags the token it saw; "ואזור" and "אזור" are different tokens.
    expect(labelRuns("בחרו ואזור", ["אזור"])).toEqual([{ text: "בחרו ואזור", marked: false }]);
    expect(labelRuns("בחרו ואזור", ["ואזור"])).toEqual([
      { text: "בחרו ", marked: false },
      { text: "ואזור", marked: true },
    ]);
  });
});

describe("marksAfterEdit (the provenance highlight survives a reverted keystroke)", () => {
  const stored = { label: "בחרו תחום", offScreenWords: ["תחום"] };

  it("keeps the stored marks while the text is the model's, trimmed either side", () => {
    expect(marksAfterEdit(stored, "בחרו תחום")).toEqual(["תחום"]);
    expect(marksAfterEdit(stored, "  בחרו תחום ")).toEqual(["תחום"]);
  });

  it("clears them the moment the text differs, and restores them when it is typed back", () => {
    expect(marksAfterEdit(stored, "בחרו תחוםx")).toEqual([]);
    expect(marksAfterEdit(stored, "בחרו")).toEqual([]);
    // Type-then-backspace: the draft must not hide a mark the row still carries.
    expect(marksAfterEdit(stored, "בחרו תחום")).toEqual(["תחום"]);
  });

  it("a step with no stored counterpart, or a pre-0049 row without the field, has no marks", () => {
    expect(marksAfterEdit(undefined, "בחרו תחום")).toEqual([]);
    expect(marksAfterEdit({ label: "בחרו תחום" }, "בחרו תחום")).toEqual([]);
  });
});
