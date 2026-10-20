"use client";

import { useState } from "react";
import Link from "next/link";
import type { HookEffect } from "@aiugc/core/hook-effect";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import { useStepViewed } from "@/components/analytics";
import { Button } from "@/components/ui/button";
import { WizardNav } from "@/components/wizard-nav";
import type { DemoState } from "@/lib/service-a-ui";
import {
  CUTAWAY_COPY,
  cutawayHookText,
  liveCutawayPlan,
  pointersChanged,
  wizardSteps,
  type AudioState,
  type CutawayPlanWire,
  type Persona,
  type RenderState,
  type ScriptState,
  type WizardStep,
} from "@/lib/service-b-ui";
import { StepAudio } from "./step-audio";
import { StepCutaways } from "./step-cutaways";
import { StepEffect } from "./step-effect";
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
  demo: CUTAWAY_COPY.stepTitle,
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
 * The Service B wizard: persona -> pointers -> script -> audio -> opening
 * animation -> (demo cutaways, when ticked, vault 0121) -> render (vault 0017,
 * 0023). Single setting: the persona's selfie
 * is the render source, so there is no image step and no product step, and the
 * ad is one HeyGen clip with the hook performed on it rather than stitched in
 * front. State is client-side only — a refresh restarts the wizard. Back
 * navigation is allowed until the render is enqueued.
 */
export function BWizard({ businessId, businessName, initialCatalog }: BWizardProps) {
  /** Demo cutaways (vault 0121): ticked on the audio card, off by default. Off
   *  = exactly today's six steps and today's request body. */
  const [cutaways, setCutaways] = useState(false);
  const steps = wizardSteps({ cutaways });
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
  /** The chosen opening animation; "none" is the default and burns no line. */
  const [hookEffect, setHookEffect] = useState<HookEffect>("none");
  /** The on-screen line; null = untouched, the effect step seeds it from the script. */
  const [hookText, setHookText] = useState<string | null>(null);
  /** Customer-placed hook-text rect; null = the centred default. */
  const [rect, setRect] = useState<SafeRect | null>(null);
  const [render, setRender] = useState<RenderState | null>(null);
  /** The cutaways' demo and plan. Kept when the option is unticked, so ticking
   *  it again costs nothing; a plan counts only while it is live. */
  const [cutawayDemo, setCutawayDemo] = useState<DemoState | null>(null);
  const [cutawayPlan, setCutawayPlan] = useState<CutawayPlanWire | null>(null);

  const step = steps[stepIndex]!;
  useStepViewed("b", step);
  /** The on-screen line the effect step shows and the render burns: the
   *  customer's edit, else the script call's draft. */
  const effectText = hookText ?? script?.hookText ?? "";
  /** The plan, if it still belongs to this audio, this demo and this hook
   *  text — a new hook text on the effect step makes it stale, and the
   *  cutaway step drafts again (founder, 2026-10-20). */
  const livePlan = liveCutawayPlan(
    cutawayPlan,
    audio?.id,
    cutawayDemo?.id,
    cutawayHookText(hookEffect, effectText),
  );
  /** What the render sends: the live plan, only with the option on. */
  const renderPlan = cutaways && livePlan && livePlan.slots.length > 0 ? livePlan : null;
  const goBack = () => setStepIndex((index) => Math.max(0, index - 1));
  const goNext = () => setStepIndex((index) => Math.min(steps.length - 1, index + 1));
  /** "Continue without cutaways": the option goes off, and the step that
   *  followed it — the render — slides into this index. */
  function skipCutaways() {
    setCutaways(false);
  }

  /** Rail jump — backwards only. */
  const jumpTo = (index: number) => {
    if (index < stepIndex) setStepIndex(index);
  };

  /**
   * Everything generated from the script is the script's — drop it. The hook
   * text goes too: the draft is re-derived with the script, and the effect
   * step reseeds from the new one.
   */
  function discardScript() {
    setScript(null);
    setEditedText("");
    setAudio(null);
    setHookText(null);
  }

  /** A different persona invalidates everything generated for the previous one.
   *  The animation is not persona-scoped, so the choice survives; the rect is
   *  dropped because it was placed over the previous persona's selfie. */
  function selectPersona(next: Persona) {
    if (persona && persona.id !== next.id) {
      discardScript();
      setRect(null);
    }
    setPersona(next);
  }

  /** Leaving the pointers step: a changed brief means the held script is stale. */
  function continueFromPointers() {
    if (script && pointersChanged(script, pointers)) discardScript();
    goNext();
  }

  /** Leaving the script step: later steps must use the latest scriptId only,
   *  and the hook text follows the script it was derived from. */
  function continueFromScript(latest: ScriptState) {
    if (audio && audio.scriptId !== latest.scriptId) setAudio(null);
    if (script?.scriptId !== latest.scriptId) setHookText(null);
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

        <div key={step} className="step-in mt-5 lg:mt-0">
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
                extra={
                  <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-ink/[0.08] bg-white p-4">
                    <input
                      type="checkbox"
                      checked={cutaways}
                      onChange={(event) => setCutaways(event.target.checked)}
                      className="mt-0.5 size-4 shrink-0 accent-accent"
                    />
                    <span>
                      <span className="block text-sm font-medium text-ink">
                        {CUTAWAY_COPY.optIn}
                      </span>
                      <span className="mt-1 block text-[13px] text-ink/60">
                        {CUTAWAY_COPY.optInHint}
                      </span>
                    </span>
                  </label>
                }
              />
            )}

            {step === "effect" && persona && script && (
              <StepEffect
                personaImageUrl={persona.imageUrl}
                hookEffect={hookEffect}
                setHookEffect={setHookEffect}
                hookText={effectText}
                setHookText={setHookText}
                rect={rect}
                setRect={setRect}
                onBack={goBack}
                onContinue={goNext}
              />
            )}

            {step === "demo" && audio?.approved && (
              <StepCutaways
                businessId={businessId}
                audioId={audio.id}
                hookText={cutawayHookText(hookEffect, effectText)}
                demo={cutawayDemo}
                setDemo={setCutawayDemo}
                plan={livePlan}
                setPlan={setCutawayPlan}
                onBack={goBack}
                onContinue={goNext}
                onSkip={skipCutaways}
                onFatal={setFatal}
              />
            )}

            {/* persona.personaImageId is always set on the B catalog (a persona
                without a selfie is not listed); the check narrows the type. */}
            {step === "render" && persona?.personaImageId && script && audio && (
              <StepRender
                businessId={businessId}
                personaId={persona.id}
                personaImageId={persona.personaImageId}
                scriptId={script.scriptId}
                audioId={audio.id}
                hookEffect={hookEffect}
                hookText={effectText}
                hookTextSafeArea={rect ?? undefined}
                cutawayPlanId={renderPlan?.planId}
                cutawayCount={renderPlan?.slots.length ?? 0}
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
