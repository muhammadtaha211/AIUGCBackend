"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import { useStepViewed } from "@/components/analytics";
import { StepPersona } from "@/components/b-wizard/step-persona";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { WizardNav } from "@/components/wizard-nav";
import { sameSpeakerGender } from "@/lib/service-a-ui";
import type { Persona, RenderState } from "@/lib/service-b-ui";
import {
  C_EMPTY_CATALOG,
  C_PERSONA_COPY,
  C_STEP_TITLES,
  C_WIZARD_STEPS,
  C_WIZARD_TITLE,
  type TextBlockClip,
  type TextBlockOption,
} from "@/lib/service-c-ui";
import { StepClip } from "./step-clip";
import { StepRender } from "./step-render";
import { StepStudio } from "./step-studio";

type CWizardProps = {
  businessId: string;
  businessName: string;
  /** Catalog server-rendered by the page shell (characters with a usable
   *  clip) — undefined falls back to the mount fetch and its retry UI. */
  initialCatalog?: Persona[];
};

/**
 * The Service C (גוש טקסט) wizard, decision 0099: character -> clip ->
 * studio (one text at a time, edited freely, placed by hand) -> render. The
 * character scopes the clip gallery and is who the text is written as; the
 * clip plays once with its own sound under the block. State is client-side
 * only — a refresh restarts the wizard. Back navigation is allowed until the
 * render is enqueued.
 */
export function CWizard({ businessId, businessName, initialCatalog }: CWizardProps) {
  const steps = C_WIZARD_STEPS;
  const [stepIndex, setStepIndex] = useState(0);
  useStepViewed("c", steps[stepIndex]!);
  /** 403/404 from any call: the business/resource is gone for this session. */
  const [fatal, setFatal] = useState<string | null>(null);

  /** The catalog, cached here so re-entering the step skips the fetch. */
  const [personaCatalog, setPersonaCatalog] = useState<Persona[] | null>(initialCatalog ?? null);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [clip, setClip] = useState<TextBlockClip | null>(null);
  /** Every text served this session, in the order shown (with any draft). */
  const [texts, setTexts] = useState<TextBlockOption[]>([]);
  const [pickId, setPickId] = useState<string | null>(null);
  /** The next-text POST in flight (a token the studio mints per call), or
   *  null — A's hookGen: here, not in the studio, because the studio unmounts
   *  on back-nav while the call is pending, and a token so a cross-gender
   *  swap can orphan it (see selectPersona). */
  const textGen = useRef<object | null>(null);
  const [textBusy, setTextBusy] = useState(false);
  /** That flight's failure, here for the same reason: a studio remounted
   *  while it was pending must still see it, or its spinner never stops. */
  const [textFailure, setTextFailure] = useState<string | null>(null);
  /** The last next-text press hit a daily quota (429): no retry control can be honest. */
  const [textQuotaBlocked, setTextQuotaBlocked] = useState(false);
  /** Customer-placed rect; null = the clip's own area. */
  const [rect, setRect] = useState<SafeRect | null>(null);
  const [render, setRender] = useState<RenderState | null>(null);
  const [renderStarting, setRenderStarting] = useState(false);

  const step = steps[stepIndex]!;
  const goBack = () => setStepIndex((index) => Math.max(0, index - 1));
  const goNext = () => setStepIndex((index) => Math.min(steps.length - 1, index + 1));
  /** Rail jump — backwards only. */
  const jumpTo = (index: number) => {
    if (index < stepIndex) setStepIndex(index);
  };

  /** A different character empties the gallery: the clip is the previous
   *  character's, and its rect goes with it. The texts survive a same-gender
   *  swap — they are this business's, written in a gendered first person — so
   *  only a cross-gender swap drops them, with any request still pending. */
  function selectPersona(next: Persona) {
    if (persona && persona.id !== next.id) {
      setClip(null);
      setRect(null);
      if (!sameSpeakerGender(persona.gender, next.gender)) {
        setTexts([]);
        setPickId(null);
        textGen.current = null;
        setTextBusy(false);
        setTextFailure(null);
      }
    }
    setPersona(next);
  }

  /** A different clip re-seeds the placement editor from ITS area. */
  function selectClip(next: TextBlockClip) {
    if (clip && clip.id !== next.id) setRect(null);
    setClip(next);
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
        <h1 className="text-lg font-semibold tracking-tight text-ink">{C_WIZARD_TITLE}</h1>
        <span className="truncate text-sm text-ink/60">{businessName}</span>
      </div>

      <div className="mt-4 lg:grid lg:grid-cols-[10.5rem_1fr] lg:items-start lg:gap-8">
        <WizardNav
          labels={steps.map((each) => C_STEP_TITLES[each])}
          current={stepIndex}
          onJump={jumpTo}
          locked={render !== null || renderStarting}
        />

        <div key={stepIndex} className="step-in mt-5 lg:mt-0">
          <div className="rounded-xl border border-ink/[0.08] bg-white p-6 shadow-xl shadow-ink/[0.05] sm:p-10">
            {/* StepPersona's own empty line is B's; C says why its list is empty. */}
            {step === "persona" && personaCatalog?.length === 0 && (
              <div>
                <StepHeader title={C_PERSONA_COPY.title} sub={C_PERSONA_COPY.sub} />
                <p className="mt-6 rounded-xl border border-dashed border-ink/15 bg-ink/[0.04] px-6 py-10 text-center text-sm text-ink/60">
                  {C_EMPTY_CATALOG}
                </p>
              </div>
            )}

            {step === "persona" && personaCatalog?.length !== 0 && (
              <StepPersona
                catalog={personaCatalog}
                setCatalog={setPersonaCatalog}
                selected={persona}
                onSelect={selectPersona}
                onContinue={goNext}
                onFatal={setFatal}
                copy={C_PERSONA_COPY}
                catalogUrl="/api/personas?withTextBlocks=1"
              />
            )}

            {step === "clip" && persona && (
              <StepClip
                personaId={persona.id}
                selected={clip}
                onSelect={selectClip}
                onBack={goBack}
                onContinue={goNext}
                onFatal={setFatal}
              />
            )}

            {step === "studio" && clip && (
              <StepStudio
                businessId={businessId}
                clip={clip}
                texts={texts}
                setTexts={setTexts}
                pickId={pickId}
                setPickId={setPickId}
                textGen={textGen}
                textBusy={textBusy}
                setTextBusy={setTextBusy}
                failure={textFailure}
                setFailure={setTextFailure}
                quotaBlocked={textQuotaBlocked}
                setQuotaBlocked={setTextQuotaBlocked}
                rect={rect}
                setRect={setRect}
                onBack={goBack}
                onContinue={goNext}
                onFatal={setFatal}
              />
            )}

            {step === "render" && clip && pickId && (
              <StepRender
                businessId={businessId}
                clipId={clip.id}
                clipDurationMs={clip.durationMs}
                scriptId={pickId}
                textSafeArea={rect ?? clip.textSafeArea}
                render={render}
                setRender={setRender}
                starting={renderStarting}
                setStarting={setRenderStarting}
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
