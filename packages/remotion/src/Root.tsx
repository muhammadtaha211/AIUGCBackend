import type React from "react";
import { Audio, Composition, interpolate, staticFile, useCurrentFrame } from "remotion";
import { ServiceB, calculateServiceBMetadata } from "./ServiceB";
import { sampleCaptions } from "./fixtures";
import { FPS, HEIGHT, WIDTH, serviceBSchema } from "./schema";
import { msToFrame } from "./timing";

/**
 * `ServiceB` is the only composition the pipeline renders. The other two are
 * founder preview scaffolding: a watermarked twin, and the placeholder clip
 * that `pnpm --filter @aiugc/remotion fixtures` renders so previewing costs
 * nothing (no GPU, no lip-sync, no TTS).
 */

const previewProps = {
  talkingHeadSrc: staticFile("fixtures/talking-head.mp4"),
  brollSrcs: [],
  captions: sampleCaptions,
  watermark: false,
};

const FIXTURE_DURATION_IN_FRAMES =
  msToFrame(sampleCaptions[sampleCaptions.length - 1]!.endMs) + FPS / 2;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="ServiceB"
      component={ServiceB}
      schema={serviceBSchema}
      defaultProps={previewProps}
      calculateMetadata={calculateServiceBMetadata}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={FIXTURE_DURATION_IN_FRAMES}
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
      durationInFrames={FIXTURE_DURATION_IN_FRAMES}
    />
    <Composition
      id="PlaceholderTalkingHead"
      component={PlaceholderTalkingHead}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={FIXTURE_DURATION_IN_FRAMES}
    />
  </>
);

/** Stands in for an InfiniteTalk clip: a drifting gradient plus a tone, so the
 *  sample render proves that the talking head's own audio survives the render. */
const PlaceholderTalkingHead: React.FC = () => {
  const frame = useCurrentFrame();
  const hue = interpolate(frame, [0, FIXTURE_DURATION_IN_FRAMES], [210, 320]);
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
