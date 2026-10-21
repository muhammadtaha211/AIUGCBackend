import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CaptionChunk } from "../src/captions";
import {
  CUTAWAY_ALTERNATE,
  CUTAWAY_EDGE_MS,
  CUTAWAY_FRAME_SLACK_MS,
  CUTAWAY_MAX_SLOTS,
  clampCutawaysForRender,
  clearHookText,
  cutawayCutPoints,
  cutawayEditError,
  cutawayLayout,
  cutawayWindowStarts,
  cutawayWindowsError,
  fitCutawayAt,
  hookLeaveVoMs,
  productMention,
  snapCutawayStart,
  type CutawayLayout,
} from "../src/cutaway-structure";
import { DETECTOR_REACH_FRAMES } from "../src/pipelines/analysis-screens";
import { serviceBTimeline } from "../src/service-b-timeline";

/**
 * The founder's own Service B audios (17 distinct, read-only from production
 * 2026-10-21, packages/core/.work/cutaways/dump-fixture-0122.ts): caption
 * timings only — every word replaced by "" — plus the composition time each
 * one's SCRIPT-drafted hook text leaves (what the draft lays out from, vault
 * 0122) and where productMention found the product on its real words.
 */
type Fixture = {
  audio: string;
  voDurationMs: number;
  captionOffsetMs: number;
  hookTextMs: number;
  mentionMs: number;
  mentionMethod: "product_name" | "business_name" | "share";
  chunks: { startMs: number; endMs: number; words: [number, number][] }[];
};
const FIXTURES: Fixture[] = JSON.parse(
  readFileSync(join(__dirname, "data", "b-cutaway-timings.json"), "utf8"),
);
/** His shortest analysed demo's window capacity (84889b25, 49.5 s), same export. */
const SHORTEST_DEMO_CAPACITY_MS = 49_466;
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
    mentionMs: f.mentionMs,
    capacityMs: Number.POSITIVE_INFINITY,
    ...over,
  });
const fixture = (audio: string) => FIXTURES.find((f) => f.audio === audio)!;

/**
 * The draft's rules (founder, 2026-10-20 and 2026-10-21): no cut before the
 * product mention or under the hook text; from the mention on, no head past
 * ~5 s; 4–6 s cutaways on cut points; the ad ends on the character.
 */
function expectDraftRules(
  f: Fixture,
  layout: CutawayLayout,
  hookTextMs = f.hookTextMs,
  mentionMs = f.mentionMs,
) {
  if (!("tier" in layout)) throw new Error(`no layout: ${layout.reason}`);
  const S = CUTAWAY_ALTERNATE;
  const chunkStarts = f.chunks.map((c) => c.startMs);
  const wordStarts = f.chunks.flatMap((c) => c.words.map(([s]) => s));
  const floor = Math.max(mentionMs, hookTextMs - f.captionOffsetMs);
  const first = layout.slots[0]!.fromMs;
  // The first cut: a chunk start at or after the floor, within a head's reach of it.
  expect(chunkStarts).toContain(first);
  expect(first).toBeGreaterThanOrEqual(floor);
  expect(first - floor).toBeLessThanOrEqual(S.head.maxMs);
  let prevEnd = -1;
  for (const [i, slot] of layout.slots.entries()) {
    const points = layout.tier === "strict" || layout.tier === "soft" ? chunkStarts : wordStarts;
    expect(points).toContain(slot.fromMs);
    expect(points).toContain(slot.toMs);
    expect(slot.toMs - slot.fromMs).toBeGreaterThanOrEqual(S.cut.minMs);
    expect(slot.toMs - slot.fromMs).toBeLessThanOrEqual(S.cut.maxMs);
    if (i > 0) {
      const head = slot.fromMs - prevEnd;
      expect(head).toBeGreaterThanOrEqual(S.head.minMs);
      expect(head).toBeLessThanOrEqual(S.head.softMaxMs);
      if (layout.tier === "strict" || layout.tier === "words") {
        expect(head).toBeLessThanOrEqual(S.head.maxMs);
      }
    }
    prevEnd = slot.toMs;
  }
  // Ends on the character, inside the approved audio — the last caption's
  // up-to-80 ms residue past duration_ms lands inside this final head.
  const finalHead = f.voDurationMs - prevEnd;
  expect(finalHead).toBeGreaterThanOrEqual(S.head.minMs);
  if (layout.tier !== "capacity") expect(finalHead).toBeLessThanOrEqual(S.head.softMaxMs);
  // And every slot is one a customer could have placed: the draft obeys the edit rules too.
  expect(
    cutawayEditError(layout.slots, {
      captions: captionsOf(f),
      voDurationMs: f.voDurationMs,
      hookLeaveVoMs: Math.max(0, hookTextMs - f.captionOffsetMs),
    }),
  ).toBeNull();
}

