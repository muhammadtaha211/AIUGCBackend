import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { measureDurationMs, padAudioStart } from "../src/media/ffmpeg";

const exec = promisify(execFile);

/**
 * The Service B lead-in: silence prepended to the approved VO before the
 * HeyGen submit. What matters downstream is that a probe of the padded file
 * reports input + pad (the composition and the usage row both assume it) and
 * that nothing about the audio itself moved — same codec, rate, channels.
 * Real ffmpeg, like media-rate and the persona-blur test.
 */

const dir = path.join(tmpdir(), "aiugc-media-pad");
const mono = path.join(dir, "mono-44k.mp3");
const stereo = path.join(dir, "stereo-48k.mp3");

async function audioStream(file: string) {
  const { stdout } = await exec("ffprobe", [
    ...["-v", "error", "-select_streams", "a:0"],
    ...["-show_entries", "stream=codec_name,sample_rate,channels"],
    ...["-print_format", "json", file],
  ]);
  const json = JSON.parse(stdout) as {
    streams: { codec_name: string; sample_rate: string; channels: number }[];
  };
  return json.streams[0]!;
}

beforeAll(async () => {
  mkdirSync(dir, { recursive: true });
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1"],
    ...["-ar", "44100", "-ac", "1", mono],
  ]);
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1"],
    ...["-ar", "48000", "-ac", "2", stereo],
  ]);
}, 60_000);

describe("padAudioStart", () => {
  it("prepends the silence: the probed duration grows by the pad", async () => {
    const out = path.join(dir, "mono-padded.mp3");
    const before = await measureDurationMs(mono);
    await padAudioStart(mono, out, 800);
    const after = await measureDurationMs(out);
    // mp3 frames are ~26ms, so the encoder may round by a frame either way.
    expect(after - before).toBeGreaterThanOrEqual(800 - 60);
    expect(after - before).toBeLessThanOrEqual(800 + 60);
  }, 30_000);

  it("keeps the codec, sample rate and channel layout of the input", async () => {
    const outMono = path.join(dir, "mono-padded-2.mp3");
    const outStereo = path.join(dir, "stereo-padded.mp3");
    await padAudioStart(mono, outMono, 500);
    await padAudioStart(stereo, outStereo, 500);
    expect(await audioStream(outMono)).toEqual({
      codec_name: "mp3",
      sample_rate: "44100",
      channels: 1,
    });
    expect(await audioStream(outStereo)).toEqual({
      codec_name: "mp3",
      sample_rate: "48000",
      channels: 2,
    });
  }, 30_000);
});
