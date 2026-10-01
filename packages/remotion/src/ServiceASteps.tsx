import { getVideoMetadata } from "@remotion/media-utils";
import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
  type CalculateMetadataFunction,
} from "remotion";
import { HookLine } from "./ServiceA";
import { ACTIVE_WORD_COLOR, TEXT_OUTLINE, Watermark } from "./overlays";
import { FPS, HEIGHT, type ServiceAStepsProps } from "./schema";
import { msToFrame, serviceAStepsTimeline } from "./timing";
import { STEP_LABEL_RECT } from "./text-fit";

/**
 * Service A steps format: bank hook clip with a burned Hebrew hook line →
 * hard cuts through 6–8 short clips of the customer's demo, each showing one
 * step with one short burned label — ending on the success state. Silent by
 * design (locked): no VO, no music, no SFX, so no <Audio> anywhere here and
 * the render passes enforceAudioTrack:false. Every step mounts the SAME demo
 * file with a different trimBefore — same file, same codec, same resolution;
 * no ffmpeg concat, no intermediate encode.
 */

const COVER: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

export const ServiceASteps: React.FC<ServiceAStepsProps> = ({
  hookSrc,
  hookLine,
  hookTextSafeArea,
  hookTextInk,
  demoSrc,
  steps,
  watermark,
  hookDurationInFrames,
  demoDurationInFrames,
}) => {
  // Fallbacks only matter in Studio before calculateMetadata resolves: a demo
  // long enough for every step, so the timeline never throws there.
  const fallbackDemoFrames =
    steps.reduce((max, s) => Math.max(max, msToFrame(s.startMs + s.durationMs)), 1) + FPS;
  const timeline = serviceAStepsTimeline({
    hookFrames: hookDurationInFrames ?? FPS * 3,
    demoFrames: demoDurationInFrames ?? fallbackDemoFrames,
    steps,
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Sequence durationInFrames={timeline.hookFrames}>
        <OffthreadVideo src={hookSrc} muted style={COVER} />
        {/* The clip's colour (decision 0073): TEXT_OUTLINE's own layers in
            the ink's rgb, so black keeps today's outline weight, drawn light.
            No ink = white on TEXT_OUTLINE, exactly as before. */}
        <HookLine
          text={hookLine}
          area={hookTextSafeArea}
          color={hookTextInk?.fill}
          textShadow={
            hookTextInk && TEXT_OUTLINE.replaceAll("rgba(0,0,0,", `rgba(${hookTextInk.outline},`)
          }
        />
      </Sequence>

      {timeline.steps.map((step, i) => (
        <Sequence key={i} from={step.fromFrame} durationInFrames={step.durationInFrames}>
          <StepSegment
            src={demoSrc}
            trimBeforeFrames={step.trimBeforeFrames}
            segmentFrames={step.durationInFrames}
            label={steps[i]!.label}
          />
        </Sequence>
      ))}

      {watermark ? <Watermark /> : null}
    </AbsoluteFill>
  );
};

const POP_FRAMES = 5;
/** transform-origin at the label rect's center so the pop scales in place. */
const LABEL_ORIGIN_Y = ((STEP_LABEL_RECT.y + STEP_LABEL_RECT.h / 2) / HEIGHT) * 100;

/**
 * One step: the demo trimmed to this step's window, with the label popping in.
 * The slow scale drift (the DemoSegment pattern) plus the hard cut back to 1
 * at each boundary is the per-step punch-in — motion reads as intent.
 */
const StepSegment: React.FC<{
  src: string;
  trimBeforeFrames: number;
  segmentFrames: number;
  label: string;
}> = ({ src, trimBeforeFrames, segmentFrames, label }) => {
  const frame = useCurrentFrame(); // local to the sequence
  const scale = interpolate(frame, [0, segmentFrames], [1, 1.04], {
    extrapolateRight: "clamp",
  });
  const pop = interpolate(frame, [0, POP_FRAMES], [0, 1], { extrapolateRight: "clamp" });

  return (
    <>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <OffthreadVideo src={src} muted trimBefore={trimBeforeFrames} style={COVER} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          opacity: pop,
          transform: `scale(${0.92 + 0.08 * pop})`,
          transformOrigin: `50% ${LABEL_ORIGIN_Y}%`,
        }}
      >
        <HookLine text={label} area={STEP_LABEL_RECT} color={ACTIVE_WORD_COLOR} />
      </AbsoluteFill>
    </>
  );
};

/**
 * Durations come from the actual files (probed in the browser, like ServiceA),
 * never from DB fields. The timeline call re-runs against the PROBED demo
 * length here — a step trimmed past the demo's end throws and fails the
 * render at selectComposition, before any frame is paid for.
 */
export const calculateServiceAStepsMetadata: CalculateMetadataFunction<
  ServiceAStepsProps
> = async ({ props }) => {
  const [hook, demo] = await Promise.all([
    getVideoMetadata(props.hookSrc),
    getVideoMetadata(props.demoSrc),
  ]);

  const toFrames = (seconds: number) => Math.max(1, Math.round(seconds * FPS));
  const hookDurationInFrames = toFrames(hook.durationInSeconds);
  const demoDurationInFrames = toFrames(demo.durationInSeconds);

  const { durationInFrames } = serviceAStepsTimeline({
    hookFrames: hookDurationInFrames,
    demoFrames: demoDurationInFrames,
    steps: props.steps,
  });

  return {
    durationInFrames,
    props: { ...props, hookDurationInFrames, demoDurationInFrames },
  };
};
