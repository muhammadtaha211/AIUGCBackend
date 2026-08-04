"use client";

import { useEffect, useState } from "react";
import {
  HOOK_LINE_LEGIBLE_MIN_PX,
  resolveHookTextSafeArea,
  type SafeRect,
} from "@aiugc/core/hook-geometry";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/field";
import { Spinner } from "@/components/ui/icons";
import type { HookClip, HookLineOption } from "@/lib/service-a-ui";
import { postJson } from "@/lib/use-api";
import { PlacementEditor, fittedFontSize, useHookLineMeasure } from "./placement-editor";

type StepHookStudioProps = {
  businessId: string;
  hook: HookClip;
  hookLines: HookLineOption[] | null;
  setHookLines: (value: HookLineOption[] | null) => void;
  hookLine: HookLineOption | null;
  setHookLine: (value: HookLineOption | null) => void;
  /** The customer-placed rect; null = untouched (the clip's default). */
  rect: SafeRect | null;
  setRect: (rect: SafeRect | null) => void;
  onBack: () => void;
  onContinue: () => void;
  onFatal: (message: string) => void;
};

/**
 * Step 3, the hook studio: the chosen clip loops behind (a) the generated
 * hook-line options with free editing and (b) the placement editor seeded from
 * the admin-drawn safe area. What the preview shows is what the render burns —
 * shrink-to-fit live, a gentle note below the legibility floor, nothing blocks.
 * A saved edit creates a NEW hook-line script row (immutability, like the VO
 * script); the variant stores the final line id.
 */
export function StepHookStudio({
  businessId,
  hook,
  hookLines,
  setHookLines,
  hookLine,
  setHookLine,
  rect,
  setRect,
  onBack,
  onContinue,
  onFatal,
}: StepHookStudioProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"options" | "save" | null>(null);
  /** Local edit buffer — saved (as a new script row) only on continue. */
  const [editedText, setEditedText] = useState(hookLine?.text ?? "");

  const shownRect = resolveHookTextSafeArea(rect ?? undefined, hook.textSafeArea);
  const previewText = editedText.trim() || hookLine?.text || "";

  const measure = useHookLineMeasure();
  const belowFloor =
    previewText !== "" &&
    fittedFontSize(previewText, shownRect, measure) < HOOK_LINE_LEGIBLE_MIN_PX;

  async function generateOptions() {
    setError(null);
    setBusy("options");
    const result = await postJson<{ options: HookLineOption[] }>(
      `/api/businesses/${businessId}/hook-lines`,
    );
    setBusy(null);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setError(result.error);
    }
    setHookLines(result.body.options);
    setHookLine(null);
    setEditedText("");
  }

  // Options generate on entering the studio (they derive from the
  // questionnaire alone, so they never depend on the demo or the clip).
  useEffect(() => {
    if (hookLines === null) void generateOptions();
    // generateOptions reads only stable props; hookLines gates the one-shot.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function selectOption(option: HookLineOption) {
    setHookLine(option);
    setEditedText(option.text);
  }

  async function saveAndContinue() {
    if (!hookLine) return;
    const text = editedText.trim();
    setRect(shownRect);
    if (text === "" || text === hookLine.text) return onContinue();

    // Edited line -> a NEW immutable script row; the variant stores its id.
    setError(null);
    setBusy("save");
    const result = await postJson<{ scriptId: string; text: string }>(
      `/api/scripts/${hookLine.scriptId}/text`,
      { text },
    );
    setBusy(null);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setError(result.error);
    }
    setHookLine({ scriptId: result.body.scriptId, text: result.body.text, angle: hookLine.angle });
    onContinue();
  }

  return (
    <div>
      <StepHeader
        title="משפט הפתיחה והמיקום שלו"
        sub="בוחרים את המשפט שייצרב על הפתיח, מנסחים אותו חופשי — וקובעים איפה בדיוק הוא יושב."
        onBack={onBack}
      />

      <div className="mt-6 flex flex-col gap-5 sm:flex-row">
        {/* The clip loops with the live burned-text preview on top. */}
        <div className="mx-auto w-56 shrink-0 sm:mx-0">
          <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-white/10">
            <video
              src={hook.previewUrl}
              muted
              loop
              autoPlay
              playsInline
              className="absolute inset-0 size-full object-cover"
            />
            <PlacementEditor rect={shownRect} onChange={setRect} text={previewText} />
          </div>
          <p className="mt-1.5 text-[12px] text-gray-500">
            גוררים את המסגרת כדי להזיז את הטקסט, ומהפינות כדי לשנות גודל.
          </p>
          {belowFloor && (
            <p className="mt-1.5 text-[12px] text-amber-300/90">
              רק לתשומת לב — בגודל הזה הטקסט עלול להיות קשה לקריאה בטלפון. אפשר להגדיל את האזור או
              לקצר את המשפט.
            </p>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {hookLines === null && !error && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
              <Spinner /> כותבים משפטי פתיחה לפי שאלון העסק…
            </div>
          )}

          {hookLines !== null && (
            <div role="radiogroup" aria-label="בחירת משפט פתיחה" className="space-y-2">
              {hookLines.map((option) => (
                <button
                  key={option.scriptId}
                  type="button"
                  role="radio"
                  aria-checked={hookLine?.scriptId === option.scriptId}
                  onClick={() => selectOption(option)}
                  className={`w-full rounded-xl border px-4 py-3 text-start text-base transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    hookLine?.scriptId === option.scriptId
                      ? "border-accent bg-accent/10 text-white ring-1 ring-accent"
                      : "border-white/10 bg-white/5 text-gray-200 hover:border-white/25 hover:bg-white/[0.08]"
                  }`}
                >
                  {option.text}
                </button>
              ))}
            </div>
          )}

          {hookLine && (
            <div className="mt-4">
              <TextAreaField
                label="אפשר לערוך את המשפט חופשי"
                rows={2}
                value={editedText}
                onChange={(event) => setEditedText(event.target.value)}
              />
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300"
            >
              {error}
            </p>
          )}

          {hookLines !== null && (
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                size="lg"
                className="flex-1"
                disabled={!hookLine || previewText === "" || busy === "options"}
                loading={busy === "save"}
                onClick={() => void saveAndContinue()}
              >
                המשך
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="flex-1"
                loading={busy === "options"}
                disabled={busy === "save"}
                onClick={() => void generateOptions()}
              >
                צור אפשרויות חדשות
              </Button>
            </div>
          )}

          {hookLines === null && error && (
            <Button
              type="button"
              variant="secondary"
              className="mt-4"
              loading={busy === "options"}
              onClick={() => void generateOptions()}
            >
              נסה שוב
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
