import { describe, expect, it } from "vitest";
import { sampleCaptions } from "../src/fixtures";
import type { CaptionChunk } from "../src/schema";
import {
  activeChunkIndex,
  activeWordIndex,
  frameToMs,
  msToFrame,
  serviceAStepsTimeline,
  serviceATimeline,
  serviceBDurations,
} from "../src/timing";
import { fitFontSize } from "../src/text-fit";

const chunks: CaptionChunk[] = [
  {
    text: "היי אני מיכל",
    startMs: 0,
    endMs: 900,
    words: [
      { word: "היי", startMs: 0, endMs: 300 },
      { word: "אני", startMs: 350, endMs: 600 },
      { word: "מיכל", startMs: 650, endMs: 900 },
    ],
  },
  {
    text: "שלוש שנים סבלתי",
    startMs: 1200,
    endMs: 2100,
    words: [
      { word: "שלוש", startMs: 1200, endMs: 1500 },
      { word: "שנים", startMs: 1550, endMs: 1800 },
      { word: "סבלתי", startMs: 1850, endMs: 2100 },
    ],
  },
];

describe("ms/frame math", () => {
  it("converts at 30fps", () => {
    expect(msToFrame(0)).toBe(0);
    expect(msToFrame(1000)).toBe(30);
    expect(msToFrame(33)).toBe(1);
    expect(msToFrame(16)).toBe(0);
    expect(frameToMs(30)).toBe(1000);
    expect(frameToMs(15)).toBe(500);
  });
});

describe("serviceBDurations", () => {
  it("runs as long as the voiceover when the clip came back short, and holds the rest", () => {
    const { durationInFrames, talkingHeadDurationInFrames } = serviceBDurations(10, 8);
    expect(durationInFrames).toBe(300);
    expect(talkingHeadDurationInFrames).toBe(240);
    // 60 frames of held final frame rather than 2s of cut-off voiceover.
    expect(durationInFrames - talkingHeadDurationInFrames).toBe(60);
  });

  it("trims a clip that outruns the voiceover", () => {
    const { durationInFrames, talkingHeadDurationInFrames } = serviceBDurations(8, 10);
    expect(durationInFrames).toBe(240);
    expect(talkingHeadDurationInFrames).toBe(300);
  });

  it("holds nothing when they match", () => {
    const { durationInFrames, talkingHeadDurationInFrames } = serviceBDurations(9.5, 9.5);
    expect(durationInFrames).toBe(285);
    expect(talkingHeadDurationInFrames).toBe(285);
  });

  it("never renders a zero-frame composition", () => {
    expect(serviceBDurations(0, 0).durationInFrames).toBe(1);
    expect(serviceBDurations(0, 0).talkingHeadDurationInFrames).toBe(1);
  });
});

describe("serviceATimeline", () => {
  // 2s hook, 20s demo at 30fps.
  const base = { hookFrames: 60, demoFrames: 600 };

  it("silent / exact-fit voiced: hook + demo, whole demo visible", () => {
    const t = serviceATimeline({ ...base, voFrames: 600 });
    expect(t).toEqual({
      durationInFrames: 660,
      hookFrames: 60,
      demoVisibleFrames: 600,
      avatarStartFrame: undefined,
    });
  });

  it("freeze: runs to the VO's end, demo fully visible then held", () => {
    // VO 21.5s -> 645 frames; 45 held frames past the demo.
    const t = serviceATimeline({ ...base, voFrames: 645, outroMode: "freeze" });
    expect(t.durationInFrames).toBe(705);
    expect(t.demoVisibleFrames).toBe(600);
    expect(t.avatarStartFrame).toBeUndefined();
  });

  it("avatar: demo cut at the slice, outro from the slice to the VO's end", () => {
    // VO 26s, slice snapped to 19.8s: demo shown 594 frames, avatar at 654.
    const t = serviceATimeline({
      ...base,
      voFrames: 780,
      outroMode: "avatar",
      voSliceMs: 19_800,
    });
    expect(t.demoVisibleFrames).toBe(594);
    expect(t.avatarStartFrame).toBe(60 + 594);
    expect(t.durationInFrames).toBe(60 + 780);
  });

  it("avatar with a slice past the demo end holds the demo until the outro", () => {
    const t = serviceATimeline({
      ...base,
      voFrames: 780,
      outroMode: "avatar",
      voSliceMs: 20_400,
    });
    expect(t.demoVisibleFrames).toBe(600); // full demo, then a 12-frame hold
    expect(t.avatarStartFrame).toBe(60 + 612);
  });

  it("never renders a zero-frame segment", () => {
    const t = serviceATimeline({ hookFrames: 0, demoFrames: 0 });
    expect(t.durationInFrames).toBe(2);
  });
});

