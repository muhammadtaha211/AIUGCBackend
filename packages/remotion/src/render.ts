import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition, type FfmpegOverrideFn } from "@remotion/renderer";
import { existsSync, mkdirSync } from "node:fs";
import { freemem } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveLocalFiles } from "./serve-files";
import { STEP_OUT_OF_RANGE } from "./timing";
import {
  serviceASchema,
  serviceAStepsSchema,
  serviceBSchema,
  type CaptionChunk,
  type ServiceAProps,
  type ServiceAStepsProps,
  type ServiceBProps,
  type TextSafeArea,
} from "./schema";

/**
 * Node-side render entrypoint. Kept free of JSX and of any browser import so
 * @aiugc/core can load it without dragging the composition graph along.
 *
 * Inputs mirror `RenderServiceAProps` / `RenderServiceBProps` from @aiugc/core
 * (frozen contract): local file paths in, one 1080x1920 / 30fps / H.264 mp4 out.
 */
export interface RenderServiceAInput {
  hookClipPath: string;
  hookLine: string;
  hookTextSafeArea: TextSafeArea;
  demoPath: string;
  /** Unused: the composition probes the stored file itself. Part of the contract. */
  demoDurationMs: number;
  captions: CaptionChunk[];
  voiceoverPath?: string;
  outroMode?: "freeze" | "avatar";
  voSliceMs?: number;
  avatarPath?: string;
  watermark: boolean;
}

export interface RenderServiceAStepsInput {
  hookClipPath: string;
  hookLine: string;
  hookTextSafeArea: TextSafeArea;
  /** ONE demo file; every step trims it. */
  demoPath: string;
  /** Chronological — the server sorts by timestamp before rendering. */
  steps: { startMs: number; durationMs: number; label: string }[];
  watermark: boolean;
}

export interface RenderServiceBInput {
  talkingHeadPath: string;
  /** The approved mp3 — the render's audio track (the clip's own is muted). */
  voiceoverPath: string;
  brollPaths: string[];
  captions: CaptionChunk[];
  watermark: boolean;
}

/** Bad inputs — the caller maps this to a permanent (non-retryable) failure. */
export class RenderPropsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderPropsError";
  }
}

/**
 * Exported for tests. colorSpace:"bt709" makes Remotion's encoder convert the
 * piped frames to limited range and stamp matrix + range in the H.264 VUI, but
 * it leaves primaries/transfer "unknown" there. Relabel them on the stitcher —
 * the process that writes the final mux — with a bitstream filter, not a
 * re-encode. 1 = BT.709, video_full_range_flag 0 = limited.
 *
 * NOTE: the conversion is only correct when the input clips themselves carry
 * colour tags — an untagged clip's pixels pass through full-swing into the
 * "tv"-tagged output (verified empirically, 4.0.499). That is why the worker
 * retags untagged lip-sync clips before rendering (core: retagBt709Full).
 */
export const bt709FfmpegOverride: FfmpegOverrideFn = ({ type, args }) => {
  if (type !== "stitcher") return args;
  return [
    ...args.slice(0, -1),
    "-bsf:v",
    "h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1",
    args[args.length - 1]!,
  ];
};

