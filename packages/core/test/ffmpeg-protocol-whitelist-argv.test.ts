import { describe, expect, it } from "vitest";
import { withProtocolWhitelist } from "../src/media/ffmpeg";

/**
 * INP-08 control (a) — argv shape. `withProtocolWhitelist` is what runRaw
 * applies to every ffmpeg/ffprobe spawn (media/ffmpeg.ts), so every one of
 * these shapes is what a real wrapper's argv looks like before the spawn:
 * several `-i` flags (a hypothetical multi-input call — none of today's
 * wrappers build one, but the transform must not special-case single-input),
 * `-ss` before `-i` (thumbnail()), a `-f lavfi` input (not used by any
 * wrapper here, but representative of the shape a future caller could build),
 * and an ffprobe call (no `-i` at all — every ffprobe wrapper passes the
 * filename as the one trailing positional argument).
 */
describe("withProtocolWhitelist (INP-08 control a — argv)", () => {
  it("inserts -protocol_whitelist file immediately before every -i, for several -i flags", () => {
    const args = ["-i", "a.mp4", "-i", "b.mp4", "-filter_complex", "[0][1]concat", "out.mp4"];
    expect(withProtocolWhitelist(args)).toEqual([
      "-protocol_whitelist",
      "file",
      "-i",
      "a.mp4",
      "-protocol_whitelist",
      "file",
      "-i",
      "b.mp4",
      "-filter_complex",
      "[0][1]concat",
      "out.mp4",
    ]);
  });

  it("inserts before -i even when -ss (a seek option) precedes it", () => {
    const args = ["-y", "-ss", "1.00", "-i", "in.mp4", "-vframes", "1", "out.jpg"];
    expect(withProtocolWhitelist(args)).toEqual([
      "-y",
      "-ss",
      "1.00",
      "-protocol_whitelist",
      "file",
      "-i",
      "in.mp4",
      "-vframes",
      "1",
      "out.jpg",
    ]);
  });

  it("inserts before a -f lavfi input's -i the same as any other input", () => {
    const args = ["-y", "-f", "lavfi", "-i", "color=c=gray:s=64x64:d=1", "out.mp4"];
    expect(withProtocolWhitelist(args)).toEqual([
      "-y",
      "-f",
      "lavfi",
      "-protocol_whitelist",
      "file",
      "-i",
      "color=c=gray:s=64x64:d=1",
      "out.mp4",
    ]);
  });

  it("prepends once for an ffprobe-shaped call with no -i (the filename is positional)", () => {
    const args = ["-v", "error", "-print_format", "json", "-show_format", "clip.mp4"];
    expect(withProtocolWhitelist(args)).toEqual([
      "-protocol_whitelist",
      "file",
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "clip.mp4",
    ]);
  });

  it("carries exactly one protocol — file — never crypto or anything wider", () => {
    const [, protocols] = withProtocolWhitelist(["-i", "x.mp4", "out.mp4"]);
    expect(protocols).toBe("file");
  });
});
