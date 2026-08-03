import type React from "react";
import { Audio, Composition, interpolate, staticFile, useCurrentFrame } from "remotion";
import { ServiceA, calculateServiceAMetadata } from "./ServiceA";
import { ServiceB, calculateServiceBMetadata } from "./ServiceB";
import { sampleCaptions, sampleDurationInFrames } from "./fixtures";
import { FPS, HEIGHT, WIDTH, serviceASchema, serviceBSchema } from "./schema";

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
  watermark: false,
};

/** The placeholder clip stands in for both the hook clip and the demo. */
const previewPropsA = {
  hookSrc: staticFile("fixtures/talking-head.mp4"),
  hookLine: "זה מה שאף אחד לא מספר לכם",
  hookTextSafeArea: { x: 90, y: 640, w: 900, h: 520 },
  demoSrc: staticFile("fixtures/talking-head.mp4"),
  voiceoverSrc: staticFile("fixtures/voiceover.wav"),
  captions: sampleCaptions,
  watermark: false,
};

export const RemotionRoot: React.FC = () => (
  <>
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
