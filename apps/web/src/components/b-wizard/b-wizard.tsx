"use client";

import { useState } from "react";
import Link from "next/link";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { WizardNav } from "@/components/wizard-nav";
import {
  pointersChanged,
  wizardSteps,
  type AudioState,
  type Persona,
  type RenderState,
  type ScriptState,
  type WizardStep,
} from "@/lib/service-b-ui";
import { StepAudio } from "./step-audio";
import { StepPersona } from "./step-persona";
import { StepPointers } from "./step-pointers";
import { StepRender } from "./step-render";
import { StepScript } from "./step-script";

const STEP_TITLES: Record<WizardStep, string> = {
  persona: "בחירת דמות",
  pointers: "מה הדמות אומרת?",
  script: "תסריט",
  audio: "הקלטה",
  effect: "אפקט פתיחה",
  render: "יצירת הסרטון",
};

type BWizardProps = {
  businessId: string;
  businessName: string;
  /** Catalog server-rendered by the page shell — undefined falls back to the
   *  mount fetch (and its retry UI) via /api/personas. */
  initialCatalog?: Persona[];
};

/**
 * The Service B wizard: persona -> pointers -> script -> audio -> opener
 * effect -> render (vault 0017). Single setting: the persona's selfie is the
 * render source, so there is no image step and no product step. State is
 * client-side only — a refresh restarts the wizard. Back navigation is
 * allowed until the render is enqueued.
 */
export function BWizard({ businessId, businessName, initialCatalog }: BWizardProps) {
  const steps = wizardSteps();
  const [stepIndex, setStepIndex] = useState(0);
  /** 403/404 from any call: the business/resource is gone for this session. */
  const [fatal, setFatal] = useState<string | null>(null);

  /** The persona catalog, cached here so re-entering the step skips the fetch. */
  const [personaCatalog, setPersonaCatalog] = useState<Persona[] | null>(initialCatalog ?? null);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [pointers, setPointers] = useState("");
  // 30s is not offered. The original reason — its word budget could produce audio
  // past InfiniteTalk's frame ceiling, failing after the customer paid for TTS —
  // is spent: HeyGen generates to the audio's length with no frame-count parameter
  // (docs/04-integrations.md §HeyGen). 30s stays off pending a founder decision,
  // not because it would fail. Do not re-enable it as a cleanup — see
  // docs/vault/decisions/0017-service-b-single-setting-selfie-talking-head.md.
  const duration = 15;
  const [script, setScript] = useState<ScriptState | null>(null);
  const [editedText, setEditedText] = useState("");
  const [audio, setAudio] = useState<AudioState | null>(null);
  const [render, setRender] = useState<RenderState | null>(null);

  const step = steps[stepIndex]!;
  const goBack = () => setStepIndex((index) => Math.max(0, index - 1));
  const goNext = () => setStepIndex((index) => Math.min(steps.length - 1, index + 1));
  /** Rail jump — backwards only. */
  const jumpTo = (index: number) => {
    if (index < stepIndex) setStepIndex(index);
  };

  /** Everything generated for the previous persona is that persona's — drop it. */
  function discardScript() {
    setScript(null);
    setEditedText("");
    setAudio(null);
  }

  /** A different persona invalidates everything generated for the previous one. */
  function selectPersona(next: Persona) {
    if (persona && persona.id !== next.id) discardScript();
    setPersona(next);
  }

  /** Leaving the pointers step: a changed brief means the held script is stale. */
  function continueFromPointers() {
    if (script && pointersChanged(script, pointers)) discardScript();
    goNext();
  }

  /** Leaving the script step: later steps must use the latest scriptId only. */
  function continueFromScript(latest: ScriptState) {
    if (audio && audio.scriptId !== latest.scriptId) setAudio(null);
    goNext();
  }

  /**
   * The audio step resolved the spoken script through audio_renders.script_id
   * and it isn't the one we were carrying. Take it whole — B posts this
   * scriptId to the render, so a stale one would caption a different script
   * than the voice speaks. The pointers it was written from are unknown to the
   * server; keep ours so the pointers step does not read the swap as an edit.
   */
  function adoptResolvedScript(resolved: ScriptState) {
    setScript({ ...resolved, pointers: script?.pointers });
    setEditedText(resolved.text);
  }

  if (fatal) {
    return (
      <div className="w-full max-w-2xl pt-6 sm:pt-10">
        <div className="rounded-xl border border-ink/[0.08] bg-white p-6 shadow-xl shadow-ink/[0.05] text-center sm:p-10">
          <p className="text-base font-medium text-ink">{fatal}</p>
          <Link href="/home" className="mt-6 inline-block">
            <Button type="button" variant="secondary">
              חזרה לדף הבית
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl pt-6 sm:pt-10 lg:max-w-4xl">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight text-ink">סרטון עם דמות AI</h1>
        <span className="truncate text-sm text-ink/60">{businessName}</span>
      </div>

      <div className="mt-4 lg:grid lg:grid-cols-[10.5rem_1fr] lg:items-start lg:gap-8">
        <WizardNav
          labels={steps.map((each) => STEP_TITLES[each])}
          current={stepIndex}
          onJump={jumpTo}
          locked={render !== null}
        />

        <div key={stepIndex} className="step-in mt-5 lg:mt-0">
          <div className="rounded-xl border border-ink/[0.08] bg-white p-6 shadow-xl shadow-ink/[0.05] sm:p-10">
            {step === "persona" && (
              <StepPersona
                catalog={personaCatalog}
                setCatalog={setPersonaCatalog}
                selected={persona}
                onSelect={selectPersona}
                onContinue={goNext}
                onFatal={setFatal}
              />
            )}

            {step === "pointers" && persona && (
              <StepPointers
                pointers={pointers}
                setPointers={setPointers}
                onBack={goBack}
                onContinue={continueFromPointers}
              />
            )}

            {step === "script" && persona && (
              <StepScript
                businessId={businessId}
                personaId={persona.id}
                pointers={pointers}
                duration={duration}
                script={script}
                setScript={setScript}
                editedText={editedText}
                setEditedText={setEditedText}
                onBack={goBack}
                onContinue={continueFromScript}
                onFatal={setFatal}
              />
            )}

            {step === "audio" && script && (
              <StepAudio
                script={script}
                audio={audio}
                setAudio={setAudio}
                onScriptResolved={adoptResolvedScript}
                onBack={goBack}
                onContinue={goNext}
                onFatal={setFatal}
              />
            )}

            {/* Placeholder until StepEffect lands (step 3 of this series):
                no opener is offered, so the render goes without one. */}
            {step === "effect" && (
              <div>
                <StepHeader title={STEP_TITLES.effect} onBack={goBack} />
                <Button type="button" size="lg" className="mt-7 w-full" onClick={goNext}>
                  המשך בלי אפקט
                </Button>
              </div>
            )}

            {step === "render" && persona && script && audio && (
              <StepRender
                businessId={businessId}
                personaId={persona.id}
                scriptId={script.scriptId}
                audioId={audio.id}
                render={render}
                setRender={setRender}
                onBack={goBack}
                onFatal={setFatal}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
