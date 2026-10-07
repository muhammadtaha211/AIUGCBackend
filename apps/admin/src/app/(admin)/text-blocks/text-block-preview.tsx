"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HOOK_FRAME, type SafeRect } from "@aiugc/core/hook-geometry";
import { HOOK_TEXT_INK, type HookTextColor } from "@aiugc/core/hook-text-color";
import { fitParagraphFontSize, TEXT_BLOCK_FONT } from "@aiugc/remotion/text-fit";

/**
 * The גוש טקסט look, previewed in CSS at the numbers the render uses: Heebo
 * 600 (the app font is the same family), `fitParagraphFontSize` with
 * TEXT_BLOCK_FONT, a thin edge plus a soft shadow in the ink's outline rgb,
 * `pre-wrap` so the quiz's line breaks show. Canvas measureText approximates
 * the render's measurement — close enough to show what fits and at what size;
 * the render's own fitter has the final word.
 *
 * Fills whatever box it is placed in (the editor's rect body, the card's
 * overlay): it measures its own width and derives the display scale from
 * `rect.w`, so it needs no scale from its parent.
 */

const WEIGHT = 600;

export function TextBlockPreview({
  text,
  rect,
  textColor = "white",
}: {
  text: string;
  rect: SafeRect;
  textColor?: HookTextColor;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [displayWidth, setDisplayWidth] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setDisplayWidth(box.clientWidth));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const measure = useMemo(() => {
    if (typeof document === "undefined") return (t: string, size: number) => t.length * size * 0.5;
    const ctx = document.createElement("canvas").getContext("2d");
    const family = getComputedStyle(document.body).fontFamily;
    return (t: string, fontSize: number) => {
      if (!ctx) return t.length * fontSize * 0.5;
      ctx.font = `${WEIGHT} ${fontSize}px ${family}`;
      return ctx.measureText(t).width;
    };
  }, []);

  const frameFontSize = useMemo(
    () =>
      fitParagraphFontSize({
        text,
        maxWidth: rect.w,
        maxHeight: rect.h,
        base: TEXT_BLOCK_FONT.base,
        min: TEXT_BLOCK_FONT.min,
        lineHeight: TEXT_BLOCK_FONT.lineHeight,
        measure,
      }),
    [text, rect.w, rect.h, measure],
  );

  const scale = displayWidth > 0 ? displayWidth / rect.w : 0;
  const ink = HOOK_TEXT_INK[textColor];
  const edge = `rgba(${ink.outline},0.95)`;
  const shadow = `rgba(${ink.outline},0.6)`;

  return (
    <div
      ref={boxRef}
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
      style={{
        direction: "rtl",
        textAlign: "center",
        fontWeight: WEIGHT,
        fontSize: frameFontSize * scale,
        lineHeight: TEXT_BLOCK_FONT.lineHeight,
        color: ink.fill,
        textShadow: `0 0 ${3 * scale}px ${edge}, 0 0 ${3 * scale}px ${edge}, 0 ${2 * scale}px ${10 * scale}px ${shadow}`,
        whiteSpace: "pre-wrap",
      }}
    >
      {/* One span, isolate — the composition's TextBlock does the same. */}
      <span style={{ unicodeBidi: "isolate" }}>{text}</span>
    </div>
  );
}

const pctW = (v: number) => `${(v / HOOK_FRAME.width) * 100}%`;
const pctH = (v: number) => `${(v / HOOK_FRAME.height) * 100}%`;

/** Read-only: the rect drawn dashed at its place on the clip, with the block inside it. */
export function TextBlockOverlay({
  rect,
  text,
  textColor,
}: {
  rect: SafeRect;
  text: string;
  textColor?: HookTextColor;
}) {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className="absolute border-2 border-dashed border-white/60"
        style={{ left: pctW(rect.x), top: pctH(rect.y), width: pctW(rect.w), height: pctH(rect.h) }}
      >
        <TextBlockPreview text={text} rect={rect} textColor={textColor} />
      </div>
    </div>
  );
}

/** What the bank editor previews on a clip before any text exists for it. */
export const SAMPLE_TEXT_BLOCK =
  "עשרים הודעות מלקוחות ב-8 בערב ואף אחד לא עונה? יש כלים כמו Sederly שעונים בשבילכם, ואתם רק מאשרים. אין לי מושג איך עשיתם את זה ידנית עד עכשיו, אבל שאפו.";
