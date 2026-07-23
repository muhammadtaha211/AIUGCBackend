"use client";

import { useState } from "react";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/field";
import { OptionCard } from "@/components/ui/option-card";
import { countWords, needsTextSave, withEditedText, type ScriptState } from "@/lib/service-b-ui";
import { postJson } from "@/lib/use-api";

type StepScriptProps = {
  businessId: string;
  personaId: string;
  pointers: string;
  setPointers: (value: string) => void;
  duration: 15 | 30;
  setDuration: (value: 15 | 30) => void;
  script: ScriptState | null;
  setScript: (script: ScriptState | null) => void;
  editedText: string;
  setEditedText: (value: string) => void;
  onBack: () => void;
  /** Receives the LATEST script — a saved edit creates a new immutable row. */
  onContinue: (latest: ScriptState) => void;
  onFatal: (message: string) => void;
};

/** Step 3: generate the Hebrew script, edit it within the word budget. */
export function StepScript({
  businessId,
  personaId,
  pointers,
  setPointers,
  duration,
  setDuration,
  script,
  setScript,
  editedText,
  setEditedText,
  onBack,
  onContinue,
  onFatal,
}: StepScriptProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);

  const words = countWords(editedText);
  const overBudget = script?.wordBudget !== undefined && words > script.wordBudget;

  async function generate() {
    setError(null);
    setBusy("generate");
    const result = await postJson<{ scriptId: string; text: string; wordBudget?: number }>(
      `/api/businesses/${businessId}/scripts`,
      {
        personaId,
        durationPreset: duration,
        ...(pointers.trim() ? { pointers: pointers.trim() } : {}),
      },
    );
    setBusy(null);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setError(result.error);
    }
    setScript({
      scriptId: result.body.scriptId,
      text: result.body.text,
      wordBudget: result.body.wordBudget,
    });
    setEditedText(result.body.text);
  }

  async function saveAndContinue() {
    if (!script) return;
    if (!needsTextSave(script.text, editedText)) return onContinue(script);

    setError(null);
    setBusy("save");
    const result = await postJson<{ scriptId: string; text: string }>(
      `/api/scripts/${script.scriptId}/text`,
      { text: editedText },
    );
    setBusy(null);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setError(result.error); // includes the server-side word-budget 400
    }
    const latest = withEditedText(script, result.body);
    setScript(latest);
    onContinue(latest);
  }

  // Phase 1: no script yet — pointers + duration, then generate.
  if (script === null) {
    return (
      <div>
        <StepHeader
          title="מה הדמות צריכה להגיד?"
          sub="כמה מילים על מה חשוב להדגיש — ואנחנו נכתוב תסריט בעברית לפי שאלון העסק."
          onBack={onBack}
        />

        <div className="mt-6 space-y-6">
          <TextAreaField
            label="מה הדמות צריכה להגיד?"
            hint="לא חובה"
            rows={3}
            maxLength={500}
            placeholder="למשל: לפתוח עם המשלוח המהיר, להזכיר את ההנחה של החודש"
            value={pointers}
            onChange={(event) => setPointers(event.target.value)}
          />

          <div>
            <p className="mb-1.5 text-sm font-medium text-gray-200">אורך הסרטון</p>
            <div role="radiogroup" aria-label="אורך הסרטון" className="grid grid-cols-2 gap-3">
              <OptionCard
                title="15 שניות"
                description="קצר וקולע"
                selected={duration === 15}
                onSelect={() => setDuration(15)}
              />
              <OptionCard
                title="30 שניות"
                description="מקום להרחיב"
                selected={duration === 30}
                onSelect={() => setDuration(30)}
              />
            </div>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300"
          >
            {error}
          </p>
        )}

        <Button
          type="button"
          size="lg"
          className="mt-7 w-full"
          loading={busy === "generate"}
          onClick={() => void generate()}
        >
          {busy === "generate" ? "כותבים את התסריט…" : "צור תסריט"}
        </Button>
      </div>
    );
  }

  // Phase 2: edit within the budget.
  return (
    <div>
      <StepHeader
        title="התסריט מוכן — אפשר לערוך"
        sub="זה מה שהדמות תגיד, מילה במילה. שינוי גדול? אפשר גם ליצור תסריט חדש."
        onBack={onBack}
      />

      <div className="mt-6">
        <TextAreaField
          label="התסריט"
          rows={7}
          value={editedText}
          onChange={(event) => setEditedText(event.target.value)}
          error={
            overBudget ? `התסריט ארוך מדי — המקסימום הוא ${script.wordBudget} מילים.` : undefined
          }
        />
        <p
          className={`mt-1.5 text-[13px] tabular-nums ${overBudget ? "text-red-400" : "text-gray-500"}`}
        >
          {script.wordBudget !== undefined
            ? `${words} / ${script.wordBudget} מילים`
            : `${words} מילים`}
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          size="lg"
          className="flex-1"
          loading={busy === "save"}
          disabled={overBudget || countWords(editedText) === 0 || busy === "generate"}
          onClick={() => void saveAndContinue()}
        >
          המשך להקלטה
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="flex-1"
          loading={busy === "generate"}
          disabled={busy === "save"}
          onClick={() => void generate()}
        >
          צור מחדש
        </Button>
      </div>

      <button
        type="button"
        onClick={() => {
          setScript(null);
          setError(null);
        }}
        className="mt-4 w-full text-center text-sm text-gray-400 transition-colors duration-150 hover:text-white"
      >
        שינוי ההנחיות ויצירת תסריט חדש
      </button>
    </div>
  );
}