describe("serviceAStepsTimeline", () => {
  // 3.5s hook (105), 24s demo (720) at 30fps.
  const base = { hookFrames: 105, demoFrames: 720 };

  it("lays the steps back to back after the hook, hard cuts, no gaps", () => {
    const t = serviceAStepsTimeline({
      ...base,
      steps: [
        { startMs: 1000, durationMs: 2000 },
        { startMs: 9000, durationMs: 1500 },
        { startMs: 21_000, durationMs: 2800 },
      ],
    });
    expect(t.hookFrames).toBe(105);
    expect(t.steps[0]).toEqual({ fromFrame: 105, durationInFrames: 60, trimBeforeFrames: 30 });
    expect(t.steps[1]).toEqual({ fromFrame: 165, durationInFrames: 45, trimBeforeFrames: 270 });
    expect(t.steps[2]).toEqual({ fromFrame: 210, durationInFrames: 84, trimBeforeFrames: 630 });
    expect(t.durationInFrames).toBe(105 + 60 + 45 + 84);
  });

  it("clamps a step window that runs past the demo's end", () => {
    const t = serviceAStepsTimeline({ ...base, steps: [{ startMs: 23_000, durationMs: 5000 }] });
    expect(t.steps[0]!.durationInFrames).toBe(30); // 24s end - 23s start
    expect(t.durationInFrames).toBe(105 + 30);
  });

  it("throws on a trim at or past the demo's end — the render must fail, not freeze", () => {
    expect(() =>
      serviceAStepsTimeline({ ...base, steps: [{ startMs: 24_000, durationMs: 2000 }] }),
    ).toThrow(/outside the demo/);
    expect(() =>
      serviceAStepsTimeline({ ...base, steps: [{ startMs: 30_000, durationMs: 2000 }] }),
    ).toThrow(/outside the demo/);
  });

  it("throws on a negative start", () => {
    expect(() =>
      serviceAStepsTimeline({ ...base, steps: [{ startMs: -100, durationMs: 2000 }] }),
    ).toThrow(/outside the demo/);
  });

  it("keeps the order it is given — chronology is the server's job", () => {
    const t = serviceAStepsTimeline({
      ...base,
      steps: [
        { startMs: 9000, durationMs: 1000 },
        { startMs: 1000, durationMs: 1000 },
      ],
    });
    expect(t.steps[0]!.trimBeforeFrames).toBe(270);
    expect(t.steps[1]!.trimBeforeFrames).toBe(30);
  });

  it("never emits a zero-frame step or a zero-frame composition", () => {
    // A sub-frame window (schema rejects durationMs <= 0; this is rounding
    // safety for legitimately tiny positive values) still emits one frame.
    const t = serviceAStepsTimeline({ ...base, steps: [{ startMs: 1000, durationMs: 10 }] });
    expect(t.steps[0]!.durationInFrames).toBe(1);
    const empty = serviceAStepsTimeline({ hookFrames: 0, demoFrames: 0, steps: [] });
    expect(empty.durationInFrames).toBe(1);
    expect(empty.hookFrames).toBe(1);
  });
});