describe("cutawayLayout on the founder's real audios", () => {
  const TIERS = {
    cbd62014: "strict",
    a2f93d2d: "strict",
    "5c0a100f": "strict",
    bc3a3cb3: "strict",
    ab7e3837: "strict",
    "6093f62a": "strict",
    "86cef649": "strict",
    "55d3b109": "strict",
    f76fff01: "strict",
    "75d5aed2": "strict",
    d975af92: "strict",
    // The product is named at 78% and 77%: no room for a clip and a final head after it.
    "7854ea9a": "vo_too_short",
    a8b4ea4e: "strict",
    "7796ac70": "strict",
    "190ef323": "vo_too_short",
    "4f0d448a": "vo_too_short",
    d3fbdd4e: "strict",
  };

  it("lays out from the product mention, at an unbounded demo and at his shortest one", () => {
    for (const capacityMs of [Number.POSITIVE_INFINITY, SHORTEST_DEMO_CAPACITY_MS]) {
      const tiers = Object.fromEntries(
        FIXTURES.map((f) => {
          const layout = layoutOf(f, { capacityMs });
          return [f.audio, "tier" in layout ? layout.tier : layout.reason];
        }),
      );
      expect(tiers).toEqual(TIERS);
    }
  });

  it("keeps the draft's rules on every layout: the script's hook text, none, and his shortest demo", () => {
    for (const f of FIXTURES) {
      for (const over of [{}, { hookTextMs: 0 }, { capacityMs: SHORTEST_DEMO_CAPACITY_MS }]) {
        const layout = layoutOf(f, over);
        if ("tier" in layout) expectDraftRules(f, layout, over.hookTextMs ?? f.hookTextMs);
      }
    }
  });

  it("the audio the local render uses: one cutaway from the phrase that names the product", () => {
    expect(fixture("ab7e3837").mentionMs).toBe(6960);
    expect(layoutOf(fixture("ab7e3837"))).toEqual({
      tier: "strict",
      firstCutMs: 6960,
      slots: [{ fromMs: 6960, toMs: 12_200, wordFrom: 15, wordTo: 24 }],
    });
  });

  it("his test audio no longer cuts during the intro: the first cut is the name's phrase at 11.36 s", () => {
    const layout = layoutOf(fixture("cbd62014"));
    expect("tier" in layout && layout.firstCutMs).toBe(11_360);
  });

  it("a 28 s audio gets two cutaways after its mention", () => {
    const layout = layoutOf(fixture("f76fff01"));
    expect("tier" in layout && layout.slots.length).toBe(2);
  });

  it("is a pure function of its input", () => {
    for (const f of FIXTURES) expect(layoutOf(f)).toEqual(layoutOf(f));
  });
});

