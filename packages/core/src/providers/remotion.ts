import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CaptionChunk } from "../captions";
import { getEnv } from "../config";
import { PermanentError, TransientError } from "../jobs/errors";

/**
 * Remotion render contract. Remotion exists specifically because browser text
 * rendering handles Hebrew RTL/bidi correctly and ffmpeg drawtext does not.
 * The compositions themselves are the next build step (see docs/04-integrations.md);
 * this module fixes the props contract so pipelines and compositions can be
 * built against the same shape.
 *
 * All props reference LOCAL file paths — the render handler downloads assets
 * from storage first. Output: 1080x1920, 30fps, H.264 MP4, no music ever.
 */

export interface TextSafeArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RenderServiceAProps {
  kind: "service_a";
  hookClipPath: string;
  hookLine: string;
  hookTextSafeArea: TextSafeArea;
  demoPath: string;
  demoDurationMs: number;
  captions: CaptionChunk[];
  /** Local mp3 path; present only for the voiced variant (audio must be approved). */
  voiceoverPath?: string;
  /**
   * What happens when the approved VO outlasts the demo (absent = it doesn't):
   * "freeze" holds the last demo frame with a slow push-in; "avatar" hard-cuts
   * to the lip-synced outro clip. The one continuous VO track carries all audio.
   */
  outroMode?: "freeze" | "avatar";
  /** Avatar ending: VO offset (ms) where the outro begins — snapped to a word gap. */
  voSliceMs?: number;
  /** Avatar ending: local path of the lip-synced outro clip (rendered muted). */
  avatarPath?: string;
  watermark: boolean;
}

export interface RenderServiceAStepsProps {
  kind: "service_a_steps";
  hookClipPath: string;
  hookLine: string;
  hookTextSafeArea: TextSafeArea;
  /** ONE demo file; every step trims it — no concat, no intermediate encode.
   *  No duration field: the composition probes the stored file itself. */
  demoPath: string;
  /** Chronological (the plan is server-sorted by timestamp). */
  steps: { startMs: number; durationMs: number; label: string }[];
  watermark: boolean;
  /* Silent by design (locked): no voiceover, no captions, no music, no SFX —
   * the output mp4 has no audio stream at all. */
}

export interface RenderServiceBProps {
  kind: "service_b";
  /** Lip-synced talking-head clip (InfiniteTalk output, downloaded locally). */
  talkingHeadPath: string;
  /**
   * Local mp3 path — the approved audio, which IS the final audio track: the
   * talking head is muted so the render never re-encodes the GPU clip's audio,
   * and the captions are timed against exactly this file. Always required.
   */
  voiceoverPath: string;
  /** Product B-roll cutaways that hide lip-sync during risky stretches. */
  brollPaths: string[];
  captions: CaptionChunk[];
  watermark: boolean;
}

export type RenderVideoProps =
  | RenderServiceAProps
  | RenderServiceAStepsProps
  | RenderServiceBProps;

/** renderMedia's 0-1 frame fraction, surfaced so the worker can checkpoint
 *  honest render progress for the customer poll. */
export type RenderProgressCallback = (fraction: number) => void;

/** @aiugc/remotion, loaded lazily — see loadRemotion(). */
interface RemotionRenderModule {
  renderServiceA(
    props: Omit<RenderServiceAProps, "kind">,
    outPath: string,
    onProgress?: RenderProgressCallback,
  ): Promise<void>;
  renderServiceASteps(
    props: Omit<RenderServiceAStepsProps, "kind">,
    outPath: string,
    onProgress?: RenderProgressCallback,
  ): Promise<void>;
  renderServiceB(
    props: Omit<RenderServiceBProps, "kind">,
    outPath: string,
    onProgress?: RenderProgressCallback,
  ): Promise<void>;
}

/**
 * The compositions live in @aiugc/remotion, which pulls in React, webpack and
 * @remotion/renderer's native binaries. The specifier is held in a variable so
 * no bundler follows it: @aiugc/core is transpiled into the Next.js server
 * build, which must never carry the renderer. Only the worker gets here, under
 * tsx, which resolves the workspace TypeScript source.
 */
async function loadRemotion(): Promise<RemotionRenderModule> {
  const specifier = "@aiugc/remotion/render";
  return (await import(specifier)) as RemotionRenderModule;
}

export async function renderVideo(
  props: RenderVideoProps,
  outPath: string,
  onProgress?: RenderProgressCallback,
): Promise<void> {
  if (getEnv().DRY_RUN) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `DRY_RUN placeholder render: ${JSON.stringify(props).slice(0, 500)}`);
    return;
  }

  const remotion = await loadRemotion();
  try {
    if (props.kind === "service_a") {
      const { kind, ...serviceA } = props;
      await remotion.renderServiceA(serviceA, outPath, onProgress);
    } else if (props.kind === "service_a_steps") {
      const { kind, ...serviceASteps } = props;
      await remotion.renderServiceASteps(serviceASteps, outPath, onProgress);
    } else {
      const { kind, ...serviceB } = props;
      await remotion.renderServiceB(serviceB, outPath, onProgress);
    }
  } catch (err) {
    // Bad inputs (missing local file, props that fail the composition schema)
    // will fail every retry identically; everything else — headless Chrome
    // crashes, font fetches, encoder hiccups — is worth another attempt.
    const message = `remotion render failed: ${err instanceof Error ? err.message : String(err)}`;
    if (err instanceof Error && err.name === "RenderPropsError") throw new PermanentError(message);
    throw new TransientError(message);
  }
}
