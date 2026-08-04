import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAFE_AREA,
  MIN_SAFE_AREA,
  framePoint,
  hookFileError,
  hookMetadataError,
  hookPatchSchema,
  hookUploadPath,
  isHookUploadPath,
  moveRect,
  oppositeCorner,
  rectFromPoints,
  registerHookSchema,
} from "../src/lib/hooks";

describe("hook file pre-check", () => {
  it("accepts an mp4 and rejects other containers, empty, and oversize files", () => {
    expect(hookFileError({ type: "video/mp4", size: 5_000_000 })).toBeNull();
    expect(hookFileError({ type: "video/quicktime", size: 5_000_000 })).toMatch(/MP4/);
    expect(hookFileError({ type: "video/mp4", size: 0 })).toMatch(/ריק/);
    expect(hookFileError({ type: "video/mp4", size: 51 * 1024 * 1024 })).toMatch(/גדול/);
  });
});

describe("hook metadata bounds (client pre-check = server bounds-check)", () => {
  const good = { durationMs: 2000, width: 1080, height: 1920 };

  it("accepts 0.5-10s at exactly 1080x1920", () => {
    expect(hookMetadataError(good)).toBeNull();
    expect(hookMetadataError({ ...good, durationMs: 500 })).toBeNull();
    expect(hookMetadataError({ ...good, durationMs: 10_000 })).toBeNull();
  });

  it("rejects out-of-range durations, naming the actual value", () => {
    expect(hookMetadataError({ ...good, durationMs: 499 })).toMatch(/0.5/);
    expect(hookMetadataError({ ...good, durationMs: 12_345 })).toMatch(/12\.3/);
  });

  it("rejects wrong dimensions, naming the actual values", () => {
    expect(hookMetadataError({ ...good, width: 720, height: 1280 })).toMatch(/720×1280/);
    expect(hookMetadataError({ ...good, width: 1920, height: 1080 })).toMatch(/1920×1080/);
  });
});

describe("upload path (register accepts only minted paths)", () => {
  it("round-trips the minted shape", () => {
    const path = hookUploadPath("11111111-1111-4111-8111-111111111111");
    expect(path).toBe("assets/bank/hook_clip/11111111-1111-4111-8111-111111111111/clip.mp4");
    expect(isHookUploadPath(path)).toBe(true);
  });

  it("rejects other buckets, entities, filenames, and non-uuid ids", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    expect(isHookUploadPath(`raw/bank/hook_clip/${uuid}/clip.mp4`)).toBe(false);
    expect(isHookUploadPath(`assets/bank/persona_image/${uuid}/clip.mp4`)).toBe(false);
    expect(isHookUploadPath(`assets/bank/hook_clip/${uuid}/other.mp4`)).toBe(false);
    expect(isHookUploadPath(`assets/bank/hook_clip/not-a-uuid/clip.mp4`)).toBe(false);
    expect(isHookUploadPath(`assets/bank/hook_clip/${uuid}/clip.mp4/extra`)).toBe(false);
  });
});

describe("register body schema", () => {
  const valid = {
    uploadPath: hookUploadPath("11111111-1111-4111-8111-111111111111"),
    durationMs: 2000,
    width: 1080,
    height: 1920,
    textSafeArea: { x: 90, y: 640, w: 900, h: 520 },
  };

  it("accepts a valid body and defaults tags to {}", () => {
    const parsed = registerHookSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.tags).toEqual({});
  });

  it("keeps known tags and rejects blank tag values (client omits them)", () => {
    const withTags = registerHookSchema.safeParse({
      ...valid,
      tags: { energy: "גבוהה", vibe: "מופתע" },
    });
    expect(withTags.success && withTags.data.tags).toEqual({ energy: "גבוהה", vibe: "מופתע" });
    expect(registerHookSchema.safeParse({ ...valid, tags: { energy: "  " } }).success).toBe(false);
  });

  it("rejects a safe area outside the frame or with non-positive size", () => {
    const withArea = (area: object) =>
      registerHookSchema.safeParse({ ...valid, textSafeArea: area }).success;
    expect(withArea({ x: 200, y: 640, w: 900, h: 520 })).toBe(false); // x+w > 1080
    expect(withArea({ x: 90, y: 1500, w: 900, h: 520 })).toBe(false); // y+h > 1920
    expect(withArea({ x: -1, y: 640, w: 900, h: 520 })).toBe(false);
    expect(withArea({ x: 90, y: 640, w: 0, h: 520 })).toBe(false);
    expect(withArea({ x: 90, y: 640, w: 900.5, h: 520 })).toBe(false);
    expect(withArea({ x: 0, y: 0, w: 1080, h: 1920 })).toBe(true); // full frame is fine
  });

  it("rejects a missing safe area or non-integer duration", () => {
    const { textSafeArea: _unused, ...withoutArea } = valid;
    expect(registerHookSchema.safeParse(withoutArea).success).toBe(false);
    expect(registerHookSchema.safeParse({ ...valid, durationMs: 2000.5 }).success).toBe(false);
  });
});

describe("clip patch schema", () => {
  it("accepts each action alone and rejects an empty patch", () => {
    expect(hookPatchSchema.safeParse({ active: false }).success).toBe(true);
    expect(
      hookPatchSchema.safeParse({ textSafeArea: { x: 0, y: 0, w: 500, h: 500 } }).success,
    ).toBe(true);
    expect(hookPatchSchema.safeParse({}).success).toBe(false);
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
});
