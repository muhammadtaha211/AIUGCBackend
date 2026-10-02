import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { msToFrame, serviceAStepsTimeline } from "@aiugc/remotion/timing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { SCREENS_DETECTOR, SIGNATURE_FPS } from "../src/pipelines/analysis-screens";
import { createBusiness } from "../src/pipelines/businesses";
import { analysisTimelineSchema, type AnalysisState } from "../src/pipelines/demo-analysis";
import {
  analysisInstants,
  assembleSteps,
  placeClips,
  recordingEndMs,
  type PlacedClip,
} from "../src/pipelines/demo-step-plans";
import {
  clipFrames,
  clipsOverlap,
  DEMO_FPS,
  overlappingPairs,
  PLAN_SKIP_SCREEN_KINDS,
  STEP_MS,
  stepClip,
  totalRuntimeMs,
} from "../src/plan-format";
import { createTestDb } from "./helpers/pglite";

/**
 * Every moment's 2 s clip (decisions 0076, 0084): where placeClips puts it,
 * and that the clip previewed is the clip the render lays out, frame for
 * frame. The rules are pinned on small synthetic timelines; the three real
 * recordings under test/data (text scrubbed, timing verbatim) pin what the
 * rule gives on footage.
 */

const SAMPLE_MS = 200;

function state(timestampMs: number, overrides: Partial<AnalysisState> = {}): AnalysisState {
  return {
    timestampMs,
    screenName: "דף הבית",
    visibleText: ["ברוכים הבאים", "התחלה"],
    action: "פעולה",
    actionType: "tap",
    sameStateAsPrevious: false,
    legibility: "high",
    salienceNote: null,
    thumbPath: "assets/x/states/0.jpg",
    ...overrides,
  };
}

/** A state the analysis put on a different page from the one before it:
 *  a navigation, a new name and new text — all three of isNewScreen's votes. */
function otherPage(timestampMs: number, name: string): AnalysisState {
  return state(timestampMs, {
    actionType: "navigate",
    screenName: name,
    visibleText: [`${name} אחת`, `${name} שתיים`],
  });
}

function place(timeline: AnalysisState[], instants: number[] | null, endMs: number): PlacedClip[] {
  return placeClips(timeline, { sampleMs: SAMPLE_MS, recordingEndMs: endMs, instants });
}

