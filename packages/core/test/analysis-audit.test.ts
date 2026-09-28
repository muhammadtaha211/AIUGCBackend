import { describe, expect, it } from "vitest";
import {
  attributeLosses,
  diffKept,
  droppedFromTimeline,
  locateMoment,
  onFpsGrid,
  parseResumeKey,
  tierReasons,
  timelineLosses,
} from "../src/pipelines/analysis-audit";
import { MAX_HAMMING } from "../src/pipelines/demo-analysis";

/**
 * `aiugc demo audit`'s attribution, on synthetic frame hashes — no ffmpeg.
 * A state is a block of set bits; two blocks that do not overlap sit 2×width
 * apart, far over MAX_HAMMING (14), so every block change is a cluster split.
 */
const block = (k: number, width = 20): bigint => ((1n << BigInt(width)) - 1n) << BigInt(width * k);
const A = block(0);
const B = block(1);
const C = block(2);
const D = block(3);
/** A with 10 more bits set: within MAX_HAMMING of A, so it merges into A's
 *  cluster — the subtle change (a toggle, a typed field) the audit looks for. */
const A2 = A | (((1n << 10n) - 1n) << 100n);

const frames = (...runs: [bigint, number][]) => runs.flatMap(([h, n]) => Array(n).fill(h));
const state = (timestampMs: number, legibility: "high" | "low" | "unreadable" = "high") => ({
  timestampMs,
  legibility,
  sameStateAsPrevious: false,
  actionType: "tap" as const,
  screenKind: "product" as const,
});

