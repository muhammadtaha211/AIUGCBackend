import { renderMedia, selectComposition } from "@remotion/renderer";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

export async function ensureFixtures(): Promise<void> {
  mkdirSync(FIXTURE_DIR, { recursive: true });

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
