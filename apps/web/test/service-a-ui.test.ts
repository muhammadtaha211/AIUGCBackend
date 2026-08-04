import { describe, expect, it } from "vitest";
import {
  A_WIZARD_STEPS,
  aRenderStageIndex,
  clientDemoFileError,
  demoDurationError,
  estimateVoSeconds,
  isActiveARenderStatus,
  isIngestingDemoStatus,
  shapeSummary,
  voLengthHeadsUp,
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

  it("stays silent while the script fits the demo", () => {
    expect(voLengthHeadsUp(40, 20, 44)).toBeNull();
    expect(voLengthHeadsUp(44, 20, 44)).toBeNull();
  });

  it("small overrun: a freeze-shaped note, clearly labeled an estimate", () => {
    // 47 words -> ~21.4s on a 20s demo: remainder < 2s.
    const note = voLengthHeadsUp(47, 20, 44)!;
    expect(note).toContain("הפריים האחרון");
    expect(note).toContain("הערכה");
  });

  it("large overrun: an avatar-shaped note with the estimated seconds", () => {
    // 55 words -> ~25s on a 20s demo: remainder >= 2s.
    const note = voLengthHeadsUp(55, 20, 44)!;
    expect(note).toContain("הדמות");
    expect(note).toContain("25");
    expect(note).toContain("הערכה");
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
