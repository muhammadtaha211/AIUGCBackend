import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { renderServiceASteps } from "../src/render";

/**
 * Frame delivery: the rendered file must actually contain a new source frame
 * on every output frame.
 *
 * This is not checkable from metadata — a render that drops two thirds of its
 * source frames still reports 30fps and the right duration, and still plays at
 * the right speed. So decode the output and ask, per segment, how many
 * DISTINCT source frames it shows: each output frame is matched to its nearest
 * eligible source frame (the ones that segment's trim window can legally
 * show), and the count of distinct matches is the answer.
 *
 * Guards the OffthreadVideo frame-cache size pinned in render.ts. Shrink that
 * constant and this goes red: Remotion's compositor answers with a previously
 * decoded frame once its cache cannot hold the working set.
 *
 * NOTE this renders for real — a webpack bundle plus a headless-Chrome render,
 * ~35s warm, plus a one-off ~15s fixture encode. It is the only test in the repo
 * that does, and it has to be: the bug it guards is invisible to every cheaper
 * check.
 */

/** NOT public/fixtures: @remotion/bundler copies public/ into every bundle,
 *  and nothing here is loaded with staticFile() — renderServiceASteps takes
 *  absolute paths and serves them on loopback. Gitignored. */
const FIXTURE_DIR = fileURLToPath(new URL("./.fixtures/", import.meta.url));

/** testsrc2 spun fast. Plain testsrc is static in the top half, and the match
 *  below needs every frame to be unambiguously itself; rotating puts a
 *  full-frame change between neighbours (min mean|diff| 13.7 vs 0.0 for
 *  testsrc) so a wrong frame can never win. veryfast/crf 26 because only the
 *  motion matters, not the picture. */
const ENCODE = ["-preset", "veryfast", "-crf", "26"];
const SPIN = "rotate=a=2*PI*t/1.7";
const HOOK_SOURCE = "testsrc2=size=1080x1920:rate=30:duration=0.5";
const DEMO_SOURCE = "testsrc2=size=1080x1920:rate=30:duration=12";

/** Two steps, both seeking several GOPs into the demo, 1s each. */
const STEPS = [
  { startMs: 6000, durationMs: 1000, label: "בדיקה" },
  { startMs: 10500, durationMs: 1000, label: "בדיקה שנייה" },
];
const HOOK_FRAMES = 15;
const STEP_FRAMES = 30;

let hook: string | null = null;
let demo: string | null = null;

describe("ServiceASteps frame delivery", () => {
  beforeAll(() => {
    hook = ensureFixture(HOOK_SOURCE);
    demo = ensureFixture(DEMO_SOURCE);
    // The names are spec hashes, so editing a spec orphans the old file.
    const keep = new Set([hook, demo].filter(Boolean).map((f) => path.basename(f!)));
    for (const stale of readdirSync(FIXTURE_DIR).filter((f) => !keep.has(f))) {
      rmSync(path.join(FIXTURE_DIR, stale), { force: true });
    }
  }, 600_000);

  it("shows a new source frame on (nearly) every output frame", async (ctx) => {
    if (!hook || !demo) {
      ctx.skip(); // no ffmpeg on this box — same stance as scripts/make-fixtures.ts
      return;
    }
    const out = path.join(tmpdir(), `aiugc-frame-delivery-${process.pid}.mp4`);
    try {
      await renderServiceASteps(
        {
          hookClipPath: hook,
          hookLine: "בדיקת מסירת פריימים",
          hookTextSafeArea: { x: 25, y: 1062, w: 1009, h: 179 },
          demoPath: demo,
          steps: STEPS,
          watermark: false,
        },
        out,
      );

      const rendered = grayFrames(out);
      const hookSource = grayFrames(hook);
      const demoSource = grayFrames(demo);
      // Exact: a wrong length would shift every segment boundary below and
      // quietly compare the wrong frames against the wrong window.
      expect(rendered.length).toBe(HOOK_FRAMES + STEP_FRAMES * STEPS.length);

      const segments = [
        { name: "hook", source: hookSource, from: 0, count: HOOK_FRAMES },
        ...STEPS.map((step, i) => ({
          name: `step${i + 1}`,
          source: demoSource,
          from: Math.round((step.startMs / 1000) * 30),
          count: STEP_FRAMES,
        })),
      ];

      let cursor = 0;
      for (const segment of segments) {
        const eligible = segment.source.slice(segment.from, segment.from + segment.count);
        // Without this an empty window would certify the segment having
        // compared nothing at all.
        expect(eligible.length, `${segment.name}: no eligible source frames`).toBe(segment.count);
        const shown = new Set<number>();
        for (let i = 0; i < segment.count; i++) {
          shown.add(nearest(eligible, rendered[cursor + i]!));
        }
        cursor += segment.count;
        // One repeat absorbs the rounding at a segment's last frame. Two
        // thirds missing is the bug.
        expect(
          shown.size,
          `${segment.name}: ${shown.size} distinct source frames over ${segment.count} output frames`,
        ).toBeGreaterThanOrEqual(segment.count - 1);
      }
    } finally {
      rmSync(out, { force: true });
    }
  }, 900_000);
});

