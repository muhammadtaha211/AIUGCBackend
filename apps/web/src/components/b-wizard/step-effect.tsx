"use client";

import { useEffect, useState } from "react";
import {
  HOOK_LINE_LEGIBLE_MIN_PX,
  resolveHookTextSafeArea,
  type SafeRect,
} from "@aiugc/core/hook-geometry";
import { HOOK_TEXT_MAX_WORDS } from "@aiugc/core/hook-text";
import {
  PlacementEditor,
  fittedFontSize,
  useHookLineMeasure,
} from "@/components/a-wizard/placement-editor";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Spinner } from "@/components/ui/icons";
import { hookTextFieldError, type OpenerClip } from "@/lib/service-b-ui";
import { apiFetch } from "@/lib/use-api";

type StepEffectProps = {
  personaId: string;
  /** The persona's opener clips, held by the wizard so re-entering skips the fetch. */
  openers: OpenerClip[] | null;
  setOpeners: (openers: OpenerClip[] | null) => void;
  /** The chosen clip; null = "ללא אפקט", the default. */
  opener: OpenerClip | null;
  setOpener: (opener: OpenerClip | null) => void;
  /** The on-screen line as the wizard resolves it: the customer's edit, else
   *  the script call's draft (b-wizard's effectText). */
  hookText: string;
  setHookText: (value: string) => void;
  /** The customer-placed rect; null = untouched (the clip's safe area). */
  rect: SafeRect | null;
  setRect: (rect: SafeRect | null) => void;
  onBack: () => void;
  onContinue: () => void;
  onFatal: (message: string) => void;
};

/**
 * Step 5, the opener effect: none (default), or one of the founder-made clips
 * of this persona's selfie. Picking a clip reveals the hook text that burns
 * over its palm phase — seeded from the script call's draft, freely edited
 * here, validated with the same rule the render enforces — and the placement
 * editor over the clip's first frame, seeded from the clip's safe area. What
 * the preview shows is what the render burns. The selection, the text and the
 * rect live in wizard state and go into render params at enqueue; nothing is
 * written back to the script (vault 0017).
 */
export function StepEffect({
  personaId,
  openers,
  setOpeners,
  opener,
  setOpener,
  hookText,
  setHookText,
  rect,
  setRect,
  onBack,
  onContinue,
  onFatal,
}: StepEffectProps) {
  const [error, setError] = useState<string | null>(null);

  /** Mount and retry share this — every exit is data, empty, error, or fatal. */
  async function load() {
    setError(null);
    setOpeners(null);
    const result = await apiFetch<{ openers: OpenerClip[] }>(`/api/personas/${personaId}/openers`);
    if (result.ok) setOpeners(result.body.openers);
    else if (result.status === 403 || result.status === 404) onFatal(result.error);
    else setError(result.error);
  }

  useEffect(() => {
    if (openers === null) void load();
    // eslint-style deps: load reads only stable props (onFatal is a useState setter).
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** A different clip re-seeds the placement editor from ITS safe area. */
  function selectOpener(next: OpenerClip | null) {
    if (next?.id !== opener?.id) setRect(null);
    setOpener(next);
  }

  const textError = opener ? hookTextFieldError(hookText) : undefined;
  const shownRect = opener
    ? resolveHookTextSafeArea(rect ?? undefined, opener.textSafeArea)
    : undefined;

  const measure = useHookLineMeasure();
  const belowFloor =
    shownRect !== undefined &&
    textError === undefined &&
    fittedFontSize(hookText, shownRect, measure) < HOOK_LINE_LEGIBLE_MIN_PX;

  const cardClass = (selected: boolean) =>
    `overflow-hidden rounded-xl border text-start transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
      selected
        ? "border-accent bg-accent/10 ring-1 ring-accent"
        : "border-ink/[0.08] bg-white hover:border-ink/25 hover:bg-ink/[0.06]"
    }`;

  return (
    <div>
      <StepHeader
        title="אפקט פתיחה"
        sub="אפשר לפתוח את הסרטון בקליפ קצר עם משפט הפתיחה על המסך, או להתחיל ישר מהדמות."
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

      {openers === null && !error && (
        <div className="mt-8 flex items-center justify-center gap-2 py-10 text-sm text-ink/55">
          <Spinner /> טוענים את אפקטי הפתיחה…
        </div>
      )}

      {openers !== null && (
        <>
          <div
            role="radiogroup"
            aria-label="בחירת אפקט פתיחה"
            className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3"
          >
            <button
              type="button"
              role="radio"
              aria-checked={opener === null}
              onClick={() => selectOpener(null)}
              className={cardClass(opener === null)}
            >
              <span className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-1.5 px-3 text-center">
                <span className="text-base font-medium text-ink">ללא אפקט</span>
                <span className="text-[12px] text-ink/55">הסרטון מתחיל ישר מהדמות</span>
              </span>
            </button>

            {openers.map((clip) => (
              <button
                key={clip.id}
                type="button"
                role="radio"
                aria-checked={opener?.id === clip.id}
                onClick={() => selectOpener(clip)}
                className={cardClass(opener?.id === clip.id)}
              >
                {/* Paused on its first frame — the palm phase the text burns
                    over. Signed URL: never through next/image. */}
                <span className="relative block aspect-[9/16] w-full bg-black">
                  <video
                    src={clip.previewUrl}
                    muted
                    playsInline
                    preload="metadata"
                    className="absolute inset-0 size-full object-cover"
                  />
                </span>
                <span className="block px-3 py-2 text-sm font-medium text-ink">{clip.label}</span>
              </button>
            ))}
          </div>

          {openers.length === 0 && (
            <p className="mt-4 text-sm text-ink/60">
              לדמות הזאת עדיין אין אפקטי פתיחה. אפשר להמשיך בלי.
            </p>
          )}

          {opener && shownRect && (
            <div className="mt-8 flex flex-col gap-5 sm:flex-row">
              {/* The clip's first frame with the live burned-text preview on top. */}
              <div className="mx-auto w-56 shrink-0 sm:mx-0">
                <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-ink/10 bg-black">
                  <video
                    key={opener.id}
                    src={opener.previewUrl}
                    muted
                    playsInline
                    preload="auto"
                    className="absolute inset-0 size-full object-cover"
                  />
                  <PlacementEditor rect={shownRect} onChange={setRect} text={hookText} />
                </div>
                <p className="mt-1.5 text-[12px] text-ink/55">
                  גוררים את המסגרת כדי להזיז את הטקסט, ומהפינות כדי לשנות גודל.
                </p>
                {belowFloor && (
                  <p className="mt-1.5 text-[12px] text-amber-600">
                    רק לתשומת לב, בגודל הזה הטקסט עלול להיות קשה לקריאה בטלפון. אפשר להגדיל את האזור
                    או לקצר את המשפט.
                  </p>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <TextField
                  label="משפט הפתיחה"
                  hint={`עד ${HOOK_TEXT_MAX_WORDS} מילים`}
                  value={hookText}
                  onChange={(event) => setHookText(event.target.value)}
                  error={textError}
                />
                <p className="mt-2 text-[13px] text-ink/55">
                  נצרב על הקליפ עד לרגע החשיפה, ואז הדמות מתחילה לדבר. אפשר לערוך חופשי.
                </p>
              </div>
            </div>
          )}

          <Button
            type="button"
            size="lg"
            className="mt-7 w-full"
            disabled={textError !== undefined}
            onClick={onContinue}
          >
            המשך
          </Button>
        </>
      )}
    </div>
  );
}
