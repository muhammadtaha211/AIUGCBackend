import { fileURLToPath } from "node:url";
import { sampleCaptions, sampleDurationInFrames } from "../src/fixtures";
import { renderServiceA, renderServiceB } from "../src/render";
import { FPS } from "../src/schema";
import { ensureFixtures, TALKING_HEAD_FIXTURE, VOICEOVER_FIXTURE } from "./make-fixtures";

/**
 * Founder preview render — the same code path the worker runs, on local
 * fixtures. `--watermark` renders the watermarked variant instead.
 * `--service-a` renders the ServiceA composition (the placeholder clip stands
 * in for hook, demo AND avatar outro; the slice lands mid-clip so the hard cut
 * into the avatar segment is visible).
 */

const watermark = process.argv.includes("--watermark");
const serviceA = process.argv.includes("--service-a");
const name = serviceA ? "sample-a" : watermark ? "sample-watermarked" : "sample";
const outPath = fileURLToPath(new URL(`../out/${name}.mp4`, import.meta.url));

await ensureFixtures();
console.log(`rendering ${name}…`);
const startedAt = Date.now();
if (serviceA) {
  const voMs = Math.round((sampleDurationInFrames / FPS) * 1000);
  await renderServiceA(
    {
      hookClipPath: TALKING_HEAD_FIXTURE,
      hookLine: "זה מה שאף אחד לא מספר לכם",
      hookTextSafeArea: { x: 90, y: 640, w: 900, h: 520 },
      demoPath: TALKING_HEAD_FIXTURE,
      demoDurationMs: voMs,
      captions: sampleCaptions,
      voiceoverPath: VOICEOVER_FIXTURE,
      outroMode: "avatar",
      voSliceMs: Math.round(voMs * 0.6),
      avatarPath: TALKING_HEAD_FIXTURE,
      watermark,
    },
    outPath,
  );
} else {
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
}
console.log(`wrote ${outPath} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
