"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import { PERSONA_CARD_QUALITY, PERSONA_CARD_SIZES, type Persona } from "@/lib/service-b-ui";
import { apiFetch } from "@/lib/use-api";

type StepPersonaProps = {
  /**
   * The fetched catalog, held by the wizard (not this step) so returning to
   * the step renders from memory instead of refetching. null = not loaded yet.
   */
  catalog: Persona[] | null;
  setCatalog: (personas: Persona[] | null) => void;
  selected: Persona | null;
  onSelect: (persona: Persona) => void;
  onContinue: () => void;
  onFatal: (message: string) => void;
  /**
   * Header copy variant. Default = Service B, where the persona IS the video.
   * Service A overrides it: there the persona scopes the hook gallery (one
   * column of the persona × clip matrix) and speaks the hook lines — no
   * presenter is rendered, so B's copy would promise a face the customer
   * never sees.
   */
  copy?: { title: string; sub: string };
  /**
   * Where the mount/retry fetch goes. Default = the Service B catalog
   * (?withSelfie=1: personas with a selfie, shown on the card). Service A
   * passes the hook-matrix filter (?withHookClips=1) so the retry lists the
   * same personas the server shell preloaded — never one whose gallery would
   * come back empty.
   */
  catalogUrl?: string;
  /**
   * Service B's two doors (decision 0118): one button per voice in place of
   * the single המשך, each choosing its branch and continuing. They sit here
   * because the founder put the door at the character step. Absent (A, C) =
   * the single המשך, unchanged.
   */
  doors?: { id: string; title: string; hint: string; onChoose: () => void }[];
};

const B_COPY = {
  title: "מי מציג את העסק שלכם?",
  sub: "בוחרים דמות אחת, היא תדבר בעברית ותציג את המוצר בסרטון.",
};

/** Step 1: pick the avatar persona from the founder-curated catalog. */
export function StepPersona({
  catalog: personas,
  setCatalog,
  selected,
  onSelect,
  onContinue,
  onFatal,
  copy = B_COPY,
  catalogUrl = "/api/personas?withSelfie=1",
  doors,
}: StepPersonaProps) {
  const [error, setError] = useState<string | null>(null);

  /** Mount and retry share this — every exit is data, empty, error, or fatal. */
  async function load() {
    setError(null);
    setCatalog(null);
    const result = await apiFetch<{ personas: Persona[] }>(catalogUrl);
    if (result.ok) setCatalog(result.body.personas);
    else if (result.status === 403 || result.status === 404) onFatal(result.error);
    else setError(result.error);
  }

  useEffect(() => {
    if (personas === null) void load();
    // eslint-style deps: load reads only stable props (onFatal is a useState setter).
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <StepHeader title={copy.title} sub={copy.sub} />

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

      {personas === null && !error && (
        <div className="mt-8 flex items-center justify-center gap-2 py-10 text-sm text-ink/55">
          <Spinner /> טוענים את הדמויות…
        </div>
      )}

      {personas !== null && personas.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-ink/15 bg-ink/[0.04] px-6 py-10 text-center text-sm text-ink/60">
          אין כרגע דמויות זמינות, אנחנו מוסיפים חדשות ממש בקרוב. נסו שוב מאוחר יותר.
        </p>
      )}

      {personas !== null && personas.length > 0 && (
        <>
          <div
            role="radiogroup"
            aria-label="בחירת דמות"
            className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          >
            {personas.map((persona, index) => (
              <button
                key={persona.id}
                type="button"
                role="radio"
                aria-checked={selected?.id === persona.id}
                onClick={() => onSelect(persona)}
                className={`overflow-hidden rounded-xl border text-start transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                  selected?.id === persona.id
                    ? "border-accent bg-accent/10 ring-1 ring-accent"
                    : "border-ink/[0.08] bg-white hover:border-ink/25 hover:bg-ink/[0.06]"
                }`}
              >
                {/* Public catalog URL — stable, so next/image resizes it and
                    the browser caches it across sessions. priority on the
                    first two rows: lazy-loading above-the-fold cards only
                    delays them. */}
                <span className="relative block aspect-[3/4] w-full">
                  <Image
                    src={persona.imageUrl}
                    alt={persona.name}
                    fill
                    sizes={PERSONA_CARD_SIZES}
                    quality={PERSONA_CARD_QUALITY}
                    priority={index < 6}
                    placeholder={persona.blurDataUrl ? "blur" : "empty"}
                    blurDataURL={persona.blurDataUrl ?? undefined}
                    className="object-cover"
                  />
                </span>
                <span className="block px-3 py-2 text-sm font-medium text-ink">{persona.name}</span>
              </button>
            ))}
          </div>

          {doors ? (
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {doors.map((door, index) => (
                <button
                  key={door.id}
                  type="button"
                  disabled={!selected}
                  onClick={door.onChoose}
                  className={`w-full rounded-xl border px-5 py-4 text-start transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:pointer-events-none disabled:opacity-50 ${
                    index === 0
                      ? "border-accent bg-accent text-ink hover:bg-accent-deep"
                      : "border-ink/15 bg-white text-ink hover:border-accent hover:bg-accent/10"
                  }`}
                >
                  <span className="block text-base font-semibold">{door.title}</span>
                  <span className="mt-1 block text-[13px] leading-snug text-ink/70">
                    {door.hint}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <Button
              type="button"
              size="lg"
              className="mt-7 w-full"
              disabled={!selected}
              onClick={onContinue}
            >
              המשך
            </Button>
          )}
        </>
      )}
    </div>
  );
}
