import { describe, expect, it } from "vitest";
import { readTimeMs } from "@aiugc/core/plan-format";
import {
  analysisIndexBatches,
  aRenderStageIndex,
  aWizardSteps,
  clampRestoredStep,
  clientDemoFileError,
  demoDurationError,
  endingForRemainder,
  endingSentence,
  estimatedEnding,
  estimateVoSeconds,
  hookHalfOptions,
  identityFromSearch,
  identitySearch,
  isActiveARenderStatus,
  isActivePlanStatus,
  isAnalysisWorkingStatus,
  isIngestingDemoStatus,
  planFailureNotice,
  restoredDemo,
  retryOutcome,
  sameSpeakerGender,
  shapeSummary,
  shouldSyncIdentity,
  sortedPlanSteps,
  stepHeadroomMs,
  type HookBatch,
  type HookLineOption,
} from "../src/lib/service-a-ui";

describe("wizard steps (format-aware, mirrors B's wizardSteps)", () => {
  it("steps format: five steps, no persona, no script, no audio", () => {
    expect(aWizardSteps("steps")).toEqual(["hook", "hookStudio", "demo", "plan", "render"]);
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
    // With a READY demo the plan step is restorable; render (index 4) is not in 8a.
    expect(clampRestoredStep(4, STEPS, ready)).toBe(STEPS.indexOf("plan"));
    expect(clampRestoredStep(3, STEPS, ready)).toBe(3);
    // Without a demo nothing past the gallery is — the hook is session-local.
    expect(clampRestoredStep(3, STEPS, null)).toBe(0);
    expect(clampRestoredStep(1, STEPS, null)).toBe(0);
  });

  /**
   * A mid-ingest demo lands on the DEMO step, never the plan step: the demo
   * step owns ingest polling and rejection, while the plan step would promise
   * an analysis that a later ingest rejection guarantees never comes.
   */
  it("routes a not-ready demo to the demo step, not the plan step", () => {
    for (const status of ["uploaded", "probing", "normalizing"]) {
      expect(clampRestoredStep(3, STEPS, { status })).toBe(STEPS.indexOf("demo"));
    }
  });

  /**
   * hookStudio needs the session-local hook, which no reload can restore —
   * ?step=1 must land on the gallery, not on a step card that renders nothing
   * (below lg the rail has no jump buttons, so a blank card is a dead end).
   */
  it("reroutes a restored hookStudio index to the hook gallery", () => {
    expect(clampRestoredStep(1, STEPS, { status: "ready" })).toBe(STEPS.indexOf("hook"));
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
