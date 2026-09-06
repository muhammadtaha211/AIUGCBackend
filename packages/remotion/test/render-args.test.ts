import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { sampleCaptions, sampleOpenerTimeline, sampleTimeline } from "../src/fixtures";
import {
  bt709FfmpegOverride,
  RenderPropsError,
  renderServiceASteps,
  renderServiceB,
} from "../src/render";
import type { ServiceBProps } from "../src/schema";

const BSF =
  "h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1";

describe("bt709FfmpegOverride", () => {
  it("inserts the SPS relabel before the output on the stitcher", () => {
    const args = ["-i", "pre-encode.mp4", "-c:v", "copy", "final.mp4"];
    const out = bt709FfmpegOverride({ type: "stitcher", args });
    expect(out).toEqual(["-i", "pre-encode.mp4", "-c:v", "copy", "-bsf:v", BSF, "final.mp4"]);
  });

  it("leaves the pre-stitcher untouched", () => {
    const args = ["-i", "-", "-c:v", "libx264", "out.mp4"];
    expect(bt709FfmpegOverride({ type: "pre-stitcher", args })).toEqual(args);
  });
});

type RenderMediaArgs = { offthreadVideoCacheSizeInBytes?: unknown; concurrency?: unknown };

type SelectArgs = { id: string; inputProps: unknown };

const renderMedia = vi.fn(async (_options: RenderMediaArgs) => undefined);
const selectComposition = vi.fn(async (args: SelectArgs) => ({ id: args.id, durationInFrames: 1 }));
vi.mock("@remotion/bundler", () => ({ bundle: async () => "http://bundle" }));
vi.mock("@remotion/renderer", () => ({
  selectComposition: (args: SelectArgs) => selectComposition(args),
  renderMedia: (options: RenderMediaArgs) => renderMedia(options),
}));

/**
 * frame-delivery.test.ts proves the render is not dropping frames, but it
 * cannot prove WHY: delete the cache pin and Remotion's default (half of free
 * memory, gigabytes on any dev box) keeps that test green. So assert the pin
 * reaches renderMedia at all. Mocked — this must stay a keyless, instant check.
 */
const dir = mkdtempSync(path.join(tmpdir(), "aiugc-render-args-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Drives the real renderServiceASteps against the mock and hands back the
 *  options it passed on. */
async function capturedRenderArgs(): Promise<RenderMediaArgs> {
  for (const name of ["hook.mp4", "demo.mp4"]) writeFileSync(path.join(dir, name), "stub");
  await renderServiceASteps(
    {
      hookClipPath: path.join(dir, "hook.mp4"),
      hookLine: "בדיקה",
      hookTextSafeArea: { x: 25, y: 1062, w: 1009, h: 179 },
      demoPath: path.join(dir, "demo.mp4"),
      steps: [{ startMs: 0, durationMs: 1000, label: "בדיקה" }],
      watermark: false,
    },
    path.join(dir, "out.mp4"),
  );
  return renderMedia.mock.calls.at(-1)![0];
}

/** A ServiceB input over stub files; the mock never decodes them. */
function serviceBInput() {
  for (const name of ["head.mp4", "vo.mp3", "b1.mp4", "b2.mp4", "whoosh.wav", "opener.mp4"]) {
    writeFileSync(path.join(dir, name), "stub");
  }
  return {
    talkingHeadPath: path.join(dir, "head.mp4"),
    voiceoverPath: path.join(dir, "vo.mp3"),
    brollPaths: [] as string[],
    captions: sampleCaptions,
    timeline: sampleTimeline,
    watermark: false,
  };
}
const zoom = { from: 1.35, to: 1.42, atMs: 1200, durationMs: 450 };

describe("renderServiceB props", () => {
  it("refuses the zoom hook together with an opener", async () => {
    await expect(
      renderServiceB(
        {
          ...serviceBInput(),
          openerPath: path.join(dir, "opener.mp4"),
          hookText: "בדיקה",
          hookTextSafeArea: { x: 25, y: 1062, w: 1009, h: 179 },
          timeline: sampleOpenerTimeline,
          hookZoom: zoom,
        },
        path.join(dir, "out.mp4"),
      ),
    ).rejects.toThrow(RenderPropsError);
  });

  it("serves b-roll and the whoosh as their own URLs — the sfx never leaks into brollSrcs", async () => {
    await renderServiceB(
      {
        ...serviceBInput(),
        brollPaths: [path.join(dir, "b1.mp4"), path.join(dir, "b2.mp4")],
        hookZoom: { ...zoom, sfxPath: path.join(dir, "whoosh.wav") },
      },
      path.join(dir, "out.mp4"),
    );
    const props = selectComposition.mock.calls.at(-1)![0].inputProps as ServiceBProps;
    expect(props.brollSrcs).toHaveLength(2);
    expect(props.hookZoom).toMatchObject(zoom);
    expect(typeof props.hookZoom?.sfxSrc).toBe("string");
    const urls = [
      props.talkingHeadSrc,
      props.voiceoverSrc,
      ...props.brollSrcs,
      props.hookZoom!.sfxSrc,
    ];
    expect(new Set(urls).size).toBe(5);
  });

  it("without b-roll or a whoosh the lists stay empty and the sfx stays absent", async () => {
    await renderServiceB({ ...serviceBInput(), hookZoom: zoom }, path.join(dir, "out.mp4"));
    const props = selectComposition.mock.calls.at(-1)![0].inputProps as ServiceBProps;
    expect(props.brollSrcs).toEqual([]);
    expect(props.hookZoom?.sfxSrc).toBeUndefined();
  });
});

describe("OffthreadVideo cache", () => {
  it("is pinned to a fixed size, never left to Remotion's ambient default", async () => {
    const size = (await capturedRenderArgs()).offthreadVideoCacheSizeInBytes;
    expect(typeof size, "renderMedia was called without a pinned cache size").toBe("number");
    // Big enough to matter: damage was measured at 50MB and below.
    expect(size as number).toBeGreaterThanOrEqual(100 * 1024 * 1024);
  });
});

/**
 * Remotion hard-caps concurrency at the host's core count and throws above it
 * ("Maximum for --concurrency is 4 (number of cores on this system)"), so a
 * tab count hardcoded above a machine's cores does not run slowly — it fails
 * every render on that machine. Measured 2026-08-27 on a 4-core Hetzner CPX32
 * against the then-hardcoded 6.
 */
describe("render concurrency", () => {
  it("never asks for more tabs than this host has cores", async () => {
    const concurrency = (await capturedRenderArgs()).concurrency;
    expect(typeof concurrency, "renderMedia was called without a pinned concurrency").toBe(
      "number",
    );
    expect(concurrency as number).toBeLessThanOrEqual(cpus().length);
  });
});