describe("cutawayLayout's first cut", () => {
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

  it("never before the product mention, however early the hook text leaves", () => {
    for (const mentionMs of [0, 3600, 6000, 9600]) {
      const layout = cutawayLayout({ ...base, hookTextMs: 0, mentionMs, capacityMs: Infinity });
      expect("tier" in layout && layout.firstCutMs).toBe(Math.max(mentionMs, 1200));
    }
  });

  it("a hook text leaving after the mention moves the first cut with it, never under it", () => {
    for (const hookTextMs of [250 + 4800, 250 + 6000, 250 + 7200]) {
      const layout = cutawayLayout({ ...base, hookTextMs, mentionMs: 2400, capacityMs: Infinity });
      expect("tier" in layout && layout.firstCutMs + 250).toBe(hookTextMs);
    }
  });

  it("takes the earliest chunk start within 5 s of the floor that lays out", () => {
    // From 6000 no cut point lies 4–6 s on (a pause from 8100 to 13 000); from 7200 one does.
    const words = (start: number) =>
      [0, 1, 2].map((w) => ({ word: "", startMs: start + w * 400, endMs: start + w * 400 + 350 }));
    const starts = [0, 1200, 2400, 3600, 4800, 6000, 7200, 13_000, 14_200, 15_400];
    const captions = starts.map((startMs) => ({
      text: "",
      startMs,
      endMs: startMs + 1100,
      words: words(startMs),
    }));
    const layout = cutawayLayout({
      captions,
      voDurationMs: 17_500,
      captionOffsetMs: 250,
      hookTextMs: 0,
      mentionMs: 6000,
      capacityMs: Infinity,
    });
    expect("tier" in layout && layout.firstCutMs).toBe(7200);
    expect("tier" in layout && layout.slots[0]).toMatchObject({ fromMs: 7200, toMs: 13_000 });
  });

  it("property: never under the hook text nor before the mention, for spoken, partial and unspoken hooks", () => {
    const spoken = uniform.flatMap((c) => c.words.map((w) => w.word));
    const hooks: string[] = [];
    for (let n = 1; n <= 8; n++) {
      hooks.push(spoken.slice(0, n).join(" ")); // a full prefix
      hooks.push([...spoken.slice(0, Math.max(0, n - 1)), "אחרת"].join(" ")); // a partial match
      hooks.push(Array.from({ length: n }, (_, i) => `לא${i}`).join(" ")); // unspoken
    }
    for (const leadInMs of [0, 125, 250, 800]) {
      for (const hookText of hooks) {
        for (const mentionMs of [0, 4800, 8400]) {
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
            mentionMs,
            capacityMs: Infinity,
          });
          if (!("tier" in layout)) continue;
          expect(layout.firstCutMs + t.captionOffsetMs).toBeGreaterThanOrEqual(t.hookTextMs);
          expect(layout.firstCutMs).toBeGreaterThanOrEqual(mentionMs);
          // The wizard's floor is the same number the layout used.
          expect(layout.firstCutMs).toBeGreaterThanOrEqual(
            hookLeaveVoMs(hookText, uniform, t.captionOffsetMs),
          );
        }
      }
    }
  });
});

describe("cutawayLayout's refusals and the demo's capacity", () => {
  const f = fixture("f76fff01");

  it("a voice too short for one cutaway and a final head after the mention", () => {
    expect(layoutOf(fixture("190ef323"))).toEqual({ slots: [], reason: "vo_too_short" });
    expect(layoutOf(fixture("4f0d448a"))).toEqual({ slots: [], reason: "vo_too_short" });
  });

  it("a demo too short for even one cutaway", () => {
    expect(layoutOf(f, { capacityMs: 3000 })).toEqual({ slots: [], reason: "demo_too_short" });
  });

  it("a short demo gets fewer slots, never repeated footage", () => {
    const full = layoutOf(f);
    const short = layoutOf(f, { capacityMs: 6100 });
    if (!("tier" in full) || !("tier" in short)) throw new Error("expected layouts");
    expect(short.slots.length).toBeLessThan(full.slots.length);
    const spent = short.slots.reduce(
      (sum, s) => sum + (s.toMs - s.fromMs) + CUTAWAY_FRAME_SLACK_MS,
      0,
    );
    expect(spent).toBeLessThanOrEqual(6100);
  });

  it("the capacity tier stays on chunk starts whenever a chunk-start prefix fits", () => {
    for (const audio of FIXTURES) {
      for (const capacityMs of [5266, 7266]) {
        const layout = layoutOf(audio, { capacityMs });
        if (!("tier" in layout) || layout.tier !== "capacity") continue;
        const chunkStarts = audio.chunks.map((c) => c.startMs);
        for (const slot of layout.slots) {
          expect(chunkStarts).toContain(slot.fromMs);
          expect(chunkStarts).toContain(slot.toMs);
        }
      }
    }
  });

  it("the capacity tier ends on a head of any length, after the most cutaway time that fits", () => {
    const layout = layoutOf(f, { capacityMs: 6100 });
    expect("tier" in layout && layout.tier).toBe("capacity");
    expect("tier" in layout && layout.slots).toHaveLength(1);
  });
});