/**
 * Size of Remotion's <OffthreadVideo> decoded-frame cache, pinned.
 *
 * Remotion's default is `null` = half of the memory FREE when the render
 * starts (`os.freemem()` on Windows), so the same inputs can render
 * differently depending on what else the box happens to be running. That is
 * not a performance knob. A 1080x1920 frame costs ~6MB in this cache, and once
 * a thread's share cannot hold a couple of them the compositor prunes to one
 * frame and then answers the NEXT timestamp out of that near-empty cache —
 * its own verbose log, verbatim:
 *
 *   Pruned 5 on thread 0 to save memory, keeping 1. Cache size on thread: 6MB,
 *     total cache: 6MB, max cache on thread: 9MB
 *   Found timestamp with too much threshold, but will let it pass because no
 *     closer frames found. difference = 512, threshold = 511
 *
 * 512 ticks is exactly one frame at this file's time base: it hands back the
 * previous frame rather than decoding the one asked for. Timestamps, duration
 * and playback speed all stay correct, so nothing downstream notices — the ad
 * just stutters. Measured against the compositor directly (no browser), on the
 * 88s/1080x1920 demo of render 448d257c at its 5-step plan's exact timestamps:
 *
 *   cache  20MB -> 12.2-12.8 distinct fps per step segment, hook 14.6   (91s)
 *   cache  50MB -> 23.9 per step                                        (68s)
 *   cache 100MB -> 30.0 per step, clean                                 (19s)
 *   cache 200/400/800MB -> 30.0 per step                          (19/26/19s)
 *   cache 512MB -> 30.0 per step, zero "too much threshold" logged       (17s)
 *
 * Wall clock for all 423 extractions in brackets — it flattens from 100MB up,
 * so the pin buys determinism for free. Full renders of that plan on a quiet
 * box agree: 95-103s and 397/423 mpdecimate-distinct frames at the default,
 * 169s and 345/423 at 25MB. The 2026-08-18 render kept 341/423 with a
 * per-segment difference fingerprint matching 25MB, which is what dates the
 * fault to this mechanism. What it was on that box that made the cache that
 * small was never established — half of free memory implies ~50MB free, and
 * nothing on disk records it. The pin makes the question moot: the size no
 * longer depends on anything ambient.
 *
 * 512MB total; with both files open the compositor reported a 256MB budget per
 * decode thread, ~40 frames each. Damage was seen at 50MB and below and never
 * at 100MB or above, on a handful of runs per size — the boundary is fuzzy, so
 * this is deliberately far above it. Note it is a floor as well as a ceiling:
 * unlike the default it will not shrink on a small host. Do not remove it: it
 * is correctness, not tuning.
 */
const OFFTHREAD_VIDEO_CACHE_BYTES = 512 * 1024 * 1024;

const ENTRY_POINT = fileURLToPath(new URL("./index.ts", import.meta.url));

let bundlePromise: Promise<string> | undefined;

/** Bundle once per process — webpack is the slow part, renders are not. */
export function getBundle(): Promise<string> {
  bundlePromise ??= bundle({ entryPoint: ENTRY_POINT }).catch((err: unknown) => {
    bundlePromise = undefined; // a long-lived worker must be able to retry
    throw err;
  });
  return bundlePromise;
}

export async function renderServiceA(input: RenderServiceAInput, outPath: string): Promise<void> {
  const files = [input.hookClipPath, input.demoPath];
  if (input.voiceoverPath) files.push(input.voiceoverPath);
  if (input.avatarPath) files.push(input.avatarPath);
  assertFilesExist(files);

  const served = await serveLocalFiles(files);
  try {
    let next = 2;
    const props = serviceASchema.safeParse({
      hookSrc: served.urls[0]!,
      hookLine: input.hookLine,
      hookTextSafeArea: input.hookTextSafeArea,
      demoSrc: served.urls[1]!,
      voiceoverSrc: input.voiceoverPath ? served.urls[next++] : undefined,
      captions: input.captions,
      outroMode: input.outroMode,
      voSliceMs: input.voSliceMs,
      avatarSrc: input.avatarPath ? served.urls[next++] : undefined,
      watermark: input.watermark,
    } satisfies ServiceAProps);
    if (!props.success) {
      throw new RenderPropsError(`invalid ServiceA props: ${props.error.message}`);
    }
    await runRender("ServiceA", props.data, outPath);
  } finally {
    await served.close();
  }
}

