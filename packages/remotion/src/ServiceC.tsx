import { measureText } from "@remotion/layout-utils";
import { getVideoMetadata } from "@remotion/media-utils";
import React, { useMemo } from "react";
import { AbsoluteFill, OffthreadVideo, type CalculateMetadataFunction } from "remotion";
import { Watermark, fontFamily } from "./overlays";
import { FPS, type ServiceCProps, type TextSafeArea } from "./schema";
import { TEXT_BLOCK_FONT, fitParagraphFontSize } from "./text-fit";

/**
 * Service C, גוש טקסט (decisions 0089–0090): one founder-made bank clip,
 * played once from its first frame to its last, WITH its own recorded sound,
 * under one Hebrew text block burned for the whole length. No hook animation,
 * no cut, no caption track, no music — the clip is the ad and the text is the
 * copy. The composition is exactly as long as the clip (calculateMetadata).
 */

const COVER: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

/**
 * The typed-in-the-app look (0090 §8): medium weight, a thin dark edge plus a
 * soft shadow, no box, centred lines — clearly lighter and smaller than the
 * hook line's 800 / 5px hard outline. The edge and the shadow are drawn in the
 * ink's outline rgb, so a black block on a bright clip gets a light edge.
 */
export const TEXT_BLOCK_WEIGHT = 500;

export function textBlockShadow(outlineRgb: string): string {
  return [
    `0 0 2px rgba(${outlineRgb},0.9)`,
    `0 0 2px rgba(${outlineRgb},0.9)`,
    `0 2px 12px rgba(${outlineRgb},0.5)`,
  ].join(", ");
}

/** White on a dark edge — what a render with no ink burns. */
export const DEFAULT_TEXT_BLOCK_INK = { fill: "white", outline: "0,0,0" } as const;

export const TextBlock: React.FC<{
  text: string;
  area: TextSafeArea;
  ink?: { fill: string; outline: string };
}> = ({ text, area, ink = DEFAULT_TEXT_BLOCK_INK }) => {
  const fontSize = useMemo(
    () =>
      fitParagraphFontSize({
        text,
        maxWidth: area.w,
        maxHeight: area.h,
        base: TEXT_BLOCK_FONT.base,
        min: TEXT_BLOCK_FONT.min,
        lineHeight: TEXT_BLOCK_FONT.lineHeight,
        measure: (t, size) =>
          measureText({
            text: t,
            fontFamily,
            fontSize: size,
            fontWeight: String(TEXT_BLOCK_WEIGHT),
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
        fontWeight: TEXT_BLOCK_WEIGHT,
        fontSize,
        lineHeight: TEXT_BLOCK_FONT.lineHeight,
        color: ink.fill,
        textShadow: textBlockShadow(ink.outline),
        // Real line breaks render as line breaks (quiz, founder_ask); runs of
        // spaces inside a line still collapse the way the fitter assumes.
        whiteSpace: "pre-wrap",
      }}
    >
      {/* ONE span, isolate: the whole block is a single bidi run per line, so
          a Latin brand name or a number stays an LTR island inside the RTL
          line and never reorders its neighbours — per-word spans would
          (defects/atomic-inline-words-reverse-a-latin-run-in-rtl). */}
      <span style={{ unicodeBidi: "isolate" }}>{text}</span>
    </div>
  );
};

export const ServiceC: React.FC<ServiceCProps> = ({
  clipSrc,
  text,
  textSafeArea,
  textInk,
  watermark,
}) => (
  <AbsoluteFill style={{ backgroundColor: "black" }}>
    {/* NOT muted, on purpose: the clip's own sound is the audio track
        (decision 0090 §5 — no voice, no music, the recording stays). */}
    <OffthreadVideo src={clipSrc} style={COVER} />
    <TextBlock text={text} area={textSafeArea} ink={textInk} />
    {watermark ? <Watermark /> : null}
  </AbsoluteFill>
);

/**
 * The composition is the clip, once: its length is probed from the file in the
 * browser during selectComposition, like the steps format, never taken from a
 * DB column.
 */
export const calculateServiceCMetadata: CalculateMetadataFunction<ServiceCProps> = async ({
  props,
}) => {
  const clip = await getVideoMetadata(props.clipSrc);
  const clipDurationInFrames = Math.max(1, Math.round(clip.durationInSeconds * FPS));
  return {
    durationInFrames: clipDurationInFrames,
    props: { ...props, clipDurationInFrames },
  };
};
