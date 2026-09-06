import { describe, expect, it } from "vitest";
import { sampleCaptions } from "../src/fixtures";
import type { CaptionChunk } from "../src/schema";
import {
  activeChunkIndex,
  activeWordIndex,
  frameToMs,
  handheld,
  hookBeatsScale,
  hookFocusState,
  hookTextRevealState,
  hookWhipState,
  msToFrame,
  hookZoomScale,
  OVERSCAN,
  serviceAStepsTimeline,
  serviceATimeline,
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

// Service B's length rules moved to @aiugc/core (service-b-timeline.test.ts):
// the VO is still never cut off, and the fixtures below mirror that function.

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

describe("hookZoomScale", () => {
  const zoom = { from: 1.35, to: 1.42, atMs: 1200, durationMs: 450 };

  it("creeps through the hook, eases out to 1 without overshoot, then holds", () => {
    expect(hookZoomScale(zoom, 0)).toBeCloseTo(1.35);
    expect(hookZoomScale(zoom, 600)).toBeCloseTo(1.385);
    expect(hookZoomScale(zoom, 1200)).toBeCloseTo(1.42);
    expect(hookZoomScale(zoom, 1425)).toBeCloseTo(1.21, 2); // ease-in-out midpoint
    expect(hookZoomScale(zoom, 1650)).toBeCloseTo(1);
    expect(hookZoomScale(zoom, 5000)).toBe(1);
    let prev = hookZoomScale(zoom, 1200);
    for (let ms = 1233; ms <= 1700; ms += 33) {
      const s = hookZoomScale(zoom, ms);
      expect(s).toBeLessThanOrEqual(prev + 1e-9);
      expect(s).toBeGreaterThanOrEqual(1);
      prev = s;
    }
  });

  it("with atMs 0 there is no creep: the ease starts at `to`, and negative time cannot throw", () => {
    expect(hookZoomScale({ ...zoom, atMs: 0 }, 0)).toBeCloseTo(1.42);
    expect(hookZoomScale({ ...zoom, atMs: 0 }, -1)).toBeCloseTo(1.42);
  });

  it("lands on exactly 1 at the ease's end, whichever way the creep runs", () => {
    expect(hookZoomScale(zoom, zoom.atMs + zoom.durationMs)).toBe(1);
    const shrinking = { ...zoom, from: 1.42, to: 1.35 };
    expect(hookZoomScale(shrinking, 600)).toBeCloseTo(1.385);
    expect(hookZoomScale(shrinking, 1200)).toBeCloseTo(1.35);
    expect(hookZoomScale(shrinking, 1650)).toBe(1);
    expect(hookZoomScale({ ...zoom, durationMs: 1 }, 1201)).toBe(1);
  });
});

describe("handheld camera", () => {
  const W = 1080;
  const H = 1920;
  const seeds = [
    "preview",
    "1397ffcd-4c2c-4cc0-9afd-692c23f5f772",
    // The tightest of 300 random render ids scanned on 2026-09-06 (13.5px of
    // horizontal headroom): the seed that decided ALIGN_MAX_PX.dx = 12.
    "c1b200d8-0e30-430c-ada0-638284e61b56",
  ];

  it("never exposes an edge: every corner stays inside the overscan, with room for the alignment offset", () => {
    for (const seed of seeds) {
      for (let frame = 0; frame < 3600; frame++) {
        const { x, y, rot } = handheld(frame, seed);
        const r = (rot * Math.PI) / 180;
        const corners: [number, number][] = [
          [W / 2, H / 2],
          [-W / 2, H / 2],
          [W / 2, -H / 2],
          [-W / 2, -H / 2],
        ];
        for (const [cx, cy] of corners) {
          // Inverse of translate → rotate → scale: where this viewport corner
          // lands on the untransformed picture.
          const px = cx - x;
          const py = cy - y;
          const u = (px * Math.cos(r) + py * Math.sin(r)) / OVERSCAN;
          const v = (-px * Math.sin(r) + py * Math.cos(r)) / OVERSCAN;
          // The talking head's alignment offset (core's ALIGN_MAX_PX: 12px x,
          // 32px y) holds for the head's whole length since 2026-09-06, so
          // every frame must leave that much of the overscan unused by the
          // sway and its rotation. Over 300 random seeds the tightest frame
          // left 13.5px x / 42.3px y; 65 of them dipped under 16, none under 12.
          expect(W / 2 - Math.abs(u)).toBeGreaterThanOrEqual(12);
          expect(H / 2 - Math.abs(v)).toBeGreaterThanOrEqual(32);
        }
      }
    }
  });

  it("moves like a held phone: fractional, under 1.2px per frame, and never still", () => {
    let prev = handheld(0, seeds[0]!);
    let moved = 0;
    for (let frame = 1; frame < 900; frame++) {
      const cur = handheld(frame, seeds[0]!);
      const step = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      expect(step).toBeLessThanOrEqual(1.2);
      if (step > 0.02) moved++;
      prev = cur;
    }
    expect(moved).toBeGreaterThan(800);
  });

  it("is a pure function of frame and seed", () => {
    expect(handheld(17, "a")).toEqual(handheld(17, "a"));
    expect(handheld(17, "a")).not.toEqual(handheld(17, "b"));
    expect(handheld(17, "a")).not.toEqual(handheld(18, "a"));
  });
});

/**
 * The other hook animations (mocks pending the founder's pick, 2026-09-06).
 * The load-bearing assertion in each block is COVERAGE: the picture may only
 * translate or blur if it also scales enough to keep the frame edge covered,
 * on top of the 12px the sway test above leaves spare. Everything else here
 * is shape.
 */
const HALF_W = 540;
/**
 * What `blurCoverScale` has to buy, in SCREEN px: the offset plus 2 sigma of
 * blur bleed — and the bleed is magnified by the same scale, because a filter
 * runs in local px and the element's transform is applied to the filtered
 * result. Asserting against `2 * blurPx` alone would only restate the formula.
 */
const cover = (scale: number) => HALF_W * (scale - 1);
const needed = (dx: number, blurPx: number, scale: number) => Math.abs(dx) + 2 * blurPx * scale;

describe("hookFocusState", () => {
  const focus = { blurPx: 16, holdMs: 350, durationMs: 850 };

  it("holds soft, pulls sharp, and lands on exactly 1 — no step at the end", () => {
    expect(hookFocusState(focus, 0).blurPx).toBeCloseTo(16);
    expect(hookFocusState(focus, 350).blurPx).toBeCloseTo(16);
    expect(hookFocusState(focus, 775).blurPx).toBeCloseTo(8); // ease-in-out midpoint
    expect(hookFocusState(focus, 1200).blurPx).toBe(0);
    expect(hookFocusState(focus, 1200).scale).toBe(1);
    expect(hookFocusState(focus, 9000).scale).toBe(1);
    // Negative time cannot throw or overshoot (Studio scrubs there).
    expect(hookFocusState(focus, -100).blurPx).toBeCloseTo(16);
  });

  it("covers its own blur at every frame, and shrinks monotonically", () => {
    let prev = Infinity;
    for (let ms = 0; ms <= 1400; ms += 1000 / 30) {
      const { blurPx, scale } = hookFocusState(focus, ms);
      expect(cover(scale)).toBeGreaterThanOrEqual(needed(0, blurPx, scale) - 1e-9);
      expect(scale).toBeLessThanOrEqual(prev + 1e-9);
      expect(scale).toBeGreaterThanOrEqual(1);
      prev = scale;
    }
  });

  it("a zero blur is a no-op, not a 1.0-something scale", () => {
    expect(hookFocusState({ ...focus, blurPx: 0 }, 0)).toEqual({ blurPx: 0, scale: 1 });
  });

  it("an absurd blur still covers and never mirrors the picture", () => {
    // The cover is a division now, so an unbounded blurPx could go negative.
    for (const blurPx of [200, 400, 5000]) {
      const { scale } = hookFocusState({ ...focus, blurPx }, 0);
      expect(scale).toBeGreaterThan(1);
      expect(Number.isFinite(scale)).toBe(true);
    }
  });
});

describe("hookWhipState", () => {
  const whip = { fromX: 140, durationMs: 320, blurPx: 18 };

  it("enters offset and blurred, settles at rest by durationMs and stays", () => {
    const start = hookWhipState(whip, 0);
    expect(start.dx).toBeCloseTo(140);
    expect(start.blurPx).toBeCloseTo(18);
    expect(start.scale).toBeCloseTo((540 + 140) / (540 - 36));
    expect(hookWhipState(whip, 320)).toEqual({ dx: 0, blurPx: 0, scale: 1 });
    expect(hookWhipState(whip, 5000)).toEqual({ dx: 0, blurPx: 0, scale: 1 });
    expect(hookWhipState(whip, -50).dx).toBeCloseTo(140);
  });

  it("is fast off the mark: past halfway in the first quarter of its time", () => {
    expect(hookWhipState(whip, 80).dx).toBeLessThan(70);
  });

  it("covers the slide AND the blur at every frame, from either side", () => {
    for (const w of [whip, { ...whip, fromX: -140 }, { ...whip, blurPx: 0 }]) {
      for (let ms = 0; ms <= 400; ms += 1000 / 30) {
        const { dx, blurPx, scale } = hookWhipState(w, ms);
        expect(cover(scale)).toBeGreaterThanOrEqual(needed(dx, blurPx, scale) - 1e-9);
      }
    }
  });
});

describe("hookTextRevealState", () => {
  const reveal = { wordMs: [0, 140, 280, 420, 560], popMs: 200, exitDurationMs: 320 };
  const END = 2520;

  it("pops the words in order and holds them up", () => {
    const at0 = hookTextRevealState(reveal, 0, END, 5).wordProgress;
    expect(at0[0]).toBe(0);
    expect(at0[4]).toBe(0);
    // 300ms in: word 0 landed 100ms ago, word 1 is 80% through its 200ms pop
    // (eased 0.99), word 2 has just started, word 3 has not.
    const mid = hookTextRevealState(reveal, 300, END, 5).wordProgress;
    expect(mid[0]).toBe(1);
    expect(mid[1]).toBeCloseTo(0.992, 3);
    expect(mid[2]).toBeGreaterThan(0);
    expect(mid[2]).toBeLessThan(0.5);
    expect(mid[3]).toBe(0);
    expect(hookTextRevealState(reveal, 1500, END, 5).wordProgress).toEqual([1, 1, 1, 1, 1]);
  });

  it("pads words the matcher could not time onto the last one — the line always completes", () => {
    const p = hookTextRevealState({ ...reveal, wordMs: [0, 140] }, 400, END, 4).wordProgress;
    expect(p).toHaveLength(4);
    expect(p).toEqual([1, 1, 1, 1]);
  });

  it("exits over the LAST exitDurationMs of its life, finishing exactly at the handoff", () => {
    expect(hookTextRevealState(reveal, 0, END, 5).exit).toBe(0);
    expect(hookTextRevealState(reveal, END - 320, END, 5).exit).toBe(0);
    expect(hookTextRevealState(reveal, END - 160, END, 5).exit).toBeCloseTo(0.5);
    expect(hookTextRevealState(reveal, END, END, 5).exit).toBe(1);
  });

  it("with no exit the line simply cuts, as it does today", () => {
    expect(hookTextRevealState({ ...reveal, exitDurationMs: 0 }, END, END, 5).exit).toBe(0);
  });
});

describe("hookBeatsScale", () => {
  const beats = { atMs: [1000, 2000], amount: 0.035, durationMs: 180 };
  const END = 12_800;

  it("is 1 between beats and pops to `amount` inside one", () => {
    expect(hookBeatsScale(beats, 0, END)).toBe(1);
    expect(hookBeatsScale(beats, 999, END)).toBe(1);
    expect(hookBeatsScale(beats, 1054, END)).toBeCloseTo(1.035, 3); // the attack's peak
    expect(hookBeatsScale(beats, 1180, END)).toBe(1);
    expect(hookBeatsScale(beats, 5000, END)).toBe(1);
  });

  it("never sums overlapping beats — two 40ms apart are still one punch", () => {
    const stacked = { ...beats, atMs: [1000, 1040] };
    for (let ms = 900; ms <= 1400; ms += 1000 / 30) {
      expect(hookBeatsScale(stacked, ms, END)).toBeLessThanOrEqual(1 + beats.amount + 1e-9);
    }
  });

  it("only ever scales UP, so it cannot expose a frame edge", () => {
    const withPush = { ...beats, push: { fromMs: 9800, to: 1.06 } };
    for (let ms = 0; ms <= END; ms += 1000 / 30) {
      expect(hookBeatsScale(withPush, ms, END)).toBeGreaterThanOrEqual(1);
    }
  });

  it("a push at or past the ad's end degrades, never throws the render away", () => {
    // endMs is timeline.totalMs — computed, never typed by the caller, so a
    // BEATS value that looks fine must not abort the render at frame 0.
    for (const fromMs of [END, END + 200, 99_999]) {
      const beatsPush = { ...beats, push: { fromMs, to: 1.06 } };
      expect(() => hookBeatsScale(beatsPush, 500, END)).not.toThrow();
      expect(hookBeatsScale(beatsPush, 500, END)).toBe(1);
    }
  });

  it("pushes in slowly over the tail and holds past the end", () => {
    const withPush = { ...beats, push: { fromMs: 9800, to: 1.06 } };
    expect(withPush.push.fromMs).toBeLessThan(END);
    expect(hookBeatsScale(withPush, 9800, END)).toBe(1);
    expect(hookBeatsScale(withPush, 11_300, END)).toBeCloseTo(1.03, 3);
    expect(hookBeatsScale(withPush, END, END)).toBeCloseTo(1.06, 3);
    expect(hookBeatsScale(withPush, END + 500, END)).toBeCloseTo(1.06, 3);
  });
});
