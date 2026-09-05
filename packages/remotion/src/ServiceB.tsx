import { getVideoMetadata } from "@remotion/media-utils";
import type React from "react";
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
import { HookLine } from "./ServiceA";
import { Captions, Watermark } from "./overlays";
import { type ServiceBProps } from "./schema";
import { frameToMs, msToFrame } from "./timing";

/**
 * Service B: an optional founder-made opener clip with the hook text burned
 * over its palm phase → hard cut at the reveal into the lip-synced talking
 * head + burned Hebrew karaoke captions. The approved mp3 is the audio track
 * and the talking head is muted: its embedded audio is the GPU provider's
 * re-encode of that same mp3, which arrives with a glitch in the first second
 * and would be encoded a third time here. Playing the approved file directly
 * also guarantees caption sync — it is the exact file the timestamps were
 * computed against. No music, ever (locked).
 *
 * Every millisecond here comes from @aiugc/core's serviceBTimeline via the
 * `timeline` prop; this file converts to frames and lays out. It does no
 * timeline arithmetic of its own.
 */

const COVER: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

export const ServiceB: React.FC<ServiceBProps> = ({
  talkingHeadSrc,
  talkingHeadDurationInFrames,
  voiceoverSrc,
  captions,
  watermark,
  openerSrc,
  hookText,
  hookTextSafeArea,
  timeline,
  openerDurationInFrames,
}) => {
  // TODO: brollSrcs is accepted and ignored — cutaway logic (when to cut away,
  // for how long, how to hide the lip-sync) is its own task.
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const hasOpener =
    openerSrc !== undefined && hookText !== undefined && hookTextSafeArea !== undefined;
  const holdFrames = msToFrame(timeline.holdMs);
  const revealFrames = msToFrame(timeline.revealAbsMs);
  const trimBeforeFrames = msToFrame(timeline.lipsyncStartFromMs);
  const voFromFrames = msToFrame(timeline.captionOffsetMs);

  // The dissolve straddles the reveal: the talking head mounts fadeIn frames
  // early and trims that many frames earlier, so the reveal frame still shows
  // clip time lipsyncStartFromMs; the opener plays fadeOut frames past it.
  // fadeIn is capped by the trim — a lead-in too short to give the clip two
  // frames before speech (leadInMs under ~300) shortens the pre-reveal half
  // rather than mounting speech early. Without an opener there is nothing to
  // dissolve from.
  const fadeIn = hasOpener
    ? Math.min(Math.floor(timeline.crossfadeFrames / 2), trimBeforeFrames)
    : 0;
  const fadeOut = hasOpener ? timeline.crossfadeFrames - fadeIn : 0;
  const talkingHeadFrom = Math.max(0, revealFrames - fadeIn);
  const talkingHeadTrim = trimBeforeFrames - (revealFrames - talkingHeadFrom);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {hasOpener ? (
        <>
          {/* First frame frozen under the hook text, then the clip from 0. */}
          <Sequence durationInFrames={Math.max(1, holdFrames)}>
            <Freeze frame={0}>
              <OffthreadVideo src={openerSrc} muted style={COVER} />
            </Freeze>
          </Sequence>
          <Sequence
            from={holdFrames}
            durationInFrames={Math.max(1, revealFrames + fadeOut - holdFrames)}
          >
            <OpenerSegment src={openerSrc} clipFrames={openerDurationInFrames} />
          </Sequence>
          {/* Visible through the palm phase; hard cut at the reveal. */}
          <Sequence durationInFrames={Math.max(1, revealFrames)}>
            <HookLine text={hookText} area={hookTextSafeArea} />
          </Sequence>
        </>
      ) : null}

      <Sequence from={talkingHeadFrom}>
        <TalkingHead
          src={talkingHeadSrc}
          trimBeforeFrames={talkingHeadTrim}
          clipFrames={talkingHeadDurationInFrames}
          fadeInFrames={hasOpener ? timeline.crossfadeFrames : 0}
          punchIn={
            hasOpener
              ? {
                  fromFrame: revealFrames - talkingHeadFrom,
                  frames: msToFrame(timeline.punchInMs),
                  scale: timeline.punchInScale,
                }
              : undefined
          }
          driftFrames={durationInFrames - talkingHeadFrom}
        />
      </Sequence>

      <Sequence from={voFromFrames}>
        <Audio src={voiceoverSrc} />
      </Sequence>

      {/* Chunks are timed against the unpadded audio; negative ms shows none. */}
      <Captions captions={captions} ms={frameToMs(frame) - timeline.captionOffsetMs} />
      {watermark ? <Watermark /> : null}
    </AbsoluteFill>
  );
};

