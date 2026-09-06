import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import {
  alignmentOffset,
  meanRgb,
  measureDurationMs,
  probeColorTags,
  retagBt709Limited,
  rgbSeries,
} from "../src/media/ffmpeg";

const exec = promisify(execFile);

/**
 * Runs against the real ffmpeg/ffprobe binaries (the worker needs them anyway;
 * probe() in live runs depends on them too). Clips are 64x64 / 0.3s — the
 * whole file generates in well under a second.
 */

const dir = path.join(tmpdir(), "aiugc-media-color");
const untagged = path.join(dir, "untagged.mp4");
const tagged = path.join(dir, "tagged.mp4");
const black = path.join(dir, "black.mp4");
const blackFull = path.join(dir, "black-full.mp4");
const halves = path.join(dir, "halves.mp4");
const pattern = path.join(dir, "pattern.mp4");
const patternShifted = path.join(dir, "pattern-shifted.mp4");

beforeAll(async () => {
  mkdirSync(dir, { recursive: true });
  const base = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=64x64:r=10:d=0.3",
    "-pix_fmt",
    "yuv420p",
  ];
  // libx264 with no colour flags writes no VUI colour metadata — same shape as
  // the lip-sync provider's clips. The tagged variant stamps all four fields
  // via the bitstream filter (the -colorspace/-color_trc output flags only
  // reach matrix + range in the VUI).
  await exec("ffmpeg", [...base, untagged]);
  await exec("ffmpeg", [
    ...["-y", "-i", untagged, "-c", "copy", "-bsf:v"],
    "h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1",
    tagged,
  ]);
  // Black encodes as stored Y=16 (limited range). The same bits tagged FULL
  // read as a dark grey — the two files differ only in their range tag.
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10:d=0.3", "-pix_fmt", "yuv420p"],
    black,
  ]);
  await exec("ffmpeg", [
    ...["-y", "-i", black, "-c", "copy", "-bsf:v", "h264_metadata=video_full_range_flag=1"],
    blackFull,
  ]);
  // A production-size frame, half white and half black: the one shape a
  // downscale kernel gets wrong (swscale's 1080→1 path is nonlinear), so the
  // mean has to come from the plane itself.
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i"],
    "color=c=black:s=1080x1920:r=10:d=0.2,drawbox=x=0:y=0:w=540:h=1920:c=white:t=fill",
    ...["-pix_fmt", "yuv420p", halves],
  ]);
  // A textured frame and the same frame shifted 8px up and 4px right — what
  // the alignment search has to find.
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=10:d=0.2", "-pix_fmt", "yuv420p"],
    pattern,
  ]);
  await exec("ffmpeg", [
    ...["-y", "-i", pattern, "-vf"],
    "pad=1088:1928:4:0:black,crop=1080:1920:0:8",
    ...["-pix_fmt", "yuv420p", patternShifted],
  ]);
}, 60_000);

describe("probeColorTags", () => {
  it("reports every field unset on an untagged clip", async () => {
    expect(await probeColorTags(untagged)).toEqual({
      colorRange: undefined,
      colorSpace: undefined,
      colorPrimaries: undefined,
      colorTransfer: undefined,
    });
  });

  it("reports the fields of a tagged clip", async () => {
    expect(await probeColorTags(tagged)).toEqual({
      colorRange: "tv",
      colorSpace: "bt709",
      colorPrimaries: "bt709",
      colorTransfer: "bt709",
    });
  });
});

describe("retagBt709Limited", () => {
  it("stamps BT.709 limited range without re-encoding", async () => {
    const out = path.join(dir, "retagged.mp4");
    await retagBt709Limited(untagged, out);
    expect(await probeColorTags(out)).toEqual({
      colorRange: "tv",
      colorSpace: "bt709",
      colorPrimaries: "bt709",
      colorTransfer: "bt709",
    });
    // Stream copy: same frames, same duration.
    expect(await measureDurationMs(out)).toBe(await measureDurationMs(untagged));
  });
});

const near = (rgb: number[], value: number, tolerance: number) =>
  rgb.every((v) => Math.abs(v - value) <= tolerance);

describe("meanRgb", () => {
  it("reads the frame per the file's own range tag, onto one full-range scale", async () => {
    // Stored Y=16 is black in limited range (→ 0) and a dark grey in full
    // range (→ 16): a grade measured between an opener and a talking head
    // is only meaningful if both are expanded per their tags first.
    expect(near(await meanRgb(black, 100), 0, 1)).toBe(true);
    expect(near(await meanRgb(blackFull, 100), 16, 1)).toBe(true);
    // Untagged reads as limited, ffmpeg's default — the retag agrees with it.
    expect(near(await meanRgb(untagged, 100), 128, 2)).toBe(true);
  });

  it("is a true mean of a production-size frame, not a downscale kernel's guess", async () => {
    expect(near(await meanRgb(halves, 100), 127.5, 2)).toBe(true);
  });

  it("measures only the region asked for", async () => {
    expect(near(await meanRgb(halves, 100, "crop=iw/2:ih:0:0"), 255, 2)).toBe(true);
    expect(near(await meanRgb(halves, 100, "crop=iw/2:ih:iw/2:0"), 0, 2)).toBe(true);
  });

  it("reads the last frame when the time is past the end (a reveal tagged on duration_ms)", async () => {
    expect(near(await meanRgb(black, 5000), 0, 1)).toBe(true);
  });
});

describe("alignmentOffset", () => {
  it("finds how far the second frame has to move to sit on the first", async () => {
    // The shifted copy shows the pattern 4px further right and 8px higher, so
    // it must move 4px left and 8px down to line up; the search is 4px-grained.
    const { dx, dy } = await alignmentOffset(pattern, 100, patternShifted, 100);
    expect(dx).toBe(-4);
    expect(dy).toBe(8);
    expect(await alignmentOffset(pattern, 100, pattern, 100)).toEqual({ dx: 0, dy: 0 });
  });
});

describe("rgbSeries", () => {
  it("returns one mean per source frame from the time asked", async () => {
    // black.mp4 is 0.3s at 10fps: three frames from 0, two from 0.1.
    const all = await rgbSeries(black, 0, 10);
    expect(all).toHaveLength(3);
    expect(all.every((rgb) => near(rgb, 0, 1))).toBe(true);
    expect(await rgbSeries(black, 100, 10)).toHaveLength(2);
    expect((await rgbSeries(halves, 0, 10)).every((rgb) => near(rgb, 127.5, 2))).toBe(true);
  });
});
