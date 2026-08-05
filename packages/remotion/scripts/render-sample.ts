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
 * into the avatar segment is visible). `--hook <file>` and
 * `--safe-area x,y,w,h` replay a real bank clip with the safe area drawn in
 * the admin editor, so what fits there can be checked against a real render.
 * `--hook-line "<text>"` overrides the burned line — e.g. a `POV:` line to
 * check the mixed-direction (Latin prefix in RTL) rendering.
 */

const watermark = process.argv.includes("--watermark");
const serviceA = process.argv.includes("--service-a");

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
const name = serviceA ? "sample-a" : watermark ? "sample-watermarked" : "sample";
const outPath = fileURLToPath(new URL(`../out/${name}.mp4`, import.meta.url));

await ensureFixtures();
console.log(`rendering ${name}…`);
const startedAt = Date.now();
if (serviceA) {
  const voMs = Math.round((sampleDurationInFrames / FPS) * 1000);
  const [x, y, w, h] = (argValue("--safe-area") ?? "90,640,900,520").split(",").map(Number);
  await renderServiceA(
    {
      hookClipPath: argValue("--hook") ?? TALKING_HEAD_FIXTURE,
      hookLine: argValue("--hook-line") ?? "זה מה שאף אחד לא מספר לכם",
      hookTextSafeArea: { x: x!, y: y!, w: w!, h: h! },
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