/** Downscaled luma, top 1000px only so the burned hook line and step label
 *  (y >= 1062) cannot influence which source frame a match lands on. */
const W = 60;
const H = 56;

function grayFrames(file: string): Uint8Array[] {
  const result = spawnSync(
    "ffmpeg",
    // prettier-ignore
    ["-v", "error", "-i", file, "-an", "-vf", `crop=1080:1000:0:0,scale=${W}:${H}`,
     "-pix_fmt", "gray", "-f", "rawvideo", "-"],
    { maxBuffer: 1 << 30 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`ffmpeg failed on ${file}: ${result.error ?? result.stderr}`);
  }
  const raw = result.stdout;
  const frames: Uint8Array[] = [];
  for (let i = 0; i + W * H <= raw.length; i += W * H) frames.push(raw.subarray(i, i + W * H));
  return frames;
}

/** Index of the eligible source frame closest to `frame`, mean-centred so the
 *  burned overlays (a constant brightness offset) do not skew the distance. */
function nearest(eligible: Uint8Array[], frame: Uint8Array): number {
  const target = mean(frame);
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < eligible.length; i++) {
    const candidate = eligible[i]!;
    const offset = mean(candidate) - target;
    let distance = 0;
    for (let p = 0; p < frame.length; p++) distance += Math.abs(candidate[p]! - frame[p]! - offset);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

function mean(frame: Uint8Array): number {
  let sum = 0;
  for (let p = 0; p < frame.length; p++) sum += frame[p]!;
  return sum / frame.length;
}

/**
 * Generate one lavfi fixture, or null on a box without ffmpeg (the test then
 * skips, the same stance scripts/make-fixtures.ts takes). The filename carries
 * a hash of the exact spec that produced it, so editing SPIN or a duration
 * regenerates instead of silently reusing a file the assertions no longer
 * hold for. Encode to a temp name and rename on success: ffmpeg creates the
 * output before encoding, and a truncated file must not be trusted forever.
 */
function ensureFixture(source: string): string | null {
  const spec = [source, SPIN, ...ENCODE].join(" ");
  const stamp = createHash("sha256").update(spec).digest("hex").slice(0, 8);
  const file = path.join(FIXTURE_DIR, `${stamp}.mp4`);
  if (existsSync(file)) return file;
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const tmp = `${file}.tmp.mp4`;
  const result = spawnSync(
    "ffmpeg",
    // prettier-ignore
    ["-y", "-f", "lavfi", "-i", source, "-vf", SPIN, "-pix_fmt", "yuv420p",
     "-c:v", "libx264", ...ENCODE, tmp],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  if (result.error || result.status !== 0) {
    rmSync(tmp, { force: true });
    return null;
  }
  renameSync(tmp, file);
  return file;
}
