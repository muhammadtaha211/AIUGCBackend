import { describe, expect, it } from "vitest";
import { sampleCaptions, sampleOpenerTimeline, sampleTimeline } from "../src/fixtures";
import { serviceAStepsSchema, serviceBSchema } from "../src/schema";

const valid = {
  talkingHeadSrc: "http://127.0.0.1:1234/0.mp4",
  voiceoverSrc: "http://127.0.0.1:1234/1.mp3",
  brollSrcs: [],
  captions: sampleCaptions,
  timeline: sampleTimeline,
  watermark: false,
};

describe("serviceBSchema", () => {
  it("accepts a render with no b-roll", () => {
    expect(serviceBSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts the opener effect: clip, hook text, rect and its timeline", () => {
    const result = serviceBSchema.safeParse({
      ...valid,
      openerSrc: "http://127.0.0.1:1234/2.mp4",
      hookText: "ככה מזמינים בלי לחכות",
      hookTextSafeArea: { x: 25, y: 1062, w: 1009, h: 179 },
      timeline: sampleOpenerTimeline,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing timeline — the layout is computed in core, never guessed here", () => {
    const { timeline, ...rest } = valid;
    expect(serviceBSchema.safeParse(rest).success).toBe(false);
    expect(serviceBSchema.safeParse({ ...valid, timeline: { hookTextMs: 0 } }).success).toBe(false);
  });

  it("accepts b-roll paths when they are present", () => {
    const result = serviceBSchema.safeParse({ ...valid, brollSrcs: ["http://x/1.mp4"] });
    expect(result.success).toBe(true);
  });

  it("accepts the zoom hook with or without a whoosh, and rejects a scale under 1", () => {
    const zoom = { from: 1.35, to: 1.42, atMs: 1200, durationMs: 450 };
    expect(serviceBSchema.safeParse({ ...valid, hookZoom: zoom }).success).toBe(true);
    expect(
      serviceBSchema.safeParse({ ...valid, hookZoom: { ...zoom, sfxSrc: "http://x/4.wav" } })
        .success,
    ).toBe(true);
    expect(serviceBSchema.safeParse({ ...valid, hookZoom: { ...zoom, from: 0.5 } }).success).toBe(
      false,
    );
    expect(
      serviceBSchema.safeParse({ ...valid, hookZoom: { ...zoom, durationMs: 0 } }).success,
    ).toBe(false);
  });

  it("accepts the other hook animations, and rejects a degenerate one of each", () => {
    const ok = {
      hookFocus: { blurPx: 16, holdMs: 350, durationMs: 850 },
      hookWhip: { fromX: -140, durationMs: 320, blurPx: 18, sfxSrc: "http://x/4.wav" },
      hookTextReveal: { wordMs: [0, 140], popMs: 200, exitDurationMs: 320 },
      hookBeats: { atMs: [1000], amount: 0.035, durationMs: 180, push: { fromMs: 9800, to: 1.06 } },
    };
    expect(serviceBSchema.safeParse({ ...valid, ...ok }).success).toBe(true);
    // Each one is independently optional — that is what "inert unless passed" means.
    for (const key of Object.keys(ok) as (keyof typeof ok)[]) {
      expect(serviceBSchema.safeParse({ ...valid, [key]: ok[key] }).success).toBe(true);
    }
    const bad = [
      { hookFocus: { ...ok.hookFocus, durationMs: 0 } },
      { hookFocus: { ...ok.hookFocus, blurPx: -1 } },
      { hookWhip: { ...ok.hookWhip, durationMs: 0 } },
      { hookTextReveal: { ...ok.hookTextReveal, wordMs: [] } },
      { hookTextReveal: { ...ok.hookTextReveal, popMs: 0 } },
      { hookBeats: { ...ok.hookBeats, amount: -0.1 } },
      { hookBeats: { ...ok.hookBeats, push: { fromMs: 0, to: 0.9 } } },
    ];
    for (const patch of bad) {
      expect(serviceBSchema.safeParse({ ...valid, ...patch }).success, JSON.stringify(patch)).toBe(
        false,
      );
    }
  });

  it("accepts captions with no word timings (even-spaced variant)", () => {
    const captions = [{ text: "טקסט", startMs: 0, endMs: 1000, words: [] }];
    expect(serviceBSchema.safeParse({ ...valid, captions }).success).toBe(true);
  });

  it("rejects a missing talking head", () => {
    const { talkingHeadSrc, ...rest } = valid;
    expect(serviceBSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a missing voiceover — Service B always has approved audio", () => {
    const { voiceoverSrc, ...rest } = valid;
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

const validSteps = {
  hookSrc: "http://127.0.0.1:1234/0.mp4",
  hookLine: "ככה מזמינים בלי לחכות",
  hookTextSafeArea: { x: 25, y: 1062, w: 1009, h: 179 },
  demoSrc: "http://127.0.0.1:1234/1.mp4",
  steps: [{ startMs: 0, durationMs: 2000, label: "נכנסים לאפליקציה" }],
  watermark: false,
};

describe("serviceAStepsSchema", () => {
  it("accepts a minimal plan, including startMs 0", () => {
    expect(serviceAStepsSchema.safeParse(validSteps).success).toBe(true);
  });

  it("rejects an empty steps array — the format IS the steps", () => {
    expect(serviceAStepsSchema.safeParse({ ...validSteps, steps: [] }).success).toBe(false);
  });

  it("rejects a zero or negative step window — fail at pay time, not a 1-frame flash", () => {
    for (const durationMs of [0, -500]) {
      const steps = [{ startMs: 1000, durationMs, label: "צעד" }];
      expect(serviceAStepsSchema.safeParse({ ...validSteps, steps }).success).toBe(false);
    }
  });

  it("rejects a negative startMs", () => {
    const steps = [{ startMs: -1, durationMs: 2000, label: "צעד" }];
    expect(serviceAStepsSchema.safeParse({ ...validSteps, steps }).success).toBe(false);
  });
});