/**
 * The opener playing from 0, holding its final frame if the dissolve tail
 * runs past the clip's end (a reveal at the very last frame).
 */
const OpenerSegment: React.FC<{ src: string; clipFrames?: number }> = ({ src, clipFrames }) => {
  const frame = useCurrentFrame(); // local to the sequence
  const lastClipFrame = Math.max(0, (clipFrames ?? Number.MAX_SAFE_INTEGER) - 1);
  return (
    <Freeze frame={lastClipFrame} active={frame > lastClipFrame}>
      <OffthreadVideo src={src} muted style={COVER} />
    </Freeze>
  );
};

/**
 * The lip-synced clip, muted, from `trimBeforeFrames` into the file. With an
 * opener it dissolves in over `fadeInFrames` and punches in from the reveal,
 * held after; without one it keeps the slow micro-motion drift — a perfectly
 * static frame is the strongest "this is AI" tell. Its final frame holds if
 * the composition outlasts the clip (the VO is never cut off).
 */
const TalkingHead: React.FC<{
  src: string;
  trimBeforeFrames: number;
  clipFrames?: number;
  fadeInFrames: number;
  punchIn?: { fromFrame: number; frames: number; scale: number };
  driftFrames: number;
}> = ({ src, trimBeforeFrames, clipFrames, fadeInFrames, punchIn, driftFrames }) => {
  const frame = useCurrentFrame(); // local to the sequence
  const opacity =
    fadeInFrames > 0
      ? interpolate(frame, [0, fadeInFrames], [0, 1], { extrapolateRight: "clamp" })
      : 1;
  const scale = punchIn
    ? interpolate(
        frame,
        [punchIn.fromFrame, punchIn.fromFrame + Math.max(1, punchIn.frames)],
        [1, punchIn.scale],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )
    : interpolate(frame, [0, Math.max(1, driftFrames)], [1, 1.025], {
        extrapolateRight: "clamp",
      });
  // Local frame of the clip's last frame: the file's length minus the trim.
  const lastClipFrame = Math.max(0, (clipFrames ?? Number.MAX_SAFE_INTEGER) - 1 - trimBeforeFrames);

  return (
    <AbsoluteFill style={{ opacity, transform: `scale(${scale})` }}>
      <Freeze frame={lastClipFrame} active={frame > lastClipFrame}>
        <OffthreadVideo src={src} muted trimBefore={trimBeforeFrames} style={COVER} />
      </Freeze>
    </AbsoluteFill>
  );
};

/**
 * Length comes from the timeline's totalMs — computed in core from the
 * approved VO's stored length and the probed lip-sync clip, so the ad never
 * cuts the voiceover off. The files are probed here only for the frame at
 * which each clip runs out and its last frame has to be held.
 */
export const calculateServiceBMetadata: CalculateMetadataFunction<ServiceBProps> = async ({
  props,
}) => {
  const [clip, opener] = await Promise.all([
    getVideoMetadata(props.talkingHeadSrc),
    props.openerSrc ? getVideoMetadata(props.openerSrc) : undefined,
  ]);
  const toFrames = (seconds: number) => Math.max(1, msToFrame(seconds * 1000));
  return {
    durationInFrames: Math.max(1, msToFrame(props.timeline.totalMs)),
    props: {
      ...props,
      talkingHeadDurationInFrames: toFrames(clip.durationInSeconds),
      openerDurationInFrames: opener ? toFrames(opener.durationInSeconds) : undefined,
    },
  };
};
