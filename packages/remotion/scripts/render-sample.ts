import { fileURLToPath } from "node:url";
import {
  sampleCaptions,
  sampleDurationInFrames,
  sampleHookText,
  sampleOpenerTimeline,
  sampleSteps,
  sampleTextBlock,
  sampleTextBlockQuiz,
  sampleTimeline,
} from "../src/fixtures";
import { renderServiceA, renderServiceASteps, renderServiceB, renderServiceC } from "../src/render";
import { FPS } from "../src/schema";
import {
  ensureFixtures,
  OPENER_FIXTURE,
  STEPS_DEMO_FIXTURE,
  STEPS_HOOK_FIXTURE,
  TALKING_HEAD_FIXTURE,
  TEXT_BLOCK_FIXTURE,
  VOICEOVER_FIXTURE,
} from "./make-fixtures";

/**
 * Founder preview render — the same code path the worker runs, on local
 * fixtures. `--watermark` renders the watermarked variant instead.
 * `--service-a` renders the ServiceA composition (the placeholder clip stands
 * in for hook, demo AND avatar outro; the slice lands mid-clip so the hard cut
 * into the avatar segment is visible). `--hook <file>` and
 * `--safe-area x,y,w,h` replay a real bank clip with the safe area drawn in
 * the admin editor, so what fits there can be checked against a real render.
 * `--hook-line "<text>"` overrides the burned line — e.g. a `POV:` line to
 * check the mixed-direction (Latin prefix in RTL) rendering. `--steps` renders
 * the ServiceASteps composition from the lavfi fixtures — a silent mp4 with
 * visible hard cuts (the demo fixture's clock jumps at each one). `--opener`
 * renders ServiceB with the synthetic opener clip in front: the clip from its
 * first frame under the hook text, the hard cut at the reveal (the text
 * outliving it), and the VO starting 250ms after the cut. `--cutaways`
 * renders ServiceB with one demo cutaway (vault 0121): the steps demo fixture,
 * whose clock shows which stretch plays, laid over the head from the second
 * caption chunk to the fourth, muted, under the captions. `--text-block` renders the ServiceC
 * composition: the tone-carrying lavfi clip (or `--clip <file>`, e.g. the
 * founder's real clip) once, with its sound, under the sample block —
 * `--quiz` for the line-broken quiz shape, `--text "<text>"` (`\n` for a
 * break) for any other, `--ink black` for a black block on a light edge,
 * `--safe-area x,y,w,h` for the rect.
 */

const watermark = process.argv.includes("--watermark");
const serviceA = process.argv.includes("--service-a");
const steps = process.argv.includes("--steps");
const opener = process.argv.includes("--opener");
const cutaways = process.argv.includes("--cutaways");
const textBlock = process.argv.includes("--text-block");
const quiz = process.argv.includes("--quiz");

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
const name = textBlock
  ? quiz
    ? "sample-c-quiz"
    : "sample-c"
  : steps
    ? "sample-steps"
    : serviceA
      ? "sample-a"
      : opener
        ? "sample-b-opener"
        : cutaways
          ? "sample-b-cutaways"
          : watermark
            ? "sample-watermarked"
            : "sample";
const outPath = fileURLToPath(new URL(`../out/${name}.mp4`, import.meta.url));

await ensureFixtures();
console.log(`rendering ${name}…`);
const startedAt = Date.now();
if (textBlock) {
  // The clip once, with its own sound (the fixture's tone), the block over
  // every frame. The default rect mirrors DEFAULT_TEXT_BLOCK_RECT.
  const [x, y, w, h] = (argValue("--safe-area") ?? "180,400,720,1040").split(",").map(Number);
  await renderServiceC(
    {
      clipPath: argValue("--clip") ?? TEXT_BLOCK_FIXTURE,
      text:
        argValue("--text")?.replaceAll("\\n", "\n") ??
        (quiz ? sampleTextBlockQuiz : sampleTextBlock),
      textSafeArea: { x: x!, y: y!, w: w!, h: h! },
      textInk:
        argValue("--ink") === "black" ? { fill: "black", outline: "255,255,255" } : undefined,
      watermark,
    },
    outPath,
  );
} else if (steps) {
  // Silent by design — the output mp4 has NO audio stream; the lavfi demo's
  // clock jumps at every cut, so the trims are verifiable by eye.
  const [x, y, w, h] = (argValue("--safe-area") ?? "25,1062,1009,179").split(",").map(Number);
  await renderServiceASteps(
    {
      hookClipPath: argValue("--hook") ?? STEPS_HOOK_FIXTURE,
      hookLine: argValue("--hook-line") ?? "ככה מזמינים בלי לחכות",
      hookTextSafeArea: { x: x!, y: y!, w: w!, h: h! },
      demoPath: STEPS_DEMO_FIXTURE,
      steps: sampleSteps,
      watermark,
    },
    outPath,
  );
} else if (serviceA) {
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
} else if (opener) {
  const [x, y, w, h] = (argValue("--safe-area") ?? "25,1062,1009,179").split(",").map(Number);
  await renderServiceB(
    {
      talkingHeadPath: TALKING_HEAD_FIXTURE,
      voiceoverPath: VOICEOVER_FIXTURE,
      captions: sampleCaptions,
      openerPath: argValue("--opener-file") ?? OPENER_FIXTURE,
      hookText: argValue("--hook-line") ?? sampleHookText,
      hookTextSafeArea: { x: x!, y: y!, w: w!, h: h! },
      timeline: sampleOpenerTimeline,
      watermark,
    },
    outPath,
  );
} else {
  await renderServiceB(
    {
      talkingHeadPath: TALKING_HEAD_FIXTURE,
      voiceoverPath: VOICEOVER_FIXTURE,
      captions: sampleCaptions,
      timeline: sampleTimeline,
      cutaways: cutaways
        ? {
            demoPath: STEPS_DEMO_FIXTURE,
            slots: [
              {
                fromMs: sampleCaptions[1]!.startMs,
                toMs: sampleCaptions[3]!.startMs,
                demoStartMs: 1000,
              },
            ],
          }
        : undefined,
      watermark,
    },
    outPath,
  );
}
console.log(`wrote ${outPath} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
