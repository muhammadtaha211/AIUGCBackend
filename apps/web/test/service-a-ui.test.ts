import { describe, expect, it } from "vitest";
import {
  A_WIZARD_STEPS,
  aRenderStageIndex,
  clientDemoFileError,
  demoDurationError,
  endingForRemainder,
  endingSentence,
  estimatedEnding,
  estimateVoSeconds,
  isActiveARenderStatus,
  isIngestingDemoStatus,
  shapeSummary,
} from "../src/lib/service-a-ui";

describe("wizard steps", () => {
  it("is one fixed path, persona first (the gallery filters by persona)", () => {
    expect(A_WIZARD_STEPS).toEqual([
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
});

describe("ending threshold (mirrors planAOutro's a_outro_min_seconds default)", () => {
  it("maps the remainder onto the three endings", () => {
    expect(endingForRemainder(0)).toBe("none");
    expect(endingForRemainder(-3)).toBe("none");
    expect(endingForRemainder(1.9)).toBe("freeze");
    expect(endingForRemainder(2)).toBe("avatar");
    expect(endingForRemainder(8)).toBe("avatar");
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
});

describe("client demo pre-checks", () => {
  it("mirrors the server rules", () => {
    expect(clientDemoFileError({ type: "video/mp4", size: 1000 })).toBeNull();
    expect(clientDemoFileError({ type: "image/png", size: 1000 })).toMatch(/MP4 או MOV/);
  });

  it("gates duration to the ingest limits (8-60s)", () => {
    expect(demoDurationError(7.9)).toMatch(/8 ל-60/);
    expect(demoDurationError(8)).toBeNull();
    expect(demoDurationError(60)).toBeNull();
    expect(demoDurationError(61)).toMatch(/8 ל-60/);
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
  const base = { hookSeconds: 2, demoSeconds: 20, voSeconds: 20 };

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
    const text = shapeSummary({ ...base, voSeconds: 28, outroMode: "avatar", outroSeconds: 8 });
    expect(text).toContain("סיום עם הדמות");
    expect(text).toContain("8 שנ׳");
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
