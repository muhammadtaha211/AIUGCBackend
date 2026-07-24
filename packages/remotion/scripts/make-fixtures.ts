import { renderMedia, selectComposition } from "@remotion/renderer";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getBundle } from "../src/render";

/**
 * Generates the local preview fixtures. Zero external API cost: no TTS, no
 * GPU, no lip-sync — just Remotion rendering a gradient clip over a synthesized
 * tone, so `studio` and `render:sample` have a talking head to work with.
 */

const FIXTURE_DIR = fileURLToPath(new URL("../public/fixtures/", import.meta.url));
export const TONE_FIXTURE = `${FIXTURE_DIR}tone.wav`;
export const TALKING_HEAD_FIXTURE = `${FIXTURE_DIR}talking-head.mp4`;

export async function ensureFixtures(): Promise<void> {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  // The tone must exist before bundling: Remotion copies public/ into the
  // bundle, and the placeholder composition loads it with staticFile().
  if (!existsSync(TONE_FIXTURE)) {
    writeToneWav(TONE_FIXTURE, 12);
    console.log(`wrote ${TONE_FIXTURE}`);
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

/** 16-bit mono PCM WAV — a soft 220Hz tone that wobbles, so the sample render
 *  proves the talking head's own audio survives (there is no other audio). */
function writeToneWav(file: string, seconds: number): void {
  const sampleRate = 44100;
  const sampleCount = sampleRate * seconds;
  const data = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate;
    const envelope = 0.18 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * t));
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * t) * envelope * 32767), i * 2);
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
