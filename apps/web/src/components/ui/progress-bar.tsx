"use client";

import { useEffect, useState } from "react";
import type { RenderBarView } from "@/lib/service-a-ui";

type RenderProgressProps = {
  /** From renderWaitView — the bar and the Hebrew line share one view model. */
  bar: RenderBarView;
  /** Accessible name. */
  label: string;
  /**
   * The caller's poll interval. The fill glides over exactly this long, so the
   * bar is still moving when the next sample lands instead of jumping and
   * sitting still — the frame fraction is checkpointed roughly a percent at a
   * time, which unsmoothed looks like a stutter, not a render.
   */
  stepMs?: number;
  className?: string;
};

/**
 * The render progress bar. Three states, all read off renderWaitView's bar:
 *
 *   percent present -> the fill grows to it, with the number on the bar
 *   no percent      -> a full-width accent wash with a band sweeping across
 *                      it. Work is happening and its size is genuinely
 *                      unknown — no fraction exists during the queue, the
 *                      bundle or the upload, and inventing one is the lie
 *                      this whole surface is built to avoid.
 *   paused          -> the wash without the sweep. This state now means only
 *                      one thing: nothing is claiming the job, and the caller
 *                      is saying so in an amber line. Motion here would
 *                      contradict it. A backoff park is NOT paused — it
 *                      resumes on its own, so the bar keeps running.
 *
 * The wash is why the indeterminate state is a WASH and not a stub: a static
 * one-third segment at the start edge reads as "33% done", which is exactly
 * the number we are refusing to invent. A uniform tint has no edge to
 * misread, and it is also what someone with prefers-reduced-motion sees —
 * `motion-safe` drops the band entirely rather than freezing it mid-track.
 *
 * The fill grows LEFT to right, physically, even though the app is dir="rtl" —
 * founder call, 2026-09-02, and the same ruling already recorded on
 * nav-progress.tsx. Progress reads as a left-to-right axis whatever the
 * language, the way a-wizard's StructureStrip forces dir="ltr" on its
 * timeline. Hence the physical `left-0` anchors below: logical `start-0` would
 * flip the whole thing back. WizardNav's mobile bar and the onboarding header
 * still fill from the RTL start — those are step counters, not this.
 */
export function RenderProgress({
  bar,
  label,
  stepMs = 2_500,
  className = "",
}: RenderProgressProps) {
  const determinate = bar.percent !== undefined;
  // Starts at 0 and fills on the next frame, so the first appearance animates
  // too (same trick as the onboarding header).
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setWidth(bar.percent ?? 0));
    return () => cancelAnimationFrame(frame);
  }, [bar.percent]);

  return (
    <div
      role="progressbar"
      aria-label={label}
      // Omitted while indeterminate on purpose: no valuenow is how assistive
      // tech is told the size of the work is unknown.
      {...(determinate
        ? { "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": bar.percent }
        : {})}
      className={`relative h-7 overflow-hidden rounded-full ${determinate ? "bg-ink/10" : "bg-accent/25"} ${className}`}
    >
      {determinate && (
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          // Linear, and exactly one poll long: eased or shorter and the bar
          // visibly stops between samples.
          style={{ width: `${width}%`, transition: `width ${stepMs}ms linear` }}
        />
      )}
      {!determinate && !bar.paused && (
        // w-1/3 pinned to the PHYSICAL left edge is what the `sweep` keyframe
        // is measured against — see globals.css.
        <div
          aria-hidden
          className="sweep absolute inset-y-0 left-0 hidden w-1/3 bg-accent motion-safe:block"
        />
      )}
      {determinate && (
        // On the bar, centred, so it is legible over both the lime fill and
        // the empty track — ink reads on both, no per-side colour swap.
        <span
          dir="ltr"
          className="absolute inset-0 grid place-items-center text-[13px] font-semibold tabular-nums text-ink"
        >
          {bar.percent}%
        </span>
      )}
    </div>
  );
}
