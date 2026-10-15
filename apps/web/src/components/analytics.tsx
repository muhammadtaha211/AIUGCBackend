"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { onRoute, track } from "@/lib/analytics-client";
import type { StepName, StepProps } from "@/lib/analytics";

/**
 * Mounted once, in the root layout: tells the analytics runtime about every
 * route, which counts the visit and keeps the recording going (every page
 * records, vault 0110). Renders nothing. usePathname only, so the static
 * marketing pages stay static.
 */
export function Analytics() {
  const pathname = usePathname();
  useEffect(() => {
    void onRoute();
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
