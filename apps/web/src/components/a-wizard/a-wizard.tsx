"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import { Button } from "@/components/ui/button";
import { WizardNav } from "@/components/wizard-nav";
import { StepAudio } from "@/components/b-wizard/step-audio";
import { StepPersona } from "@/components/b-wizard/step-persona";
import {
  A_WIZARD_STEPS,
  sameSpeakerGender,
  type AWizardStep,
  type DemoState,
  type HookBatch,
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
  /** Catalog server-rendered by the page shell — undefined falls back to the
   *  mount fetch (and its retry UI) via /api/personas. */
  initialCatalog?: Persona[];
};

/**
 * The Service A wizard: persona -> hook gallery (persona-filtered) -> hook
 * studio (line + placement) -> demo upload (+ optional footage note) -> VO
 * script -> audio approval (hard gate) -> advisory shape + render.
 * Single variant — the grid stays CLI-only. State is client-side only; a
 * refresh restarts the wizard. Persona and audio steps are shared with B.
 */
export function AWizard({ businessId, businessName, advantages, initialCatalog }: AWizardProps) {
  const steps = A_WIZARD_STEPS;
  const [stepIndex, setStepIndex] = useState(0);
  /** 403/404 from any call: the business/resource is gone for this session. */
  const [fatal, setFatal] = useState<string | null>(null);

  /** The persona catalog, cached here so re-entering the step skips the fetch. */
  const [personaCatalog, setPersonaCatalog] = useState<Persona[] | null>(initialCatalog ?? null);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [hook, setHook] = useState<HookClip | null>(null);
  /** All ten frames from one generation; null = not generated yet. */
  const [hookBatch, setHookBatch] = useState<HookBatch | null>(null);
  /** Which interleaved five are on screen. The first reroll flips this for free. */
  const [hookHalf, setHookHalf] = useState<0 | 1>(0);
  /** Every line written this session, most recent first — sent as `avoid`. */
  const [hookAvoid, setHookAvoid] = useState<string[]>([]);
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
  /** Rail jump — backwards only; state survives exactly like repeated goBack. */
  const jumpTo = (index: number) => {
    if (index < stepIndex) setStepIndex(index);
  };

  /**
   * A different persona invalidates the VO script and audio (the voice
   * changed) and a persona-swapped hook clip that belonged to the old persona
   * (it is not in the new persona's gallery). Generic clips survive.
   *
   * Hook lines survive a persona swap but NOT a gender swap: since hook_lines
   * v6 they speak in the persona's own first person, and Hebrew first person is
   * gendered — a feminine line under a male persona is burned into the frame
   * and unfixable without a re-render. A same-gender swap leaves all ten valid,
   * so it keeps them (and the paid-for unseen half).
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
      if (!sameSpeakerGender(persona.gender, next.gender)) {
        setHookBatch(null);
        setHookHalf(0);
        setHookAvoid([]);
        setHookLine(null);
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

  /**
   * The audio step resolved the spoken script through audio_renders.script_id
   * and it isn't the one we were carrying. Take it whole — the textarea behind
   * us must show what was actually recorded, and its ending estimate must read
   * the matching word budget.
   */
  function adoptResolvedScript(resolved: ScriptState) {
    setScript(resolved);
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
        <h1 className="text-lg font-semibold tracking-tight text-ink">הוק + דמו</h1>
        <span className="truncate text-sm text-ink/60">{businessName}</span>
      </div>

      <div className="mt-4 lg:grid lg:grid-cols-[10.5rem_1fr] lg:items-start lg:gap-8">
        <WizardNav
          labels={steps.map((each) => STEP_TITLES[each])}
          current={stepIndex}
          onJump={jumpTo}
          locked={render !== null}
        />

        <div>
          <StructureStrip persona={persona} hook={hook} demo={demo} />

          <div key={stepIndex} className="step-in mt-5">
            <div className="rounded-xl border border-ink/[0.08] bg-white p-6 shadow-xl shadow-ink/[0.05] sm:p-10">
              {step === "persona" && (
                <StepPersona
                  catalog={personaCatalog}
                  setCatalog={setPersonaCatalog}
                  selected={persona}
                  onSelect={selectPersona}
                  onContinue={goNext}
                  onFatal={setFatal}
                  // In A the choice sets the narration voice; the face shows up
                  // only when the VO outlasts the demo. Say exactly that.
                  copy={{
                    title: "מי תקריין את המודעה שלכם?",
                    sub: "בוחרים דמות אחת, הקריינות תוקלט בקול שלה, והיא תופיע בסוף הסרטון רק אם הקריינות ממשיכה אחרי שסרטון המוצר נגמר.",
                  }}
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

              {step === "hookStudio" && hook && persona && (
                <StepHookStudio
                  businessId={businessId}
                  personaId={persona.id}
                  hook={hook}
                  hookBatch={hookBatch}
                  setHookBatch={setHookBatch}
                  hookHalf={hookHalf}
                  setHookHalf={setHookHalf}
                  hookAvoid={hookAvoid}
                  setHookAvoid={setHookAvoid}
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
                  hookLineText={hookLine?.text}
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
                  onScriptResolved={adoptResolvedScript}
                  onBack={goBack}
                  onContinue={goNext}
                  onFatal={setFatal}
                  approveContinueLabel="מאשרים וממשיכים ליצירת הסרטון"
                  demoDurationMs={demo?.durationMs}
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
      </div>
    </div>
  );
}

/**
 * The structure strip: the fixed three-part shape of every Service A ad —
 * פתיח | הדמו שלכם | סיום עם הדמות, populating live as choices land, so the
 * customer always sees what they are building. The persona face sits in the
 * ending slot from step 1, but the ending itself is conditional (it renders
 * only when the VO outlasts the demo), so the caption states the same
 * condition as the persona step's copy — never "she closes the video".
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
    <div dir="ltr" className="mt-4 grid grid-cols-3 gap-2 lg:mt-0">
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
      <StripSlot
        label="סיום עם הדמות"
        caption={
          persona ? "מקריינת את הסרטון; תופיע בסוף רק אם הקריינות ממשיכה אחרי הדמו" : undefined
        }
      >
        {persona && (
          // Public catalog URL — next/image shrinks the 9:16 source to tile size.
          <Image
            src={persona.imageUrl}
            alt={persona.name}
            fill
            sizes="80px"
            className="object-cover"
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
          children ? "border-ink/15" : "border-dashed border-ink/15 bg-ink/[0.04]"
        }`}
      >
        {children}
      </div>
      <p dir="rtl" className="mt-1 text-[11px] text-ink/60">
        {label}
      </p>
      {caption && (
        <p dir="rtl" className="text-[10px] leading-tight text-ink/55">
          {caption}
        </p>
      )}
    </div>
  );
}
