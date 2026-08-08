"use client";

import { useState } from "react";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/field";
import { endingSentence, estimatedEnding } from "@/lib/service-a-ui";
import { countWords, needsTextSave, withEditedText, type ScriptState } from "@/lib/service-b-ui";
import { postJson } from "@/lib/use-api";

type StepAScriptProps = {
  businessId: string;
  demoId: string;
  /** For the seconds-only length heads-up (inverts the word-budget mapping). */
  demoDurationMs?: number;
  personaId: string;
  /** The chosen hook line — the VO opener escalates past it instead of repeating it. */
  hookLineText?: string;
  advantages: string[];
  selectedAdvantages: string[];
  setSelectedAdvantages: (value: string[]) => void;
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
 * Step 5, two parts: tick the advantages that actually appear in the footage,
 * then the VO script — generated from them, editable. Length is ADVISORY: a
 * longer script means a freeze/avatar ending, estimated here in seconds and
 * shown exactly in the shape display before anything renders. Nothing blocks.
 */
export function StepAScript({
  businessId,
  demoId,
  demoDurationMs,
  personaId,
  hookLineText,
  advantages,
  selectedAdvantages,
  setSelectedAdvantages,
  script,
  setScript,
  editedText,
  setEditedText,
  onBack,
  onContinue,
  onFatal,
}: StepAScriptProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"script" | "save" | null>(null);
  /** Within-step navigation: the script phase's back returns to the tick. */
  const [phase, setPhase] = useState<"advantages" | "script">(script ? "script" : "advantages");

  const words = countWords(editedText);
  // The only place the user can still change the script's length — name what
  // the current one points at: one of the three endings, or a narration that
  // stops before the footage does.
  const ending =
    script?.wordBudget !== undefined && demoDurationMs !== undefined
      ? estimatedEnding(words, demoDurationMs / 1000, script.wordBudget)
      : null;

  async function generateScript() {
    setError(null);
    setBusy("script");
    const result = await postJson<{ scriptId: string; text: string; wordBudget?: number }>(
      `/api/businesses/${businessId}/vo-script`,
      { demoId, personaId, selectedAdvantages, hookLineText },
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
    setPhase("script");
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
      return setError(result.error);
    }
    const latest = withEditedText(script, result.body);
    setScript(latest);
    onContinue(latest);
  }

  function toggleAdvantage(advantage: string) {
    setSelectedAdvantages(
      selectedAdvantages.includes(advantage)
        ? selectedAdvantages.filter((a) => a !== advantage)
        : [...selectedAdvantages, advantage],
    );
  }

  // Part 1: tick the advantages the VO script may narrate.
  if (phase === "advantages") {
    return (
      <div>
        <StepHeader
          title="תסריט הקריינות"
          sub="נכתוב תסריט לפי שאלון העסק — סמנו מה מהיתרונות באמת רואים בסרטון."
          onBack={onBack}
        />

        {advantages.length > 0 && (
          <fieldset className="mt-6">
            <legend className="text-sm font-medium text-gray-300">
              מה מהיתרונות באמת רואים בסרטון? (לתסריט הקריינות)
            </legend>
            <div className="mt-3 space-y-2">
              {advantages.map((advantage) => (
                <label
                  key={advantage}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-gray-200"
                >
                  <input
                    type="checkbox"
                    checked={selectedAdvantages.includes(advantage)}
                    onChange={() => toggleAdvantage(advantage)}
                    className="size-4 accent-accent"
                  />
                  {advantage}
                </label>
              ))}
            </div>
          </fieldset>
        )}

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
          loading={busy === "script"}
          onClick={() => {
            // An existing script (back navigation) is reused as-is.
            if (script) setPhase("script");
            else void generateScript();
          }}
        >
          {busy === "script" ? "כותבים את התסריט…" : "המשך לתסריט הקריינות"}
        </Button>
      </div>
    );
  }

  // Part 2: the VO script — edit freely; length is advisory.
  return (
    <div>
      <StepHeader
        title="תסריט הקריינות"
        sub="זה מה שיישמע מעל סרטון המוצר, מילה במילה."
        onBack={() => setPhase("advantages")}
      />

      <div className="mt-6">
        <TextAreaField
          label="התסריט"
          rows={7}
          value={editedText}
          onChange={(event) => setEditedText(event.target.value)}
        />
        <p className="mt-1.5 text-[13px] tabular-nums text-gray-500">{words} מילים</p>
        {ending && (
          // Amber marks "short" alone. A freeze or avatar ending is the normal
          // result of a script written to fill the demo — it is shaped, priced
          // and shown before anything renders — so flagging it would warn about
          // the working case and stay silent on the broken one.
          <p
            className={`mt-1.5 text-[13px] ${
              ending === "short" ? "text-amber-300/90" : "text-gray-500"
            }`}
          >
            {endingSentence(ending, false)}
          </p>
        )}
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
          disabled={countWords(editedText) === 0 || busy === "script"}
          onClick={() => void saveAndContinue()}
        >
          המשך להקלטה
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="flex-1"
          loading={busy === "script"}
          disabled={busy === "save"}
          onClick={() => void generateScript()}
        >
          צור מחדש
        </Button>
      </div>
    </div>
  );
}
