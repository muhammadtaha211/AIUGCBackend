import { describe, expect, it } from "vitest";
import { sampleCaptions } from "../src/fixtures";
import { serviceBSchema } from "../src/schema";

const valid = {
  talkingHeadSrc: "http://127.0.0.1:1234/0.mp4",
  brollSrcs: [],
  captions: sampleCaptions,
  watermark: false,
};

describe("serviceBSchema", () => {
  it("accepts a render with no b-roll", () => {
    expect(serviceBSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts b-roll paths when they are present", () => {
    const result = serviceBSchema.safeParse({ ...valid, brollSrcs: ["http://x/1.mp4"] });
    expect(result.success).toBe(true);
  });

  it("accepts captions with no word timings (even-spaced variant)", () => {
    const captions = [{ text: "טקסט", startMs: 0, endMs: 1000, words: [] }];
    expect(serviceBSchema.safeParse({ ...valid, captions }).success).toBe(true);
  });

  it("rejects a missing talking head", () => {
    const { talkingHeadSrc, ...rest } = valid;
    expect(serviceBSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects b-roll given as a bare string instead of a list", () => {
    expect(serviceBSchema.safeParse({ ...valid, brollSrcs: "http://x/1.mp4" }).success).toBe(false);
  });

  it("rejects caption chunks missing word timings", () => {
    const captions = [{ text: "טקסט", startMs: 0, endMs: 1000 }];
    expect(serviceBSchema.safeParse({ ...valid, captions }).success).toBe(false);
  });

  it("rejects a non-boolean watermark", () => {
    expect(serviceBSchema.safeParse({ ...valid, watermark: "true" }).success).toBe(false);
  });
});