describe("attributeLosses", () => {
  // 5 fps: A 0–400 (rep 200) | B 600 alone | C 800–1400 (rep 1000) | D 1600–1800 (rep 1600)
  const hashes = frames([A, 3], [B, 1], [C, 4], [D, 2]);

  it("attributes each run to the stage that dropped it", () => {
    const audit = attributeLosses({
      hashes,
      fps: 5,
      maxStates: 80,
      timeline: [state(200), state(1000, "unreadable")],
    });
    expect(audit.runs.map((r) => [r.startMs, r.endMs, r.representativeMs])).toEqual([
      [0, 400, 200],
      [600, 600, 600],
      [800, 1400, 1000],
      [1600, 1800, 1600],
    ]);
    expect(audit.runs.map((r) => r.lostAt)).toEqual([null, "S1", "S4", "S3"]);
    expect(audit.runs.map((r) => r.timelineIndex)).toEqual([0, null, 1, null]);
    expect(audit).toMatchObject({ clustersBeforeS1: 4, clustersAfterS1: 3, s1: 1, s2: 0, s3: 1 });
    expect(audit.keptMs).toEqual([200, 1000, 1600]);
    expect(audit.unmatchedTimelineMs).toEqual([]);
  });

  it("measures duration in held frames and Hamming from the previous run's anchor", () => {
    const audit = attributeLosses({ hashes, fps: 5, maxStates: 80, timeline: [] });
    expect(audit.runs.map((r) => r.durationMs)).toEqual([600, 200, 800, 400]);
    expect(audit.runs.map((r) => r.hammingFromPrev)).toEqual([null, 40, 40, 40]);
    // Every split exists because the anchor distance crossed the threshold.
    for (const r of audit.runs.slice(1)) expect(r.hammingFromPrev!).toBeGreaterThan(MAX_HAMMING);
  });

  it("attributes the cap's thinning to S2, by position and blind to duration", () => {
    // Five two-frame states, cap 3: subsampleClusters keeps positions 0, 1, 4.
    const five = frames([A, 2], [B, 2], [C, 2], [D, 2], [block(4), 2]);
    const reps = [0, 400, 800, 1200, 1600];
    const audit = attributeLosses({
      hashes: five,
      fps: 5,
      maxStates: 3,
      timeline: [state(0), state(400), state(1600)],
    });
    expect(audit.runs.map((r) => r.representativeMs)).toEqual(reps);
    expect(audit.runs.map((r) => r.lostAt)).toEqual([null, null, "S2", "S2", null]);
    expect(audit).toMatchObject({ s1: 0, s2: 2, s3: 0 });
  });

  it("lets the timeline decide what was held, and lists states no run holds", () => {
    // The recompute thins the 800 run, but the timeline holds its
    // representative — the analysis kept it, so it is not lost. 999 sits in
    // the same run, which already holds 800: the recompute merged two states.
    const five = frames([A, 2], [B, 2], [C, 2], [D, 2], [block(4), 2]);
    const audit = attributeLosses({
      hashes: five,
      fps: 5,
      maxStates: 3,
      timeline: [state(0), state(800), state(999), state(1600)],
    });
    expect(audit.runs.map((r) => r.lostAt)).toEqual([null, "S3", null, "S2", null]);
    expect(audit.runs.map((r) => r.timelineIndex)).toEqual([0, null, 1, null, 3]);
    expect(audit.unmatchedTimelineMs).toEqual([999]);
  });

  it("does not call a run S3 when its stored state is one frame off its representative", () => {
    // Measured 2026-09-28: on another machine two thirds of the moved
    // representatives moved by one frame. A 0–800 (rep 400) and B 1000–1800
    // (rep 1400); the analysis stored 600 and 1200. Exact matching alone
    // would report both as S3.
    const audit = attributeLosses({
      hashes: frames([A, 5], [B, 5]),
      fps: 5,
      maxStates: 80,
      timeline: [state(600), state(1200)],
    });
    expect(audit.runs.map((r) => r.representativeMs)).toEqual([400, 1400]);
    expect(audit.runs.map((r) => [r.lostAt, r.timelineIndex])).toEqual([
      [null, 0],
      [null, 1],
    ]);
    expect(audit).toMatchObject({ s3: 0, unmatchedTimelineMs: [] });
  });

  it("measures Hamming from the previous run's anchor (its first frame), not its representative", () => {
    // Run 1 is A A A2 A2 A2 (A2 within threshold of A); its representative is
    // A2. B split off because it is far from the ANCHOR A: 40 bits, where
    // from A2 it would be 50.
    const audit = attributeLosses({
      hashes: frames([A, 2], [A2, 3], [B, 2]),
      fps: 5,
      maxStates: 80,
      timeline: [],
    });
    expect(audit.runs).toHaveLength(2);
    expect(audit.runs[1]!.hammingFromPrev).toBe(40);
  });

  it("keeps a long hold with a subtle change as ONE cluster whose median shows the before state", () => {
    // 12 frames of A, then 8 of A2 (10 bits away): one 4s cluster, rep frame 9 = A.
    const audit = attributeLosses({
      hashes: frames([A, 12], [A2, 8]),
      fps: 5,
      maxStates: 80,
      timeline: [state(1800)],
    });
    expect(audit.runs).toHaveLength(1);
    expect(audit.runs[0]).toMatchObject({ startMs: 0, endMs: 3800, representativeMs: 1800 });
    expect(audit.durations).toEqual({ atLeast2s: 1, atLeast3s: 1, atLeast5s: 0, maxMs: 4000 });
    expect(audit.longHolds).toEqual([
      {
        startMs: 0,
        endMs: 3800,
        durationMs: 4000,
        firstLastHamming: 10,
        repLastHamming: 10,
        lostAt: null,
        timelineIndex: 0,
      },
    ]);
  });

  it("reports rep→last 0 when the hold's second half is the longer one", () => {
    const audit = attributeLosses({
      hashes: frames([A, 8], [A2, 12]),
      fps: 5,
      maxStates: 80,
      timeline: [],
    });
    expect(audit.longHolds[0]).toMatchObject({ firstLastHamming: 10, repLastHamming: 0 });
    expect(audit.longHolds[0]!.lostAt).toBe("S3");
  });
});

describe("tierReasons / timelineLosses (the old collapsed tier, S5)", () => {
  it("names every reason the old pickerPools collapsed a state for", () => {
    expect(tierReasons(state(0))).toEqual([]);
    expect(
      tierReasons({
        timestampMs: 0,
        legibility: "low",
        sameStateAsPrevious: true,
        actionType: "idle",
        screenKind: "system",
      }),
    ).toEqual(["low", "repeat", "idle", "skip-kind"]);
    // Absent screenKind is "no information" and never a skip.
    expect(tierReasons({ ...state(0), screenKind: undefined })).toEqual([]);
    expect(tierReasons({ ...state(0), screenKind: "other" })).toEqual([]);
  });

  it("gives an unreadable state no tier reason — it has no tile at all (S4)", () => {
    expect(tierReasons({ ...state(0, "unreadable"), actionType: "idle" })).toEqual([]);
  });

  it("counts reasons with overlaps and each tier state once", () => {
    const losses = timelineLosses([
      state(0),
      { ...state(200, "low"), actionType: "idle" },
      { ...state(400), screenKind: "login" },
      { ...state(600), sameStateAsPrevious: true },
      state(800, "unreadable"),
    ]);
    expect(losses).toEqual({
      timelineLength: 5,
      s4: 1,
      s5: { low: 1, repeat: 1, idle: 1, "skip-kind": 1, total: 3 },
    });
  });
});

