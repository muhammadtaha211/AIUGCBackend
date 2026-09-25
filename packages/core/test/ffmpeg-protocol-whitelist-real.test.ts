import { describe, expect, it } from "vitest";
import { probe } from "../src/media/ffmpeg";

/**
 * INP-08 control (a), real ffprobe (no mocking): a non-file protocol that
 * needs no network — a `data:` URI carrying real mp4 bytes, so without the
 * whitelist ffprobe would open and probe it successfully via the `data`
 * protocol — is refused specifically because it is not on the protocol
 * whitelist, not merely because it fails to parse. Confirmed by hand first
 * (2026-09-25, ffmpeg/ffprobe 8.1.2-full_build-www.gyan.dev, Windows): the
 * same data: URI probes fine with no whitelist and fails with
 * `Protocol 'data' not on whitelist 'file'!` once probe() applies it.
 */
describe("probe() refuses a non-file protocol (real ffprobe, INP-08 control a)", () => {
  it("rejects a data: URI with ffprobe's own not-on-whitelist error, not a generic parse failure", async () => {
    // "hello" is not valid video — deliberately: the protocol check must fire
    // before any format probing even looks at the bytes.
    const dataUri = "data:text/plain;base64,aGVsbG8=";
    await expect(probe(dataUri)).rejects.toThrow(/Protocol 'data' not on whitelist 'file'/);
  });
});
