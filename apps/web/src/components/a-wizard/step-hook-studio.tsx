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
import { HOOK_LINE_CHOSEN_LABEL, HOOK_LINE_OTHERS_LABEL } from "@/lib/quote-ui";
import {
  hookHalfOptions,
  type HookBatch,
  type HookClip,
  type HookLineOption,
} from "@/lib/service-a-ui";
import { postJson } from "@/lib/use-api";
import { PlacementEditor, fittedFontSize, useHookLineMeasure } from "./placement-editor";

type StepHookStudioProps = {
  businessId: string;
  /** The speaker — hook lines are written in this persona's first person.
   *  The wizard always holds one by the time this step mounts (persona-first
   *  flow); the line stays freely editable here. */
  personaId: string;
  hook: HookClip;
  hookBatch: HookBatch | null;
  setHookBatch: (value: HookBatch | null) => void;
  /** Parent-owned gate for the paid generation POST: the token of the flight
   *  in progress, or null. Survives this component unmounting (back-nav) and
   *  StrictMode's doubled mount effect; the parent nulls it on a cross-gender
   *  persona swap, which orphans the flight so its result is dropped. */
  hookGen: { current: object | null };
  hookHalf: 0 | 1;
  setHookHalf: (value: 0 | 1) => void;
  hookAvoid: string[];
  setHookAvoid: (value: string[]) => void;
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
 *
 * One generation writes ten frames; five show at a time. The first reroll flips
 * to the complementary five for free, the next mints a new batch with `avoid`.
 * The customer is never told which is which — one button, one label.
 */
export function StepHookStudio({
  businessId,
  personaId,
  hook,
  hookBatch,
  setHookBatch,
  hookGen,
  hookHalf,
  setHookHalf,
  hookAvoid,
  setHookAvoid,
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

  /** The five on screen, and the pick when a reroll has moved it out of them. */
  const shown = hookBatch ? hookHalfOptions(hookBatch, hookHalf) : null;
  const pinned =
    hookLine && shown && !shown.some((option) => option.scriptId === hookLine.scriptId)
      ? hookLine
      : null;

  async function generateOptions() {
    // One paid POST at a time. The gate lives in the parent, so a StrictMode
    // re-run of the mount effect — or a real unmount/remount while the call
    // is pending — sees the flight instead of starting a second one.
    if (hookGen.current) return;
    const flight = {};
    hookGen.current = flight;
    setError(null);
    setBusy("options");
    const result = await postJson<{ options: HookLineOption[] }>(
      `/api/businesses/${businessId}/hook-lines`,
      { personaId, avoid: hookAvoid },
    );
    // A cross-gender persona swap while this was pending orphaned the flight
    // (and may have started another): these lines are the previous speaker's
    // first person, so they never reach the batch.
    if (hookGen.current !== flight) return;
    hookGen.current = null;
    setBusy(null);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setError(result.error);
    }
    // Selection survives a new batch: the pick is a persisted script row and
    // still renders. Clearing it would silently discard a deliberate choice.
    setHookBatch({ options: result.body.options, parity: Math.random() < 0.5 ? 1 : 0 });
    setHookHalf(0);
    setHookAvoid([...result.body.options.map((option) => option.text), ...hookAvoid].slice(0, 20));
  }

  /**
   * One button, one label. The first press flips to the five we already paid
   * for; the next one buys a fresh batch that avoids everything shown so far.
   */
  function reroll() {
    if (hookBatch && hookHalf === 0) return setHookHalf(1);
    void generateOptions();
  }

  // Options generate on entering the studio (they derive from the
  // questionnaire and the speaker's gender, never from the demo or the clip).
  useEffect(() => {
    if (hookBatch === null) void generateOptions();
    // generateOptions reads only stable props; hookBatch + the parent's
    // in-flight gate make the one-shot safe to double-invoke.
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
        sub="בוחרים את המשפט שייצרב על הפתיח, מנסחים אותו חופשי, וקובעים איפה בדיוק הוא יושב."
        onBack={onBack}
      />

      <div className="mt-6 flex flex-col gap-5 sm:flex-row">
        {/* The clip loops with the live burned-text preview on top. */}
        <div className="mx-auto w-56 shrink-0 sm:mx-0">
          <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-ink/10">
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
          <p className="mt-1.5 text-[12px] text-ink/55">
            גוררים את המסגרת כדי להזיז את הטקסט, ומהפינות כדי לשנות גודל.
          </p>
          {belowFloor && (
            <p className="mt-1.5 text-[12px] text-amber-300/90">
              רק לתשומת לב, בגודל הזה הטקסט עלול להיות קשה לקריאה בטלפון. אפשר להגדיל את האזור או
              לקצר את המשפט.
            </p>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {shown === null && !error && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink/55">
              <Spinner /> כותבים משפטי פתיחה לפי שאלון העסק…
            </div>
          )}

          {shown !== null && (
            <div role="radiogroup" aria-label="בחירת משפט פתיחה" className="space-y-2">
              {/* A reroll can move the chosen line off screen. Pin it at the
                  top rather than showing nothing selected — it is still what
                  the render burns, and it stays clickable and checked. */}
              {pinned && (
                <>
                  <p className="text-[12px] text-ink/60">{HOOK_LINE_CHOSEN_LABEL}</p>
                  <OptionButton option={pinned} selected onSelect={selectOption} />
                  <p className="pt-2 text-[12px] text-ink/60">{HOOK_LINE_OTHERS_LABEL}</p>
                </>
              )}
              {shown.map((option) => (
                <OptionButton
                  key={option.scriptId}
                  option={option}
                  selected={hookLine?.scriptId === option.scriptId}
                  onSelect={selectOption}
                />
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
            <p role="alert" className="mt-4 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
              {error}
            </p>
          )}

          {shown !== null && (
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
                onClick={reroll}
              >
                צור אפשרויות חדשות
              </Button>
            </div>
          )}

          {shown === null && error && (
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

/** One selectable line. Two call sites (the pinned pick and the five). */
function OptionButton({
  option,
  selected,
  onSelect,
}: {
  option: HookLineOption;
  selected: boolean;
  onSelect: (option: HookLineOption) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(option)}
      className={`w-full rounded-xl border px-4 py-3 text-start text-base transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
        selected
          ? "border-accent bg-accent/10 text-ink ring-1 ring-accent"
          : "border-ink/[0.08] bg-white text-ink/80 hover:border-ink/25 hover:bg-ink/[0.06]"
      }`}
    >
      {option.text}
    </button>
  );
}
