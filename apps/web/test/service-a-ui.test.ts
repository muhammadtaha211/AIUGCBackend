import { describe, expect, it } from "vitest";
import {
  A_WIZARD_STEPS,
  aRenderStageIndex,
  clientDemoFileError,
  demoDurationError,
  isActiveARenderStatus,
  isIngestingDemoStatus,
  shapeSummary,
} from "../src/lib/service-a-ui";

describe("wizard steps", () => {
  it("is one fixed path: demo -> hook -> persona -> script -> audio -> render", () => {
    expect(A_WIZARD_STEPS).toEqual(["demo", "hook", "persona", "script", "audio", "render"]);
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
