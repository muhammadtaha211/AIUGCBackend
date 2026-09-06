"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  hookAnimation,
  hookAnimationDurationMs,
  type HookAnimation,
  type HookEffect,
} from "@aiugc/core/hook-effect";
import { GAP_MS } from "@aiugc/core/service-b-timeline";
import { hookFocusState, hookWhipState, hookZoomScale, OVERSCAN } from "@aiugc/remotion/timing";
import { HOOK_FRAME } from "@aiugc/core/hook-geometry";
import { Play } from "@/components/ui/icons";

/**
 * The effect step's preview: the persona's selfie — the ad's opening frame —
 * with the chosen opening animation actually PLAYING on it, once, and then a
 * play button to run it again.
 *
 * It is not a video of someone else's ad. It is the same numbers
 * (@aiugc/core/hook-effect) driven through the same state functions the
 * composition uses (@aiugc/remotion/timing), on the customer's own persona, so
 * the move here is the move that burns. The only approximations are that the
 * seeded handheld sway is not simulated and that the picture under the move is
 * a still rather than a talking head — during the first second of a Service B
 * ad the head is holding the lead-in silence anyway, so a still is close to
 * what plays.
 *
 * The burned hook text is `children` and deliberately sits OUTSIDE the moving
 * layer: in ServiceB.tsx the hook line is a sibling of the camera container,
 * not inside it, so the picture moves under text that does not.
 */

/** Milliseconds of stillness after the move, so the settled frame reads as the ad's. */
const REST_HOLD_MS = 700;
/** One preview on the page; a fixed id keeps it out of CSS url() escaping. */
const WHIP_FILTER_ID = "hook-preview-whip";

type Picture = { scale: number; dx: number; blurPx: number; whipBlurPx: number };

const REST: Picture = { scale: 1, dx: 0, blurPx: 0, whipBlurPx: 0 };

/**
 * The picture's transform at `ms`, exactly as ServiceB.tsx composes it: every
 * animation's scale multiplied into one transform, the whip's offset and both
 * blurs alongside. Blur and offset are in 1080-wide frame pixels; the caller
 * scales them to the preview box.
 */
function pictureAt(animation: HookAnimation, ms: number): Picture {
  const focus = animation.focus ? hookFocusState(animation.focus, ms) : undefined;
  const whip = animation.whip ? hookWhipState(animation.whip, ms) : undefined;
  return {
    scale:
      (animation.zoom ? hookZoomScale(animation.zoom, ms) : 1) *
      (focus?.scale ?? 1) *
      (whip?.scale ?? 1),
    dx: whip?.dx ?? 0,
    blurPx: focus?.blurPx ?? 0,
    whipBlurPx: whip?.blurPx ?? 0,
  };
}

type HookEffectPreviewProps = {
  /** The chosen animation. "none" renders the still frame and no play button. */
  effect: HookEffect;
  /** Signed URL of the persona's selfie — never through next/image. */
  imageUrl: string;
  /** The burned-text overlay (the placement editor), fixed to the frame. */
  children?: React.ReactNode;
};

export function HookEffectPreview({ effect, imageUrl, children }: HookEffectPreviewProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const raf = useRef<number | null>(null);
  const [displayWidth, setDisplayWidth] = useState(0);
  const [picture, setPicture] = useState<Picture>(REST);
  const [playing, setPlaying] = useState(false);

  // Speech starts GAP_MS into the ad for every render whose lead-in is at
  // least the gap, which every Service B render's is (lipsync_lead_in_ms is
  // 800) — serviceBTimeline's captionOffsetMs is min(leadInMs, GAP_MS). So the
  // preview can place the move without knowing the render's lead-in.
  const animation = useMemo(() => hookAnimation(effect, GAP_MS), [effect]);
  const durationMs = hookAnimationDurationMs(animation);

  // Measured the moment the node exists, not only by the observer: a
  // ResizeObserver delivers on the frame loop, so its first callback is a frame
  // away — and in a background tab never arrives at all. Until it does, `toBox`
  // is 0, and the blur and the whip's slide are silently nothing while the
  // scale animates normally: a broken effect rather than a late one.
  const attachBox = useCallback((node: HTMLDivElement | null) => {
    boxRef.current = node;
    if (node) setDisplayWidth(node.clientWidth);
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setDisplayWidth(box.clientWidth));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const play = useCallback(() => {
    if (durationMs <= 0) return;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    const start = performance.now();
    setPlaying(true);
    setPicture(pictureAt(animation, 0));
    const step = (now: number) => {
      const ms = now - start;
      if (ms >= durationMs) {
        // The move is over: hold the settled frame a beat, then offer it again.
        setPicture(REST);
        if (ms >= durationMs + REST_HOLD_MS) {
          raf.current = null;
          setPlaying(false);
          return;
        }
      } else {
        setPicture(pictureAt(animation, ms));
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [animation, durationMs]);

  // Plays once when the step opens and once more on every change of effect —
  // picking one IS the request to see it.
  useEffect(() => {
    play();
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [play]);

  // Blur and offset come out of timing.ts in the composition's 1080-wide frame
  // pixels; on screen the box is a couple of hundred px, so they scale with it
  // or a 20px blur would swallow the preview.
  const toBox = displayWidth / HOOK_FRAME.width;
  const cssBlur = picture.blurPx * toBox;
  const cssWhipBlur = picture.whipBlurPx * toBox;
  const filters = [
    cssWhipBlur > 0.01 ? `url(#${WHIP_FILTER_ID})` : undefined,
    cssBlur > 0.01 ? `blur(${cssBlur.toFixed(2)}px)` : undefined,
  ].filter(Boolean);

  return (
    <div
      ref={attachBox}
      className="relative aspect-[9/16] overflow-hidden rounded-xl border border-ink/10 bg-black"
    >
      {cssWhipBlur > 0.01 && (
        <svg width={0} height={0} className="absolute" aria-hidden>
          <filter id={WHIP_FILTER_ID} colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation={`${cssWhipBlur.toFixed(2)} 0`} />
          </filter>
        </svg>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt=""
        className="absolute inset-0 size-full object-cover"
        style={{
          // OVERSCAN is the composition's own margin for the handheld sway; the
          // preview keeps it so the settled frame is framed like the ad's.
          transform: `translateX(${(picture.dx * toBox).toFixed(2)}px) scale(${(picture.scale * OVERSCAN).toFixed(4)})`,
          // About the face, not the frame centre — ServiceB.tsx's TalkingHead.
          transformOrigin: "50% 40%",
          filter: filters.length > 0 ? filters.join(" ") : undefined,
        }}
      />

      {children}

      {!playing && durationMs > 0 && (
        <button
          type="button"
          onClick={play}
          aria-label="הצג שוב את אפקט הפתיחה"
          className="absolute bottom-2 left-1/2 z-10 flex size-9 -translate-x-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors duration-150 hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <Play className="size-4" />
        </button>
      )}
    </div>
  );
}
