import { describe, expect, it } from "vitest";
import { AccountBudgetError, InsufficientCreditsError } from "@aiugc/core";
import { coreErrorMapping, GENERIC_ERROR, INVALID_BODY, NOT_FOUND } from "../src/lib/api-errors";

/**
 * The mapper decides what a customer reads when a pipeline refuses them, so
 * every branch that has its own Hebrew is pinned here. The budget cases are
 * checked with the real AccountBudgetError — instanceof is the branch, and a
 * 429 that degraded to the generic 500 would be invisible in a live run.
 */

/** The exact message assertAccountBudget throws (budget.ts). */
const capMessage = (kind: string, used: number, cap: number) =>
  `account daily cap reached for ${kind}: used ${used} of ${cap} in the last 24h`;

describe("coreErrorMapping — the per-account quota ceiling", () => {
  it("maps an LLM cap to its own 429, not a generic failure", () => {
    const err = new AccountBudgetError(capMessage("llm_tokens", 521786, 500000));
    expect(coreErrorMapping(err)).toEqual({
      status: 429,
      error: "הגעתם למכסת יצירת התוכן היומית של החשבון — נסו שוב מחר.",
      mapped: true,
    });
  });

  it("names the render quota for a GPU cap", () => {
    const err = new AccountBudgetError(capMessage("gpu_seconds", 2400, 2000));
    const result = coreErrorMapping(err);
    expect(result.status).toBe(429);
    expect(result.error).toBe("הגעתם למכסת יצירת הסרטונים היומית של החשבון — נסו שוב מחר.");
  });

  it("names the recording quota for a TTS cap", () => {
    const err = new AccountBudgetError(capMessage("tts_chars", 26000, 25000));
    const result = coreErrorMapping(err);
    expect(result.status).toBe(429);
    expect(result.error).toBe("הגעתם למכסת ההקלטות היומית של החשבון — נסו שוב מחר.");
  });

  it("is never the generic 500 for any capped kind", () => {
    for (const kind of ["llm_tokens", "gpu_seconds", "tts_chars"]) {
      const result = coreErrorMapping(new AccountBudgetError(capMessage(kind, 10, 1)));
      expect(result.mapped).toBe(true);
      expect(result.status).toBe(429);
      expect(result.error).not.toBe(GENERIC_ERROR);
    }
  });

  it("does not collide with the audio-preview limit, which is its own 429", () => {
    const result = coreErrorMapping(new Error("daily audio preview limit reached"));
    expect(result.status).toBe(429);
    expect(result.error).toBe("הגעתם למכסת ההשמעות היומית — נסו שוב מחר.");
  });
});

describe("coreErrorMapping — the three approval gates", () => {
  it("maps the steps-format plan gate (sets.ts) to a 409, not a 500", () => {
    const err = new Error("step plan must be approved before rendering (hard gate)");
    expect(coreErrorMapping(err)).toEqual({
      status: 409,
      error: "צריך לאשר את תוכנית הצעדים לפני יצירת הסרטון.",
      mapped: true,
    });
  });

  it("still maps the audio gate", () => {
    const err = new Error("audio must be approved before rendering (hard gate)");
    const result = coreErrorMapping(err);
    expect(result.status).toBe(409);
    expect(result.error).toBe("צריך לאשר את האודיו לפני יצירת הסרטון.");
  });

  it("gives the two gates two different lines", () => {
    const lines = [
      "step plan must be approved before rendering (hard gate)",
      "audio must be approved before rendering (hard gate)",
    ].map((m) => coreErrorMapping(new Error(m)).error);
    expect(new Set(lines).size).toBe(2);
  });

  it("no longer maps the composite gate — the composite routes are gone", () => {
    const err = new Error("composite must be approved before rendering (hard gate)");
    expect(coreErrorMapping(err).mapped).toBe(false);
  });
});

describe("coreErrorMapping — the not-ready demo, phrased both ways", () => {
  const NOT_READY = "סרטון המוצר עדיין בעיבוד — נסו שוב בעוד רגע.";

  it("maps the bare message thrown by sets.ts", () => {
    expect(coreErrorMapping(new Error("demo is not ready"))).toEqual({
      status: 409,
      error: NOT_READY,
      mapped: true,
    });
  });

  it("maps copy.ts's interpolated message — the uuid used to break the match", () => {
    const err = new Error(
      "demo 3f2a1b4c-0000-4000-8000-000000000455 is not ready (status: probing)",
    );
    expect(coreErrorMapping(err)).toEqual({ status: 409, error: NOT_READY, mapped: true });
  });

  it("does not swallow the other not-ready messages, which have their own lines", () => {
    expect(coreErrorMapping(new Error("composite is not ready yet (status: queued)")).error).toBe(
      "עוד לא מוכן — נסו שוב בעוד רגע.",
    );
    expect(coreErrorMapping(new Error("audio render is not ready yet (status: queued)")).error).toBe(
      "עוד לא מוכן — נסו שוב בעוד רגע.",
    );
  });
});

describe("coreErrorMapping — order is load-bearing", () => {
  it("lets /not found/ win over later mappings, as before", () => {
    expect(coreErrorMapping(new Error("business abc not found"))).toEqual({
      status: 404,
      error: NOT_FOUND,
      mapped: true,
    });
  });

  it("passes an already-Hebrew word-budget message through untouched", () => {
    const message = "התסריט ארוך מדי לאורך הסרטון";
    expect(coreErrorMapping(new Error(message))).toEqual({
      status: 400,
      error: message,
      mapped: true,
    });
  });

  it("collapses step-shape rejections to the generic body error", () => {
    for (const message of [
      "sourceIndex 9 is not in the analysis timeline",
      "sourceIndex 4 appears twice",
      "step 2 has an empty label",
    ]) {
      expect(coreErrorMapping(new Error(message))).toEqual({
        status: 400,
        error: INVALID_BODY,
        mapped: true,
      });
    }
  });
});

describe("coreErrorMapping — credits and the fallthrough", () => {
  it("carries the shortfall as a number in the 402", () => {
    const result = coreErrorMapping(new InsufficientCreditsError(12, 5));
    expect(result.status).toBe(402);
    expect(result.error).toContain("7");
  });

  it("reports unmapped errors so the caller logs them", () => {
    expect(coreErrorMapping(new Error("kaboom"))).toEqual({
      status: 500,
      error: GENERIC_ERROR,
      mapped: false,
    });
  });

  it("handles a non-Error throw without crashing", () => {
    expect(coreErrorMapping("just a string").mapped).toBe(false);
    expect(coreErrorMapping(undefined).status).toBe(500);
  });
});
