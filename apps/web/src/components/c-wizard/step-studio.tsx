"use client";

import { useEffect, useState } from "react";
import { resolveHookTextSafeArea, type SafeRect } from "@aiugc/core/hook-geometry";
import {
  normalizeTextBlockText,
  textBlockSkeletonLabel,
  textBlockTextError,
} from "@aiugc/core/text-block";
import { PlacementEditor } from "@/components/a-wizard/placement-editor";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/field";
import { Spinner } from "@/components/ui/icons";
import {
  C_ANOTHER_TEXT,
  C_EARLIER_TEXTS,
  C_PLACEMENT_HINT,
  C_STUDIO_COPY,
  C_TEXT_LOADING,
  earlierTexts,
  isTextBlockDirty,
  retryableTextBlockFailure,
  textBlockCounter,
  textBlockDraft,
  withSavedText,
  withShownText,
  type TextBlockClip,
  type TextBlockOption,
} from "@/lib/service-c-ui";
import type { TextBlockNextResponse } from "@/lib/service-c";
import { postJson } from "@/lib/use-api";
import { TextBlockPreview } from "./text-block-preview";

type StepStudioProps = {
  businessId: string;
  clip: TextBlockClip;
  /** Every text served this session, in the order shown; the wizard owns it so
   *  back-nav and a clip change keep them (they are the speaker's, not the clip's). */
  texts: TextBlockOption[];
  setTexts: React.Dispatch<React.SetStateAction<TextBlockOption[]>>;
  /** The text on screen — the one the render burns. */
  pickId: string | null;
  setPickId: (scriptId: string | null) => void;
  /** Parent-owned gate for the next-text POST, A's hookGen pattern: the token
   *  of the flight in progress, or null. Survives this step unmounting and
   *  StrictMode's doubled mount effect; the wizard nulls it on a cross-gender
   *  character swap, which orphans the flight so its text is dropped. */
  textGen: { current: object | null };
  /** The same flight, as state — so continue stays disabled across a remount
   *  and a late text can never move the pick after the customer moved on. */
  textBusy: boolean;
  setTextBusy: (busy: boolean) => void;
  /** That flight's failure and quota state, owned by the wizard so a studio
   *  remounted while the flight was pending still sees how it ended. */
  failure: string | null;
  setFailure: (message: string | null) => void;
  quotaBlocked: boolean;
  setQuotaBlocked: (blocked: boolean) => void;
  /** The customer-placed rect; null = untouched (the clip's own area). */
  rect: SafeRect | null;
  setRect: (rect: SafeRect | null) => void;
  onBack: () => void;
  onContinue: () => void;
  onFatal: (message: string) => void;
};

/**
 * Step 3, the studio: one text at a time from the business's stored batch
 * (decision 0099, R2), free to edit, burned live over the looping clip inside
 * a box the customer moves and resizes. "Another text" serves the next stored
 * one; the model is called only when the stock is empty, server-side. An
 * edited text is saved on continue as a NEW script row, and its id is what
 * the render step sends.
 */
