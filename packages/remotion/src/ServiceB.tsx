import { getVideoMetadata } from "@remotion/media-utils";
import type React from "react";
import {
  AbsoluteFill,
  Audio,
  Freeze,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  type CalculateMetadataFunction,
} from "remotion";
import { HookLine } from "./ServiceA";
import { Captions, Watermark } from "./overlays";
import { FPS, type GradeCurve, type ServiceBProps } from "./schema";
import {
  cutawayFrames,
  frameToMs,
  gradeAt,
  hookBeatsScale,
  hookFocusState,
  hookTextRevealState,
  hookWhipState,
  hookZoomScale,
  msToFrame,
  OVERSCAN,
  SEAM_DISSOLVE_FRAMES,
} from "./timing";

/**
 * Service B: an optional founder-made opener clip, playing from its first
 * frame with the hook text burned over it, → hard cut at the reveal into the
 * lip-synced talking head + burned Hebrew karaoke captions. The hook text
 * lives its read time and never leaves before the reveal (decision 0019); the
 * captions wait for it to leave — one text element at a time. The approved
 * mp3 is the audio track and the talking head is muted: its embedded audio is
 * the GPU provider's re-encode of that same mp3, which arrives with a glitch
 * in the first second and would be encoded a third time here. Playing the
 * approved file directly also guarantees caption sync — it is the exact file
 * the timestamps were computed against. No music, ever (locked).
 *
 * The whole picture — opener and talking head alike — holds still under one
 * static scale (timing.ts `OVERSCAN`): no camera motion on any B render (vault
 * 0120 §2). Opt-in demo cutaways (vault 0121) lay stretches of the customer's
 * own demo, muted, over the head on caption-chunk boundaries, while the head,
 * the VO and the captions run on underneath; the burned text, the captions and
 * the watermark stay on top of both, as burned-in-post overlays do. The
 * talking head carries a measured brightness gain so the cut lands at the
 * opener's exposure.
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
  talkingHeadGrade,
  talkingHeadAlign,
  cutaways,
  hookZoom,
  hookFocus,
  hookWhip,
  hookTextReveal,
  hookBeats,
}) => {
  const frame = useCurrentFrame();

  const hasOpener =
    openerSrc !== undefined && hookText !== undefined && hookTextSafeArea !== undefined;
  // CEIL, not round: hookTextMs is a caption-chunk boundary, and a handoff
  // frame rounded DOWN starts the captions before that chunk does — so
  // activeChunkIndex hands back the PREVIOUS chunk, the one holding the hook's
  // last word, and one hook word flashes at the bottom under the hook line.
  const hookTextFrames = Math.ceil((timeline.hookTextMs / 1000) * FPS);
  const revealFrames = msToFrame(timeline.revealAbsMs);
  const trimBeforeFrames = msToFrame(timeline.lipsyncStartFromMs);
  const voFromFrames = msToFrame(timeline.captionOffsetMs);

  // The hook animations (timing.ts). All optional and inert when absent; the
  // scales multiply into the ONE transform on the head, so two of them
  // composed are two camera moves at once and never two layers.
  const ms = frameToMs(frame);
  const focus = hookFocus ? hookFocusState(hookFocus, ms) : undefined;
  const whip = hookWhip ? hookWhipState(hookWhip, ms) : undefined;
  const pictureScale =
    (hookZoom ? hookZoomScale(hookZoom, ms) : 1) *
    (focus?.scale ?? 1) *
    (whip?.scale ?? 1) *
    (hookBeats ? hookBeatsScale(hookBeats, ms, timeline.totalMs) : 1);
  const textReveal =
    hookTextReveal && hookText !== undefined
      ? hookTextRevealState(
          hookTextReveal,
          ms,
          timeline.hookTextMs,
          hookText.split(/\s+/).filter(Boolean).length,
        )
      : undefined;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AbsoluteFill
        style={{
          transform: `scale(${OVERSCAN})`,
        }}
      >
        {hasOpener ? (
          /* The clip from its first frame to the reveal (SEAM_DISSOLVE_FRAMES
             past it — 0 today, a hard cut), holding its last frame if it runs out. */
          <Sequence durationInFrames={Math.max(1, revealFrames + SEAM_DISSOLVE_FRAMES)}>
            <OpenerSegment src={openerSrc} clipFrames={openerDurationInFrames} />
          </Sequence>
        ) : null}

        <Sequence from={revealFrames}>
          <TalkingHead
            src={talkingHeadSrc}
            trimBeforeFrames={trimBeforeFrames}
            clipFrames={talkingHeadDurationInFrames}
            grade={talkingHeadGrade}
            align={talkingHeadAlign}
            dissolveFrames={hasOpener ? SEAM_DISSOLVE_FRAMES : 0}
            scale={pictureScale}
            offsetX={whip?.dx ?? 0}
            blurPx={focus?.blurPx ?? 0}
            whipBlurPx={whip?.blurPx ?? 0}
          />
        </Sequence>
      </AbsoluteFill>

      {/* Outside the overscan: the demo shows 1:1, as Service A shows it. The
          head underneath keeps playing, so it returns in sync. */}
      {cutaways
        ? cutawayFrames(cutaways.slots, timeline.captionOffsetMs, hookTextFrames).map((c) => (
            <Sequence key={c.fromFrame} from={c.fromFrame} durationInFrames={c.durationInFrames}>
              <Cutaway
                src={cutaways.src}
                trimBeforeFrames={c.trimBeforeFrames}
                clipFrames={cutaways.demoDurationInFrames}
              />
            </Sequence>
          ))
        : null}

      {hookText !== undefined && hookTextSafeArea !== undefined && hookTextFrames > 0 ? (
        /* From frame 0 for its life: its read time with an opener, never
           leaving before the reveal. Without an opener the timeline gives it
           no life, unless a caller sets hookTextMs — as the zoom hook does. */
        <Sequence durationInFrames={hookTextFrames}>
          <HookLine
            text={hookText}
            area={hookTextSafeArea}
            wordProgress={textReveal?.wordProgress}
            exit={textReveal?.exit}
          />
        </Sequence>
      ) : null}

      <Sequence from={voFromFrames}>
        <Audio src={voiceoverSrc} />
      </Sequence>

      {hookZoom?.sfxSrc ? (
        /* The whoosh leads the ease by two frames, as sound design does. */
        <Sequence from={Math.max(0, msToFrame(hookZoom.atMs) - 2)}>
          <Audio src={hookZoom.sfxSrc} volume={0.7} />
        </Sequence>
      ) : null}

      {hookWhip?.sfxSrc ? (
        /* The whip's whoosh runs with the move, from frame 0. */
        <Sequence from={0}>
          <Audio src={hookWhip.sfxSrc} volume={0.7} />
        </Sequence>
      ) : null}

      {/* Chunks are timed against the unpadded audio; negative ms shows none.
          The captions wait for the hook text to leave (hookTextFrames is 0
          without an opener). */}
      {frame >= hookTextFrames ? (
        <Captions captions={captions} ms={frameToMs(frame) - timeline.captionOffsetMs} />
      ) : null}
      {watermark ? <Watermark /> : null}
    </AbsoluteFill>
  );
};

