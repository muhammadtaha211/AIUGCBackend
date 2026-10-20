import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CaptionChunk } from "../src/captions";
import {
  ALTERNATE,
  CUTAWAY_EDGE_MS,
  CUTAWAY_FRAME_SLACK_MS,
  clampCutawaysForRender,
  cutawayLayout,
  layoutError,
  windowsError,
  type CutawayLayout,
} from "../src/cutaway-structure";
import { DETECTOR_REACH_FRAMES } from "../src/pipelines/analysis-screens";
import { serviceBTimeline } from "../src/service-b-timeline";

/**
 * The founder's own Service B audios (16 distinct, read-only from production
 * 2026-10-20): caption timings only — every word replaced by "" — plus the
 * composition time each one's real hook text left, as serviceBTimeline put it.
 */
type Fixture = {
  audio: string;
  voDurationMs: number;
  captionOffsetMs: number;
  hookTextMs: number;
  chunks: { startMs: number; endMs: number; words: [number, number][] }[];
};
const FIXTURES: Fixture[] = JSON.parse(
  readFileSync(join(__dirname, "data", "b-cutaway-timings.json"), "utf8"),
);
const captionsOf = (f: Fixture): CaptionChunk[] =>
  f.chunks.map((c) => ({
    text: "",
    startMs: c.startMs,
    endMs: c.endMs,
    words: c.words.map(([startMs, endMs]) => ({ word: "", startMs, endMs })),
  }));
const layoutOf = (f: Fixture, over: Partial<Parameters<typeof cutawayLayout>[0]> = {}) =>
  cutawayLayout({
    captions: captionsOf(f),
    voDurationMs: f.voDurationMs,
    captionOffsetMs: f.captionOffsetMs,
    hookTextMs: f.hookTextMs,
    capacityMs: Number.POSITIVE_INFINITY,
    ...over,
  });
const fixture = (audio: string) => FIXTURES.find((f) => f.audio === audio)!;

/** Every invariant the founder's rule 4 and his 2026-10-20 amendment set. */
function expectRuleFour(f: Fixture, layout: CutawayLayout, hookTextMs = f.hookTextMs) {
  if (!("tier" in layout)) throw new Error(`no layout: ${layout.reason}`);
  const chunkStarts = f.chunks.map((c) => c.startMs);
  const wordStarts = f.chunks.flatMap((c) => c.words.map(([s]) => s));
  const floor = Math.max(ALTERNATE.firstCutMinMs, hookTextMs) - f.captionOffsetMs;
  // The first cut: the FIRST chunk start at or after both 3 s and the hook text.
  expect(layout.slots[0]!.fromMs).toBe(chunkStarts.find((s) => s >= floor));
  let prevEnd = -1;
  for (const [i, slot] of layout.slots.entries()) {
    const points = layout.tier === "strict" || layout.tier === "soft" ? chunkStarts : wordStarts;
    expect(points).toContain(slot.fromMs);
    expect(points).toContain(slot.toMs);
    expect(slot.toMs - slot.fromMs).toBeGreaterThanOrEqual(ALTERNATE.cut.minMs);
    expect(slot.toMs - slot.fromMs).toBeLessThanOrEqual(ALTERNATE.cut.maxMs);
    if (i > 0) {
      const head = slot.fromMs - prevEnd;
      expect(head).toBeGreaterThanOrEqual(ALTERNATE.head.minMs);
      expect(head).toBeLessThanOrEqual(ALTERNATE.head.softMaxMs);
      if (layout.tier === "strict" || layout.tier === "words") {
        expect(head).toBeLessThanOrEqual(ALTERNATE.head.maxMs);
      }
    }
    prevEnd = slot.toMs;
  }
  // Ends on the character, inside the approved audio — the last caption's
  // up-to-80 ms residue past duration_ms lands inside this final head.
  const finalHead = f.voDurationMs - prevEnd;
  expect(finalHead).toBeGreaterThanOrEqual(ALTERNATE.head.minMs);
  if (layout.tier !== "capacity") expect(finalHead).toBeLessThanOrEqual(ALTERNATE.head.softMaxMs);
  expect(
    layoutError(layout.slots, {
      voDurationMs: f.voDurationMs,
      captionOffsetMs: f.captionOffsetMs,
      hookTextMs,
    }),
  ).toBeNull();
}

