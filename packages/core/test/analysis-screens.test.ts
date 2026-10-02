import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import {
  clusterStates,
  extractFramesAt,
  frameSignatures,
  signatureOf,
  SIGNATURE_HEIGHT,
  SIGNATURE_WIDTH,
} from "../src/media/ffmpeg";
import {
  analysisMoments,
  footageEvents,
  momentHold,
  screenChanges,
  SIGNATURE_FPS,
} from "../src/pipelines/analysis-screens";

const exec = promisify(execFile);
const W = SIGNATURE_WIDTH;
const H = SIGNATURE_HEIGHT;

/** A deterministic textured frame: `seed` picks the texture, `shift` slides it
 *  sideways (a scroll or a camera pan), `gain` scales its brightness. */
function frame(seed: number, shift = 0, gain = 1): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + shift) >> 3;
      const v = y >> 3;
      const texel = ((u * 73856093) ^ (v * 19349663) ^ (seed * 83492791)) >>> 0;
      out[y * W + x] = Math.min(255, Math.round((40 + (texel % 160)) * gain));
    }
  }
  return out;
}

describe("signatureOf", () => {
  it("rejects a frame of the wrong size", () => {
    expect(() => signatureOf(new Uint8Array(10))).toThrow(/expected/);
  });

  it("gives a flat frame no edges and a flat brightness map", () => {
    const flat = signatureOf(new Uint8Array(W * H).fill(200));
    expect(Math.max(...flat.edges)).toBe(0);
    expect(Math.max(...flat.luma.map(Math.abs))).toBe(0);
  });

  it("describes layout, not exposure: a dimmer copy of a frame has the same edge shares", () => {
    const bright = signatureOf(frame(1));
    const dim = signatureOf(frame(1, 0, 0.6));
    let distance = 0;
    for (let k = 0; k < bright.edges.length; k++) {
      distance += Math.abs(bright.edges[k]! - dim.edges[k]!);
    }
    expect(distance).toBeLessThan(0.02);
  });
});

describe("footageEvents", () => {
  const held = (seed: number, n: number) =>
    Array.from({ length: n }, () => signatureOf(frame(seed)));

  it("finds a cut between two held screens, at the cut, as a cut", () => {
    const events = footageEvents([...held(1, 45), ...held(2, 45)]);
    expect(events).toHaveLength(1);
    // Frame 45 is the first of the new screen; the peak sits within the gap.
    expect(Math.abs(events[0]!.atMs - (45 * 1000) / SIGNATURE_FPS)).toBeLessThanOrEqual(200);
    expect(events[0]!.strength).toBeGreaterThan(1);
    expect(events[0]!.abrupt).toBeGreaterThanOrEqual(0.9);
  });

  it("finds nothing on a held screen", () => {
    expect(footageEvents(held(1, 90))).toEqual([]);
  });

  it("finds nothing in a steady pan: it differs as much across each hold as across the gap", () => {
    const pan = Array.from({ length: 90 }, (_, i) => signatureOf(frame(1, i * 3)));
    expect(footageEvents(pan)).toEqual([]);
  });

  it("gives identical instants for identical input (decision 0078)", () => {
    const build = () => [...held(1, 40), ...held(2, 30), ...held(3, 40)];
    const first = footageEvents(build());
    expect(first).toHaveLength(2);
    expect(footageEvents(build())).toEqual(first);
  });

  it("is too short to judge below one gap and two holds, and says nothing", () => {
    expect(footageEvents(held(1, 10))).toEqual([]);
  });
});

describe("analysisMoments and momentHold", () => {
  // The same deterministic pseudo-random walk every run: no Math.random in a test.
  let state = 12345;
  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state;
  };

  it("every moment has start <= t <= end, and spans never overlap — for any hash sequence", () => {
    for (let round = 0; round < 200; round++) {
      const n = 20 + (next() % 200);
      const hashes: bigint[] = [];
      let current = BigInt(next());
      for (let i = 0; i < n; i++) {
        // Hold, drift by a bit, or jump: every way a real sequence moves.
        const roll = next() % 10;
        if (roll === 0) current = BigInt(next()) << 40n;
        else if (roll < 3) current ^= 1n << BigInt(next() % 100);
        hashes.push(current);
      }
      const timestamps = hashes.map((_, i) => i * 200);
      const kept = clusterStates(hashes, timestamps, { maxHamming: 14, minFrames: 2 });
      const moments = analysisMoments(
        kept,
        kept.map(() => true),
      );
      moments.forEach((moment, i) => {
        expect(moment.startMs).toBeLessThanOrEqual(moment.t);
        expect(moment.t).toBeLessThanOrEqual(moment.endMs);
        if (i > 0) expect(moment.startMs).toBeGreaterThan(moments[i - 1]!.endMs);
      });
    }
  });

  it("keeps a moment whose read failed, marked, with its span", () => {
    const kept = [
      { startMs: 0, endMs: 400, representativeMs: 200 },
      { startMs: 600, endMs: 1400, representativeMs: 1000 },
    ];
    expect(analysisMoments(kept, [true, false])).toEqual([
      { t: 200, startMs: 0, endMs: 400, read: true },
      { t: 1000, startMs: 600, endMs: 1400, read: false },
    ]);
    expect(() => analysisMoments(kept, [true])).toThrow(/read flags/);
  });

  it("cuts a span back to the changes on either side of its moment", () => {
    const moment = { t: 5000, startMs: 2000, endMs: 9000, read: true };
    expect(momentHold(moment, [])).toEqual({ startMs: 2000, endMs: 9000 });
    // A cluster can run across a real change: the hold stops at it.
    expect(momentHold(moment, [{ atMs: 3100 }, { atMs: 7400 }, { atMs: 8000 }])).toEqual({
      startMs: 3100,
      endMs: 7400,
    });
    expect(momentHold(moment, [{ atMs: 1000 }, { atMs: 9500 }])).toEqual({
      startMs: 2000,
      endMs: 9000,
    });
  });
});