/**
 * The opener playing from 0, holding its final frame if the reveal sits on
 * the clip's very last frame.
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
 * One stretch of the customer's demo: muted — the approved mp3 is the only
 * track (locked #7) — and cover-fit like Service A's steps (the normalized
 * demo is already 1080×1920, so cover is identity), holding its last frame if
 * the window runs to the very end of the file.
 */
const Cutaway: React.FC<{ src: string; trimBeforeFrames: number; clipFrames?: number }> = ({
  src,
  trimBeforeFrames,
  clipFrames,
}) => {
  const frame = useCurrentFrame(); // local to the sequence
  const lastClipFrame = Math.max(0, (clipFrames ?? Number.MAX_SAFE_INTEGER) - 1 - trimBeforeFrames);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Freeze frame={lastClipFrame} active={frame > lastClipFrame}>
        <OffthreadVideo src={src} muted trimBefore={trimBeforeFrames} style={COVER} />
      </Freeze>
    </AbsoluteFill>
  );
};

/**
 * The lip-synced clip, muted, from `trimBeforeFrames` into the file, under
 * the measured colour grade: per-channel gains sampled over talking-head
 * time (core's media/grade.ts), applied as an SVG colour matrix in sRGB —
 * CSS filters have no per-channel gain. Its final frame holds if the
 * composition outlasts the clip (the VO is never cut off).
 */