describe("productMention", () => {
  /** Captions from a plain Hebrew/Latin script, 3 words a phrase, 400 ms a word. */
  const captions = (script: string): CaptionChunk[] => {
    const words = script.split(" ");
    const out: CaptionChunk[] = [];
    for (let i = 0; i < words.length; i += 3) {
      const slice = words.slice(i, i + 3).map((word, k) => ({
        word,
        startMs: (i + k) * 400,
        endMs: (i + k) * 400 + 350,
      }));
      out.push({ text: "", startMs: slice[0]!.startMs, endMs: slice.at(-1)!.endMs, words: slice });
    }
    return out;
  };
  const VO = 20_000;

  it("finds a Latin product name with a domain and a comma, at its phrase's start", () => {
    const c = captions("זה יקר ואיטי. האתר הזה, קוראים לו Tavnit.ai, נותן לך הכול");
    expect(productMention(c, { productName: "Tavnit.ai", businessName: "Tavnit" }, VO)).toEqual({
      ms: 2400,
      wordIndex: 7,
      method: "product_name",
      count: 1,
    });
  });

  it("strips a Hebrew prefix from the spoken word, never from the name", () => {
    const c = captions("אני ממש אוהבת את זה ואז הגעתי לעולא ביוטי והכול השתנה");
    const found = productMention(c, { productName: "עולא ביוטי" }, VO);
    expect(found).toMatchObject({ method: "product_name", wordIndex: 7, ms: 2400 });
    // "ממש" would shrink to "מש" — and so would a product called "שמש". Not a match.
    const sun = productMention(
      captions("זה ממש טוב לי עכשיו שמש מאירה"),
      { productName: "שמש" },
      VO,
    );
    expect(sun).toMatchObject({ method: "product_name", wordIndex: 5 });
  });

  it("a short one-word name must be exact", () => {
    const c = captions("ובכל יום בבוקר אני אומרת לעצמי");
    expect(productMention(c, { productName: "יום" }, VO)).toMatchObject({
      method: "product_name",
      wordIndex: 1,
    });
    expect(productMention(c, { productName: "כל" }, VO).method).toBe("share");
  });

  it("the business name counts only exactly, and the earlier of the two names wins", () => {
    const c = captions("הסטודיו של מירב פתוח וגם הקורס החדש סטודיו מירב פתוח");
    expect(
      productMention(c, { productName: "סטודיו מירב", businessName: "הסטודיו של מירב" }, VO),
    ).toMatchObject({ method: "business_name", wordIndex: 0, count: 1 });
    // A common word as the business name, glued to a prefix: not a match.
    expect(
      productMention(captions("בתבנית הזאת אין כלום"), { businessName: "תבנית" }, VO).method,
    ).toBe("share");
  });

  it("counts every time the name is spoken and takes the first", () => {
    const c = captions("Tavnit עכשיו ועוד פעם Tavnit בסוף");
    expect(productMention(c, { productName: "Tavnit" }, VO)).toMatchObject({
      wordIndex: 0,
      count: 2,
    });
  });

  it("no name heard: the first phrase at 40% of the voice", () => {
    const c = captions(Array.from({ length: 45 }, (_, i) => `מילה${i}`).join(" "));
    // 40% of 18 000 = 7200 → the phrase starting at 7200 (word 18).
    expect(productMention(c, { productName: "Tavnit.ai", businessName: "Tavnit" }, 18_000)).toEqual(
      {
        ms: 7200,
        wordIndex: 18,
        method: "share",
        count: 0,
      },
    );
    expect(productMention(c, {}, 18_000).method).toBe("share");
  });
});

