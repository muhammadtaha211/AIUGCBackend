import { loadFont } from "@remotion/google-fonts/Heebo";
import { getVideoMetadata } from "@remotion/media-utils";
import type React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  type CalculateMetadataFunction,
} from "remotion";
import { FPS, type CaptionChunk, type ServiceBProps } from "./schema";
import { activeChunkIndex, activeWordIndex, frameToMs } from "./timing";

/**
 * Service B: lip-synced talking head + burned Hebrew karaoke captions.
 * The talking head's embedded audio IS the final audio — there is no separate
 * audio track and no music, ever (locked decision).
 */

// Never rely on system fonts: the render box is headless Chrome and the design
// target is Israeli UGC. Heebo has full Hebrew coverage at heavy weights.
const { fontFamily } = loadFont("normal", {
  weights: ["800"],
  subsets: ["hebrew", "latin"],
});

/** Safe margins: platform chrome (TikTok caption + CTA, Reels action rail). */
const CAPTION_BOTTOM = 440;
const SIDE_MARGIN = 110;

const ACTIVE_WORD_COLOR = "#FFE04A";
/** Brand mark burned into unpaid/sample exports. One constant to rebrand. */
const WATERMARK_TEXT = "AIUGC";

const TEXT_OUTLINE = [
  "5px 5px 0 rgba(0,0,0,0.92)",
  "-5px 5px 0 rgba(0,0,0,0.92)",
  "5px -5px 0 rgba(0,0,0,0.92)",
  "-5px -5px 0 rgba(0,0,0,0.92)",
  "0 8px 26px rgba(0,0,0,0.6)",
].join(", ");

export const ServiceB: React.FC<ServiceBProps> = ({ talkingHeadSrc, captions, watermark }) => {
  // TODO: brollSrcs is accepted and ignored — cutaway logic (when to cut away,
  // for how long, how to hide the lip-sync) is its own task.
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Micro-motion: a ~2.5% drift across the whole clip. A perfectly static
  // frame is the strongest "this is AI" tell; anything faster is noticeable.
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.025], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <OffthreadVideo
          src={talkingHeadSrc}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
      <Captions captions={captions} ms={frameToMs(frame)} />
      {watermark ? <Watermark /> : null}
    </AbsoluteFill>
  );
};

const Captions: React.FC<{ captions: CaptionChunk[]; ms: number }> = ({ captions, ms }) => {
  const index = activeChunkIndex(captions, ms);
  if (index === -1) return null;
  const chunk = captions[index]!;
  const active = activeWordIndex(chunk, ms);

  return (
    <AbsoluteFill
      style={{
        direction: "rtl",
        justifyContent: "flex-end",
        alignItems: "center",
        paddingInline: SIDE_MARGIN,
        paddingBottom: CAPTION_BOTTOM,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "10px 20px",
          fontFamily,
          fontWeight: 800,
          fontSize: 82,
          lineHeight: 1.25,
          color: "white",
          textShadow: TEXT_OUTLINE,
        }}
      >
        {chunk.words.length === 0 ? (
          // Even-spaced captions carry no word timings — show the line as is.
          <span style={{ unicodeBidi: "isolate" }}>{chunk.text}</span>
        ) : (
          chunk.words.map((word, i) => (
            <span
              key={`${i}-${word.startMs}`}
              style={{
                // Isolate each word so numbers and Latin product names keep
                // their own LTR run without flipping the RTL word order.
                unicodeBidi: "isolate",
                color: i === active ? ACTIVE_WORD_COLOR : "white",
                transform: i === active ? "scale(1.06)" : "none",
              }}
            >
              {word.word}
            </span>
          ))
        )}
      </div>
    </AbsoluteFill>
  );
};

const WATERMARK_ROWS = 7;
const WATERMARK_COLS = 3;

const Watermark: React.FC = () => (
  <AbsoluteFill
    style={{
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-around",
      opacity: 0.12,
      transform: "rotate(-22deg) scale(1.35)",
      fontFamily,
      fontWeight: 800,
      fontSize: 52,
      letterSpacing: 10,
      color: "white",
    }}
  >
    {Array.from({ length: WATERMARK_ROWS }, (_, row) => (
      <div key={row} style={{ display: "flex", justifyContent: "space-around" }}>
        {Array.from({ length: WATERMARK_COLS }, (_, col) => (
          <span key={col}>{WATERMARK_TEXT}</span>
        ))}
      </div>
    ))}
  </AbsoluteFill>
);

/**
 * Duration comes from the talking-head clip itself — the lip-sync output is
 * exactly as long as the approved audio, and the ad ends when it ends.
 * Probed in the browser (Studio and the headless render both have one), so the
 * worker box needs no ffprobe for this step.
 */
export const calculateServiceBMetadata: CalculateMetadataFunction<ServiceBProps> = async ({
  props,
}) => {
  const { durationInSeconds } = await getVideoMetadata(props.talkingHeadSrc);
  return { durationInFrames: Math.max(1, Math.round(durationInSeconds * FPS)) };
};