export function StepStudio({
  businessId,
  clip,
  texts,
  setTexts,
  pickId,
  setPickId,
  textGen,
  textBusy,
  setTextBusy,
  failure,
  setFailure,
  quotaBlocked,
  setQuotaBlocked,
  rect,
  setRect,
  onBack,
  onContinue,
  onFatal,
}: StepStudioProps) {
  /** The edit-save's own failure; a next-text failure is the wizard's `failure`. */
  const [saveError, setSaveError] = useState<string | null>(null);
  const error = saveError ?? failure;
  const [saving, setSaving] = useState(false);

  const pick = texts.find((text) => text.scriptId === pickId) ?? null;
  const draft = pick ? textBlockDraft(pick) : "";
  const textError = pick ? textBlockTextError(draft) : null;
  const shownRect = resolveHookTextSafeArea(rect ?? undefined, clip.textSafeArea);
  const previewText = normalizeTextBlockText(draft);
  const earlier = earlierTexts(texts, pickId);

  async function requestNext() {
    // One POST at a time; the gate lives in the wizard (see textGen).
    if (textGen.current) return;
    const flight = {};
    textGen.current = flight;
    setFailure(null);
    setSaveError(null);
    setTextBusy(true);
    const result = await postJson<TextBlockNextResponse>(
      `/api/businesses/${businessId}/text-blocks/next`,
      { clipId: clip.id },
    );
    // A cross-gender swap while this was pending orphaned it: the text is the
    // previous speaker's, so it never joins the list.
    if (textGen.current !== flight) return;
    textGen.current = null;
    setTextBusy(false);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      setQuotaBlocked(!retryableTextBlockFailure(result.status));
      return setFailure(result.error);
    }
    // Functional: this closure may outlive a remount that saw newer texts.
    setTexts((prev) => withShownText(prev, result.body));
    setPickId(result.body.scriptId);
  }

  // The first text is served on entering the studio; returning keeps the list.
  useEffect(() => {
    if (texts.length === 0) void requestNext();
    // requestNext reads only stable props; the wizard's gate makes the
    // one-shot safe to double-invoke.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function setDraft(value: string) {
    setTexts((prev) =>
      prev.map((text) => (text.scriptId === pickId ? { ...text, draft: value } : text)),
    );
  }

  async function saveAndContinue() {
    if (!pick) return;
    setRect(shownRect);
    if (!isTextBlockDirty(pick)) return onContinue();

    // Edited text -> a NEW immutable script row; the render sends its id.
    setSaveError(null);
    setSaving(true);
    const result = await postJson<{ scriptId: string; text: string }>(
      `/api/scripts/${pick.scriptId}/text`,
      { text: draft },
    );
    setSaving(false);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setSaveError(result.error);
    }
    setTexts((prev) => withSavedText(prev, pick.scriptId, result.body));
    setPickId(result.body.scriptId);
    onContinue();
  }

  return (
    <div>
      <StepHeader title={C_STUDIO_COPY.title} sub={C_STUDIO_COPY.sub} onBack={onBack} />

      <div className="mt-6 flex flex-col gap-5 sm:flex-row">
        {/* The clip loops with the live burned-block preview on top. */}
        <div className="mx-auto w-56 shrink-0 sm:mx-0">
          <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-ink/10">
            <video
              src={clip.previewUrl}
              muted
              loop
              autoPlay
              playsInline
              className="absolute inset-0 size-full object-cover"
            />
            <PlacementEditor
              rect={shownRect}
              onChange={setRect}
              text={previewText}
              textColor={clip.textColor}
            >
              <TextBlockPreview text={previewText} rect={shownRect} textColor={clip.textColor} />
            </PlacementEditor>
          </div>
          <p className="mt-1.5 text-[12px] text-ink/55">{C_PLACEMENT_HINT}</p>
        </div>

        <div className="min-w-0 flex-1">
          {pick === null && !error && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink/55">
              <Spinner /> {C_TEXT_LOADING}
            </div>
          )}

          {pick && (
            <TextAreaField
              label={textBlockSkeletonLabel(pick.skeleton)}
              hint={textBlockCounter(draft)}
              error={textError ?? undefined}
              rows={9}
              disabled={saving}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}

          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
              {error}
            </p>
          )}

          {pick && (
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                size="lg"
                className="flex-1"
                disabled={textError !== null || textBusy}
                loading={saving}
                onClick={() => void saveAndContinue()}
              >
                המשך
              </Button>
              {!quotaBlocked && (
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="flex-1"
                  loading={textBusy}
                  disabled={saving}
                  onClick={() => void requestNext()}
                >
                  {C_ANOTHER_TEXT}
                </Button>
              )}
            </div>
          )}

          {pick === null && error && !quotaBlocked && (
            <Button
              type="button"
              variant="secondary"
              className="mt-4"
              loading={textBusy}
              onClick={() => void requestNext()}
            >
              נסה שוב
            </Button>
          )}

          {earlier.length > 0 && (
            <div className="mt-7">
              <p className="text-[12px] text-ink/60">{C_EARLIER_TEXTS}</p>
              {/* Picking one puts it back in the editor above, with its draft. */}
              <div className="mt-2 space-y-2">
                {earlier.map((text) => (
                  <button
                    key={text.scriptId}
                    type="button"
                    disabled={saving}
                    onClick={() => setPickId(text.scriptId)}
                    className="w-full rounded-xl border border-ink/[0.08] bg-white px-4 py-3 text-start transition-colors duration-150 hover:border-ink/25 hover:bg-ink/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  >
                    <span className="block text-[12px] text-ink/55">
                      {textBlockSkeletonLabel(text.skeleton)}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-sm text-ink/80">
                      {textBlockDraft(text)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
