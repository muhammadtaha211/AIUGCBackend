"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  HOOK_FRAME,
  framePoint,
  moveRect,
  oppositeCorner,
  rectFromPoints,
  type Corner,
  type FramePoint,
  type SafeRect,
} from "@aiugc/core/hook-geometry";
import { fitFontSize, HOOK_FONT } from "@aiugc/remotion/text-fit";

/**
 * The hook studio's placement editor: the same drag/move/corner-resize
 * mechanic as the admin safe-area editor (both build on the pure geometry in
 * @aiugc/core/hook-geometry), rendering the customer's ACTUAL hook line at
 * approximately composition styling — shrink-to-fit live, so what they see is
 * what the render burns. Overlay the parent lays over its 9:16 clip preview.
 */

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

/** Canvas measureText in the app font approximates the render's measurement. */
export function useHookLineMeasure(): (text: string, fontSize: number) => number {
  return useMemo(() => {
    if (typeof document === "undefined") return (text: string, size: number) => text.length * size;
    const ctx = document.createElement("canvas").getContext("2d");
    const family = getComputedStyle(document.body).fontFamily;
    return (text: string, fontSize: number) => {
      if (!ctx) return text.length * fontSize * 0.55;
      ctx.font = `800 ${fontSize}px ${family}`;
      return ctx.measureText(text).width;
    };
  }, []);
}

/** The composition's shrink-to-fit for `text` inside `rect`, in frame px. */
export function fittedFontSize(
  text: string,
  rect: SafeRect,
  measure: (text: string, fontSize: number) => number,
): number {
  return fitFontSize({
    text,
    maxWidth: rect.w,
    maxHeight: rect.h,
    base: HOOK_FONT.base,
    min: HOOK_FONT.min,
    lineHeight: HOOK_FONT.lineHeight,
    measure,
  });
}

type PlacementEditorProps = {
  rect: SafeRect;
  onChange: (rect: SafeRect) => void;
  /** The customer's current hook line — rendered live inside the rect. */
  text: string;
};

export function PlacementEditor({ rect, onChange, text }: PlacementEditorProps) {
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

  const measure = useHookLineMeasure();
  const frameFontSize = useMemo(() => fittedFontSize(text, rect, measure), [text, rect, measure]);

  const scale = displayWidth / HOOK_FRAME.width;
  const outline = 5 * scale;

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
            color: "white",
            textShadow: `${outline}px ${outline}px 0 rgba(0,0,0,0.92), ${-outline}px ${outline}px 0 rgba(0,0,0,0.92), ${outline}px ${-outline}px 0 rgba(0,0,0,0.92), ${-outline}px ${-outline}px 0 rgba(0,0,0,0.92)`,
          }}
        >
          {/* isolate, not plaintext — must match HookLine in the composition:
              plaintext flips a `POV:`-opening line to LTR base direction. */}
          <span style={{ unicodeBidi: "isolate" }}>{text}</span>
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
