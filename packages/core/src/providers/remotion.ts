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
  watermark: boolean;
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

export type RenderVideoProps = RenderServiceAProps | RenderServiceBProps;

/** @aiugc/remotion, loaded lazily — see loadRemotion(). */
interface RemotionRenderModule {
  renderServiceB(props: Omit<RenderServiceBProps, "kind">, outPath: string): Promise<void>;
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

export async function renderVideo(props: RenderVideoProps, outPath: string): Promise<void> {
  if (getEnv().DRY_RUN) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `DRY_RUN placeholder render: ${JSON.stringify(props).slice(0, 500)}`);
    return;
  }

  if (props.kind === "service_a") {
    throw new Error(
      "Remotion compositions are not built yet — run with DRY_RUN=1, or implement " +
        "apps/worker rendering per docs/04-integrations.md §Remotion",
    );
  }

  const { kind, ...serviceB } = props;
  const { renderServiceB } = await loadRemotion();
  try {
    await renderServiceB(serviceB, outPath);
  } catch (err) {
    // Bad inputs (missing local file, props that fail the composition schema)
    // will fail every retry identically; everything else — headless Chrome
    // crashes, font fetches, encoder hiccups — is worth another attempt.
    const message = `remotion render failed: ${err instanceof Error ? err.message : String(err)}`;
    if (err instanceof Error && err.name === "RenderPropsError") throw new PermanentError(message);
    throw new TransientError(message);
  }
}
