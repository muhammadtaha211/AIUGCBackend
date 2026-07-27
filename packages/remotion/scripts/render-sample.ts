import { fileURLToPath } from "node:url";
import { sampleCaptions } from "../src/fixtures";
import { renderServiceB } from "../src/render";
import { ensureFixtures, TALKING_HEAD_FIXTURE, VOICEOVER_FIXTURE } from "./make-fixtures";

/**
 * Founder preview render — the same code path the worker runs, on local
 * fixtures. `--watermark` renders the watermarked variant instead.
 */

const watermark = process.argv.includes("--watermark");
const outPath = fileURLToPath(
  new URL(`../out/${watermark ? "sample-watermarked" : "sample"}.mp4`, import.meta.url),
);

await ensureFixtures();
console.log(`rendering ${watermark ? "watermarked " : ""}sample…`);
const startedAt = Date.now();
await renderServiceB(
  {
    talkingHeadPath: TALKING_HEAD_FIXTURE,
    voiceoverPath: VOICEOVER_FIXTURE,
    brollPaths: [],
    captions: sampleCaptions,
    watermark,
  },
  outPath,
);
console.log(`wrote ${outPath} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
