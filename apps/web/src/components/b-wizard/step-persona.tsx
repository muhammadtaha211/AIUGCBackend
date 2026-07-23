"use client";

import { useEffect, useState } from "react";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import type { Persona } from "@/lib/service-b-ui";
import { apiFetch } from "@/lib/use-api";

type StepPersonaProps = {
  selected: Persona | null;
  onSelect: (persona: Persona) => void;
  onContinue: () => void;
  onFatal: (message: string) => void;
};

/** Step 1: pick the avatar persona from the founder-curated catalog. */
export function StepPersona({ selected, onSelect, onContinue, onFatal }: StepPersonaProps) {
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Mount and retry share this — every exit is data, empty, error, or fatal. */
  async function load() {
    setError(null);
    setPersonas(null);
    const result = await apiFetch<{ personas: Persona[] }>("/api/personas");
    if (result.ok) setPersonas(result.body.personas);
    else if (result.status === 403 || result.status === 404) onFatal(result.error);
    else setError(result.error);
  }

  useEffect(() => {
    void load();
    // eslint-style deps: load reads only stable props (onFatal is a useState setter).
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <StepHeader
        title="מי מציג את העסק שלכם?"
        sub="בוחרים דמות אחת — היא תדבר בעברית ותציג את המוצר בסרטון."
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

      {personas === null && !error && (
        <div className="mt-8 flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
          <Spinner /> טוענים את הדמויות…
        </div>
      )}

      {personas !== null && personas.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-white/15 bg-white/5 px-6 py-10 text-center text-sm text-gray-400">
          אין כרגע דמויות זמינות — אנחנו מוסיפים חדשות ממש בקרוב. נסו שוב מאוחר יותר.
        </p>
      )}

      {personas !== null && personas.length > 0 && (
        <>
          <div
            role="radiogroup"
            aria-label="בחירת דמות"
            className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3"
          >
            {personas.map((persona) => (
              <button
                key={persona.id}
                type="button"
                role="radio"
                aria-checked={selected?.id === persona.id}
                onClick={() => onSelect(persona)}
                className={`overflow-hidden rounded-xl border text-start transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  selected?.id === persona.id
                    ? "border-accent bg-accent/10 ring-1 ring-accent"
                    : "border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/[0.08]"
                }`}
              >
                {/* Signed, short-lived URL — next/image optimization would break it. */}
                <img
                  src={persona.imageUrl}
                  alt={persona.name}
                  className="aspect-[3/4] w-full object-cover"
                />
                <span className="block px-3 py-2 text-sm font-medium text-white">
                  {persona.name}
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
