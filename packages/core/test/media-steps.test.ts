import { execFile } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { clusterStates, extractFrames, frameHashes, probe } from "../src/media/ffmpeg";

const exec = promisify(execFile);

/**
 * Runs against the real ffmpeg binaries, like media-color.test.ts. The
 * two-scene clip hard-cuts from a left-to-right luma ramp to the reversed
 * ramp (structure flip); the flat-cut clip hard-cuts white to black — zero
 * structure on both sides, so only the hash's luma band can split it.
 */

const dir = path.join(tmpdir(), "aiugc-media-steps");
const twoScene = path.join(dir, "two-scene.mp4");
const staticClip = path.join(dir, "static.mp4");
const flatCut = path.join(dir, "flat-cut.mp4");

const RAMP = "color=c=black:s=288x512:r=10:d=2,format=gray,geq=lum=X*255/W";
const RAMP_REVERSED = "color=c=black:s=288x512:r=10:d=2,format=gray,geq=lum=(W-1-X)*255/W";
const FLAT_WHITE = "color=c=white:s=288x512:r=10:d=2";
const FLAT_BLACK = "color=c=black:s=288x512:r=10:d=2";

const CONCAT = ["-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", "-pix_fmt", "yuv420p"];

beforeAll(async () => {
  mkdirSync(dir, { recursive: true });
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", RAMP, "-f", "lavfi", "-i", RAMP_REVERSED],
    ...CONCAT,
    twoScene,
  ]);
  await exec("ffmpeg", ["-y", "-f", "lavfi", "-i", RAMP, "-pix_fmt", "yuv420p", staticClip]);
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", FLAT_WHITE, "-f", "lavfi", "-i", FLAT_BLACK],
    ...CONCAT,
    flatCut,
  ]);
}, 30_000);

describe("frameHashes", () => {
  it("hashes a monotonic ramp to all-ones horizontal, all-zero vertical bits", async () => {
    const hashes = await frameHashes(staticClip, { fps: 5 });
    expect(hashes.length).toBeGreaterThanOrEqual(8);
    // Band layout: [64 horizontal][63 vertical][16 luma]. The ramp rises
    // left-to-right (all H bits set) and is constant top-to-bottom — up to
    // the ±1 luma quantization noise yuv420p leaves between cells, which is
    // exactly what maxHamming absorbs.
    expect(hashes[0]! >> 79n).toBe((1n << 64n) - 1n);
    const vBand = (hashes[0]! >> 16n) & ((1n << 63n) - 1n);
    const vNoiseBits = (vBand.toString(2).match(/1/g) ?? []).length;
    expect(vNoiseBits).toBeLessThanOrEqual(4);
  });
});

describe("clusterStates", () => {
  it("collapses a static screen into one cluster", async () => {
    const hashes = await frameHashes(staticClip, { fps: 5 });
    const timestamps = hashes.map((_, i) => i * 200);
    const clusters = clusterStates(hashes, timestamps, { maxHamming: 14 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.startMs).toBe(0);
    expect(clusters[0]!.endMs).toBe(timestamps[timestamps.length - 1]);
  });

  it("splits on a real content change", async () => {
    const hashes = await frameHashes(twoScene, { fps: 5 });
    const timestamps = hashes.map((_, i) => i * 200);
    const clusters = clusterStates(hashes, timestamps, { maxHamming: 14 });
    expect(clusters).toHaveLength(2);
    // The cut is at 2000ms; each cluster must sit fully on its own side.
    expect(clusters[0]!.endMs).toBeLessThan(2000);
    expect(clusters[1]!.startMs).toBeGreaterThanOrEqual(2000);
    for (const c of clusters) {
      expect(c.representativeMs).toBeGreaterThanOrEqual(c.startMs);
      expect(c.representativeMs).toBeLessThanOrEqual(c.endMs);
    }
  });

  it("splits a flat-to-flat cut on the luma band alone", async () => {
    const hashes = await frameHashes(flatCut, { fps: 5 });
    const timestamps = hashes.map((_, i) => i * 200);
    const clusters = clusterStates(hashes, timestamps, { maxHamming: 14 });
    expect(clusters).toHaveLength(2);
  });

  it("splits a slow drift that never crosses the threshold in one step", () => {
    // Thermometer-shaped hashes: adjacent distance 3, cumulative unbounded.
    // Neighbour comparison would merge all 9 frames into one cluster.
    const hashes = Array.from({ length: 9 }, (_, i) => (1n << BigInt(3 * i)) - 1n);
    const timestamps = hashes.map((_, i) => i * 200);
    const clusters = clusterStates(hashes, timestamps, { maxHamming: 14 });
    expect(clusters.length).toBeGreaterThan(1);
  });

  it("drops single-frame noise clusters when minFrames is set", () => {
    const stable = 0n;
    const noise = (1n << 40n) - 1n; // far from stable
    const hashes = [stable, stable, stable, noise, stable, stable, stable];
    const timestamps = hashes.map((_, i) => i * 200);
    const clusters = clusterStates(hashes, timestamps, { maxHamming: 14, minFrames: 2 });
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.representativeMs)).not.toContain(600); // the noise frame
  });

  it("rejects mismatched input lengths", () => {
    expect(() => clusterStates([0n], [], { maxHamming: 14 })).toThrow("1 hashes");
  });
});

describe("extractFrames", () => {
  it("writes numbered JPEGs with index-derived timestamps", { timeout: 30_000 }, async () => {
    const out = path.join(dir, "frames");
    const frames = await extractFrames(twoScene, out, { fps: 2, width: 96 });
    expect(frames.length).toBeGreaterThanOrEqual(7); // ~4s at 2fps
    expect(frames[0]!.timestampMs).toBe(0);
    expect(frames[1]!.timestampMs).toBe(500);
    for (const f of frames) expect(statSync(f.path).size).toBeGreaterThan(0);
    expect((await probe(frames[0]!.path)).width).toBe(96);
  });

  it("clears stale frames when re-extracting into the same dir", { timeout: 30_000 }, async () => {
    const out = path.join(dir, "frames-reuse");
    const first = await extractFrames(twoScene, out, { fps: 2, width: 96 });
    const second = await extractFrames(twoScene, out, { fps: 1, width: 96 });
    // Retry at a lower fps must not return phantom frames from the first run.
    expect(second.length).toBeLessThan(first.length);
    const last = second[second.length - 1]!;
    expect(last.timestampMs).toBeLessThan(4000); // inside the 4s video
  });
});
