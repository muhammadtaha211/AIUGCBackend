import { describe, expect, it } from "vitest";
import {
  hookFileError,
  hookMetadataError,
  hookPatchSchema,
  hookUploadPath,
  isHookUploadPath,
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

  it("accepts the optional persona/source ids (the שכפול לדמות flow) as uuids", () => {
    const uuid = "22222222-2222-4222-8222-222222222222";
    const withPersona = registerHookSchema.safeParse({
      ...valid,
      personaId: uuid,
      sourceClipId: uuid,
    });
    expect(withPersona.success).toBe(true);
    expect(withPersona.success && withPersona.data.personaId).toBe(uuid);
    expect(registerHookSchema.safeParse({ ...valid, personaId: "not-a-uuid" }).success).toBe(false);
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

  it("accepts a persona (re)assignment, including null to clear back to generic", () => {
    const uuid = "22222222-2222-4222-8222-222222222222";
    expect(hookPatchSchema.safeParse({ personaId: uuid }).success).toBe(true);
    expect(hookPatchSchema.safeParse({ personaId: null }).success).toBe(true);
    expect(hookPatchSchema.safeParse({ personaId: "nope" }).success).toBe(false);
  });
});

// The safe-area geometry itself (framePoint/rectFromPoints/moveRect/…) moved
// to @aiugc/core/hook-geometry — its tests live in core (hook-geometry.test.ts).
