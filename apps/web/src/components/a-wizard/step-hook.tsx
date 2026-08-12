"use client";

import { useEffect, useState } from "react";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import type { HookClip } from "@/lib/service-a-ui";
import { apiFetch } from "@/lib/use-api";

type StepHookProps = {
  /** Filters the gallery: this persona's swapped clips + the generic ones. */
  personaId: string;
  selected: HookClip | null;
  onSelect: (hook: HookClip) => void;
  onBack: () => void;
  onContinue: () => void;
  onFatal: (message: string) => void;
};

/** Step 2: pick the reaction clip from the founder-curated bank. */
export function StepHook({
  personaId,
  selected,
  onSelect,
  onBack,
  onContinue,
  onFatal,
}: StepHookProps) {
  const [hooks, setHooks] = useState<HookClip[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setHooks(null);
    const result = await apiFetch<{ hooks: HookClip[] }>(
      `/api/hooks?personaId=${encodeURIComponent(personaId)}`,
    );
    if (result.ok) setHooks(result.body.hooks);
    else if (result.status === 403 || result.status === 404) onFatal(result.error);
    else setError(result.error);
  }

  useEffect(() => {
    void load();
    // load reads only stable props (onFatal is a useState setter).
  }, [personaId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <StepHeader
        title="בחרו קליפ פתיחה"
        sub="הפתיח עוצר את הגלילה ברגע הראשון, ומיד אחריו הדמות שבחרתם מקריינת את הסרטון וסוגרת אותו."
        onBack={onBack}
      />

      {error && (
        <div className="mt-6">
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
            {error}
          </p>
          <Button type="button" variant="secondary" className="mt-4" onClick={() => void load()}>
            נסה שוב
          </Button>
        </div>
      )}

      {hooks === null && !error && (
        <div className="mt-8 flex items-center justify-center gap-2 py-10 text-sm text-ink/55">
          <Spinner /> טוענים את הפתיחים…
        </div>
      )}

      {hooks !== null && hooks.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-ink/15 bg-ink/[0.04] px-6 py-10 text-center text-sm text-ink/60">
          אין כרגע פתיחים זמינים, אנחנו מוסיפים חדשים ממש בקרוב. נסו שוב מאוחר יותר.
        </p>
      )}

      {hooks !== null && hooks.length > 0 && (
        <>
          <div
            role="radiogroup"
            aria-label="בחירת קליפ פתיחה"
            className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          >
            {hooks.map((hook) => (
              <button
                key={hook.id}
                type="button"
                role="radio"
                aria-checked={selected?.id === hook.id}
                onClick={() => onSelect(hook)}
                className={`overflow-hidden rounded-xl border text-start transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                  selected?.id === hook.id
                    ? "border-accent bg-accent/10 ring-1 ring-accent"
                    : "border-ink/[0.08] bg-white hover:border-ink/25 hover:bg-ink/[0.06]"
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
                <span dir="ltr" className="block px-3 py-2 text-end text-xs text-ink/60">
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
