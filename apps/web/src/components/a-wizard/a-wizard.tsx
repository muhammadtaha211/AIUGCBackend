"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StepAudio } from "@/components/b-wizard/step-audio";
import { StepPersona } from "@/components/b-wizard/step-persona";
import {
  A_WIZARD_STEPS,
  type AWizardStep,
  type DemoState,
  type HookClip,
  type HookLineOption,
} from "@/lib/service-a-ui";
import type { AudioState, Persona, RenderState, ScriptState } from "@/lib/service-b-ui";
import { StepDemo } from "./step-demo";
import { StepHook } from "./step-hook";
import { StepARender } from "./step-render";
import { StepAScript } from "./step-script";

const STEP_TITLES: Record<AWizardStep, string> = {
  demo: "סרטון המוצר",
  hook: "בחירת פתיח",
  persona: "בחירת דמות",
  script: "משפט פתיחה ותסריט",
  audio: "הקלטה",
  render: "יצירת הסרטון",
};

type AWizardProps = {
  businessId: string;
  businessName: string;
  /** Questionnaire advantages — the VO script derives from the ticked ones. */
  advantages: string[];
};

/**
 * The Service A wizard: demo upload -> hook clip -> persona -> hook line +
 * VO script -> audio approval (hard gate) -> advisory shape + render.
 * Single variant — the grid stays CLI-only. State is client-side only; a
 * refresh restarts the wizard. Persona and audio steps are shared with B.
 */
export function AWizard({ businessId, businessName, advantages }: AWizardProps) {
  const steps = A_WIZARD_STEPS;
  const [stepIndex, setStepIndex] = useState(0);
  /** 403/404 from any call: the business/resource is gone for this session. */
  const [fatal, setFatal] = useState<string | null>(null);

  const [demo, setDemo] = useState<DemoState | null>(null);
  const [hook, setHook] = useState<HookClip | null>(null);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [selectedAdvantages, setSelectedAdvantages] = useState<string[]>(advantages);
  const [hookLines, setHookLines] = useState<HookLineOption[] | null>(null);
  const [hookLine, setHookLine] = useState<HookLineOption | null>(null);
  const [script, setScript] = useState<ScriptState | null>(null);
  const [editedText, setEditedText] = useState("");
  const [audio, setAudio] = useState<AudioState | null>(null);
  const [render, setRender] = useState<RenderState | null>(null);

  const step = steps[stepIndex]!;
  const goBack = () => setStepIndex((index) => Math.max(0, index - 1));
  const goNext = () => setStepIndex((index) => Math.min(steps.length - 1, index + 1));

  /** A different demo invalidates the VO script (word budget) and its audio. */
  function replaceDemo(next: DemoState | null) {
    if (demo && next?.id !== demo.id) {
      setScript(null);
      setEditedText("");
      setAudio(null);
    }
    setDemo(next);
  }

  /**
   * A different persona invalidates the VO script and audio (the voice
   * changed). Hook-line options derive from the questionnaire and survive.
   */
  function selectPersona(next: Persona) {
    if (persona && persona.id !== next.id) {
      setScript(null);
      setEditedText("");
      setAudio(null);
    }
    setPersona(next);
  }

  /** Leaving the script step: later steps must use the latest scriptId only. */
  function continueFromScript(latest: ScriptState) {
    if (audio && audio.scriptId !== latest.scriptId) setAudio(null);
    goNext();
  }

  if (fatal) {
    return (
      <div className="w-full max-w-2xl pt-6 sm:pt-10">
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-center sm:p-10">
          <p className="text-base font-medium text-white">{fatal}</p>
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
    <div className="w-full max-w-2xl pt-6 sm:pt-10">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-gray-300">הוק + דמו — {businessName}</span>
        <span dir="ltr" className="tabular-nums text-gray-500">
          {stepIndex + 1}/{steps.length}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
          style={{ width: `${Math.round(((stepIndex + 1) / steps.length) * 100)}%` }}
        />
      </div>

      <div key={stepIndex} className="step-in mt-5">
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 sm:p-10">
          <h1 className="sr-only">{STEP_TITLES[step]}</h1>

          {step === "demo" && (
            <StepDemo
              businessId={businessId}
              demo={demo}
              setDemo={replaceDemo}
              onContinue={goNext}
              onFatal={setFatal}
            />
          )}

          {step === "hook" && (
            <StepHook
              selected={hook}
              onSelect={setHook}
              onBack={goBack}
              onContinue={goNext}
              onFatal={setFatal}
            />
          )}

          {step === "persona" && (
            <StepPersona
              selected={persona}
              onSelect={selectPersona}
              onContinue={goNext}
              onFatal={setFatal}
            />
          )}

          {step === "script" && demo && persona && (
            <StepAScript
              businessId={businessId}
              demoId={demo.id}
              personaId={persona.id}
              advantages={advantages}
              selectedAdvantages={selectedAdvantages}
              setSelectedAdvantages={setSelectedAdvantages}
              hookLines={hookLines}
              setHookLines={setHookLines}
              hookLine={hookLine}
              setHookLine={setHookLine}
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
              onBack={goBack}
              onContinue={goNext}
              onFatal={setFatal}
            />
          )}

          {step === "render" && demo && hook && persona && hookLine && script && audio && (
            <StepARender
              businessId={businessId}
              demoId={demo.id}
              hookClipId={hook.id}
              hookLineScriptId={hookLine.scriptId}
              audioId={audio.id}
              personaId={persona.id}
              render={render}
              setRender={setRender}
              onBack={goBack}
              onFatal={setFatal}
            />
          )}
        </div>
      </div>
    </div>
  );
}
