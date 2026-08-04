import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { measureDurationMs, probeColorTags, retagBt709Full } from "../src/media/ffmpeg";

const exec = promisify(execFile);

/**
 * Runs against the real ffmpeg/ffprobe binaries (the worker needs them anyway;
 * probe() in live runs depends on them too). Clips are 64x64 / 0.3s — the
 * whole file generates in well under a second.
 */

const dir = path.join(tmpdir(), "aiugc-media-color");
const untagged = path.join(dir, "untagged.mp4");
const tagged = path.join(dir, "tagged.mp4");

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
}, 30_000);

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

describe("retagBt709Full", () => {
  it("stamps BT.709 full range without re-encoding", async () => {
    const out = path.join(dir, "retagged.mp4");
    await retagBt709Full(untagged, out);
    expect(await probeColorTags(out)).toEqual({
      colorRange: "pc",
      colorSpace: "bt709",
      colorPrimaries: "bt709",
      colorTransfer: "bt709",
    });
    // Stream copy: same frames, same duration.
    expect(await measureDurationMs(out)).toBe(await measureDurationMs(untagged));
  });
});