describe("cutawayLayout on the founder's real audios", () => {
  it("lays out every audio long enough, on chunk starts for all but the three tight ones", () => {
    const tiers = Object.fromEntries(
      FIXTURES.map((f) => {
        const layout = layoutOf(f);
        return [f.audio, "tier" in layout ? layout.tier : layout.reason];
      }),
    );
    expect(tiers).toEqual({
      a2f93d2d: "words_soft",
      "5c0a100f": "words",
      bc3a3cb3: "strict",
      ab7e3837: "strict",
      "6093f62a": "strict",
      "86cef649": "strict",
      "55d3b109": "strict",
      f76fff01: "strict",
      "75d5aed2": "strict",
      d975af92: "strict",
      "7854ea9a": "words",
      a8b4ea4e: "strict",
      "7796ac70": "strict",
      "190ef323": "vo_too_short",
      "4f0d448a": "strict",
      d3fbdd4e: "strict",
    });
  });

  it("keeps rule 4 on every layout, with the real hook text and with none", () => {
    for (const f of FIXTURES) {
      for (const hookTextMs of [f.hookTextMs, 0]) {
        const layout = layoutOf(f, { hookTextMs });
        if ("tier" in layout) expectRuleFour(f, layout, hookTextMs);
      }
    }
  });

  it("the audio the local render uses: three heads, two cutaways, all on chunk starts", () => {
    const layout = layoutOf(fixture("ab7e3837"));
    expect(layout).toEqual({
      tier: "strict",
      firstCutMs: 4080,
      slots: [
        { fromMs: 4080, toMs: 9440, wordFrom: 9, wordTo: 18 },
        { fromMs: 10960, toMs: 15080, wordFrom: 21, wordTo: 30 },
      ],
    });
  });

  it("a 28 s audio gets three cutaways", () => {
    const layout = layoutOf(fixture("f76fff01"));
    expect("tier" in layout && layout.slots.length).toBe(3);
  });

  it("is a pure function of its input", () => {
    for (const f of FIXTURES) expect(layoutOf(f)).toEqual(layoutOf(f));
  });
});

describe("cutawayLayout's first cut follows the hook text", () => {
  // Uniform 3-word chunks, 1.2 s apart, 20 chunks, words 400 ms apart.
  const uniform: CaptionChunk[] = Array.from({ length: 20 }, (_, c) => ({
    text: "",
    startMs: c * 1200,
    endMs: c * 1200 + 1100,
    words: [0, 1, 2].map((w) => ({
      word: `מילה${c * 3 + w}`,
      startMs: c * 1200 + w * 400,
      endMs: c * 1200 + w * 400 + 350,
    })),
  }));
  const base = { captions: uniform, voDurationMs: 24_000, captionOffsetMs: 250 };

  it("no hook text: the first chunk start 3 s into the ad", () => {
    const layout = cutawayLayout({ ...base, hookTextMs: 0, capacityMs: Infinity });
    // 3000 − 250 = 2750 in VO time → the chunk at 3600.
    expect("tier" in layout && layout.firstCutMs).toBe(3600);
  });

  it("a hook text leaving late moves the first cut with it, never under it", () => {
    for (const hookTextMs of [250 + 4800, 250 + 6000, 250 + 7200]) {
      const layout = cutawayLayout({ ...base, hookTextMs, capacityMs: Infinity });
      expect("tier" in layout && layout.firstCutMs + 250).toBeGreaterThanOrEqual(hookTextMs);
      expect("tier" in layout && layout.firstCutMs + 250).toBe(hookTextMs);
    }
  });

  it("property: the first cut is never under the hook text, for spoken, partial and unspoken hooks", () => {
    const spoken = uniform.flatMap((c) => c.words.map((w) => w.word));
    const hooks: string[] = [];
    for (let n = 1; n <= 8; n++) {
      hooks.push(spoken.slice(0, n).join(" ")); // a full prefix
      hooks.push([...spoken.slice(0, Math.max(0, n - 1)), "אחרת"].join(" ")); // a partial match
      hooks.push(Array.from({ length: n }, (_, i) => `לא${i}`).join(" ")); // unspoken
    }
    for (const leadInMs of [0, 125, 250, 800]) {
      for (const hookText of hooks) {
        const t = serviceBTimeline({
          hasOpener: false,
          hookText,
          captions: uniform,
          leadInMs,
          lipsyncDurationMs: 0,
          voDurationMs: base.voDurationMs,
        });
        const layout = cutawayLayout({
          ...base,
          captionOffsetMs: t.captionOffsetMs,
          hookTextMs: t.hookTextMs,
          capacityMs: Infinity,
        });
        if (!("tier" in layout)) continue;
        expect(layout.firstCutMs + t.captionOffsetMs).toBeGreaterThanOrEqual(t.hookTextMs);
        expect(layout.firstCutMs + t.captionOffsetMs).toBeGreaterThanOrEqual(
          ALTERNATE.firstCutMinMs,
        );
      }
    }
  });
});

