import { describe, expect, it } from "vitest";
import { bt709FfmpegOverride } from "../src/render";

const BSF =
  "h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1";

describe("bt709FfmpegOverride", () => {
  it("inserts the SPS relabel before the output on the stitcher", () => {
    const args = ["-i", "pre-encode.mp4", "-c:v", "copy", "final.mp4"];
    const out = bt709FfmpegOverride({ type: "stitcher", args });
    expect(out).toEqual(["-i", "pre-encode.mp4", "-c:v", "copy", "-bsf:v", BSF, "final.mp4"]);
  });

  it("leaves the pre-stitcher untouched", () => {
    const args = ["-i", "-", "-c:v", "libx264", "out.mp4"];
    expect(bt709FfmpegOverride({ type: "pre-stitcher", args })).toEqual(args);
  });
});
