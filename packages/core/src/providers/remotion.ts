import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CaptionChunk } from "../captions";
import { getEnv } from "../config";
import { PermanentError, TransientError } from "../jobs/errors";
import type { GradeCurve } from "../media/grade";
import type { ServiceBTimeline } from "../service-b-timeline";

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
  /**
   * The hook line's fill and outline rgb, from the clip's colour
   * (hook-text-color.ts, decision 0073). Absent = today's white. Field name
   * and shape MIRROR @aiugc/remotion's RenderServiceAStepsInput — nothing
   * typechecks that mirror (see hookZoom below), so the remotion test and the
   * DRY_RUN echo test pin it.
   */
  hookTextInk?: { fill: string; outline: string };
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
  /**
   * Seeds the composition's handheld camera path — the render id, so a retry
   * re-renders identical frames. Right after `kind` so the DRY_RUN echo
   * always carries it.
   */
  cameraSeed: string;
  /** Lip-synced talking-head clip (HeyGen output, downloaded locally). */
  talkingHeadPath: string;
  /**
   * Local mp3 path — the approved audio, which IS the final audio track: the
   * talking head is muted so the render never re-encodes the GPU clip's audio,
   * and the captions are timed against exactly this file. Always required.
   * Starts at timeline.captionOffsetMs, the frame speech begins in the clip.
   */
  voiceoverPath: string;
  /** Product B-roll cutaways that hide lip-sync during risky stretches. */
  brollPaths: string[];
  /**
   * The opener effect (vault 0017): a founder-made clip in front of the
   * talking head with the hook text burned over its palm phase, hard-cut at
   * the reveal. All three together, or none.
   */
  openerPath?: string;
  hookText?: string;
  hookTextSafeArea?: TextSafeArea;
  /**
   * The layout in ms, from serviceBTimeline — the composition converts to
   * frames and does no timeline arithmetic of its own.
   */
  timeline: ServiceBTimeline;
  /**
   * Per-channel gain curve on the talking head, measured per render against
   * the opener's reveal frame (media/grade.ts). Absent without an opener,
   * under DRY_RUN, and when the two frames were not comparable.
   */
  talkingHeadGrade?: GradeCurve;
  /**
   * Pixels (at 1080×1920) the talking head is offset by, for its whole
   * length, so its idle frame sits on the opener's reveal frame at the cut
   * (no ease — vault 0021). Absent when not measured or when the match was
   * outside what the overscan hides.
   */
  talkingHeadAlign?: { dx: number; dy: number };
  /**
   * The hook animation the composition performs on the clip — at most one,
   * chosen by name in the wizard and turned into numbers by buildServiceBProps
   * (vault 0023). Field names and shapes MIRROR @aiugc/remotion's
   * RenderServiceBInput exactly: `sfxPath` is a local file (the composition's
   * own prop is `sfxSrc`, a loopback URL its render entry maps to). Nothing
   * typechecks that mirror — loadRemotion casts the dynamic import against
   * this interface — so a wrong name here renders silently and wrongly.
   */
  hookZoom?: { from: number; to: number; atMs: number; durationMs: number; sfxPath?: string };
  hookFocus?: { blurPx: number; holdMs: number; durationMs: number };
  hookWhip?: { fromX: number; durationMs: number; blurPx: number; sfxPath?: string };
  watermark: boolean;
  /** Last on purpose: the DRY_RUN render echoes a prefix of these props. */
  captions: CaptionChunk[];
}

export type RenderVideoProps = RenderServiceAProps | RenderServiceAStepsProps | RenderServiceBProps;

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
    // A prefix, not the whole thing: captions are the one unbounded field and
    // every builder puts them last. 2000 keeps the fixed fields — four local
    // paths (the clip, the VO, the opener's, a hook animation's sfx), the hook
    // text and its rect, and the timeline — inside it on a long checkout path.
    writeFileSync(outPath, `DRY_RUN placeholder render: ${JSON.stringify(props).slice(0, 2000)}`);
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