const TalkingHead: React.FC<{
  src: string;
  trimBeforeFrames: number;
  clipFrames?: number;
  grade?: GradeCurve;
  align?: { dx: number; dy: number };
  dissolveFrames: number;
  /** Every hook animation's scale for this frame, multiplied (timing.ts); 1 = none. */
  scale: number;
  /** The whip's horizontal offset, on top of the alignment slide; 0 = none. */
  offsetX: number;
  /** Rack-focus blur, isotropic; 0 = sharp. */
  blurPx: number;
  /** Whip blur, horizontal only — an SVG filter, since CSS blur() has no direction. */
  whipBlurPx: number;
}> = ({
  src,
  trimBeforeFrames,
  clipFrames,
  grade,
  align,
  dissolveFrames,
  scale,
  offsetX,
  blurPx,
  whipBlurPx,
}) => {
  const frame = useCurrentFrame(); // local to the sequence
  const ms = frameToMs(frame);
  // Local frame of the clip's last frame: the file's length minus the trim.
  const lastClipFrame = Math.max(0, (clipFrames ?? Number.MAX_SAFE_INTEGER) - 1 - trimBeforeFrames);
  const [r, g, b] = grade ? gradeAt(grade, ms) : [1, 1, 1];
  // The alignment offset holds for the whole clip: an ease back to 0 (1.5s,
  // 2026-09-06) drifted the head after the cut, and the founder saw it.
  const dx = align?.dx ?? 0;
  const dy = align?.dy ?? 0;
  const opacity = dissolveFrames > 0 ? Math.min(1, (frame + 1) / dissolveFrames) : 1;
  // A filter list, in order: colour, then the directional whip blur, then the
  // isotropic focus blur. Sub-0.01px is not a blur, and an idle filter pass
  // costs a compositor layer every frame.
  const directional = whipBlurPx > 0.01;
  const filters = [
    grade ? "url(#talking-head-grade)" : undefined,
    directional ? "url(#talking-head-whip)" : undefined,
    blurPx > 0.01 ? `blur(${blurPx.toFixed(2)}px)` : undefined,
  ].filter(Boolean);

  return (
    <>
      {directional ? (
        <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
          <filter id="talking-head-whip" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation={`${whipBlurPx.toFixed(2)} 0`} />
          </filter>
        </svg>
      ) : null}
      {grade ? (
        <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
          <filter id="talking-head-grade" colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values={`${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`}
            />
          </filter>
        </svg>
      ) : null}
      <AbsoluteFill
        style={{
          filter: filters.length > 0 ? filters.join(" ") : undefined,
          transform: `translate(${dx + offsetX}px, ${dy}px) scale(${scale})`,
          // Scale about the face, not the frame centre, so a zoom keeps the
          // eyes where they are and the torso does the moving.
          transformOrigin: "50% 40%",
          opacity,
        }}
      >
        <Freeze frame={lastClipFrame} active={frame > lastClipFrame}>
          <OffthreadVideo src={src} muted trimBefore={trimBeforeFrames} style={COVER} />
        </Freeze>
      </AbsoluteFill>
    </>
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
  const [clip, opener, demo] = await Promise.all([
    getVideoMetadata(props.talkingHeadSrc),
    props.openerSrc ? getVideoMetadata(props.openerSrc) : undefined,
    props.cutaways ? getVideoMetadata(props.cutaways.src) : undefined,
  ]);
  const toFrames = (seconds: number) => Math.max(1, msToFrame(seconds * 1000));
  return {
    durationInFrames: Math.max(1, msToFrame(props.timeline.totalMs)),
    props: {
      ...props,
      talkingHeadDurationInFrames: toFrames(clip.durationInSeconds),
      openerDurationInFrames: opener ? toFrames(opener.durationInSeconds) : undefined,
      cutaways:
        props.cutaways && demo
          ? { ...props.cutaways, demoDurationInFrames: toFrames(demo.durationInSeconds) }
          : props.cutaways,
    },
  };
};
