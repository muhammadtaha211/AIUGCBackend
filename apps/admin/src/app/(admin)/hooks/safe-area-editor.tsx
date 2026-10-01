"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HOOK_TEXT_INK, type HookTextColor } from "@aiugc/core/hook-text-color";
import { fitFontSize, HOOK_FONT } from "@aiugc/remotion/text-fit";
import {
  HOOK_FRAME,
  framePoint,
  moveRect,
  oppositeCorner,
  rectFromPoints,
  type Corner,
  type FramePoint,
  type SafeRect,
} from "@/lib/hooks";

/**
 * The visual safe-area editor: an absolutely-positioned overlay the parent
 * lays over its 9:16 video preview. Drag on the video to draw the rect, drag
 * its body to move, drag a corner to resize — all state in 1080x1920 frame
 * space, converted from pointer positions via the pure geometry in lib/hooks.
 * A sample Hebrew hook line renders inside at approximately composition
 * styling, in the clip's text colour, so the founder sees what actually fits
 * and reads before a render does.
 */

const SAMPLE_HOOK_LINE = "זה מה שאף אחד לא מספר לכם";

const pctW = (v: number) => `${(v / HOOK_FRAME.width) * 100}%`;
const pctH = (v: number) => `${(v / HOOK_FRAME.height) * 100}%`;

const HANDLE_STYLE: Record<Corner, React.CSSProperties> = {
  nw: { left: -7, top: -7, cursor: "nwse-resize" },
  ne: { right: -7, top: -7, cursor: "nesw-resize" },
  sw: { left: -7, bottom: -7, cursor: "nesw-resize" },
  se: { right: -7, bottom: -7, cursor: "nwse-resize" },
};

type DragState =
  | { mode: "draw" | "resize"; anchor: FramePoint }
  | { mode: "move"; origin: SafeRect; start: FramePoint };

type SafeAreaEditorProps = {
  rect: SafeRect;
  onChange: (rect: SafeRect) => void;
  /** The colour the clip's hook line burns in (decision 0073); absent = white. */
  textColor?: HookTextColor;
};

export function SafeAreaEditor({ rect, onChange, textColor = "white" }: SafeAreaEditorProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [displayWidth, setDisplayWidth] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setDisplayWidth(box.clientWidth));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // Canvas measureText in the app font (Heebo, same family the composition
  // loads) approximates the render's measurement — close enough to show what
  // fits; the render's own fitFontSize still has the final word.
  const measure = useMemo(() => {
    if (typeof document === "undefined") return (text: string, size: number) => text.length * size;
    const ctx = document.createElement("canvas").getContext("2d");
    const family = getComputedStyle(document.body).fontFamily;
    return (text: string, fontSize: number) => {
      if (!ctx) return text.length * fontSize * 0.55;
      ctx.font = `800 ${fontSize}px ${family}`;
      return ctx.measureText(text).width;
    };
  }, []);

  const frameFontSize = useMemo(
    () =>
      fitFontSize({
        text: SAMPLE_HOOK_LINE,
        maxWidth: rect.w,
        maxHeight: rect.h,
        base: HOOK_FONT.base,
        min: HOOK_FONT.min,
        lineHeight: HOOK_FONT.lineHeight,
        measure,
      }),
    [rect.w, rect.h, measure],
  );

  const scale = displayWidth / HOOK_FRAME.width;
  const outline = 5 * scale;
  const ink = HOOK_TEXT_INK[textColor];
  const shade = `rgba(${ink.outline},0.92)`;

  function toFrame(event: React.PointerEvent): FramePoint {
    const bounds = boxRef.current!.getBoundingClientRect();
    return framePoint(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      bounds.width,
      bounds.height,
    );
  }

  function onPointerDown(event: React.PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const target = event.target as HTMLElement;
    const point = toFrame(event);
    const corner = target.dataset.corner as Corner | undefined;
    if (corner) {
      drag.current = { mode: "resize", anchor: oppositeCorner(rect, corner) };
    } else if (target.dataset.role === "body") {
      drag.current = { mode: "move", origin: rect, start: point };
    } else {
      drag.current = { mode: "draw", anchor: point };
      onChange(rectFromPoints(point, point));
    }
    boxRef.current!.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    const state = drag.current;
    if (!state) return;
    const point = toFrame(event);
    if (state.mode === "move") {
      onChange(moveRect(state.origin, point.x - state.start.x, point.y - state.start.y));
    } else {
      onChange(rectFromPoints(state.anchor, point));
    }
  }

  function onPointerUp() {
    drag.current = null;
  }

  return (
    <div
      ref={boxRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="absolute inset-0 cursor-crosshair select-none"
      style={{ touchAction: "none" }}
    >
      <div
        data-role="body"
        className="absolute cursor-move border-2 border-accent bg-accent/10"
        style={{ left: pctW(rect.x), top: pctH(rect.y), width: pctW(rect.w), height: pctH(rect.h) }}
      >
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
          style={{
            direction: "rtl",
            textAlign: "center",
            fontWeight: 800,
            fontSize: frameFontSize * scale,
            lineHeight: HOOK_FONT.lineHeight,
            color: ink.fill,
            textShadow: `${outline}px ${outline}px 0 ${shade}, ${-outline}px ${outline}px 0 ${shade}, ${outline}px ${-outline}px 0 ${shade}, ${-outline}px ${-outline}px 0 ${shade}`,
          }}
        >
          {/* isolate, not plaintext — must match HookLine in the composition:
              plaintext flips a `POV:`-opening line to LTR base direction. */}
          <span style={{ unicodeBidi: "isolate" }}>{SAMPLE_HOOK_LINE}</span>
        </div>
        {(Object.keys(HANDLE_STYLE) as Corner[]).map((corner) => (
          <span
            key={corner}
            data-corner={corner}
            className="absolute size-3.5 rounded-sm border border-ink/40 bg-accent"
            style={HANDLE_STYLE[corner]}
          />
        ))}
      </div>
    </div>
  );
}

/** Read-only rectangle for the card preview — same percentage mapping, no interaction. */
export function SafeAreaOverlay({ rect }: { rect: SafeRect }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className="absolute border-2 border-dashed border-white/60"
        style={{ left: pctW(rect.x), top: pctH(rect.y), width: pctW(rect.w), height: pctH(rect.h) }}
      />
    </div>
  );
}
