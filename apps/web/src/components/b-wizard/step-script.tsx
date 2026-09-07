"use client";

import { useState } from "react";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/field";
import {
  countWords,
  estimateSpokenSeconds,
  needsTextSave,
  withEditedText,
  type ScriptState,
} from "@/lib/service-b-ui";
import { postJson } from "@/lib/use-api";

type StepScriptProps = {
  businessId: string;
  personaId: string;
  /** The brief from the pointers step — posted with the generation, shown as a recap. */
  pointers: string;
  /** Only 15s ships — see the duration note in b-wizard.tsx. */
  duration: 15;
  script: ScriptState | null;
  setScript: (script: ScriptState | null) => void;
  editedText: string;
  setEditedText: (value: string) => void;
  onBack: () => void;
  /** Receives the LATEST script — a saved edit creates a new immutable row. */
  onContinue: (latest: ScriptState) => void;
  onFatal: (message: string) => void;
};

/**
 * Step 3: generate the Hebrew script and edit it freely — length is advisory
 * here, not enforced. The generation is an explicit click, not a mount effect
 * — the pointers step leads here, and a paid call on navigation would be
 * spent by every back-and-forth. The response also carries the draft
 * on-screen hook text, which this step keeps in state for the effect step and
 * does not display.
 */
export function StepScript({
  businessId,
  personaId,
  pointers,
  duration,
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
  // Advisory, never a wall: the word budget is the target the script was
  // written to, not a cap. A longer script is a longer ad — HeyGen generates
  // to the audio, and the render is priced per audio second — so the useful
  // thing to show is the length itself, in the spirit of Service A's ending
  // advisory. Whole seconds; the exact number arrives with the recording.
  //
  // Nothing is said below two seconds. One or two typed words are not a
  // script yet, "בערך 0 שניות" is absurd, and 1 would need שנייה rather than
  // the fixed plural שניות — Service A's identical sentence never reaches
  // those values, so this is where the floor has to be explicit.
  const rounded =
    script?.wordBudget !== undefined
      ? Math.round(estimateSpokenSeconds(words, duration, script.wordBudget))
      : 0;
  const projectedSeconds = rounded >= 2 ? rounded : null;

  async function generate() {
    setError(null);
    setBusy("generate");
    const brief = pointers.trim();
    const result = await postJson<{
      scriptId: string;
      text: string;
      wordBudget?: number;
      hookText?: string;
    }>(`/api/businesses/${businessId}/scripts`, {
      personaId,
      durationPreset: duration,
      ...(brief ? { pointers: brief } : {}),
    });
    setBusy(null);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setError(result.error);
    }
    setScript({
      scriptId: result.body.scriptId,
      text: result.body.text,
      wordBudget: result.body.wordBudget,
      hookText: result.body.hookText,
      pointers: brief,
    });
    setEditedText(result.body.text);
  }

  async function saveAndContinue() {
    if (!script) return;
    if (!needsTextSave(script.text, editedText)) return onContinue(script);

    setError(null);
    setBusy("save");
    const result = await postJson<{ scriptId: string; text: string; hookText?: string }>(
      `/api/scripts/${script.scriptId}/text`,
      { text: editedText },
    );
    setBusy(null);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setError(result.error); // includes the server-side runaway-guard 400
    }
    const latest = withEditedText(script, result.body);
    setScript(latest);
    onContinue(latest);
  }

  // Phase 1: no script yet — the brief as a recap, then generate on click.
  if (script === null) {
    return (
      <div>
        <StepHeader
          title="התסריט"
          sub="נכתוב תסריט בעברית לפי שאלון העסק וההנחיות שלכם. אפשר לערוך אותו אחר כך."
          onBack={onBack}
        />

        {pointers.trim() && (
          <div className="mt-6 rounded-xl border border-ink/[0.08] bg-white px-5 py-4">
            <p className="text-[13px] text-ink/55">ההנחיות שלכם</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink/80">
              {pointers.trim()}
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-6 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
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

  // Phase 2: edit, with the projected length alongside.
  return (
    <div>
      <StepHeader
        title="התסריט מוכן, אפשר לערוך"
        sub="זה מה שהדמות תגיד, מילה במילה. שינוי גדול? אפשר גם ליצור תסריט חדש."
        onBack={onBack}
      />

      <div className="mt-6">
        <TextAreaField
          label="התסריט"
          rows={7}
          value={editedText}
          onChange={(event) => setEditedText(event.target.value)}
        />
        <p className="mt-1.5 text-[13px] tabular-nums text-ink/55">{words} מילים</p>
        {projectedSeconds !== null && (
          <p className="mt-1.5 text-[13px] text-ink/55">
            לפי האורך הנוכחי, הסרטון יימשך בערך {projectedSeconds} שניות.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          size="lg"
          className="flex-1"
          loading={busy === "save"}
          disabled={countWords(editedText) === 0 || busy === "generate"}
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
    </div>
  );
}
