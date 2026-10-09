"use client";

import { useEffect, useState } from "react";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import {
  C_CLIP_COPY,
  C_CLIP_GROUP_LABEL,
  C_CLIPS_EMPTY,
  C_CLIPS_LOADING,
  type TextBlockClip,
} from "@/lib/service-c-ui";
import { apiFetch } from "@/lib/use-api";

type StepClipProps = {
  /** The gallery is one character's clips — the bank is global, the column is theirs. */
  personaId: string;
  selected: TextBlockClip | null;
  onSelect: (clip: TextBlockClip) => void;
  onBack: () => void;
  onContinue: () => void;
  onFatal: (message: string) => void;
};

/** Pick the clip the text burns over, from the founder's גוש טקסט bank. A's
 *  StepHook is wired to /api/hooks, so this is its own gallery. */
export function StepClip({
  personaId,
  selected,
  onSelect,
  onBack,
  onContinue,
  onFatal,
}: StepClipProps) {
  const [clips, setClips] = useState<TextBlockClip[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setClips(null);
    const result = await apiFetch<{ clips: TextBlockClip[] }>(
      `/api/text-block-clips?personaId=${encodeURIComponent(personaId)}`,
    );
    if (result.ok) setClips(result.body.clips);
    else if (result.status === 403 || result.status === 404) onFatal(result.error);
    else setError(result.error);
  }

  useEffect(() => {
    void load();
    // load reads only stable props (onFatal is a useState setter).
  }, [personaId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <StepHeader title={C_CLIP_COPY.title} sub={C_CLIP_COPY.sub} onBack={onBack} />

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

      {clips === null && !error && (
        <div className="mt-8 flex items-center justify-center gap-2 py-10 text-sm text-ink/55">
          <Spinner /> {C_CLIPS_LOADING}
        </div>
      )}

      {clips !== null && clips.length === 0 && (
        <p className="mt-6 rounded-xl border border-dashed border-ink/15 bg-ink/[0.04] px-6 py-10 text-center text-sm text-ink/60">
          {C_CLIPS_EMPTY}
        </p>
      )}

      {clips !== null && clips.length > 0 && (
        <>
          <div
            role="radiogroup"
            aria-label={C_CLIP_GROUP_LABEL}
            className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          >
            {clips.map((clip) => (
              <button
                key={clip.id}
                type="button"
                role="radio"
                aria-checked={selected?.id === clip.id}
                onClick={() => onSelect(clip)}
                className={`overflow-hidden rounded-xl border text-start transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
                  selected?.id === clip.id
                    ? "border-accent bg-accent/10 ring-1 ring-accent"
                    : "border-ink/[0.08] bg-white hover:border-ink/25 hover:bg-ink/[0.06]"
                }`}
              >
                {/* Signed, short-lived URL; the clip loops muted as its own preview. */}
                <video
                  src={clip.previewUrl}
                  muted
                  loop
                  autoPlay
                  playsInline
                  className="aspect-[9/16] w-full object-cover"
                />
                <span dir="ltr" className="block px-3 py-2 text-end text-xs text-ink/60">
                  {Math.round(clip.durationMs / 100) / 10}s
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
