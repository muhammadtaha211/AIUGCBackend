import { describe, expect, it } from "vitest";
import { sampleCaptions } from "../src/fixtures";
import type { CaptionChunk } from "../src/schema";
import {
  activeChunkIndex,
  activeWordIndex,
  frameToMs,
  msToFrame,
  serviceBDurations,
} from "../src/timing";

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