describe("placeClips — every moment's 2 s clip (decision 0084)", () => {
  it("no instants known: the clip starts at its moment and nothing is calm", () => {
    const timeline = [state(1000), state(6000), state(11000)];
    expect(place(timeline, null, 20_000)).toEqual([
      { startMs: 1000, calm: false, twoPages: false },
      { startMs: 6000, calm: false, twoPages: false },
      { startMs: 11000, calm: false, twoPages: false },
    ]);
  });

  it("no instants known: the recording's end wins, and the clip slides back to stay inside it", () => {
    // The last moment sits 400 ms before the end: its clip is the last 2 s.
    const timeline = [state(1000), state(9600)];
    expect(place(timeline, null, 10_000)[1]).toEqual({
      startMs: 8000,
      calm: false,
      twoPages: false,
    });
  });

  it("no instants known: a later moment on another page inside the clip marks it two-pages", () => {
    const timeline = [state(1000), otherPage(2200, "הגדרות"), state(8000)];
    const clips = place(timeline, null, 20_000);
    // 1000-3000 holds the 2200 ms moment, which the analysis put on another page.
    expect(clips[0]).toEqual({ startMs: 1000, calm: false, twoPages: true });
    expect(clips[1]!.twoPages).toBe(false);
  });

  it("calm: starts at the moment when no instant is within 0.2 s of the clip", () => {
    const timeline = [state(4000)];
    expect(place(timeline, [1000, 9000], 20_000)[0]).toEqual({
      startMs: 4000,
      calm: true,
      twoPages: false,
    });
  });

  it("calm: slides earlier by the least that clears the next instant by 0.2 s", () => {
    // An instant at 5500 ms: a calm clip must end by 5300, so it starts at 3300.
    const timeline = [state(4000)];
    expect(place(timeline, [5500], 20_000)[0]).toEqual({
      startMs: 3300,
      calm: true,
      twoPages: false,
    });
  });

  it("an instant exactly 0.2 s outside the clip is clear of it; one frame closer is not", () => {
    const timeline = [state(4000)];
    // The clip 4000-6000 ends 0.2 s before an instant at 6200: calm where it stands.
    expect(place(timeline, [6200], 20_000)[0]).toEqual({
      startMs: 4000,
      calm: true,
      twoPages: false,
    });
    // One frame closer (6167 ms) and it has to slide a frame to stay calm.
    expect(place(timeline, [6167], 20_000)[0]).toEqual({
      startMs: 3967,
      calm: true,
      twoPages: false,
    });
    // The same on the other side: an instant 0.2 s before the start is clear.
    expect(place(timeline, [3800], 20_000)[0]!.calm).toBe(true);
    expect(place(timeline, [3833], 20_000)[0]!.calm).toBe(false);
  });

  it("the detector's blind edges are never called calm", () => {
    // Nothing can be detected in the first or last 11 frames of a recording.
    const first = place([state(0)], [], 20_000)[0]!;
    expect(first).toEqual({ startMs: 0, calm: false, twoPages: false });
    // A moment far enough in is calm on the same empty instant list.
    expect(place([state(1000)], [], 20_000)[0]!.calm).toBe(true);
    // A moment too close to the end to slide clear of the blind tail: its
    // clip is the recording's last 2 s, and not calm.
    expect(place([state(19_600)], [], 20_000)[0]).toEqual({
      startMs: 18_000,
      calm: false,
      twoPages: false,
    });
    // One that can slide clear of the tail does, and is calm.
    expect(place([state(18_000)], [], 20_000)[0]).toEqual({
      startMs: 17_633,
      calm: true,
      twoPages: false,
    });
  });

  it("no calm start: an instant the analysis did not see as a page change is crossed before one it did", () => {
    // Page A until 3000, then page B from 3600 (the analysis agrees: 3300 is a
    // page change). On page B, instants at 4400 and 5200 are typing — same
    // page by the analysis. The 3600 moment has no calm 2 s anywhere.
    const timeline = [
      state(3000),
      otherPage(3600, "טופס"),
      state(5000, { screenName: "טופס", visibleText: ["טופס אחת", "טופס שתיים"] }),
      state(9000, { screenName: "טופס", visibleText: ["טופס אחת", "טופס שתיים"] }),
    ];
    const clip = place(timeline, [3300, 4400, 5200], 20_000)[1]!;
    // It stays on page B from 0.2 s after the change, crossing only the typing.
    expect(clip).toEqual({ startMs: 3500, calm: false, twoPages: false });
  });

  it("no calm start and every start crosses a page change: the clip is marked two-pages", () => {
    // Page changes the analysis saw at 3300 and 4500, 1.2 s apart: no 2 s
    // around the 3600 moment avoids both.
    const timeline = [state(3000), otherPage(3600, "טופס"), otherPage(4800, "תוצאה"), state(9000)];
    const clip = place(timeline, [3300, 4500], 20_000)[1]!;
    expect(clip.calm).toBe(false);
    expect(clip.twoPages).toBe(true);
  });

  it("an instant before the first moment or after the last counts as a page change", () => {
    // One moment at 1000, an instant at 600 before it and one at 1500 after:
    // no pair of moments sits either side of them, so each counts.
    const clip = place([state(1000)], [600, 1500], 20_000)[0]!;
    expect(clip.calm).toBe(false);
    expect(clip.twoPages).toBe(true);
    // The one before the first moment, alone: nothing else decides it.
    expect(place([state(3000)], [2900], 20_000)[0]).toEqual({
      startMs: 3000,
      calm: false,
      twoPages: true,
    });
  });

  it("an instant on a moment's own frame is the change into that moment", () => {
    // The 5000 instant sits on the middle moment, which the analysis put on a
    // new page: it is that page change, not a change inside the page after it.
    const timeline = [
      state(1000),
      otherPage(5000, "טופס"),
      state(9000, { screenName: "טופס", visibleText: ["טופס אחת", "טופס שתיים"] }),
    ];
    expect(place(timeline, [5000], 20_000)[1]).toEqual({
      startMs: 5000,
      calm: false,
      twoPages: true,
    });
  });

  it("a clip starts at most 1.8 s before its moment — 2 s less one analysis sample", () => {
    // Calm exactly at the limit: the clip 2200-4200 ends 0.2 s before 4400.
    expect(place([state(4000)], [4400], 20_000)[0]).toEqual({
      startMs: 2200,
      calm: true,
      twoPages: false,
    });
    // One frame closer and the calm start is out of reach.
    expect(place([state(4000)], [4367], 20_000)[0]).toEqual({
      startMs: 2367,
      calm: false,
      twoPages: true,
    });
  });

  it("a moment between two frames starts on the frame before it, never after it", () => {
    // 4 fps analysis: 250 ms is frame 7.5. Rounding up would start the clip
    // 17 ms after its moment.
    const clips = placeClips([state(250), state(12_750)], {
      sampleMs: 250,
      recordingEndMs: 109_500,
      instants: null,
    });
    expect(clips.map((c) => c.startMs)).toEqual([233, 12_733]);
  });

  it("among starts crossing the same page changes, the moment's own picture stays up longest, then the least slide", () => {
    // Same-page instants at 4000 and 6000: the moment's own stretch is exactly
    // the 2 s between them, so the clip covers that stretch — not the 2 s from
    // the moment, half of which would be past the 6000 instant.
    const timeline = [state(1000), state(5000), state(9000)];
    expect(place(timeline, [4000, 6000], 20_000)[1]).toEqual({
      startMs: 4000,
      calm: false,
      twoPages: false,
    });
  });

  it("is deterministic and never mutates its inputs", () => {
    const timeline = [state(1000), otherPage(3600, "טופס"), state(7000)];
    const instants = [3300, 900, 5200];
    const before = JSON.stringify({ timeline, instants });
    const once = place(timeline, instants, 20_000);
    expect(place(timeline, instants, 20_000)).toEqual(once);
    expect(JSON.stringify({ timeline, instants })).toBe(before);
  });

  it("property: every clip holds its moment, stays inside the recording, is exactly 60 frames, and a calm one is clear of every instant", () => {
    // A small deterministic generator — no dependency, the same cases every run.
    let seed = 20261002;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let round = 0; round < 300; round++) {
      // Moments on the 5 fps analysis grid, strictly increasing.
      const timeline: AnalysisState[] = [];
      let t = Math.floor(random() * 10) * SAMPLE_MS;
      const count = 1 + Math.floor(random() * 30);
      for (let i = 0; i < count; i++) {
        timeline.push(random() < 0.3 ? otherPage(t, `דף ${i}`) : state(t));
        t += (1 + Math.floor(random() * 25)) * SAMPLE_MS;
      }
      const lastMs = timeline[timeline.length - 1]!.timestampMs;
      const endMs = recordingEndMs(
        random() < 0.3 ? null : lastMs + Math.floor(random() * 6000),
        timeline,
        SAMPLE_MS,
      );
      // Instants on the 30 fps frame grid, as the detector emits them.
      const instants =
        random() < 0.1
          ? null
          : Array.from({ length: Math.floor(random() * 40) }, () =>
              Math.round((Math.floor(random() * ((endMs * 30) / 1000)) * 1000) / 30),
            );
      const clips = place(timeline, instants, endMs);
      expect(clips).toHaveLength(timeline.length);
      clips.forEach((clip, i) => {
        const moment = timeline[i]!.timestampMs;
        if (endMs >= STEP_MS) {
          expect(clip.startMs).toBeGreaterThanOrEqual(0);
          expect(clip.startMs + STEP_MS).toBeLessThanOrEqual(endMs);
          expect(clip.startMs).toBeLessThanOrEqual(moment);
          expect(moment).toBeLessThan(clip.startMs + STEP_MS);
        }
        // The render's own arithmetic: exactly 60 frames, whatever the start.
        expect(msToFrame(clip.startMs + STEP_MS) - msToFrame(clip.startMs)).toBe(60);
        if (clip.calm) {
          expect(clip.twoPages).toBe(false);
          const start = msToFrame(clip.startMs);
          for (const instant of instants ?? []) {
            const at = msToFrame(instant);
            expect(at <= start - 6 || at >= start + 60 + 6).toBe(true);
          }
        }
      });
    }
  });
});

