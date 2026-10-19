import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assertRecordingHasAudio,
  cutAndEncodeRecording,
  decodeRecording,
  integratedLoudness,
  measureDurationMs,
  normalizeRecordingLoudness,
  RECORDING_NO_AUDIO,
} from "../src/media/ffmpeg";
import { PermanentError } from "../src/jobs/errors";
import { RECORDING_UNSUPPORTED } from "../src/own-voice";

const exec = promisify(execFile);

/**
 * The own-voice media chain (decision 0118): every container a browser
 * recorder or a phone hands over decodes to mono 44.1 kHz, the loudness lands
 * at the target with one linear gain, and the cut is sample-accurate and in the
 * stored TTS format. Real ffmpeg on lavfi inputs, like media-pad.
 */

const dir = path.join(tmpdir(), "aiugc-media-recording");
const src = (name: string) => path.join(dir, name);
/** A quiet "voice" (about -37 LUFS): a tone after 1.5 s of silence. */
const TONE = "sine=frequency=220:duration=4,volume=-15dB,adelay=1500:all=1";

async function stream(file: string) {
  const { stdout } = await exec("ffprobe", [
    ...["-v", "error", "-select_streams", "a:0"],
    ...["-show_entries", "stream=codec_name,sample_rate,channels,bit_rate"],
    ...["-print_format", "json", file],
  ]);
  return (JSON.parse(stdout) as { streams: Record<string, string | number>[] }).streams[0]!;
}

beforeAll(async () => {
  mkdirSync(dir, { recursive: true });
  const audio = (out: string, codec: string[]) =>
    exec("ffmpeg", ["-y", "-f", "lavfi", "-i", TONE, ...codec, src(out)]);
  await audio("voice.ogg", ["-c:a", "libopus"]); // a WhatsApp voice note
  await audio("voice.webm", ["-c:a", "libopus"]); // Chrome's recorder
  await audio("voice.m4a", ["-c:a", "aac"]); // iOS Safari's recorder, Voice Memos
  await audio("voice.wav", ["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"]);
  await audio("voice.mp3", ["-c:a", "libmp3lame"]);
  // A phone video: picture plus sound.
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=30:duration=5.5"],
    ...["-f", "lavfi", "-i", TONE],
    ...["-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", src("selfie.mp4")],
  ]);
  // A video with no sound at all.
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=30:duration=2"],
    ...["-c:v", "libx264", "-pix_fmt", "yuv420p", src("silent.mp4")],
  ]);
  writeFileSync(src("not-media.webm"), "this is not a media file");
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "600"],
    ...["-c:a", "libopus", "-b:a", "6k", src("ten-minutes.ogg")],
  ]);
}, 120_000);