describe("fitFontSize", () => {
  // Fake measure: every character is 0.5em wide.
  const measure = (text: string, fontSize: number) => text.length * fontSize * 0.5;
  const base = { base: 92, min: 40, lineHeight: 1.2, measure };

  it("keeps the base size when the line fits", () => {
    const size = fitFontSize({ ...base, text: "קצר וקולע", maxWidth: 900, maxHeight: 520 });
    expect(size).toBe(92);
  });

  it("shrinks an overlong line until its wrapped lines fit the height", () => {
    const text = "משפט ארוך מאוד שאף אחד לא היה צריך לכתוב אבל המודל כתב אותו בכל זאת";
    const size = fitFontSize({ ...base, text, maxWidth: 900, maxHeight: 200 });
    expect(size).toBeLessThan(92);
    // The winning size really fits: greedy-wrap line count times line height.
    const words = text.split(" ");
    let lines = 1;
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate, size) <= 900) current = candidate;
      else {
        lines++;
        current = word;
      }
    }
    expect(lines * size * 1.2).toBeLessThanOrEqual(200);
  });

  it("shrinks for a single unbreakable word wider than the area", () => {
    const size = fitFontSize({
      ...base,
      text: "מילהארוכהבמיוחדשלאנשברת",
      maxWidth: 600,
      maxHeight: 520,
    });
    expect(size).toBeLessThan(92);
    expect(measure("מילהארוכהבמיוחדשלאנשברת", size)).toBeLessThanOrEqual(600);
  });

  it("bottoms out at the minimum instead of looping forever", () => {
    const size = fitFontSize({ ...base, text: "א".repeat(400), maxWidth: 100, maxHeight: 50 });
    expect(size).toBe(40);
  });
});

describe("activeChunkIndex", () => {
  it("selects the chunk that is speaking", () => {
    expect(activeChunkIndex(chunks, 0)).toBe(0);
    expect(activeChunkIndex(chunks, 500)).toBe(0);
    expect(activeChunkIndex(chunks, 1200)).toBe(1);
    expect(activeChunkIndex(chunks, 2000)).toBe(1);
  });

  it("holds a chunk through the gap until the next one starts", () => {
    expect(activeChunkIndex(chunks, 1000)).toBe(0);
    expect(activeChunkIndex(chunks, 1199)).toBe(0);
  });

  it("shows nothing before the first chunk or after the last one ends", () => {
    expect(activeChunkIndex(chunks, -1)).toBe(-1);
    expect(activeChunkIndex(chunks, 2100)).toBe(-1);
    expect(activeChunkIndex(chunks, 9999)).toBe(-1);
  });

  it("returns -1 for no captions", () => {
    expect(activeChunkIndex([], 500)).toBe(-1);
  });
});

describe("activeWordIndex", () => {
  it("highlights the spoken word", () => {
    expect(activeWordIndex(chunks[0]!, 0)).toBe(0);
    expect(activeWordIndex(chunks[0]!, 299)).toBe(0);
    expect(activeWordIndex(chunks[0]!, 350)).toBe(1);
    expect(activeWordIndex(chunks[0]!, 700)).toBe(2);
  });

  it("holds the last word through gaps and after the chunk ends", () => {
    expect(activeWordIndex(chunks[0]!, 320)).toBe(0);
    expect(activeWordIndex(chunks[0]!, 1000)).toBe(2);
  });

  it("highlights nothing before the first word or without word timings", () => {
    expect(activeWordIndex(chunks[1]!, 0)).toBe(-1);
    expect(activeWordIndex({ text: "טקסט", startMs: 0, endMs: 500, words: [] }, 100)).toBe(-1);
  });
});

describe("sample fixture", () => {
  it("is shaped like chunkWords output: 2–4 words per chunk, ordered timings", () => {
    let previousEnd = -1;
    for (const chunk of sampleCaptions) {
      expect(chunk.words.length).toBeGreaterThanOrEqual(2);
      expect(chunk.words.length).toBeLessThanOrEqual(4);
      expect(chunk.text).toBe(chunk.words.map((w) => w.word).join(" "));
      expect(chunk.startMs).toBe(chunk.words[0]!.startMs);
      expect(chunk.endMs).toBe(chunk.words[chunk.words.length - 1]!.endMs);
      expect(chunk.startMs).toBeGreaterThan(previousEnd);
      previousEnd = chunk.endMs;
    }
  });

  it("stays on screen for every frame of the sample clip", () => {
    const lastMs = sampleCaptions[sampleCaptions.length - 1]!.endMs;
    for (let ms = 250; ms < lastMs; ms += 100) {
      expect(activeChunkIndex(sampleCaptions, ms)).toBeGreaterThanOrEqual(0);
    }
  });
});