describe("the clip previewed is the clip rendered", () => {
  it("the three frame rates are one number", () => {
    expect(DEMO_FPS).toBe(SIGNATURE_FPS);
    expect(msToFrame(1000)).toBe(DEMO_FPS);
  });

  it("a slid clip: the stored step, the preview window and the rendered frames agree", () => {
    // The 4000 ms moment's clip slides to 3300 to stay calm before 5500.
    const timeline = [state(1000), state(4000), state(9000)];
    const clips = place(timeline, [5500], 20_000);
    const steps = assembleSteps(
      [
        { sourceIndex: 0, label: "פתחו את האתר" },
        { sourceIndex: 1, label: "בחרו תבנית מוכנה" },
        { sourceIndex: 2, label: "המודעה מוכנה" },
      ],
      timeline,
      clips,
    );
    expect(steps.map((s) => [s.timestampMs, s.startMs, s.durationMs])).toEqual([
      [1000, 1000, 2000],
      [4000, 3300, 2000],
      [9000, 9000, 2000],
    ]);
    // What the editor previews (stepClip) is what the render is handed.
    const rendered = serviceAStepsTimeline({
      hookFrames: 105,
      demoFrames: msToFrame(20_000),
      steps: steps.map(stepClip),
    });
    expect(rendered.steps.map((s) => s.durationInFrames)).toEqual([60, 60, 60]);
    expect(rendered.steps.map((s) => s.trimBeforeFrames)).toEqual([30, 99, 270]);
    steps.forEach((step, i) => {
      const frames = clipFrames(stepClip(step));
      expect(rendered.steps[i]!.trimBeforeFrames).toBe(frames.startFrame);
      expect(rendered.steps[i]!.durationInFrames).toBe(frames.endFrame - frames.startFrame);
    });
    // The total the editor and the confirm screen show is the frames rendered.
    expect(totalRuntimeMs(steps)).toBe(6000);
    expect(rendered.durationInFrames - rendered.hookFrames).toBe((6000 * DEMO_FPS) / 1000);
  });

  it("a step stored before clips existed renders exactly as it always did", () => {
    // The stored shape of every plan approved before decision 0084: no
    // startMs, the length it was saved with. The render used to be handed
    // { startMs: timestampMs, durationMs } — stepClip hands it the same.
    const stored = { timestampMs: 5200, durationMs: 3400, label: "ניתוב הושלם" };
    expect(stepClip(stored)).toEqual({ startMs: 5200, durationMs: 3400 });
    const rendered = serviceAStepsTimeline({
      hookFrames: 105,
      demoFrames: 720,
      steps: [stepClip(stored)],
    });
    expect(rendered.steps[0]).toEqual({
      fromFrame: 105,
      durationInFrames: 102,
      trimBeforeFrames: 156,
    });
  });

  it("overlap: clips that share footage, clips that only touch, and a non-adjacent pair", () => {
    const clip = (startMs: number) => ({ startMs, durationMs: STEP_MS });
    expect(clipsOverlap(clip(1000), clip(2999))).toBe(true);
    expect(clipsOverlap(clip(1000), clip(3000))).toBe(false);
    // Every pair, as positions in the list given.
    expect(overlappingPairs([clip(8300), clip(10_000), clip(11_900)])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    // The third overlaps the first but not the one listed between them.
    expect(overlappingPairs([clip(10_000), clip(7900), clip(11_900)])).toEqual([[0, 2]]);
  });
});

/** The scrubbed production timelines under test/data. */
function loadRecording(id: string): {
  timeline: AnalysisState[];
  recordingMs: number;
  instants: number[];
} {
  const file = fileURLToPath(new URL(`./data/analysis-${id}.json`, import.meta.url));
  const data = JSON.parse(readFileSync(file, "utf8")) as {
    timeline: unknown;
    recordingMs: number;
    instants: number[];
  };
  return { ...data, timeline: analysisTimelineSchema.parse(data.timeline) };
}

/** What a generated plan may pick (findPlanViolations' own legality). */
function pickable(s: AnalysisState): boolean {
  return (
    s.legibility !== "unreadable" &&
    !s.sameStateAsPrevious &&
    !(s.screenKind !== undefined && PLAN_SKIP_SCREEN_KINDS.has(s.screenKind))
  );
}

/** The most clips that can be used together: none sharing footage. */
function separateClips(starts: number[]): number {
  let last = Number.NEGATIVE_INFINITY;
  let n = 0;
  for (const start of [...starts].sort((a, b) => a - b)) {
    if (start >= last + STEP_MS) {
      n++;
      last = start;
    }
  }
  return n;
}

describe("the rule on real recordings (test/data, text scrubbed)", () => {
  it.each([
    // [analysis, moments, pickable, calm pickable, two-pages pickable, clips usable together]
    ["4219e82e", 65, 49, 12, 7, 26],
    ["6658999c", 65, 50, 12, 8, 27],
    ["f6e343d1", 27, 17, 0, 7, 9],
  ])(
    "%s: every moment has a 2 s clip holding it, and a plan has its five separate clips",
    (id, moments, pickableCount, calm, twoPages, together) => {
      const { timeline, recordingMs, instants } = loadRecording(id);
      const endMs = recordingEndMs(recordingMs, timeline, SAMPLE_MS);
      const clips = place(timeline, instants, endMs);
      expect(clips).toHaveLength(moments);
      clips.forEach((clip, i) => {
        const moment = timeline[i]!.timestampMs;
        expect(clip.startMs).toBeGreaterThanOrEqual(0);
        expect(clip.startMs + STEP_MS).toBeLessThanOrEqual(endMs);
        expect(clip.startMs).toBeLessThanOrEqual(moment);
        expect(moment).toBeLessThan(clip.startMs + STEP_MS);
        expect(msToFrame(clip.startMs + STEP_MS) - msToFrame(clip.startMs)).toBe(60);
      });
      const picks = clips.filter((_, i) => pickable(timeline[i]!));
      expect(picks).toHaveLength(pickableCount);
      expect(picks.filter((clip) => clip.calm)).toHaveLength(calm);
      expect(picks.filter((clip) => clip.twoPages)).toHaveLength(twoPages);
      expect(separateClips(picks.map((clip) => clip.startMs))).toBe(together);
      expect(together).toBeGreaterThanOrEqual(5);
    },
  );

  it("without its instants the same recording still gives every moment a clip, none calm", () => {
    const { timeline, recordingMs } = loadRecording("f6e343d1");
    const endMs = recordingEndMs(recordingMs, timeline, SAMPLE_MS);
    const clips = place(timeline, null, endMs);
    expect(clips.every((clip) => !clip.calm)).toBe(true);
    clips.forEach((clip, i) => {
      // At the moment, except where the recording's end pulls it back.
      expect(clip.startMs).toBe(Math.min(timeline[i]!.timestampMs, endMs - STEP_MS));
    });
  });
});

describe("analysisInstants — what the footage row gives the placement", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let demoId: string;

  beforeAll(async () => {
    const testDb = await createTestDb();
    db = testDb.db;
    pg = testDb.pg;
    const business = await createBusiness(db, {
      ownerEmail: "clips@example.com",
      name: "קליפים",
      ownerRole: "admin",
    });
    const demo = await db.insert(dbSchema.demos).values({ businessId: business.id }).returning();
    demoId = demo[0]!.id;
  });

  afterAll(async () => {
    await pg.close();
  });

  /** A failed analysis row: any number may exist per demo. */
  async function analysisWithFootage(
    footage: { detector: string | null; instants: unknown } | null,
  ): Promise<string> {
    const analysis = await db
      .insert(dbSchema.demoAnalyses)
      .values({ demoId, status: "failed" })
      .returning();
    const analysisId = analysis[0]!.id;
    if (footage) {
      await db
        .insert(dbSchema.demoAnalysisFootage)
        .values({ analysisId, fps: 5, fileSha: "x", moments: [], ...footage });
    }
    return analysisId;
  }

  it("no footage row: not known", async () => {
    expect(await analysisInstants(db, await analysisWithFootage(null))).toBeNull();
  });

  it("a row from the measured detector: its instants' times", async () => {
    const id = await analysisWithFootage({
      detector: SCREENS_DETECTOR,
      instants: [
        { atMs: 1133, strength: 1.2, abrupt: 0.4 },
        { atMs: 2033, strength: 2.8, abrupt: 0.9 },
      ],
    });
    expect(await analysisInstants(db, id)).toEqual([1133, 2033]);
  });

  it("an empty instant list is a known answer, not an unknown one", async () => {
    const id = await analysisWithFootage({ detector: SCREENS_DETECTOR, instants: [] });
    expect(await analysisInstants(db, id)).toEqual([]);
  });

  it("a failed decode, another detector or a malformed list: not known", async () => {
    expect(
      await analysisInstants(db, await analysisWithFootage({ detector: null, instants: null })),
    ).toBeNull();
    expect(
      await analysisInstants(
        db,
        await analysisWithFootage({ detector: "screens@2", instants: [{ atMs: 500 }] }),
      ),
    ).toBeNull();
    expect(
      await analysisInstants(
        db,
        await analysisWithFootage({ detector: SCREENS_DETECTOR, instants: [{ at: 500 }] }),
      ),
    ).toBeNull();
  });
});
