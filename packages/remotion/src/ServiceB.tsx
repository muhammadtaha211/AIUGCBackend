import { getAudioDurationInSeconds, getVideoMetadata } from "@remotion/media-utils";
import type React from "react";
import {
  AbsoluteFill,
  Audio,
  Freeze,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from "remotion";
import { Captions, Watermark } from "./overlays";
import { type ServiceBProps } from "./schema";
import { frameToMs, serviceBDurations } from "./timing";

/**
 * Service B: lip-synced talking head + burned Hebrew karaoke captions.
 * The approved mp3 is the audio track and the talking head is muted: its
 * embedded audio is the GPU provider's re-encode of that same mp3, which
 * arrives with a glitch in the first second and would be encoded a third time
 * here. Playing the approved file directly also guarantees caption sync — it is
 * the exact file the timestamps were computed against. No music, ever (locked).
 */

export const ServiceB: React.FC<ServiceBProps> = ({
  talkingHeadSrc,
  talkingHeadDurationInFrames,
  voiceoverSrc,
  captions,
  watermark,
}) => {
  // TODO: brollSrcs is accepted and ignored — cutaway logic (when to cut away,
  // for how long, how to hide the lip-sync) is its own task.
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Micro-motion: a ~2.5% drift across the whole clip. A perfectly static
  // frame is the strongest "this is AI" tell; anything faster is noticeable.
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.025], {
    extrapolateRight: "clamp",
  });

  // The composition runs as long as the VO, so a talking head that came back
  // shorter would leave black frames under the last words. Freeze holds its
  // final frame instead — outside the scale wrapper, so the micro-motion keeps
  // drifting and the hold reads as stillness rather than a frozen render.
  const lastClipFrame = Math.max(0, (talkingHeadDurationInFrames ?? durationInFrames) - 1);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Audio src={voiceoverSrc} />
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <Freeze frame={lastClipFrame} active={frame > lastClipFrame}>
          <OffthreadVideo
            src={talkingHeadSrc}
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </Freeze>
      </AbsoluteFill>
      <Captions captions={captions} ms={frameToMs(frame)} />
      {watermark ? <Watermark /> : null}
    </AbsoluteFill>
  );
};

/**
 * Duration comes from the approved VO, never from the clip: the ad must not cut
 * the voiceover off mid-sentence. The clip is probed too, only to tell the
 * composition where to start holding its final frame. Both probes run in the
 * browser (Studio and the headless render both have one), so the worker box
 * needs no ffprobe for this step.
 */
export const calculateServiceBMetadata: CalculateMetadataFunction<ServiceBProps> = async ({
  props,
}) => {
  const [voiceoverSeconds, clip] = await Promise.all([
    getAudioDurationInSeconds(props.voiceoverSrc),
    getVideoMetadata(props.talkingHeadSrc),
  ]);
  const { durationInFrames, talkingHeadDurationInFrames } = serviceBDurations(
    voiceoverSeconds,
    clip.durationInSeconds,
  );
  return { durationInFrames, props: { ...props, talkingHeadDurationInFrames } };
};