describe("screenChanges — when unsure, it is a change (decision 0079)", () => {
  const at = (atMs: number) => ({ atMs, strength: 2, abrupt: 0.5 });

  it("an instant nobody judged is a change", () => {
    expect(screenChanges([{ ...at(1000), label: null, sure: false }])).toEqual([
      { atMs: 1000, kind: "change", why: "unjudged" },
    ]);
  });

  it("an unsure answer is a change whatever it leaned towards; a sure same-screen answer is not", () => {
    expect(
      screenChanges([
        { ...at(1000), label: "overlay", sure: true },
        { ...at(2000), label: "content", sure: false },
        { ...at(3000), label: "new", sure: true },
      ]),
    ).toEqual([
      { atMs: 2000, kind: "change", why: "unsure" },
      { atMs: 3000, kind: "change", why: "model" },
    ]);
  });

  it("a swap stays marked as a swap, sure or not", () => {
    expect(
      screenChanges([
        { ...at(1000), label: "swap", sure: true },
        { ...at(2000), label: "swap", sure: false },
      ]),
    ).toEqual([
      { atMs: 1000, kind: "swap", why: "model" },
      { atMs: 2000, kind: "swap", why: "unsure" },
    ]);
  });
});

describe("frameSignatures and extractFramesAt against real ffmpeg", () => {
  const dir = path.join(tmpdir(), "aiugc-analysis-screens");
  const twoScene = path.join(dir, "two-scene.mp4");
  // Two textured scenes of 2 s each at 30 fps, hard cut between them.
  const scene = (seed: number) =>
    `color=c=black:s=288x512:r=30:d=2,format=gray,geq=lum=mod(floor(X/16)*${seed}+floor(Y/16)*31\\,200)+20`;

  beforeAll(async () => {
    mkdirSync(dir, { recursive: true });
    await exec("ffmpeg", [
      ...["-y", "-f", "lavfi", "-i", scene(37), "-f", "lavfi", "-i", scene(91)],
      ...["-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", "-pix_fmt", "yuv420p"],
      twoScene,
    ]);
  }, 30_000);

  it("streams one signature per frame and finds the cut at 2 s", async () => {
    const signatures = await frameSignatures(twoScene, { fps: SIGNATURE_FPS });
    expect(signatures).toHaveLength(120);
    const events = footageEvents(signatures);
    expect(events).toHaveLength(1);
    expect(Math.abs(events[0]!.atMs - 2000)).toBeLessThanOrEqual(200);
  }, 30_000);

  it("extracts a hundred named frames in one pass (a flat select of that many terms fails)", async () => {
    const frameIndexes = Array.from({ length: 100 }, (_, i) => i);
    const frames = await extractFramesAt(twoScene, path.join(dir, "frames"), {
      fps: SIGNATURE_FPS,
      width: 96,
      frameIndexes,
    });
    expect(frames).toHaveLength(100);
    expect(frames[99]!.timestampMs).toBe(3300);
  }, 30_000);

  it("tiles every four frames into one strip, stamped with its first frame's time", async () => {
    const strips = await extractFramesAt(twoScene, path.join(dir, "strips"), {
      fps: SIGNATURE_FPS,
      width: 96,
      frameIndexes: [3, 6, 9, 12, 60, 63, 66, 69],
      tile: 4,
    });
    expect(strips.map((s) => s.timestampMs)).toEqual([100, 2000]);
    await expect(
      extractFramesAt(twoScene, path.join(dir, "strips"), {
        fps: SIGNATURE_FPS,
        width: 96,
        frameIndexes: [1, 2, 3],
        tile: 4,
      }),
    ).rejects.toThrow(/do not fill strips/);
  }, 30_000);
});