describe("assertRecordingHasAudio", () => {
  it.each(["voice.ogg", "voice.webm", "voice.m4a", "voice.wav", "voice.mp3", "selfie.mp4"])(
    "accepts %s",
    async (name) => {
      const { statedMs } = await assertRecordingHasAudio(src(name));
      expect(statedMs).toBeGreaterThan(5400);
      expect(statedMs).toBeLessThan(5600);
    },
  );

  it("returns the container's stated length, so an hours-long file is refused before any decode", async () => {
    expect((await assertRecordingHasAudio(src("voice.mp3"))).statedMs).toBeGreaterThan(5400);
    // Ten minutes of opus at 6 kb/s: well under 1 MB, ~100 MB as PCM.
    expect((await assertRecordingHasAudio(src("ten-minutes.ogg"))).statedMs).toBeGreaterThan(
      599_000,
    );
  });

  it("refuses a video with no audio stream in Hebrew", async () => {
    const err = await assertRecordingHasAudio(src("silent.mp4")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect((err as PermanentError).customerMessage).toBe(RECORDING_NO_AUDIO);
  });

  it("refuses a file no demuxer reads with the formats line", async () => {
    const err = await assertRecordingHasAudio(src("not-media.webm")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect((err as PermanentError).customerMessage).toBe(RECORDING_UNSUPPORTED);
  });
});

describe("decodeRecording", () => {
  it.each(["voice.ogg", "voice.webm", "voice.m4a", "voice.wav", "voice.mp3", "selfie.mp4"])(
    "decodes %s to mono 44.1 kHz PCM at its full length",
    async (name) => {
      const out = src(`${name}.wav`);
      await decodeRecording(src(name), out, 91_000);
      expect(await stream(out)).toMatchObject({
        codec_name: "pcm_s16le",
        sample_rate: "44100",
        channels: 1,
      });
      // 1.5 s of silence + 4 s of tone (the video is cut to 5.5 s).
      const ms = await measureDurationMs(out);
      expect(ms).toBeGreaterThanOrEqual(5400);
      expect(ms).toBeLessThanOrEqual(5600);
    },
  );
});

describe("decodeRecording's length bound", () => {
  it("stops at the bound whatever the container holds", async () => {
    const out = src("bounded.wav");
    await decodeRecording(src("ten-minutes.ogg"), out, 91_000);
    const ms = await measureDurationMs(out);
    expect(ms).toBeGreaterThanOrEqual(90_900);
    expect(ms).toBeLessThanOrEqual(91_100);
  });
});

describe("normalizeRecordingLoudness", () => {
  it("lifts a quiet recording to the target with one gain, peaks under the limit", async () => {
    const wav = src("quiet.wav");
    await decodeRecording(src("voice.ogg"), wav, 91_000);
    const before = await integratedLoudness(wav);
    const out = src("quiet-normalized.wav");
    const { inputLufs, gainDb } = await normalizeRecordingLoudness(wav, out, {
      targetLufs: -20,
      peakDb: -2,
    });
    expect(inputLufs).toBeCloseTo(before, 1);
    expect(gainDb).toBeGreaterThan(5);
    const after = await integratedLoudness(out);
    expect(after).toBeGreaterThan(-21.5);
    expect(after).toBeLessThan(-18.5);
    // Linear gain + a compensated limiter: the length does not move.
    expect(Math.abs((await measureDurationMs(out)) - (await measureDurationMs(wav)))).toBeLessThan(
      5,
    );
  });

  it("never boosts a near-silent file by more than 30 dB", async () => {
    const whisper = src("whisper.wav");
    await exec("ffmpeg", [
      ...["-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=3,volume=-60dB"],
      ...["-ac", "1", "-ar", "44100", whisper],
    ]);
    const { gainDb } = await normalizeRecordingLoudness(whisper, src("whisper-out.wav"), {
      targetLufs: -20,
      peakDb: -2,
    });
    expect(gainDb).toBe(30);
  });
});

describe("cutAndEncodeRecording", () => {
  it("cuts sample-accurately and encodes the stored TTS format", async () => {
    const wav = src("cut-src.wav");
    await decodeRecording(src("voice.wav"), wav, 91_000);
    const out = src("cut.mp3");
    await cutAndEncodeRecording(wav, out, 1400, 5400);
    expect(await stream(out)).toMatchObject({
      codec_name: "mp3",
      sample_rate: "44100",
      channels: 1,
      bit_rate: "128000",
    });
    // 4000 ms; an mp3 frame is ~26 ms, so the encoder may round by one.
    const ms = await measureDurationMs(out);
    expect(ms).toBeGreaterThanOrEqual(4000 - 30);
    expect(ms).toBeLessThanOrEqual(4000 + 30);
    // The cut opens 100 ms before the tone: silence first, then sound.
    const { stderr } = await exec("ffmpeg", [
      ...["-hide_banner", "-i", out, "-af", "silencedetect=n=-60dB:d=0.05", "-f", "null", "-"],
    ]);
    const end = /silence_end: ([\d.]+)/.exec(stderr);
    expect(end).not.toBeNull();
    expect(Number(end![1])).toBeGreaterThan(0.05);
    expect(Number(end![1])).toBeLessThan(0.16);
  });
});
