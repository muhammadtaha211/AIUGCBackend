"use client";

import { useEffect, useState } from "react";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import type { HookClip } from "@/lib/service-a-ui";
import { apiFetch } from "@/lib/use-api";

type StepHookProps = {
  selected: HookClip | null;
  onSelect: (hook: HookClip) => void;
  onBack: () => void;
  onContinue: () => void;
  onFatal: (message: string) => void;
};

/** Step 2: pick the reaction clip from the founder-curated bank. */
export function StepHook({ selected, onSelect, onBack, onContinue, onFatal }: StepHookProps) {
  const [hooks, setHooks] = useState<HookClip[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setHooks(null);
    const result = await apiFetch<{ hooks: HookClip[] }>("/api/hooks");
    if (result.ok) setHooks(result.body.hooks);
    else if (result.status === 403 || result.status === 404) onFatal(result.error);
    else setError(result.error);
  }

  useEffect(() => {
    void load();
    // load reads only stable props (onFatal is a useState setter).
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <StepHeader
        title="בוחרים פתיח"
        sub="קליפ תגובה קצר שפותח את המודעה — משפט הפתיחה ייצרב עליו בשלב הבא."
        onBack={onBack}
      />

      {error && (
        <div className="mt-6">
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
            {error}
          </p>
          <Button type="button" variant="secondary" className="mt-4" onClick={() => void load()}>
            נסה שוב
          </Button>
        </div>
      )}

      {hooks === null && !error && (
        <div className="mt-8 flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
          <Spinner /> טוענים את הפתיחים…
        </div>
      )}

      {hooks !== null && hooks.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center text-sm text-gray-400">
          אין כרגע פתיחים זמינים — אנחנו מוסיפים חדשים ממש בקרוב. נסו שוב מאוחר יותר.
        </p>
      )}

      {hooks !== null && hooks.length > 0 && (
        <>
          <div
            role="radiogroup"
            aria-label="בחירת פתיח"
            className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3"
          >
            {hooks.map((hook) => (
              <button
                key={hook.id}
                type="button"
                role="radio"
                aria-checked={selected?.id === hook.id}
                onClick={() => onSelect(hook)}
                className={`overflow-hidden rounded-xl border text-start transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  selected?.id === hook.id
                    ? "border-accent bg-accent/10 ring-1 ring-accent"
                    : "border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/[0.08]"
                }`}
              >
                {/* Signed, short-lived URL; ~2s clips loop as their own preview. */}
                <video
                  src={hook.previewUrl}
                  muted
                  loop
                  autoPlay
                  playsInline
                  className="aspect-[9/16] w-full object-cover"
                />
                <span dir="ltr" className="block px-3 py-2 text-end text-xs text-gray-400">
                  {Math.round(hook.durationMs / 100) / 10}s
                </span>
              </button>
            ))}
          </div>

          <Button
            type="button"
            size="lg"
            className="mt-7 w-full"
            disabled={!selected}
            onClick={onContinue}
          >
            המשך
          </Button>
        </>
      )}
    </div>
  );
}
