"use client";

import type { HookEffect } from "@aiugc/core/hook-effect";
import {
  CENTRED_HOOK_TEXT_RECT,
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
import { HookEffectPreview } from "./hook-effect-preview";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { hookTextFieldError, HOOK_EFFECT_OPTIONS } from "@/lib/service-b-ui";

type StepEffectProps = {
  /** The render source — its selfie is the ad's first frame, so the preview is honest. */
  personaImageUrl: string;
  /** The chosen animation; "none" is the default and burns no line. */
  hookEffect: HookEffect;
  setHookEffect: (effect: HookEffect) => void;
  /** The on-screen line as the wizard resolves it: the customer's edit, else
   *  the script call's draft (b-wizard's effectText). */
  hookText: string;
  setHookText: (value: string) => void;
  /** The customer-placed rect; null = untouched (the centred default). */
  rect: SafeRect | null;
  setRect: (rect: SafeRect | null) => void;
  onBack: () => void;
  onContinue: () => void;
};

/**
 * Step 5, the opening animation: none (default), or one the composition
 * performs on the single HeyGen clip — a zoom out of a tight opening, a focus
 * pull, or a whip-in (vault 0023; the founder picked these three on
 * 2026-09-06 after watching a mock of each). Nothing is stitched in front of
 * the clip any more, so there is no clip list, no fetch and no failure state:
 * every option renders from what the wizard already holds.
 *
 * Picking an animation reveals the hook text that burns over it — seeded from
 * the script call's draft, freely edited here, validated with the same rule
 * the render enforces — and the placement editor over the persona's selfie,
 * which IS the frame the animation plays on. The text's geometry preview is
 * exact (burned text sits outside the camera transform); the picture under it
 * will be zooming, softening or sliding at that moment. The selection, the
 * text and the rect live in wizard state and go into render params at enqueue;
 * nothing is written back to the script (vault 0017).
 */
export function StepEffect({
  personaImageUrl,
  hookEffect,
  setHookEffect,
  hookText,
  setHookText,
  rect,
  setRect,
  onBack,
  onContinue,
}: StepEffectProps) {
  const animated = hookEffect !== "none";
  const textError = animated ? hookTextFieldError(hookText) : undefined;
  // The same fallback createBRender applies server-side — preview and burn
  // must resolve through one constant or they silently disagree.
  const shownRect = animated
    ? resolveHookTextSafeArea(rect ?? undefined, CENTRED_HOOK_TEXT_RECT)
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
        sub="אפשר לפתוח את הסרטון בתנועת מצלמה עם משפט הפתיחה על המסך, או להתחיל ישר מהדמות."
        onBack={onBack}
      />

      <div
        role="radiogroup"
        aria-label="בחירת אפקט פתיחה"
        className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        {HOOK_EFFECT_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={hookEffect === option.id}
            onClick={() => setHookEffect(option.id)}
            className={cardClass(hookEffect === option.id)}
          >
            <span className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-1.5 px-3 text-center">
              <span className="text-base font-medium text-ink">{option.label}</span>
              <span className="text-[12px] text-ink/55">{option.hint}</span>
            </span>
          </button>
        ))}
      </div>

      {animated && shownRect && (
        <div className="mt-8 flex flex-col gap-5 sm:flex-row">
          {/* The persona's selfie — the image the talking head is generated
              from, so this is the ad's opening frame — with the chosen animation
              playing on it and the live burned-text preview on top. */}
          <div className="mx-auto w-56 shrink-0 sm:mx-0">
            <HookEffectPreview effect={hookEffect} imageUrl={personaImageUrl}>
              <PlacementEditor rect={shownRect} onChange={setRect} text={hookText} />
            </HookEffectPreview>
            <p className="mt-1.5 text-[12px] text-ink/55">
              האפקט מתנגן פעם אחת — לחיצה על כפתור הנגינה מריצה אותו שוב. גוררים את המסגרת כדי להזיז
              את הטקסט, ומהפינות כדי לשנות גודל.
            </p>
            {belowFloor && (
              <p className="mt-1.5 text-[12px] text-amber-600">
                רק לתשומת לב, בגודל הזה הטקסט עלול להיות קשה לקריאה בטלפון. אפשר להגדיל את האזור או
                לקצר את המשפט.
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
              נצרב במרכז המסך עד שהדמות מסיימת להגיד אותו, ואז הכתוביות ממשיכות מהשורה הבאה. אפשר
              לערוך חופשי.
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
    </div>
  );
}
