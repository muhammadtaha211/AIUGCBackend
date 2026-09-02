"use client";

import { useEffect, useState } from "react";
import type { RenderBarView } from "@/lib/service-a-ui";

type RenderProgressProps = {
  /** From renderWaitView — the bar and the Hebrew line share one view model. */
  bar: RenderBarView;
  /** Accessible name; the visible caption is the caller's (it differs per surface). */
  label: string;
  className?: string;
};

/**
 * The render progress track. Three states, all read off renderWaitView's bar:
 *
 *   percent present -> determinate fill
 *   no percent      -> a full-width accent wash with a band sweeping across
 *                      it. Work is happening and its size is genuinely
 *                      unknown — no fraction exists during the queue, the
 *                      bundle or the upload, and inventing one is the lie
 *                      this whole surface is built to avoid.
 *   paused          -> an empty track. Nothing is claiming the job, so the
 *                      bar shows nothing rather than something.
 *
 * The wash is why the indeterminate state is a WASH and not a stub: a static
 * one-third segment at the start edge reads as "33% done", which is exactly
 * the number we are refusing to invent. A uniform tint has no edge to
 * misread, and it is also what someone with prefers-reduced-motion sees —
 * `motion-safe` drops the band entirely rather than freezing it mid-track.
 *
 * Fill direction follows the app's other in-flow bars (WizardNav's mobile bar,
 * the onboarding header): it grows from the RTL start edge, on the right.
 * nav-progress.tsx is deliberately NOT the precedent — that one is fixed
 * chrome with a faked value and a physical left-0.
 */
export function RenderProgress({ bar, label, className = "" }: RenderProgressProps) {
  const determinate = bar.percent !== undefined;
  // Starts at 0 and fills on the next frame, so the first appearance animates
  // too (same trick as the onboarding header).
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setWidth(bar.percent ?? 0));
    return () => cancelAnimationFrame(frame);
  }, [bar.percent]);

  const working = !determinate && !bar.paused;
  return (
    <div
      role="progressbar"
      aria-label={label}
      // Omitted while indeterminate on purpose: no valuenow is how assistive
      // tech is told the size of the work is unknown.
      {...(determinate
        ? { "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": bar.percent }
        : {})}
      className={`relative h-1.5 overflow-hidden rounded-full ${working ? "bg-accent/25" : "bg-ink/10"} ${className}`}
    >
      {determinate && (
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
          style={{ width: `${width}%` }}
        />
      )}
      {working && (
        // w-1/3 pinned to the start edge is what the `sweep` keyframe is
        // measured against — see globals.css.
        <div
          aria-hidden
          className="sweep absolute inset-y-0 start-0 hidden w-1/3 rounded-full bg-accent motion-safe:block"
        />
      )}
    </div>
  );
}
