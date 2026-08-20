import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeVideo, parseRate, probe } from "../src/media/ffmpeg";
import { needsNormalize } from "../src/pipelines/bank";

const exec = promisify(execFile);

/**
 * Frame rate is the one property of a bank clip nothing upstream can check —
 * the browser upload reads MIME/size/dimensions/duration and cannot read a
 * rate — so probe() has to report the EFFECTIVE rate and normalizeVideo() has
 * to fix it. Real ffmpeg, 64x64 clips (the worker needs the binaries anyway,
 * and test/media-color.test.ts already requires them).
 */

const dir = path.join(tmpdir(), "aiugc-media-rate");
const at24 = path.join(dir, "24fps.mp4");
const at30 = path.join(dir, "30fps.mp4");
/** 30fps timebase, but frames only every ~6th slot: r_frame_rate says 30,
 *  avg_frame_rate says ~5.8. Reading the wrong field passes this clip. */
const vfr = path.join(dir, "vfr.mp4");
const normalized = path.join(dir, "normalized.mp4");

beforeAll(async () => {
  mkdirSync(dir, { recursive: true });
  for (const [rate, file] of [
    ["24", at24],
    ["30", at30],
  ] as const) {
    await exec("ffmpeg", [
      ...["-y", "-f", "lavfi", "-i", `testsrc=s=64x64:r=${rate}:d=0.3`],
      ...["-pix_fmt", "yuv420p", file],
    ]);
  }
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", "testsrc=s=64x64:r=30:d=4"],
    ...["-vf", "select='eq(n,0)+eq(n,1)+not(mod(n,6))'", "-fps_mode", "vfr"],
    ...["-pix_fmt", "yuv420p", vfr],
  ]);
  await normalizeVideo(at24, normalized);
}, 60_000);

describe("parseRate", () => {
  it("reads ffprobe's rational rates", () => {
    expect(parseRate("30/1")).toBe(30);
    expect(parseRate("30000/1001")).toBeCloseTo(29.97, 2);
  });

  it("reports 0 for every shape that means 'no idea'", () => {
    for (const rate of ["0/0", "N/A", "30", "", undefined]) expect(parseRate(rate)).toBe(0);
  });
});

describe("needsNormalize", () => {
  it("leaves 30 and NTSC 29.97 alone", () => {
    expect(needsNormalize(30)).toBe(false);
    expect(needsNormalize(30000 / 1001)).toBe(false);
  });

  it("catches the rates that judder", () => {
    expect(needsNormalize(24)).toBe(true);
    expect(needsNormalize(25)).toBe(true);
    expect(needsNormalize(60)).toBe(true);
  });

  it("never rewrites a master on an unknown rate", () => {
    expect(needsNormalize(0)).toBe(false);
  });
});

describe("probe", () => {
  it("reports the frame rate", async () => {
    expect((await probe(at24)).fps).toBeCloseTo(24, 3);
    expect((await probe(at30)).fps).toBeCloseTo(30, 3);
  });

  it("reports the EFFECTIVE rate of a variable-rate clip, not its timebase", async () => {
    // r_frame_rate would say 30 here and wave the clip through.
    const { fps } = await probe(vfr);
    expect(fps).toBeLessThan(10);
    expect(needsNormalize(fps)).toBe(true);
  });
});

describe("normalizeVideo", () => {
  it("brings an off-rate clip to the composition's 30fps", async () => {
    expect((await probe(normalized)).fps).toBeCloseTo(30, 3);
  });

  it("keeps the 1080x1920 delivery frame", async () => {
    const info = await probe(normalized);
    expect([info.width, info.height]).toEqual([1080, 1920]);
  });
});
