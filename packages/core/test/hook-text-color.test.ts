import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOOK_TEXT_COLOR,
  HOOK_TEXT_COLORS,
  HOOK_TEXT_INK,
  hookTextColorSchema,
} from "../src/hook-text-color";

/**
 * Decision 0073: two names, white and black, set per clip by the founder.
 * The DB CHECK (migrations.test.ts, 0049) and the admin schemas
 * (apps/admin/test/hooks.test.ts) refuse everything else too.
 */
describe("hook text colour vocabulary", () => {
  it("accepts white and black only — names, never a hex or another case", () => {
    expect(HOOK_TEXT_COLORS).toEqual(["white", "black"]);
    for (const ok of ["white", "black"]) {
      expect(hookTextColorSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of ["gray", "yellow", "#000000", "#fff", "Black", "WHITE", "", null, 0]) {
      expect(hookTextColorSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("defaults to white", () => {
    expect(DEFAULT_HOOK_TEXT_COLOR).toBe("white");
  });

  it("white is today's ink; black is its inverse — a dark fill on a light outline", () => {
    expect(HOOK_TEXT_INK.white).toEqual({ fill: "white", outline: "0,0,0" });
    expect(HOOK_TEXT_INK.black).toEqual({ fill: "black", outline: "255,255,255" });
  });
});