describe("hookLeaveVoMs", () => {
  const uniform: CaptionChunk[] = Array.from({ length: 10 }, (_, c) => ({
    text: "",
    startMs: c * 1200,
    endMs: c * 1200 + 1100,
    words: [0, 1, 2].map((w) => ({
      word: `מילה${c * 3 + w}`,
      startMs: c * 1200 + w * 400,
      endMs: c * 1200 + w * 400 + 350,
    })),
  }));

  it("no hook text leaves at 0, where hookHandoffMs('') would read a floor", () => {
    expect(hookLeaveVoMs("", uniform, 250)).toBe(0);
    expect(hookLeaveVoMs("   ", uniform, 250)).toBe(0);
  });

  it("matches the render's own timeline for any line", () => {
    for (const hookText of ["מילה0 מילה1 מילה2 מילה3", "משהו אחר לגמרי", "מילה0"]) {
      const t = serviceBTimeline({
        hasOpener: false,
        hookText,
        captions: uniform,
        leadInMs: 800,
        lipsyncDurationMs: 0,
        voDurationMs: 12_000,
      });
      expect(hookLeaveVoMs(hookText, uniform, t.captionOffsetMs)).toBe(
        t.hookTextMs - t.captionOffsetMs,
      );
    }
  });
});

// A 20 s voice: 3-word phrases 1.2 s apart, words 400 ms apart.
const PHRASES: CaptionChunk[] = Array.from({ length: 16 }, (_, c) => ({
  text: "",
  startMs: c * 1200,
  endMs: c * 1200 + 1100,
  words: [0, 1, 2].map((w) => ({
    word: `מילה${c * 3 + w}`,
    startMs: c * 1200 + w * 400,
    endMs: c * 1200 + w * 400 + 350,
  })),
}));
const VO_MS = 19_500;
const FOOTAGE = {
  anchors: Array.from({ length: 30 }, (_, k) => ({ startMs: 400 + k * 2000, stateIndex: k })),
  minStartMs: CUTAWAY_EDGE_MS,
  maxEndMs: 60_000,
};

describe("fitCutawayAt", () => {
  it("ends on the phrase start nearest the length it prefers, 4–6 s on", () => {
    expect(fitCutawayAt(PHRASES, 3600, { limitMs: VO_MS, preferMs: 5000 })).toBe(8400);
    expect(fitCutawayAt(PHRASES, 3600, { limitMs: VO_MS, preferMs: 4000 })).toBe(8400);
    expect(fitCutawayAt(PHRASES, 3600, { limitMs: VO_MS, preferMs: 6000 })).toBe(9600);
  });

  it("stops at the next clip, falls back to a word start, and says when nothing fits", () => {
    // The next clip at 8000: no phrase start in 7600..8000 — the word start 7600 is.
    expect(fitCutawayAt(PHRASES, 3600, { limitMs: 7700, preferMs: 5000 })).toBe(7600);
    expect(fitCutawayAt(PHRASES, 3600, { limitMs: 7500, preferMs: 5000 })).toBeNull();
    expect(fitCutawayAt(PHRASES, 16_800, { limitMs: VO_MS, preferMs: 5000 })).toBeNull();
  });
});

