"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import type { PersonaImage } from "@/lib/service-b-ui";
import { apiFetch } from "@/lib/use-api";

type StepImageProps = {
  personaId: string;
  selected: PersonaImage | null;
  onSelect: (image: PersonaImage) => void;
  /** Zero background images: leave the step silently (default-image render). */
  onSkip: () => void;
  onBack: () => void;
  onContinue: () => void;
  onFatal: (message: string) => void;
};

/** Step 2: pick which background image of the chosen persona to render with. */
export function StepImage({
  personaId,
  selected,
  onSelect,
  onSkip,
  onBack,
  onContinue,
  onFatal,
}: StepImageProps) {
  const [images, setImages] = useState<PersonaImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Mount and retry share this — every exit is data, empty, error, or fatal. */
  async function load() {
    setError(null);
    setImages(null);
    const result = await apiFetch<{ images: PersonaImage[] }>(`/api/personas/${personaId}/images`);
    if (result.ok) setImages(result.body.images);
    else if (result.status === 403 || result.status === 404) onFatal(result.error);
    else setError(result.error);
  }

  useEffect(() => {
    void load();
    // eslint-style deps: load reads only stable props (onFatal is a useState setter).
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // No backgrounds -> the step does not exist for this persona; leave in the
  // direction the user was heading so back navigation still works.
  useEffect(() => {
    if (images !== null && images.length === 0) onSkip();
    // onSkip is stable (wizard navigation); images is the real trigger.
  }, [images]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <StepHeader
        title="בחירת רקע"
        sub="בוחרים את התמונה שממנה ניצור את הסרטון עם הדמות."
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

      {images === null && !error && (
        <div className="mt-8 flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
          <Spinner /> טוענים את התמונות…
        </div>
      )}

      {images !== null && images.length > 0 && (
        <>
          <div
            role="radiogroup"
            aria-label="בחירת רקע"
            className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3"
          >
            {images.map((image) => (
              <button
                key={image.id}
                type="button"
                role="radio"
                aria-checked={selected?.id === image.id}
                onClick={() => onSelect(image)}
                className={`overflow-hidden rounded-xl border text-start transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  selected?.id === image.id
                    ? "border-accent bg-accent/10 ring-1 ring-accent"
                    : "border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/[0.08]"
                }`}
              >
                {/* Public catalog URL — stable, so next/image resizes it and
                    the browser caches it across sessions. */}
                <span className="relative block aspect-[3/4] w-full">
                  <Image
                    src={image.imageUrl}
                    alt={image.label ?? "רקע"}
                    fill
                    sizes="(max-width: 640px) 45vw, 200px"
                    className="object-cover"
                  />
                </span>
                {image.label && (
                  <span className="block px-3 py-2 text-sm font-medium text-white">
                    {image.label}
                  </span>
                )}
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
