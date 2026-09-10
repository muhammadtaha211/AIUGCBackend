import { renderMedia, selectComposition } from "@remotion/renderer";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sampleDurationInFrames } from "../src/fixtures";
import { getBundle } from "../src/render";
import { FPS } from "../src/schema";

/**
 * Generates the local preview fixtures. Zero external API cost: no TTS, no
 * GPU, no lip-sync — just Remotion rendering a gradient clip over a synthesized
 * tone, so `studio` and `render:sample` have a talking head to work with.
 */

const FIXTURE_DIR = fileURLToPath(new URL("../public/fixtures/", import.meta.url));
export const TONE_FIXTURE = `${FIXTURE_DIR}tone.wav`;
/** Stands in for the approved mp3: same length as the placeholder clip, a
 *  different pitch from its embedded tone so the two are told apart by ear. */
export const VOICEOVER_FIXTURE = `${FIXTURE_DIR}voiceover.wav`;
export const TALKING_HEAD_FIXTURE = `${FIXTURE_DIR}talking-head.mp4`;
/** Steps-format stand-ins: a 3.5s hook clip and a 24s "demo" whose testsrc
 *  clock makes every trim visible — a cut jumps the on-screen timestamp. */
export const STEPS_HOOK_FIXTURE = `${FIXTURE_DIR}steps-hook.mp4`;
export const STEPS_DEMO_FIXTURE = `${FIXTURE_DIR}steps-demo.mp4`;
/** Service B opener stand-in: a 2.4s silent lavfi clip whose pattern makes the
 *  reveal cut into the gradient talking head unmistakable by eye. */
export const OPENER_FIXTURE = `${FIXTURE_DIR}opener.mp4`;

export async function ensureFixtures(): Promise<void> {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  // ffmpeg lavfi, not Remotion, for the steps fixtures: no audio stream by
  // construction (the format is silent) and the clock/hue drift come free.
  // ffmpeg is already a worker-box requirement; a machine without it keeps
  // every pre-steps command working and only these fixtures are skipped.
  ensureLavfiFixture(STEPS_HOOK_FIXTURE, "testsrc2=size=1080x1920:rate=30:duration=3.5");
  ensureLavfiFixture(STEPS_DEMO_FIXTURE, "testsrc=size=1080x1920:rate=30:duration=24", [
    "-vf",
    "hue=H=6.28*t/24", // slow hue rotation: each trim point also has its own tint
  ]);
  // sampleOpenerTimeline (src/fixtures.ts) is built for exactly this length
  // and a 1.6s reveal; the moving pattern shows whether the hold really froze.
  ensureLavfiFixture(OPENER_FIXTURE, "testsrc2=size=1080x1920:rate=30:duration=2.4");

  // The tones must exist before bundling: Remotion copies public/ into the
  // bundle, and the compositions load them with staticFile().
  if (!existsSync(TONE_FIXTURE)) {
    writeToneWav(TONE_FIXTURE, 12, 220);
    console.log(`wrote ${TONE_FIXTURE}`);
  }
  if (!existsSync(VOICEOVER_FIXTURE)) {
    writeToneWav(VOICEOVER_FIXTURE, sampleDurationInFrames / FPS, 330);
    console.log(`wrote ${VOICEOVER_FIXTURE}`);
  }

  if (existsSync(TALKING_HEAD_FIXTURE)) return;
  console.log("rendering placeholder talking head (first run also downloads Chrome Headless)…");
  const serveUrl = await getBundle();
  const composition = await selectComposition({
    serveUrl,
    id: "PlaceholderTalkingHead",
    inputProps: {},
  });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    audioCodec: "aac",
    outputLocation: TALKING_HEAD_FIXTURE,
    inputProps: {},
    logLevel: "error",
  });
  console.log(`wrote ${TALKING_HEAD_FIXTURE}`);
}

/** Generate one silent lavfi mp4; warn-and-skip when ffmpeg fails or is
 *  missing so studio/render:sample keep working on a box without it. Encodes
 *  to a temp name and renames on success: ffmpeg creates the output before
 *  encoding, so an interrupted run must not leave a truncated file that the
 *  existsSync guard then trusts forever. */
function ensureLavfiFixture(file: string, source: string, extraArgs: string[] = []): void {
  if (existsSync(file)) return;
  const tmp = file.replace(/\.mp4$/, ".tmp.mp4");
  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      source,
      ...extraArgs,
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-crf",
      "20",
      tmp,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  if (result.error || result.status !== 0) {
    rmSync(tmp, { force: true });
    const detail = result.error?.message ?? result.stderr?.toString().trim().slice(-300);
    console.warn(
      `ffmpeg failed for ${file} (needed only for the steps preview/sample — is ffmpeg on PATH?): ${detail}`,
    );
    return;
  }
  renameSync(tmp, file);
  console.log(`wrote ${file}`);
}

/** 16-bit mono PCM WAV — a soft tone that wobbles, standing in for speech. */
function writeToneWav(file: string, seconds: number, hz: number): void {
  const sampleRate = 44100;
  const sampleCount = sampleRate * seconds;
  const data = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate;
    const envelope = 0.18 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * t));
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * t) * envelope * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format: PCM
  header.writeUInt16LE(1, 22); // channels
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);

  writeFileSync(file, Buffer.concat([header, data]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await ensureFixtures();
}
