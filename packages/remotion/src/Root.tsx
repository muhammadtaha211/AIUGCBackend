import type React from "react";
import { Audio, Composition, interpolate, staticFile, useCurrentFrame } from "remotion";
import { ServiceA, calculateServiceAMetadata } from "./ServiceA";
import { ServiceASteps, calculateServiceAStepsMetadata } from "./ServiceASteps";
import { ServiceB, calculateServiceBMetadata } from "./ServiceB";
import { ServiceC, calculateServiceCMetadata } from "./ServiceC";
import {
  sampleCaptions,
  sampleDurationInFrames,
  sampleHookText,
  sampleOpenerTimeline,
  sampleSteps,
  sampleTextBlock,
  sampleTimeline,
} from "./fixtures";
import {
  FPS,
  HEIGHT,
  WIDTH,
  serviceASchema,
  serviceAStepsSchema,
  serviceBSchema,
  serviceCSchema,
} from "./schema";

/**
 * `ServiceA` and `ServiceB` are the compositions the pipeline renders. The
 * rest is founder preview scaffolding: a watermarked twin, and the placeholder
 * clip that `pnpm --filter @aiugc/remotion fixtures` renders so previewing
 * costs nothing (no GPU, no lip-sync, no TTS).
 */

const previewProps = {
  talkingHeadSrc: staticFile("fixtures/talking-head.mp4"),
  voiceoverSrc: staticFile("fixtures/voiceover.wav"),
  brollSrcs: [],
  captions: sampleCaptions,
  timeline: sampleTimeline,
  watermark: false,
};

/** The opener effect over a synthetic lavfi clip (`pnpm fixtures`), so the
 *  hold, the burned hook text and the seam at the reveal can be eyeballed. */
const previewPropsOpener = {
  ...previewProps,
  openerSrc: staticFile("fixtures/opener.mp4"),
  hookText: sampleHookText,
  hookTextSafeArea: { x: 25, y: 1062, w: 1009, h: 179 },
  timeline: sampleOpenerTimeline,
};

/** The placeholder clip stands in for both the hook clip and the demo. */
const previewPropsA = {
  hookSrc: staticFile("fixtures/talking-head.mp4"),
  hookLine: "זה מה שאף אחד לא מספר לכם",
  // Mirrors DEFAULT_HOOK_TEXT_RECT in @aiugc/core/hook-geometry — kept as a
  // literal because core depends on this package, never the other way round.
  hookTextSafeArea: { x: 25, y: 1062, w: 1009, h: 179 },
  demoSrc: staticFile("fixtures/talking-head.mp4"),
  voiceoverSrc: staticFile("fixtures/voiceover.wav"),
  captions: sampleCaptions,
  watermark: false,
};

/** The lavfi fixtures (steps-hook/steps-demo) come from `pnpm fixtures`. */
const previewPropsSteps = {
  hookSrc: staticFile("fixtures/steps-hook.mp4"),
  hookLine: "ככה מזמינים בלי לחכות",
  hookTextSafeArea: { x: 25, y: 1062, w: 1009, h: 179 },
  demoSrc: staticFile("fixtures/steps-demo.mp4"),
  steps: sampleSteps,
  watermark: false,
};

/** Service C: the lavfi clip with a tone (`pnpm fixtures`) under the sample block. */
const previewPropsC = {
  clipSrc: staticFile("fixtures/text-block.mp4"),
  text: sampleTextBlock,
  // Mirrors DEFAULT_TEXT_BLOCK_RECT in @aiugc/core/hook-geometry — a literal
  // for the same reason as the hook rect above.
  textSafeArea: { x: 80, y: 360, w: 820, h: 1040 },
  watermark: false,
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="ServiceC"
      component={ServiceC}
      schema={serviceCSchema}
      defaultProps={previewPropsC}
      calculateMetadata={calculateServiceCMetadata}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={sampleDurationInFrames}
    />
    <Composition
      id="ServiceA"
      component={ServiceA}
      schema={serviceASchema}
      defaultProps={previewPropsA}
      calculateMetadata={calculateServiceAMetadata}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={sampleDurationInFrames}
    />
    <Composition
      id="ServiceASteps"
      component={ServiceASteps}
      schema={serviceAStepsSchema}
      defaultProps={previewPropsSteps}
      calculateMetadata={calculateServiceAStepsMetadata}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={sampleDurationInFrames}
    />
    <Composition
      id="ServiceB"
      component={ServiceB}
      schema={serviceBSchema}
      defaultProps={previewProps}
      calculateMetadata={calculateServiceBMetadata}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={sampleDurationInFrames}
    />
    <Composition
      id="ServiceB-Opener"
      component={ServiceB}
      schema={serviceBSchema}
      defaultProps={previewPropsOpener}
      calculateMetadata={calculateServiceBMetadata}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={sampleDurationInFrames}
    />
    <Composition
      id="ServiceB-Watermarked"
      component={ServiceB}
      schema={serviceBSchema}
      defaultProps={{ ...previewProps, watermark: true }}
      calculateMetadata={calculateServiceBMetadata}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={sampleDurationInFrames}
    />
    <Composition
      id="PlaceholderTalkingHead"
      component={PlaceholderTalkingHead}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={sampleDurationInFrames}
    />
  </>
);

/** Stands in for an InfiniteTalk clip: a drifting gradient plus a 220Hz tone.
 *  The tone is deliberately audible and deliberately NOT the voiceover fixture
 *  (330Hz): hearing it in a sample render means the clip's audio leaked through
 *  instead of being muted. */
const PlaceholderTalkingHead: React.FC = () => {
  const frame = useCurrentFrame();
  const hue = interpolate(frame, [0, sampleDurationInFrames], [210, 320]);
  const bob = Math.sin(frame / 9) * 14;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `linear-gradient(160deg, hsl(${hue} 55% 22%), hsl(${hue + 40} 60% 42%))`,
      }}
    >
      <Audio src={staticFile("fixtures/tone.wav")} />
      <div
        style={{
          width: 620,
          height: 620,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.16)",
          transform: `translateY(${bob - 180}px)`,
        }}
      />
    </div>
  );
};
