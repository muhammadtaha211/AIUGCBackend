"use client";

import { useEffect, useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { onRoute, stopRecordingIfPublic, track } from "@/lib/analytics-client";
import type { StepName, StepProps } from "@/lib/analytics";

/**
 * Mounted once, in the root layout: tells the analytics runtime about every
 * route, which counts the visit and starts or stops the recording for it
 * (lib/analytics.ts isRecordedPath). Renders nothing. usePathname only, so the
 * static marketing pages stay static.
 */
export function Analytics() {
  const pathname = usePathname();
  // Inside the commit, before the recorder's observer sees the new page: a
  // public page reached from a recorded one never enters that recording.
  useLayoutEffect(() => {
    stopRecordingIfPublic(pathname);
  }, [pathname]);
  useEffect(() => {
    void onRoute(pathname);
  }, [pathname]);
  return null;
}

/** A client wizard's current step, fired whenever it changes, once `ready`. */
export function useStepViewed(
  service: StepProps<"wizard_step_viewed">["service"],
  step: string,
  ready = true,
) {
  useEffect(() => {
    // The step list is checked at run time (stepProperties); a name outside it is not sent.
    if (ready) track("wizard_step_viewed", { service, step } as StepProps<"wizard_step_viewed">);
  }, [service, step, ready]);
}

/** Fires a named step once, from a server component (NoCreditsCard). */
export function TrackStep<N extends StepName>({ name, props }: { name: N; props: StepProps<N> }) {
  // Once per mount: the props are literals from a server component.
  useEffect(() => {
    track(name, props);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
