import { measureText } from "@remotion/layout-utils";
import { getAudioDurationInSeconds, getVideoMetadata } from "@remotion/media-utils";
import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  Freeze,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from "remotion";
import { Captions, TEXT_OUTLINE, Watermark, fontFamily } from "./overlays";
import { FPS, type ServiceAProps, type TextSafeArea } from "./schema";
import { frameToMs, serviceATimeline } from "./timing";
import { fitFontSize, HOOK_FONT } from "./text-fit";

/**
 * Service A: bank reaction clip with a burned Hebrew hook line → hard cut →
 * the customer's demo with burned captions and (voiced variant) the approved
 * VO from demo start. The hook is read, not heard — the bank clip is always
 * muted; in the voiced variant the demo is muted too and the one continuous VO
 * track carries all audio, including over a freeze or avatar ending.
 * No music, ever (locked).
 */

const COVER: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

export const ServiceA: React.FC<ServiceAProps> = ({
  hookSrc,
  hookLine,
  hookTextSafeArea,
  demoSrc,
  voiceoverSrc,
  captions,
  outroMode,
  voSliceMs,
  avatarSrc,
  watermark,
  hookDurationInFrames,
  demoDurationInFrames,
  voDurationInFrames,
  avatarDurationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Fallbacks only matter in Studio before calculateMetadata resolves.
  const timeline = serviceATimeline({
    hookFrames: hookDurationInFrames ?? FPS * 2,
    demoFrames: demoDurationInFrames ?? Math.max(1, durationInFrames - FPS * 2),
    voFrames: voDurationInFrames,
    outroMode,
    voSliceMs,
  });
  const { hookFrames, demoVisibleFrames, avatarStartFrame } = timeline;
  const demoSequenceEnd = avatarStartFrame ?? durationInFrames;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Sequence durationInFrames={hookFrames}>
        <OffthreadVideo src={hookSrc} muted style={COVER} />
        <HookLine text={hookLine} area={hookTextSafeArea} />
      </Sequence>

      <Sequence from={hookFrames} durationInFrames={Math.max(1, demoSequenceEnd - hookFrames)}>
        <DemoSegment
          src={demoSrc}
          muted={voiceoverSrc !== undefined}
          visibleFrames={demoVisibleFrames}
          segmentFrames={demoSequenceEnd - hookFrames}
        />
      </Sequence>

      {avatarStartFrame !== undefined && avatarSrc !== undefined ? (
        <Sequence from={avatarStartFrame}>
          <AvatarSegment
            src={avatarSrc}
            clipFrames={avatarDurationInFrames}
            segmentFrames={Math.max(1, durationInFrames - avatarStartFrame)}
          />
        </Sequence>
      ) : null}

      {voiceoverSrc !== undefined ? (
        <Sequence from={hookFrames}>
          <Audio src={voiceoverSrc} />
        </Sequence>
      ) : null}

      {/* Captions are demo-relative; negative ms during the hook shows none. */}
      <Captions captions={captions} ms={frameToMs(frame - hookFrames)} />
      {watermark ? <Watermark /> : null}
    </AbsoluteFill>
  );
};

/**
 * The demo, hard-cut at `visibleFrames`. When the segment outlives the visible
 * demo (freeze ending, or the gap before an avatar starts) the last shown
 * frame holds with a slow push-in — motion reads as intent, a static frame
 * reads as a stall.
 */
