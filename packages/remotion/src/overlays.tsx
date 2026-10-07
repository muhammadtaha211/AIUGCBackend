import { loadFont } from "@remotion/google-fonts/Heebo";
import type React from "react";
import { AbsoluteFill } from "remotion";
import { type CaptionChunk } from "./schema";
import { activeChunkIndex, activeWordIndex } from "./timing";

/**
 * Overlays shared by the ServiceA and ServiceB compositions: the burned Hebrew
 * karaoke captions and the sample watermark. One implementation so the two
 * services stay visually identical where the product says they are.
 */

// Never rely on system fonts: the render box is headless Chrome and the design
// target is Israeli UGC. Heebo has full Hebrew coverage at heavy weights. Two
// weights: 800 for the hook line, captions, labels and watermark; 600 for the
// Service C text block, which is typed-in-the-app lighter on purpose (0090 §8,
// tuned from 500 against the founder's screenshots on 2026-10-07).
// Each weight is one more WOFF2 per subset fetched at render time — the same
// mechanism, no file on the box (docs/07-worker-box.md §8).
export const { fontFamily } = loadFont("normal", {
  weights: ["600", "800"],
  subsets: ["hebrew", "latin"],
});

/** Safe margins: platform chrome (TikTok caption + CTA, Reels action rail). */
const CAPTION_BOTTOM = 440;
const SIDE_MARGIN = 110;

/** Exported: the steps format burns its step labels in the same yellow. */
export const ACTIVE_WORD_COLOR = "#FFE04A";
/** Brand mark burned into unpaid/sample exports. One constant to rebrand. */
const WATERMARK_TEXT = "AIUGC";

export const TEXT_OUTLINE = [
  "5px 5px 0 rgba(0,0,0,0.92)",
  "-5px 5px 0 rgba(0,0,0,0.92)",
  "5px -5px 0 rgba(0,0,0,0.92)",
  "-5px -5px 0 rgba(0,0,0,0.92)",
  "0 8px 26px rgba(0,0,0,0.6)",
].join(", ");

export const Captions: React.FC<{ captions: CaptionChunk[]; ms: number }> = ({ captions, ms }) => {
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

export const Watermark: React.FC = () => (
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
