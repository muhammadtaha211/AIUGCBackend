"use client";

import { Check } from "@/components/ui/icons";

type WizardNavProps = {
  /** Step labels in flow order. */
  labels: string[];
  current: number;
  /** Jump back to a completed step — same state semantics as pressing back repeatedly. */
  onJump: (index: number) => void;
  /** True once the render is enqueued: the choices are paid for, no more jumping. */
  locked?: boolean;
  /** False when a parent wrapper owns the pinning (the A wizard pins nav +
   *  structure strip together) — a nested sticky would re-pin over the strip
   *  when the row bottom pushes the wrapper up at the end of scroll. */
  sticky?: boolean;
};

/**
 * Wizard step navigation, one component, two forms. Desktop (lg+): a labeled
 * vertical rail — the whole flow is visible, completed steps are buttons that
 * jump back (forward jumps would skip required choices, so current/future
 * steps are inert). Mobile: the compact current-label + n/total + progress
 * bar, because a seven-row rail would push the step itself below the fold.
 * The discs reuse the render timeline's visual language (lime = done/current).
 */
export function WizardNav({ labels, current, onJump, locked = false, sticky = true }: WizardNavProps) {
  return (
    <nav aria-label="שלבי היצירה" className={sticky ? "lg:sticky lg:top-8" : undefined}>
      {/* Mobile */}
      <div className="lg:hidden">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="truncate font-medium text-ink/75">{labels[current]}</span>
          <span dir="ltr" className="tabular-nums text-ink/55">
            {current + 1}/{labels.length}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
            style={{ width: `${Math.round(((current + 1) / labels.length) * 100)}%` }}
          />
        </div>
      </div>

      {/* Desktop rail */}
      <ol className="hidden lg:block">
        {labels.map((label, index) => {
          const done = index < current;
          const isCurrent = index === current;
          const row = (
            <>
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-xs ${
                  done
                    ? "border-accent bg-accent/20 text-ink"
                    : isCurrent
                      ? "border-accent text-ink"
                      : "border-ink/15 text-ink/40"
                }`}
              >
                {done ? <Check /> : index + 1}
              </span>
              <span
                className={`pt-1.5 text-[13px] leading-snug transition-colors duration-150 group-hover:text-ink ${
                  isCurrent ? "font-medium text-ink" : done ? "text-ink/75" : "text-ink/55"
                }`}
              >
                {label}
              </span>
            </>
          );
          return (
            <li
              key={label}
              aria-current={isCurrent ? "step" : undefined}
              className="relative pb-5 last:pb-0"
            >
              {/* Connector down to the next disc. */}
              {index < labels.length - 1 && (
                <span aria-hidden className="absolute bottom-0 start-3.5 top-8 w-px bg-ink/10" />
              )}
              {done && !locked ? (
                <button
                  type="button"
                  onClick={() => onJump(index)}
                  className="group flex w-full items-start gap-3 rounded-lg text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  {row}
                </button>
              ) : (
                <div className="flex items-start gap-3">{row}</div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