describe("cutawayEditError — the customer's rules, never the draft's head rules", () => {
  const opts = { captions: PHRASES, voDurationMs: VO_MS, hookLeaveVoMs: 2400 };

  it("accepts long heads, touching clips, a clip before the mention and no clips at all", () => {
    expect(cutawayEditError([], opts)).toBeNull();
    expect(cutawayEditError([{ fromMs: 2400, toMs: 7200 }], opts)).toBeNull();
    expect(
      cutawayEditError(
        [
          { fromMs: 2400, toMs: 7200 },
          { fromMs: 7200, toMs: 12_000 },
        ],
        opts,
      ),
    ).toBeNull();
    // 12 s of the character before the only clip: a note in the wizard, never a refusal.
    expect(cutawayEditError([{ fromMs: 13_200, toMs: 18_000 }], opts)).toBeNull();
  });

  it("refuses each broken rule", () => {
    expect(cutawayEditError([{ fromMs: 1200, toMs: 6000 }], opts)).toMatch(/hook text/);
    expect(cutawayEditError([{ fromMs: 2500, toMs: 7200 }], opts)).toMatch(/spoken word/);
    expect(cutawayEditError([{ fromMs: 2400, toMs: 6000 }], opts)).toMatch(/3600 ms long/);
    expect(cutawayEditError([{ fromMs: 2400, toMs: 9600 }], opts)).toMatch(/7200 ms long/);
    expect(
      cutawayEditError(
        [
          { fromMs: 2400, toMs: 7200 },
          { fromMs: 6000, toMs: 10_800 },
        ],
        opts,
      ),
    ).toMatch(/overlap/);
    expect(
      cutawayEditError([{ fromMs: 13_200, toMs: 18_000 }], { ...opts, voDurationMs: 18_000 }),
    ).toMatch(/past the voice/);
    const nine = Array.from({ length: CUTAWAY_MAX_SLOTS + 1 }, (_, i) => ({
      fromMs: 2400 + i * 1200,
      toMs: 2400 + i * 1200 + 4800,
    }));
    expect(cutawayEditError(nine, opts)).toMatch(/more than 8/);
  });
});

describe("cutawayWindowStarts and snapCutawayStart", () => {
  it("offers the moments whose window stays inside the recording and clear of the others", () => {
    const footage = {
      anchors: [400, 2400, 4400, 6400, 8400].map((startMs, stateIndex) => ({
        startMs,
        stateIndex,
      })),
      minStartMs: CUTAWAY_EDGE_MS,
      maxEndMs: 10_000,
    };
    expect(cutawayWindowStarts(footage, 4000, [])).toEqual([400, 2400, 4400]);
    expect(cutawayWindowStarts(footage, 4000, [{ demoStartMs: 400, lengthMs: 3900 }])).toEqual([
      4400,
    ]);
    expect(snapCutawayStart([400, 4400], 2400)).toBe(400);
    expect(snapCutawayStart([], 2400)).toBeUndefined();
  });
});

