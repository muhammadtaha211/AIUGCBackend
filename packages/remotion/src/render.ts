import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition, type FfmpegOverrideFn } from "@remotion/renderer";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveLocalFiles } from "./serve-files";
import { serviceBSchema, type CaptionChunk, type ServiceBProps } from "./schema";

/**
 * Node-side render entrypoint. Kept free of JSX and of any browser import so
 * @aiugc/core can load it without dragging the composition graph along.
 *
 * Input mirrors `RenderServiceBProps` from @aiugc/core (frozen contract):
 * local file paths in, one 1080x1920 / 30fps / H.264 mp4 out.
 */
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

export async function renderServiceB(input: RenderServiceBInput, outPath: string): Promise<void> {
  const files = [input.talkingHeadPath, input.voiceoverPath, ...input.brollPaths];
  for (const file of files) {
    // `!file` covers an untyped caller dropping the voiceover: that has to fail
    // permanently here, not crash the file server on an undefined path.
    if (!file || !existsSync(file)) {
      throw new RenderPropsError(`render input file is missing: ${file}`);
    }
  }

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

    const serveUrl = await getBundle();
    const composition = await selectComposition({
      serveUrl,
      id: "ServiceB",
      inputProps: props.data,
    });

    mkdirSync(path.dirname(outPath), { recursive: true });
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
      outputLocation: outPath,
      inputProps: props.data,
      logLevel: "error",
    });
  } finally {
    await served.close();
  }
}
