import { describe, expect, it } from "vitest";
import {
  chunkWords,
  evenlySpacedCaptions,
  wordsFromCharAlignment,
  type WordTiming,
} from "../src/captions";

function fakeWords(n: number): WordTiming[] {
  return Array.from({ length: n }, (_, i) => ({
    word: `מילה${i}`,
    startMs: i * 400,
    endMs: i * 400 + 350,
  }));
}

describe("captions", () => {
  it("derives word timings from character alignment (Hebrew, spaces)", () => {
    // "שלום עולם" with 100ms per char
    const text = "שלום עולם";
    const chars = [...text];
    const alignment = {
      characters: chars,
      startTimesMs: chars.map((_, i) => i * 100),
      endTimesMs: chars.map((_, i) => (i + 1) * 100),
    };
    const words = wordsFromCharAlignment(alignment);
    expect(words).toEqual([
      { word: "שלום", startMs: 0, endMs: 400 },
      { word: "עולם", startMs: 500, endMs: 900 },
    ]);
  });

  it("chunks words into groups of 2-4, no orphan single words", () => {
    for (let n = 2; n <= 30; n++) {
      const chunks = chunkWords(fakeWords(n));
      const sizes = chunks.map((c) => c.words.length);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
      for (const size of sizes) {
        expect(size).toBeGreaterThanOrEqual(2);
        expect(size).toBeLessThanOrEqual(4);
      }
    }
  });

  it("chunk timings cover the word span in order", () => {
    const chunks = chunkWords(fakeWords(10));
    expect(chunks[0]!.startMs).toBe(0);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.startMs).toBeGreaterThan(chunks[i - 1]!.startMs);
    }
  });

  it("spaces silent captions evenly", () => {
    const chunks = evenlySpacedCaptions(["א", "ב", "ג", "ד"], 40_000);
    expect(chunks).toHaveLength(4);
    expect(chunks[0]).toMatchObject({ startMs: 0, endMs: 10_000 });
    expect(chunks[3]).toMatchObject({ startMs: 30_000, endMs: 40_000 });
  });
});