describe("clearHookText — a longer hook text moves a clip, derived and never written", () => {
  const slot = (id: number, fromMs: number, toMs: number, demoStartMs: number) => ({
    id,
    fromMs,
    toMs,
    demoStartMs,
    stateIndex: (demoStartMs - 400) / 2000,
  });
  const opts = (hookLeaveVoMs: number) => ({
    captions: PHRASES,
    voDurationMs: VO_MS,
    hookLeaveVoMs,
    footage: FOOTAGE,
  });

  it("leaves every clip alone when the hook text leaves before them", () => {
    const slots = [slot(1, 3600, 8400, 2400)];
    expect(clearHookText(slots, opts(2400))).toEqual({ slots, moved: [], dropped: [] });
    expect(clearHookText(slots, opts(0))).toEqual({ slots, moved: [], dropped: [] });
  });

  it("moves the clip to the phrase the hook text leaves on, keeping its length and footage", () => {
    const result = clearHookText(
      [slot(1, 3600, 8400, 2400), slot(2, 12_000, 16_800, 20_400)],
      opts(4800),
    );
    expect(result.moved).toEqual([1]);
    expect(result.dropped).toEqual([]);
    expect(result.slots[0]).toEqual(slot(1, 4800, 9600, 2400));
    expect(result.slots[1]).toEqual(slot(2, 12_000, 16_800, 20_400));
  });

  it("moves two clips in script order, the first one out of the second's way", () => {
    const result = clearHookText(
      [slot(1, 2400, 7200, 2400), slot(2, 7200, 12_000, 8400)],
      opts(8400),
    );
    expect(result.moved).toEqual([1, 2]);
    expect(result.slots.map((s) => [s.fromMs, s.toMs])).toEqual([
      [8400, 13_200],
      [13_200, 18_000],
    ]);
  });

  it("refits the end to a phrase when the old length cannot land, and re-snaps footage that no longer fits", () => {
    // The next clip starts at 9600: from 4800 only 4.8 s of its 6 s fits, and its footage still does.
    const result = clearHookText(
      [slot(1, 3600, 9600, 2400), slot(2, 9600, 14_400, 8400)],
      opts(4800),
    );
    expect(result.slots[0]).toMatchObject({ id: 1, fromMs: 4800, toMs: 9600, demoStartMs: 2400 });
    // A window that no longer fits beside the others snaps to the nearest moment that does.
    const tight = clearHookText(
      [slot(1, 3600, 7600, 4400), slot(2, 12_000, 16_800, 400)],
      opts(4800),
    );
    expect(tight.slots[0]).toMatchObject({ id: 1, fromMs: 4800 });
    expect(cutawayWindowsError(tight.slots, FOOTAGE.maxEndMs + CUTAWAY_EDGE_MS)).toBeNull();
  });

  it("drops a clip no phrase can hold, script or footage", () => {
    // The hook text runs until 15.6 s: from there no 4 s clip ends inside the voice.
    expect(clearHookText([slot(1, 3600, 8400, 2400)], opts(15_600))).toEqual({
      slots: [],
      moved: [],
      dropped: [1],
    });
    // Room in the script, none in a one-window demo the other clip already shows.
    const oneWindow = {
      anchors: [{ startMs: 400, stateIndex: 0 }],
      minStartMs: CUTAWAY_EDGE_MS,
      maxEndMs: 6000,
    };
    const result = clearHookText([slot(1, 2400, 7200, 400), slot(2, 12_000, 16_800, 400)], {
      ...opts(4800),
      footage: oneWindow,
    });
    expect(result.dropped).toEqual([1]);
    expect(result.slots.map((s) => s.id)).toEqual([2]);
  });

  it("every result keeps the customer's rules", () => {
    const slots = [slot(1, 2400, 7200, 2400), slot(2, 9600, 14_400, 12_400)];
    for (let leave = 0; leave <= 14_400; leave += 1200) {
      const result = clearHookText(slots, opts(leave));
      expect(
        cutawayEditError(result.slots, {
          captions: PHRASES,
          voDurationMs: VO_MS,
          hookLeaveVoMs: leave,
        }),
      ).toBeNull();
      expect(cutawayWindowsError(result.slots, FOOTAGE.maxEndMs + CUTAWAY_EDGE_MS)).toBeNull();
      expect(result.slots.length + result.dropped.length).toBe(2);
    }
  });
});

describe("cutawayCutPoints", () => {
  it("chunk starts are a subset of the word starts", () => {
    const points = cutawayCutPoints(PHRASES);
    expect(points.chunks).toHaveLength(16);
    for (const p of points.chunks) expect(points.words).toContain(p);
  });
});

describe("cutawayWindowsError", () => {
  const slot = (demoStartMs: number, len = 5000) => ({
    fromMs: 4000,
    toMs: 4000 + len,
    demoStartMs,
  });

  it("keeps clear of the recording's unexamined edges", () => {
    expect(CUTAWAY_EDGE_MS).toBe(Math.ceil((DETECTOR_REACH_FRAMES * 1000) / 30));
    expect(cutawayWindowsError([slot(CUTAWAY_EDGE_MS)], 60_000)).toBeNull();
    expect(cutawayWindowsError([slot(CUTAWAY_EDGE_MS - 1)], 60_000)).toMatch(/before/);
    const latest = 60_000 - CUTAWAY_EDGE_MS - 5000 - CUTAWAY_FRAME_SLACK_MS;
    expect(cutawayWindowsError([slot(latest)], 60_000)).toBeNull();
    expect(cutawayWindowsError([slot(latest + 1)], 60_000)).toMatch(/past the recording's end/);
  });

  it("never lets two cutaways show the same footage", () => {
    expect(cutawayWindowsError([slot(1000), slot(6100)], 60_000)).toBeNull();
    expect(cutawayWindowsError([slot(1000), slot(6000)], 60_000)).toMatch(/same footage/);
    expect(cutawayWindowsError([slot(6000), slot(1000)], 60_000)).toMatch(/same footage/);
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