describe("onFpsGrid", () => {
  it("accepts a timeline sampled at this fps and refuses one sampled at another", () => {
    expect(onFpsGrid([state(0), state(200), state(1400)], 5)).toBe(true);
    expect(onFpsGrid([state(0), state(333), state(667)], 5)).toBe(false);
  });

  it("cannot see a change from a grid that is a subset of this one", () => {
    // 1 fps timestamps all sit on the 5 fps grid — why the job checkpoint is read too.
    expect(onFpsGrid([state(0), state(1000), state(2000)], 5)).toBe(true);
  });
});

describe("parseResumeKey", () => {
  it("reads the analysis-time fps and kept representatives", () => {
    expect(parseResumeKey("analyze_demo@v3/5/10/200,1000,1600")).toEqual({
      fps: 5,
      keptMs: [200, 1000, 1600],
    });
  });

  it("refuses anything that is not the handler's four-part key", () => {
    expect(parseResumeKey("analyze_demo@v3/5/10")).toBeNull();
    expect(parseResumeKey("analyze_demo@v3/x/10/200")).toBeNull();
    expect(parseResumeKey("analyze_demo@v3/0/10/200")).toBeNull();
    expect(parseResumeKey("analyze_demo@v3/5/10/200,abc")).toBeNull();
    // An empty kept list must not read as one cluster at 0ms.
    expect(parseResumeKey("analyze_demo@v3/5/10/")).toBeNull();
  });
});

describe("droppedFromTimeline (S3 from the checkpoint)", () => {
  it("is the analysis's kept representatives the timeline lacks", () => {
    expect(droppedFromTimeline([200, 1000, 1600], [state(200), state(1600)])).toEqual([1000]);
    expect(droppedFromTimeline([200], [state(200)])).toEqual([]);
  });
});

describe("diffKept (does this machine reproduce the analysis?)", () => {
  it("is empty both ways when the recompute keeps exactly what the analysis kept", () => {
    expect(diffKept([200, 1000], [200, 1000])).toEqual({ missingMs: [], extraMs: [] });
  });

  it("names a one-frame boundary shift as one missing and one extra", () => {
    // Measured 2026-09-28: ffmpeg 8.1.2 against the box's analyses moved
    // two thirds of the moved representatives by one 200ms frame, both ways.
    expect(diffKept([200, 1000, 1600], [400, 1000, 1400])).toEqual({
      missingMs: [200, 1600],
      extraMs: [400, 1400],
    });
  });
});

describe("locateMoment", () => {
  const hashes = frames([A, 3], [B, 1], [C, 4], [D, 2]);
  const timeline = [state(200), state(1000, "unreadable")];
  const attribution = attributeLosses({ hashes, fps: 5, maxStates: 80, timeline });

  it("names the stage that lost a moment and the timeline states around it", () => {
    const at = locateMoment({ attribution, hashes, fps: 5, atMs: 590 });
    expect(at).toMatchObject({ frameMs: 600, hammingToRepresentative: 0 });
    expect(at.run).toMatchObject({ startMs: 600, lostAt: "S1" });
    expect([at.timelineBefore, at.timelineAfter]).toEqual([0, 1]);
  });

  it("names the timeline state holding a moment", () => {
    const at = locateMoment({ attribution, hashes, fps: 5, atMs: 100 });
    expect(at.run).toMatchObject({ startMs: 0, lostAt: null, timelineIndex: 0 });
  });

  it("measures the moment's frame against the representative the model saw", () => {
    // A A A2 A2 A2: representative frame 2 is A2; a moment at 0:00.0 shows A.
    const hold = frames([A, 2], [A2, 3]);
    const held = attributeLosses({ hashes: hold, fps: 5, maxStates: 80, timeline: [state(400)] });
    const at = locateMoment({ attribution: held, hashes: hold, fps: 5, atMs: 0 });
    expect(at.run).toMatchObject({ representativeMs: 400, timelineIndex: 0 });
    expect(at.hammingToRepresentative).toBe(10);
  });

  it("clamps a moment past the end to the last sampled frame", () => {
    const at = locateMoment({ attribution, hashes, fps: 5, atMs: 60_000 });
    expect(at.frameMs).toBe(1800);
    expect(at.run.lostAt).toBe("S3");
  });
});
