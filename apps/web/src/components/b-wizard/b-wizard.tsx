"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  wizardSteps,
  type AudioState,
  type CompositeState,
  type Persona,
  type RenderState,
  type ScriptState,
  type WizardStep,
} from "@/lib/service-b-ui";
import { StepAudio } from "./step-audio";
import { StepComposite } from "./step-composite";
import { StepPersona } from "./step-persona";
import { StepRender } from "./step-render";
import { StepScript } from "./step-script";

const STEP_TITLES: Record<WizardStep, string> = {
  persona: "בחירת דמות",
  composite: "תמונת מוצר",
  script: "תסריט",
  audio: "הקלטה",
  render: "יצירת הסרטון",
};

type BWizardProps = {
  businessId: string;
  businessName: string;
  category: string;
};

/**
 * The Service B wizard: persona -> (product photo) -> script -> audio ->
 * render. State is client-side only — a refresh restarts the wizard. Back
 * navigation is allowed until the render is enqueued.
 */
export function BWizard({ businessId, businessName, category }: BWizardProps) {
  const steps = wizardSteps(category);
  const [stepIndex, setStepIndex] = useState(0);
  /** 403/404 from any call: the business/resource is gone for this session. */
  const [fatal, setFatal] = useState<string | null>(null);

  const [persona, setPersona] = useState<Persona | null>(null);
  const [composite, setComposite] = useState<CompositeState | null>(null);
  const [pointers, setPointers] = useState("");
  const [duration, setDuration] = useState<15 | 30>(15);
  const [script, setScript] = useState<ScriptState | null>(null);
  const [editedText, setEditedText] = useState("");
  const [audio, setAudio] = useState<AudioState | null>(null);
  const [render, setRender] = useState<RenderState | null>(null);

  const step = steps[stepIndex]!;
  const goBack = () => setStepIndex((index) => Math.max(0, index - 1));
  const goNext = () => setStepIndex((index) => Math.min(steps.length - 1, index + 1));

  /** A different persona invalidates everything generated for the previous one. */
  function selectPersona(next: Persona) {
    if (persona && persona.id !== next.id) {
      setComposite(null);
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
        <span className="font-medium text-gray-300">סרטון עם דמות AI — {businessName}</span>
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

          {step === "persona" && (
            <StepPersona
              selected={persona}
              onSelect={selectPersona}
              onContinue={goNext}
              onFatal={setFatal}
            />
          )}

          {step === "composite" && persona && (
            <StepComposite
              businessId={businessId}
              personaId={persona.id}
              composite={composite}
              setComposite={setComposite}
              onBack={goBack}
              onContinue={goNext}
              onFatal={setFatal}
            />
          )}

          {step === "script" && persona && (
            <StepScript
              businessId={businessId}
              personaId={persona.id}
              pointers={pointers}
              setPointers={setPointers}
              duration={duration}
              setDuration={setDuration}
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

          {step === "render" && persona && script && audio && (
            <StepRender
              businessId={businessId}
              personaId={persona.id}
              scriptId={script.scriptId}
              audioId={audio.id}
              compositeId={composite?.approved ? composite.id : undefined}
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
