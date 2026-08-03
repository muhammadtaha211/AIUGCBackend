"use client";

import { useState } from "react";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/field";
import type { HookLineOption } from "@/lib/service-a-ui";
import { countWords, needsTextSave, withEditedText, type ScriptState } from "@/lib/service-b-ui";
import { postJson } from "@/lib/use-api";

type StepAScriptProps = {
  businessId: string;
  demoId: string;
  personaId: string;
  advantages: string[];
  selectedAdvantages: string[];
  setSelectedAdvantages: (value: string[]) => void;
  hookLines: HookLineOption[] | null;
  setHookLines: (value: HookLineOption[] | null) => void;
  hookLine: HookLineOption | null;
  setHookLine: (value: HookLineOption | null) => void;
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
 * Step 4, two parts: pick the burned hook line (generated options), then the
 * VO script — generated from the ticked advantages, editable. The word budget
 * is ADVISORY here: a longer script means a freeze/avatar ending, shown in
 * the shape display before anything renders. Nothing blocks.
 */
export function StepAScript({
  businessId,
  demoId,
  personaId,
  advantages,
  selectedAdvantages,
  setSelectedAdvantages,
  hookLines,
  setHookLines,
  hookLine,
  setHookLine,
  script,
  setScript,
  editedText,
  setEditedText,
  onBack,
  onContinue,
  onFatal,
}: StepAScriptProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"hookLines" | "script" | "save" | null>(null);
  /** Within-step navigation: the script phase's back returns to the pick. */
  const [phase, setPhase] = useState<"pick" | "script">(hookLine && script ? "script" : "pick");

  const words = countWords(editedText);
  const overBudget = script?.wordBudget !== undefined && words > script.wordBudget;

  async function generateHookLines() {
    setError(null);
    setBusy("hookLines");
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
  }

  async function generateScript() {
    setError(null);
    setBusy("script");
    const result = await postJson<{ scriptId: string; text: string; wordBudget?: number }>(
      `/api/businesses/${businessId}/vo-script`,
      { demoId, personaId, selectedAdvantages },
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

  // Part 1: pick the hook line (and tick the advantages for the VO script).
  if (phase === "pick") {
    return (
      <div>
        <StepHeader
          title="משפט הפתיחה"
          sub="המשפט שייצרב על הפתיח — זה מה שעוצר את הגלילה."
          onBack={onBack}
        />

        {hookLines === null ? (
          <p className="mt-6 text-sm text-gray-400">
            ניצור כמה משפטי פתיחה לפי שאלון העסק — ותבחרו את החזק שבהם.
          </p>
        ) : (
          <div role="radiogroup" aria-label="בחירת משפט פתיחה" className="mt-6 space-y-2">
            {hookLines.map((option) => (
              <button
                key={option.scriptId}
                type="button"
                role="radio"
                aria-checked={hookLine?.scriptId === option.scriptId}
                onClick={() => setHookLine(option)}
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

        {advantages.length > 0 && (
          <fieldset className="mt-7">
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

        {hookLines === null ? (
          <Button
            type="button"
            size="lg"
            className="mt-7 w-full"
            loading={busy === "hookLines"}
            onClick={() => void generateHookLines()}
          >
            {busy === "hookLines" ? "כותבים משפטי פתיחה…" : "צור משפטי פתיחה"}
          </Button>
        ) : (
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              size="lg"
              className="flex-1"
              disabled={!hookLine || busy !== null}
              loading={busy === "script"}
              onClick={() => {
                // An existing script (back navigation) is reused as-is.
                if (script) setPhase("script");
                else void generateScript();
              }}
            >
              {busy === "script" ? "כותבים את התסריט…" : "המשך לתסריט הקריינות"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="flex-1"
              loading={busy === "hookLines"}
              disabled={busy === "script"}
              onClick={() => void generateHookLines()}
            >
              צור אפשרויות חדשות
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Part 2: the VO script — edit freely; length is advisory.
  return (
    <div>
      <StepHeader
        title="תסריט הקריינות"
        sub="זה מה שיישמע מעל סרטון המוצר, מילה במילה."
        onBack={() => setPhase("pick")}
      />

      <div className="mt-6">
        <TextAreaField
          label="התסריט"
          rows={7}
          value={editedText}
          onChange={(event) => setEditedText(event.target.value)}
        />
        <p className="mt-1.5 text-[13px] tabular-nums text-gray-500">
          {script?.wordBudget !== undefined
            ? `${words} / ${script.wordBudget} מילים`
            : `${words} מילים`}
        </p>
        {overBudget && (
          <p className="mt-1.5 text-[13px] text-amber-300/90">
            התסריט ארוך מסרטון המוצר — הסרטון יקבל סיום מתאים (תראו את המבנה המדויק לפני היצירה).
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
