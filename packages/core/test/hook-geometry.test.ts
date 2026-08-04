import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAFE_AREA,
  HOOK_LINE_LEGIBLE_MIN_PX,
  MIN_SAFE_AREA,
  framePoint,
  moveRect,
  oppositeCorner,
  rectFromPoints,
  resolveHookTextSafeArea,
  textSafeAreaSchema,
} from "../src/hook-geometry";

describe("rect resolution chain (variant rect -> clip default)", () => {
  const clipRect = { x: 100, y: 200, w: 880, h: 400 };
  const variantRect = { x: 40, y: 900, w: 1000, h: 300 };

  it("the variant rect wins when present", () => {
    expect(resolveHookTextSafeArea(variantRect, clipRect)).toEqual(variantRect);
  });

  it("falls back to the clip's default rect (old variants carry no rect)", () => {
    expect(resolveHookTextSafeArea(undefined, clipRect)).toEqual(clipRect);
  });
});

describe("textSafeAreaSchema (frame-bounded integer rect)", () => {
  it("accepts in-frame rects including the full frame", () => {
    expect(textSafeAreaSchema.safeParse({ x: 90, y: 640, w: 900, h: 520 }).success).toBe(true);
    expect(textSafeAreaSchema.safeParse({ x: 0, y: 0, w: 1080, h: 1920 }).success).toBe(true);
  });

  it("rejects out-of-frame, non-positive, and non-integer rects", () => {
    expect(textSafeAreaSchema.safeParse({ x: 200, y: 640, w: 900, h: 520 }).success).toBe(false);
    expect(textSafeAreaSchema.safeParse({ x: 90, y: 1500, w: 900, h: 520 }).success).toBe(false);
    expect(textSafeAreaSchema.safeParse({ x: -1, y: 640, w: 900, h: 520 }).success).toBe(false);
    expect(textSafeAreaSchema.safeParse({ x: 90, y: 640, w: 0, h: 520 }).success).toBe(false);
    expect(textSafeAreaSchema.safeParse({ x: 90, y: 640, w: 900.5, h: 520 }).success).toBe(false);
  });
});

describe("safe-area coordinate mapping (display px <-> 1080x1920 frame)", () => {
  it("scales a preview point up to frame space", () => {
    expect(framePoint(135, 240, 270, 480)).toEqual({ x: 540, y: 960 });
    expect(framePoint(0, 0, 270, 480)).toEqual({ x: 0, y: 0 });
    expect(framePoint(270, 480, 270, 480)).toEqual({ x: 1080, y: 1920 });
  });

  it("clamps pointer positions outside the preview box", () => {
    expect(framePoint(-50, -50, 270, 480)).toEqual({ x: 0, y: 0 });
    expect(framePoint(999, 999, 270, 480)).toEqual({ x: 1080, y: 1920 });
  });

  it("normalizes a drag in any direction to the same rect", () => {
    const down = rectFromPoints({ x: 100, y: 200 }, { x: 700, y: 900 });
    const up = rectFromPoints({ x: 700, y: 900 }, { x: 100, y: 200 });
    expect(down).toEqual({ x: 100, y: 200, w: 600, h: 700 });
    expect(up).toEqual(down);
  });

  it("enforces the minimum size, shifting back inside the frame at the edges", () => {
    const tiny = rectFromPoints({ x: 500, y: 500 }, { x: 505, y: 505 });
    expect(tiny.w).toBe(MIN_SAFE_AREA);
    expect(tiny.h).toBe(MIN_SAFE_AREA);
    const atCorner = rectFromPoints({ x: 1080, y: 1920 }, { x: 1079, y: 1919 });
    expect(atCorner.x + atCorner.w).toBeLessThanOrEqual(1080);
    expect(atCorner.y + atCorner.h).toBeLessThanOrEqual(1920);
  });

  it("moves a rect only as far as the frame allows", () => {
    const rect = { x: 90, y: 640, w: 900, h: 520 };
    expect(moveRect(rect, 20, -40)).toEqual({ x: 110, y: 600, w: 900, h: 520 });
    expect(moveRect(rect, 9999, 9999)).toEqual({ x: 180, y: 1400, w: 900, h: 520 });
    expect(moveRect(rect, -9999, -9999)).toEqual({ x: 0, y: 0, w: 900, h: 520 });
  });

  it("anchors a corner resize on the diagonally opposite corner", () => {
    const rect = { x: 100, y: 200, w: 300, h: 400 };
    expect(oppositeCorner(rect, "nw")).toEqual({ x: 400, y: 600 });
    expect(oppositeCorner(rect, "ne")).toEqual({ x: 100, y: 600 });
    expect(oppositeCorner(rect, "sw")).toEqual({ x: 400, y: 200 });
    expect(oppositeCorner(rect, "se")).toEqual({ x: 100, y: 200 });
  });

  it("keeps the default rect inside the frame and above minimum size", () => {
    expect(DEFAULT_SAFE_AREA.x + DEFAULT_SAFE_AREA.w).toBeLessThanOrEqual(1080);
    expect(DEFAULT_SAFE_AREA.y + DEFAULT_SAFE_AREA.h).toBeLessThanOrEqual(1920);
    expect(DEFAULT_SAFE_AREA.w).toBeGreaterThanOrEqual(MIN_SAFE_AREA);
    expect(DEFAULT_SAFE_AREA.h).toBeGreaterThanOrEqual(MIN_SAFE_AREA);
  });

  it("the legibility floor sits between the fitter's min (40) and base (92)", () => {
    expect(HOOK_LINE_LEGIBLE_MIN_PX).toBeGreaterThan(40);
    expect(HOOK_LINE_LEGIBLE_MIN_PX).toBeLessThan(92);
  });
});
