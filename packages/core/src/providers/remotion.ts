import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CaptionChunk } from "../captions";
import { getEnv } from "../config";

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
  /** Product B-roll cutaways that hide lip-sync during risky stretches. */
  brollPaths: string[];
  captions: CaptionChunk[];
  watermark: boolean;
}

export type RenderVideoProps = RenderServiceAProps | RenderServiceBProps;

export async function renderVideo(props: RenderVideoProps, outPath: string): Promise<void> {
  if (getEnv().DRY_RUN) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `DRY_RUN placeholder render: ${JSON.stringify(props).slice(0, 500)}`);
    return;
  }
  // Real implementation: @remotion/renderer against the ServiceA/ServiceB
  // compositions on the worker box (free license: company <= 3 people).
  throw new Error(
    "Remotion compositions are not built yet — run with DRY_RUN=1, or implement " +
      "apps/worker rendering per docs/04-integrations.md §Remotion",
  );
}
