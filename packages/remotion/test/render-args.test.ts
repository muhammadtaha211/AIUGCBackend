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
import type { ServiceAStepsProps, ServiceBProps } from "../src/schema";

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
  for (const name of ["head.mp4", "vo.mp3", "demo.mp4", "whoosh.wav", "whip.wav", "opener.mp4"]) {
    writeFileSync(path.join(dir, name), "stub");
  }
  return {
    talkingHeadPath: path.join(dir, "head.mp4"),
    voiceoverPath: path.join(dir, "vo.mp3"),
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

  it("serves the cutaway demo and the whoosh as their own URLs, the windows passed through", async () => {
    const slots = [
      { fromMs: 4080, toMs: 9440, demoStartMs: 12_000 },
      { fromMs: 10_960, toMs: 15_080, demoStartMs: 30_000 },
    ];
    await renderServiceB(
      {
        ...serviceBInput(),
        cutaways: { demoPath: path.join(dir, "demo.mp4"), slots },
        hookZoom: { ...zoom, sfxPath: path.join(dir, "whoosh.wav") },
      },
      path.join(dir, "out.mp4"),
    );
    const props = selectComposition.mock.calls.at(-1)![0].inputProps as ServiceBProps;
    expect(props.cutaways?.slots).toEqual(slots);
    expect(props.hookZoom).toMatchObject(zoom);
    expect(typeof props.hookZoom?.sfxSrc).toBe("string");
    const urls = [
      props.talkingHeadSrc,
      props.voiceoverSrc,
      props.cutaways!.src,
      props.hookZoom!.sfxSrc,
    ];
    expect(new Set(urls).size).toBe(4);
  });

  it("serves the whip's own whoosh as a separate URL from the zoom's", async () => {
    await renderServiceB(
      {
        ...serviceBInput(),
        hookZoom: { ...zoom, sfxPath: path.join(dir, "whoosh.wav") },
        hookWhip: { fromX: 140, durationMs: 320, blurPx: 18, sfxPath: path.join(dir, "whip.wav") },
        hookFocus: { blurPx: 16, holdMs: 350, durationMs: 850 },
        hookBeats: { atMs: [1000], amount: 0.035, durationMs: 180 },
      },
      path.join(dir, "out.mp4"),
    );
    const props = selectComposition.mock.calls.at(-1)![0].inputProps as ServiceBProps;
    expect(props.hookWhip).toMatchObject({ fromX: 140, durationMs: 320, blurPx: 18 });
    expect(typeof props.hookWhip?.sfxSrc).toBe("string");
    expect(props.hookWhip?.sfxSrc).not.toBe(props.hookZoom?.sfxSrc);
    // The plain-data props travel through untouched.
    expect(props.hookFocus).toEqual({ blurPx: 16, holdMs: 350, durationMs: 850 });
    expect(props.hookBeats).toEqual({ atMs: [1000], amount: 0.035, durationMs: 180 });
  });

  it("refuses a kinetic hook text that would render with no text on screen", async () => {
    const reveal = { wordMs: [0, 140], popMs: 200, exitDurationMs: 320 };
    const withText = {
      hookText: "חייבת לספר לכם",
      hookTextSafeArea: { x: 25, y: 768, w: 1055, h: 473 },
    };
    // hookTextMs 0 (what serviceBTimeline returns with no opener), no text, or
    // no rect: each one renders the whole ad with the effect silently absent.
    for (const input of [
      { hookTextReveal: reveal, ...withText },
      { hookTextReveal: reveal, timeline: { ...sampleTimeline, hookTextMs: 2520 } },
      {
        hookTextReveal: reveal,
        hookText: withText.hookText,
        timeline: { ...sampleTimeline, hookTextMs: 2520 },
      },
    ]) {
      await expect(
        renderServiceB({ ...serviceBInput(), ...input }, path.join(dir, "out.mp4")),
      ).rejects.toThrow(RenderPropsError);
    }
    // With all three it renders, and the prop travels through untouched.
    await renderServiceB(
      {
        ...serviceBInput(),
        ...withText,
        timeline: { ...sampleTimeline, hookTextMs: 2520 },
        hookTextReveal: reveal,
      },
      path.join(dir, "out.mp4"),
    );
    const props = selectComposition.mock.calls.at(-1)![0].inputProps as ServiceBProps;
    expect(props.hookTextReveal).toEqual(reveal);
  });

  it("refuses any hook animation together with an opener, not just the zoom", async () => {
    const withOpener = {
      ...serviceBInput(),
      openerPath: path.join(dir, "opener.mp4"),
      hookText: "בדיקה",
      hookTextSafeArea: { x: 25, y: 1062, w: 1009, h: 179 },
      timeline: sampleOpenerTimeline,
    };
    for (const effect of [
      { hookFocus: { blurPx: 16, holdMs: 350, durationMs: 850 } },
      { hookWhip: { fromX: 140, durationMs: 320, blurPx: 18 } },
      { hookBeats: { atMs: [1000], amount: 0.035, durationMs: 180 } },
    ]) {
      await expect(
        renderServiceB({ ...withOpener, ...effect }, path.join(dir, "out.mp4")),
      ).rejects.toThrow(RenderPropsError);
    }
  });

  it("without cutaways or a whoosh, both stay absent", async () => {
    await renderServiceB({ ...serviceBInput(), hookZoom: zoom }, path.join(dir, "out.mp4"));
    const props = selectComposition.mock.calls.at(-1)![0].inputProps as ServiceBProps;
    expect(props.cutaways).toBeUndefined();
    expect(props.hookZoom?.sfxSrc).toBeUndefined();
  });
});

/**
 * The hook line's ink crosses an uncompiled mirror (core's
 * RenderServiceAStepsProps is cast onto RenderServiceAStepsInput) and then a
 * zod parse that strips unknown keys, so a dropped or renamed field would
 * silently burn white. Pin that it reaches the composition (decision 0073).
 */
describe("renderServiceASteps props", () => {
  async function stepsInputProps(hookTextInk?: { fill: string; outline: string }) {
    for (const name of ["hook.mp4", "demo.mp4"]) writeFileSync(path.join(dir, name), "stub");
    await renderServiceASteps(
      {
        hookClipPath: path.join(dir, "hook.mp4"),
        hookLine: "בדיקה",
        hookTextSafeArea: { x: 25, y: 1062, w: 1009, h: 179 },
        ...(hookTextInk ? { hookTextInk } : {}),
        demoPath: path.join(dir, "demo.mp4"),
        steps: [{ startMs: 0, durationMs: 1000, label: "בדיקה" }],
        watermark: false,
      },
      path.join(dir, "out.mp4"),
    );
    return selectComposition.mock.calls.at(-1)![0].inputProps as ServiceAStepsProps;
  }

  it("hands the clip's ink to the composition", async () => {
    const ink = { fill: "black", outline: "255,255,255" };
    expect((await stepsInputProps(ink)).hookTextInk).toEqual(ink);
  });

  it("without an ink the composition gets none — today's white", async () => {
    expect((await stepsInputProps()).hookTextInk).toBeUndefined();
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