describe("cutawayLayout's refusals and the demo's capacity", () => {
  const f = fixture("f76fff01");

  it("a voice too short for one cutaway and a final head", () => {
    expect(layoutOf(fixture("190ef323"))).toEqual({ slots: [], reason: "vo_too_short" });
  });

  it("a demo too short for even one cutaway", () => {
    expect(layoutOf(f, { capacityMs: 3000 })).toEqual({ slots: [], reason: "demo_too_short" });
  });

  it("a short demo gets fewer slots, never repeated footage", () => {
    const full = layoutOf(f);
    const short = layoutOf(f, { capacityMs: 11_000 });
    if (!("tier" in full) || !("tier" in short)) throw new Error("expected layouts");
    expect(short.slots.length).toBeLessThan(full.slots.length);
    const spent = short.slots.reduce(
      (sum, s) => sum + (s.toMs - s.fromMs) + CUTAWAY_FRAME_SLACK_MS,
      0,
    );
    expect(spent).toBeLessThanOrEqual(11_000);
  });

  it("the capacity tier ends on a head of any length, after the most cutaway time that fits", () => {
    const layout = layoutOf(f, { capacityMs: 6100 });
    expect("tier" in layout && layout.tier).toBe("capacity");
    expect("tier" in layout && layout.slots).toHaveLength(1);
  });
});

describe("windowsError", () => {
  const slot = (demoStartMs: number, len = 5000) => ({
    fromMs: 4000,
    toMs: 4000 + len,
    demoStartMs,
  });

  it("keeps clear of the recording's unexamined edges", () => {
    expect(CUTAWAY_EDGE_MS).toBe(Math.ceil((DETECTOR_REACH_FRAMES * 1000) / 30));
    expect(windowsError([slot(CUTAWAY_EDGE_MS)], 60_000)).toBeNull();
    expect(windowsError([slot(CUTAWAY_EDGE_MS - 1)], 60_000)).toMatch(/before/);
    const latest = 60_000 - CUTAWAY_EDGE_MS - 5000 - CUTAWAY_FRAME_SLACK_MS;
    expect(windowsError([slot(latest)], 60_000)).toBeNull();
    expect(windowsError([slot(latest + 1)], 60_000)).toMatch(/past the recording's end/);
  });

  it("never lets two cutaways show the same footage", () => {
    expect(windowsError([slot(1000), slot(6100)], 60_000)).toBeNull();
    expect(windowsError([slot(1000), slot(6000)], 60_000)).toMatch(/same footage/);
    expect(windowsError([slot(6000), slot(1000)], 60_000)).toMatch(/same footage/);
  });
});

describe("layoutError", () => {
  const opts = { voDurationMs: 20_000, captionOffsetMs: 250, hookTextMs: 2400 };
  it("accepts a layout and refuses each broken invariant", () => {
    const good = [
      { fromMs: 3000, toMs: 8000 },
      { fromMs: 10_000, toMs: 15_000 },
    ];
    expect(layoutError(good, opts)).toBeNull();
    expect(layoutError([], opts)).toMatch(/no cutaways/);
    expect(layoutError([{ fromMs: 2000, toMs: 7000 }], opts)).toMatch(/hook text/);
    expect(layoutError([{ fromMs: 3000, toMs: 6000 }], opts)).toMatch(/3000 ms long/);
    expect(
      layoutError(
        [
          { fromMs: 3000, toMs: 8000 },
          { fromMs: 8500, toMs: 13_000 },
        ],
        opts,
      ),
    ).toMatch(/too short/);
    expect(layoutError([{ fromMs: 14_500, toMs: 19_500 }], opts)).toMatch(/end on the character/);
  });
});

describe("clampCutawaysForRender", () => {
  const opts = { videoEndMs: 30_000, captionOffsetMs: 250, hookTextMs: 2400 };
  const w = (fromMs: number, toMs: number, demoStartMs: number) => ({ fromMs, toMs, demoStartMs });

  it("keeps valid windows as they are", () => {
    const windows = [w(3000, 8000, 1000), w(10_000, 15_000, 9000)];
    expect(clampCutawaysForRender(windows, opts)).toEqual({
      kept: windows,
      dropped: [],
      shifted: [],
    });
  });

  it("shifts a window running past the probed video earlier, keeping its length", () => {
    const result = clampCutawaysForRender([w(3000, 8000, 26_000)], opts);
    expect(result.kept).toEqual([w(3000, 8000, 30_000 - 5000 - CUTAWAY_FRAME_SLACK_MS)]);
    expect(result.shifted).toEqual([0]);
  });

  it("drops what cannot play and never throws", () => {
    const result = clampCutawaysForRender(
      [
        w(1000, 6000, 1000), // before the hook text leaves
        w(3000, 8000, Number.NaN), // malformed
        w(10_000, 15_000, 20_000),
        w(16_000, 21_000, 22_000), // overlaps the one before it
      ],
      opts,
    );
    expect(result.kept).toEqual([w(10_000, 15_000, 20_000)]);
    expect(result.dropped.map((d) => d.index)).toEqual([0, 1, 3]);
    expect(clampCutawaysForRender([w(3000, 8000, 0)], { ...opts, videoEndMs: 4000 }).kept).toEqual(
      [],
    );
  });
});
