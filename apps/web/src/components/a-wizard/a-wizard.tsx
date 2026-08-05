"use client";

import { useState } from "react";
import Link from "next/link";
import type { SafeRect } from "@aiugc/core/hook-geometry";
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
import { StepHookStudio } from "./step-hook-studio";
import { StepARender } from "./step-render";
import { StepAScript } from "./step-script";

const STEP_TITLES: Record<AWizardStep, string> = {
  persona: "בחירת דמות",
  hook: "בחירת קליפ פתיחה",
  hookStudio: "משפט הפתיחה והמיקום",
  demo: "סרטון המוצר",
  script: "תסריט הקריינות",
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
 * The Service A wizard: persona -> hook gallery (persona-filtered) -> hook
 * studio (line + placement) -> demo upload (+ optional footage note) -> VO
 * script -> audio approval (hard gate) -> advisory shape + render.
 * Single variant — the grid stays CLI-only. State is client-side only; a
 * refresh restarts the wizard. Persona and audio steps are shared with B.
 */
export function AWizard({ businessId, businessName, advantages }: AWizardProps) {
  const steps = A_WIZARD_STEPS;
  const [stepIndex, setStepIndex] = useState(0);
  /** 403/404 from any call: the business/resource is gone for this session. */
  const [fatal, setFatal] = useState<string | null>(null);

  const [persona, setPersona] = useState<Persona | null>(null);
  const [hook, setHook] = useState<HookClip | null>(null);
  const [hookLines, setHookLines] = useState<HookLineOption[] | null>(null);
  const [hookLine, setHookLine] = useState<HookLineOption | null>(null);
  /** Customer-placed hook-line rect; null = the clip's default safe area. */
  const [rect, setRect] = useState<SafeRect | null>(null);
  const [demo, setDemo] = useState<DemoState | null>(null);
  const [demoDescription, setDemoDescription] = useState("");
  const [selectedAdvantages, setSelectedAdvantages] = useState<string[]>(advantages);
  const [script, setScript] = useState<ScriptState | null>(null);
  const [editedText, setEditedText] = useState("");
  const [audio, setAudio] = useState<AudioState | null>(null);
  const [render, setRender] = useState<RenderState | null>(null);

  const step = steps[stepIndex]!;
  const goBack = () => setStepIndex((index) => Math.max(0, index - 1));
  const goNext = () => setStepIndex((index) => Math.min(steps.length - 1, index + 1));

  /**
   * A different persona invalidates the VO script and audio (the voice
   * changed) and a persona-swapped hook clip that belonged to the old persona
   * (it is not in the new persona's gallery). Generic clips and the hook-line
   * options survive — they derive from the questionnaire alone.
   */
  function selectPersona(next: Persona) {
    if (persona && persona.id !== next.id) {
      setScript(null);
      setEditedText("");
      setAudio(null);
      if (hook?.personaId && hook.personaId !== next.id) {
        setHook(null);
        setRect(null);
      }
    }
    setPersona(next);
  }

  /** A different clip re-seeds the placement editor from ITS default rect. */
  function selectHook(next: HookClip) {
    if (hook && hook.id !== next.id) setRect(null);
    setHook(next);
  }

  /** A different demo invalidates the VO script (word budget) and its audio. */
  function replaceDemo(next: DemoState | null) {
    if (demo && next?.id !== demo.id) {
      setScript(null);
      setEditedText("");
      setAudio(null);
    }
    setDemo(next);
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

      <StructureStrip persona={persona} hook={hook} demo={demo} />

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

          {step === "hook" && persona && (
            <StepHook
              personaId={persona.id}
              selected={hook}
              onSelect={selectHook}
              onBack={goBack}
              onContinue={goNext}
              onFatal={setFatal}
            />
          )}

          {step === "hookStudio" && hook && (
            <StepHookStudio
              businessId={businessId}
              hook={hook}
              hookLines={hookLines}
              setHookLines={setHookLines}
              hookLine={hookLine}
              setHookLine={setHookLine}
              rect={rect}
              setRect={setRect}
              onBack={goBack}
              onContinue={goNext}
              onFatal={setFatal}
            />
          )}

          {step === "demo" && (
            <StepDemo
              businessId={businessId}
              demo={demo}
              setDemo={replaceDemo}
              description={demoDescription}
              setDescription={setDemoDescription}
              onContinue={goNext}
              onFatal={setFatal}
            />
          )}

          {step === "script" && demo && persona && (
            <StepAScript
              businessId={businessId}
              demoId={demo.id}
              demoDurationMs={demo.durationMs}
              personaId={persona.id}
              advantages={advantages}
              selectedAdvantages={selectedAdvantages}
              setSelectedAdvantages={setSelectedAdvantages}
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
              approveContinueLabel="מאשרים וממשיכים ליצירת הסרטון"
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
              textSafeArea={rect ?? undefined}
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

/**
 * The structure strip: the fixed three-part shape of every Service A ad —
 * פתיח | הדמו שלכם | סיום עם הדמות — populating live as choices land, so the
 * customer always sees what they are building. The persona face sits in the
 * ending slot from step 1: the chosen character narrates and closes the video.
 * The strip is a temporal axis, not text — timelines run left→right even in
 * RTL locales, so the container is forced LTR (hook far left); the Hebrew
 * labels inside stay RTL.
 */
function StructureStrip({
  persona,
  hook,
  demo,
}: {
  persona: Persona | null;
  hook: HookClip | null;
  demo: DemoState | null;
}) {
  return (
    <div dir="ltr" className="mt-4 grid grid-cols-3 gap-2">
      <StripSlot label="פתיח">
        {hook && (
          <video
            src={hook.previewUrl}
            muted
            loop
            autoPlay
            playsInline
            className="absolute inset-0 size-full object-cover"
          />
        )}
      </StripSlot>
      <StripSlot label="הדמו שלכם">
        {demo?.thumbUrl && (
          // Signed, short-lived URL — next/image optimization would break it.
          <img src={demo.thumbUrl} alt="" className="absolute inset-0 size-full object-cover" />
        )}
      </StripSlot>
      <StripSlot label="סיום עם הדמות" caption={persona ? "מקריינת לאורך כל הסרטון" : undefined}>
        {persona && (
          <img
            src={persona.imageUrl}
            alt={persona.name}
            className="absolute inset-0 size-full object-cover"
          />
        )}
      </StripSlot>
    </div>
  );
}

function StripSlot({
  label,
  caption,
  children,
}: {
  label: string;
  caption?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="text-center">
      {/* 9:16 tile — every strip asset is exactly 1080×1920, so an
          aspect-matched tile makes cropping structurally impossible. */}
      <div
        className={`relative mx-auto aspect-[9/16] w-20 overflow-hidden rounded-lg border ${
          children ? "border-white/15" : "border-dashed border-white/15 bg-white/5"
        }`}
      >
        {children}
      </div>
      <p dir="rtl" className="mt-1 text-[11px] text-gray-400">
        {label}
      </p>
      {caption && (
        <p dir="rtl" className="text-[10px] leading-tight text-gray-500">
          {caption}
        </p>
      )}
    </div>
  );
}