export async function renderServiceASteps(
  input: RenderServiceAStepsInput,
  outPath: string,
): Promise<void> {
  const files = [input.hookClipPath, input.demoPath];
  assertFilesExist(files);

  const served = await serveLocalFiles(files);
  try {
    const props = serviceAStepsSchema.safeParse({
      hookSrc: served.urls[0]!,
      hookLine: input.hookLine,
      hookTextSafeArea: input.hookTextSafeArea,
      demoSrc: served.urls[1]!,
      steps: input.steps,
      watermark: input.watermark,
    } satisfies ServiceAStepsProps);
    if (!props.success) {
      throw new RenderPropsError(`invalid ServiceASteps props: ${props.error.message}`);
    }
    // The steps format is silent (locked) and the output mp4 has NO audio
    // stream. enforceAudioTrack:false alone is not enough — with audioCodec
    // "aac" set, renderMedia muxes a silent track anyway (verified on
    // 4.0.499); muted:true is what actually drops the stream. If an upload
    // path ever chokes on a stream-less MP4, the fix is to mux a silent AAC
    // track — never to add sound.
    try {
      await runRender("ServiceASteps", props.data, outPath, {
        enforceAudioTrack: false,
        muted: true,
      });
    } catch (err) {
      // The out-of-range-trim throw fires in the browser during
      // selectComposition and reaches Node as a plain Error — remap it so the
      // worker's taxonomy sees a bad plan as permanent, never retryable.
      if (err instanceof Error && err.message.includes(STEP_OUT_OF_RANGE)) {
        throw new RenderPropsError(err.message);
      }
      throw err;
    }
  } finally {
    await served.close();
  }
}

export async function renderServiceB(input: RenderServiceBInput, outPath: string): Promise<void> {
  const files = [input.talkingHeadPath, input.voiceoverPath, ...input.brollPaths];
  assertFilesExist(files);

  const served = await serveLocalFiles(files);
  try {
    const props = serviceBSchema.safeParse({
      talkingHeadSrc: served.urls[0]!,
      voiceoverSrc: served.urls[1]!,
      brollSrcs: served.urls.slice(2),
      captions: input.captions,
      watermark: input.watermark,
    } satisfies ServiceBProps);
    if (!props.success) {
      throw new RenderPropsError(`invalid ServiceB props: ${props.error.message}`);
    }
    await runRender("ServiceB", props.data, outPath);
  } finally {
    await served.close();
  }
}

function assertFilesExist(files: (string | undefined)[]): void {
  for (const file of files) {
    // `!file` covers an untyped caller dropping a required path: that has to
    // fail permanently here, not crash the file server on an undefined path.
    if (!file || !existsSync(file)) {
      throw new RenderPropsError(`render input file is missing: ${file}`);
    }
  }
}

async function runRender(
  id: "ServiceA" | "ServiceASteps" | "ServiceB",
  inputProps: ServiceAProps | ServiceAStepsProps | ServiceBProps,
  outPath: string,
  opts?: { enforceAudioTrack?: boolean; muted?: boolean },
): Promise<void> {
  const serveUrl = await getBundle();
  const composition = await selectComposition({ serveUrl, id, inputProps });

  mkdirSync(path.dirname(outPath), { recursive: true });
  // The 2026-08-18 stutter was dated to a too-small ambient frame cache, but
  // what made that box tight was never established — it was reconstructed from
  // surviving temp dirs. These are the two numbers that reconstruction needed:
  // record them at every render start so the next occurrence proves itself.
  // outPath carries the render id (WORK_DIR/render/<videoRenderId>/final.mp4).
  console.log(
    `[render] ${id} out=${outPath} freemem=${freemem()} offthreadVideoCacheSizeInBytes=${OFFTHREAD_VIDEO_CACHE_BYTES}`,
  );
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    audioCodec: "aac",
    // crf 20 matches the normalize step in @aiugc/core media/ffmpeg.
    crf: 20,
    // Tag BT.709 limited (-color_range tv + zscale); the default leaves
    // full-range unknown-matrix output that players display too bright/
    // washed against every other delivery file. The override above makes
    // the range conversion real and completes the VUI tags.
    colorSpace: "bt709",
    ffmpegOverride: bt709FfmpegOverride,
    offthreadVideoCacheSizeInBytes: OFFTHREAD_VIDEO_CACHE_BYTES,
    outputLocation: outPath,
    inputProps,
    logLevel: "error",
    ...opts,
  });
}