const DemoSegment: React.FC<{
  src: string;
  muted: boolean;
  visibleFrames: number;
  segmentFrames: number;
}> = ({ src, muted, visibleFrames, segmentFrames }) => {
  const frame = useCurrentFrame(); // local to the sequence
  const holding = frame >= visibleFrames;
  const scale =
    holding && segmentFrames > visibleFrames
      ? interpolate(frame, [visibleFrames, segmentFrames], [1, 1.03], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 1;

  return (
    <AbsoluteFill style={{ transform: `scale(${scale})` }}>
      <Freeze frame={Math.max(0, visibleFrames - 1)} active={holding}>
        <OffthreadVideo src={src} muted={muted} style={COVER} />
      </Freeze>
    </AbsoluteFill>
  );
};

/**
 * The lip-synced outro. Muted — the continuous VO carries the audio — with a
 * slow micro-motion drift (Service B moved on to a handheld camera path), and
 * a final-frame hold in case the GPU clip came back a hair shorter than the
 * VO tail.
 */
const AvatarSegment: React.FC<{
  src: string;
  clipFrames?: number;
  segmentFrames: number;
}> = ({ src, clipFrames, segmentFrames }) => {
  const frame = useCurrentFrame(); // local to the sequence
  const scale = interpolate(frame, [0, segmentFrames], [1, 1.025], {
    extrapolateRight: "clamp",
  });
  const lastClipFrame = Math.max(0, (clipFrames ?? segmentFrames) - 1);

  return (
    <AbsoluteFill style={{ transform: `scale(${scale})` }}>
      <Freeze frame={lastClipFrame} active={frame > lastClipFrame}>
        <OffthreadVideo src={src} muted style={COVER} />
      </Freeze>
    </AbsoluteFill>
  );
};

/**
 * How far the kinetic hook line travels on its way out — down toward the
 * caption slot (~425px below the rect's centre) and a little smaller, fading
 * as it goes. Service B's `hookTextReveal` mock only; a hook line with no
 * `exit` never moves.
 */
const HOOK_EXIT_DY = 360;
const HOOK_EXIT_SCALE = 0.92;

export const HookLine: React.FC<{
  text: string;
  area: TextSafeArea;
  color?: string;
  /** Absent = TEXT_OUTLINE. Only the steps hook line passes one (decision 0073). */
  textShadow?: string;
  /**
   * Kinetic hook text (Service B mock, timing.ts `hookTextRevealState`):
   * one 0..1 pop progress per whitespace-separated word. Absent = the whole
   * line is simply on screen, which is what Service A always passes.
   */
  wordProgress?: number[];
  /** 0..1 of the slide-down-and-fade exit; absent = at rest. */
  exit?: number;
}> = ({
  text,
  area,
  // White for the hook line; the steps format burns its labels yellow.
  color = "white",
  textShadow = TEXT_OUTLINE,
  wordProgress,
  exit = 0,
}) => {
  const fontSize = useMemo(
    () =>
      fitFontSize({
        text,
        maxWidth: area.w,
        maxHeight: area.h,
        base: HOOK_FONT.base,
        min: HOOK_FONT.min,
        lineHeight: HOOK_FONT.lineHeight,
        measure: (t, size) =>
          measureText({
            text: t,
            fontFamily,
            fontSize: size,
            fontWeight: "800",
            validateFontIsLoaded: false,
          }).width,
      }),
    [text, area.w, area.h],
  );

  return (
    <div
      style={{
        position: "absolute",
        left: area.x,
        top: area.y,
        width: area.w,
        height: area.h,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        direction: "rtl",
        textAlign: "center",
        fontFamily,
        fontWeight: 800,
        fontSize,
        lineHeight: HOOK_FONT.lineHeight,
        color,
        textShadow,
        transform:
          exit > 0
            ? `translateY(${(HOOK_EXIT_DY * exit).toFixed(1)}px) scale(${1 - (1 - HOOK_EXIT_SCALE) * exit})`
            : undefined,
        opacity: 1 - exit,
      }}
    >
      {/* isolate, not plaintext: plaintext takes base direction from the first
          strong character, so a line opening with a Latin run (`POV:`) flips
          the whole line LTR and the prefix drifts to the wrong edge. isolate
          keeps the container's RTL base; the Latin run stays an LTR island.
          The words live INSIDE this one span, never as siblings: the parent is
          a flex container, which drops whitespace-only text nodes between flex
          items and would eat every space in the line. */}
      <span style={{ unicodeBidi: "isolate" }}>
        {wordProgress === undefined
          ? text
          : text
              .split(/\s+/)
              .filter(Boolean)
              .map((word, i) => {
                // A word with no progress of its own has already fully popped
                // (hookTextRevealState pads to the word count, so this is only
                // reached if a caller passes a short array directly).
                const p = wordProgress[i] ?? 1;
                return (
                  <React.Fragment key={`${i}-${word}`}>
                    {i > 0 ? " " : null}
                    {/* inline-block so the pop can scale it; transforms do not
                        affect layout, so the line never reflows as words land. */}
                    <span
                      style={{
                        display: "inline-block",
                        opacity: p,
                        // No transform once it has landed — Captions does the
                        // same, so a finished word is not left on a
                        // compositing path for the rest of the ad.
                        transform: p >= 1 ? undefined : `scale(${(0.86 + 0.14 * p).toFixed(3)})`,
                      }}
                    >
                      {word}
                    </span>
                  </React.Fragment>
                );
              })}
      </span>
    </div>
  );
};

/**
 * Durations come from the actual files (probed in the browser, like Service
 * B), never from DB fields — the render composes exactly what was stored.
 */
export const calculateServiceAMetadata: CalculateMetadataFunction<ServiceAProps> = async ({
  props,
}) => {
  const [hook, demo, voSeconds, avatar] = await Promise.all([
    getVideoMetadata(props.hookSrc),
    getVideoMetadata(props.demoSrc),
    props.voiceoverSrc ? getAudioDurationInSeconds(props.voiceoverSrc) : undefined,
    props.avatarSrc ? getVideoMetadata(props.avatarSrc) : undefined,
  ]);

  const toFrames = (seconds: number) => Math.max(1, Math.round(seconds * FPS));
  const hookDurationInFrames = toFrames(hook.durationInSeconds);
  const demoDurationInFrames = toFrames(demo.durationInSeconds);
  const voDurationInFrames = voSeconds === undefined ? undefined : toFrames(voSeconds);
  const avatarDurationInFrames =
    avatar === undefined ? undefined : toFrames(avatar.durationInSeconds);

  const { durationInFrames } = serviceATimeline({
    hookFrames: hookDurationInFrames,
    demoFrames: demoDurationInFrames,
    voFrames: voDurationInFrames,
    outroMode: props.outroMode,
    voSliceMs: props.voSliceMs,
  });

  return {
    durationInFrames,
    props: {
      ...props,
      hookDurationInFrames,
      demoDurationInFrames,
      voDurationInFrames,
      avatarDurationInFrames,
    },
  };
};
