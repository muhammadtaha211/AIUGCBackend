"use client";

import { useState } from "react";
import Link from "next/link";
import type { HookEffect } from "@aiugc/core/hook-effect";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import { useStepViewed } from "@/components/analytics";
import { Button } from "@/components/ui/button";
import { WizardNav } from "@/components/wizard-nav";
import {
  OWN_VOICE_STEP_TITLES,
  pointersChanged,
  POINTERS_SKIP_LABEL,
  VOICE_DOORS,
  wizardSteps,
  type AudioState,
  type OwnVoiceApproval,
  type Persona,
  type RecordingState,
  type RenderState,
  type ScriptState,
  type TranscriptEdits,
  type VoiceSource,
  type WizardStep,
} from "@/lib/service-b-ui";
import { StepAudio } from "./step-audio";
import { StepEffect } from "./step-effect";
import { StepPersona } from "./step-persona";
import { StepPointers } from "./step-pointers";
import { StepRecord } from "./step-record";
import { StepRender } from "./step-render";
import { StepScript } from "./step-script";
import { StepTranscript } from "./step-transcript";

const STEP_TITLES: Record<WizardStep, string> = {
  persona: "בחירת דמות",
  pointers: "מה הדמות אומרת?",
  script: "תסריט",
  audio: "הקלטה",
  record: OWN_VOICE_STEP_TITLES.record,
  transcript: OWN_VOICE_STEP_TITLES.transcript,
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
 * The Service B wizard: persona -> pointers -> script -> audio -> opening
 * animation -> render (vault 0017, 0023). Single setting: the persona's selfie
 * is the render source, so there is no image step and no product step, and the
 * ad is one HeyGen clip with the hook performed on it rather than stitched in
 * front. State is client-side only — a refresh restarts the wizard. Back
 * navigation is allowed until the render is enqueued.
 *
 * The character step's two doors (decision 0118): the AI voice is the flow
 * above, unchanged; the customer's own voice replaces the audio step with
 * record -> transcript and rejoins at the effect step, where the approval's
 * script + audio pair stands in for the AI branch's.
 */
export function BWizard({ businessId, businessName, initialCatalog }: BWizardProps) {
  const [voice, setVoice] = useState<VoiceSource>("ai");
  const steps = wizardSteps(voice);
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
  // The own-voice branch (decision 0118). `skipped` = the customer went
  // straight from pointers to the recorder: no reading pane, and Back from the
  // recorder returns to pointers rather than to a script step never visited.
  const [skipped, setSkipped] = useState(false);
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [transcriptEdits, setTranscriptEdits] = useState<TranscriptEdits>({});
  const [approval, setApproval] = useState<OwnVoiceApproval | null>(null);

  const step = steps[stepIndex]!;
  useStepViewed("b", step);
  /** The on-screen line the effect step shows and the render burns: the
   *  customer's edit, else the script call's draft. */
  const effectText = hookText ?? (voice === "own" ? approval?.hookText : script?.hookText) ?? "";
  /** What the effect and render steps read: the AI branch's script + audio,
   *  or the own-voice approval's pair. */
  const spoken =
    voice === "own"
      ? approval && { scriptId: approval.scriptId, audioId: approval.audioId }
      : script && audio && { scriptId: script.scriptId, audioId: audio.id };
  const goBack = () =>
    setStepIndex((index) =>
      steps[index] === "record" && skipped ? steps.indexOf("pointers") : Math.max(0, index - 1),
    );
  const goNext = () => setStepIndex((index) => Math.min(steps.length - 1, index + 1));
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
      // The recording is the customer's voice and belongs to no persona, so it
      // stays; its approval named the old persona, and approving again is free.
      setApproval(null);
    }
    setPersona(next);
  }

  /** A door at the character step. Switching voice drops the other branch's
   *  audio — the teleprompter script is the same b_script either way. */
  function chooseVoice(next: VoiceSource) {
    if (next !== voice) {
      setAudio(null);
      setRecording(null);
      setTranscriptEdits({});
      setApproval(null);
      setHookText(null);
      setSkipped(false);
      setVoice(next);
    }
    goNext();
  }

  /** The pointers step's one tap straight to the recorder. */
  function skipToRecord() {
    setSkipped(true);
    setStepIndex(steps.indexOf("record"));
  }

  /** The upload is registered: a new recording replaces any earlier one. */
  function recorded(next: RecordingState) {
    setRecording(next);
    setTranscriptEdits({});
    setApproval(null);
    setHookText(null);
    goNext();
  }

  function recordAgain() {
    setRecording(null);
    setTranscriptEdits({});
    setApproval(null);
    setHookText(null);
    setStepIndex(steps.indexOf("record"));
  }

  /** A new pair resets the hook line, as a new script does on the AI branch. */
  function approved(next: OwnVoiceApproval) {
    if (next.audioId !== approval?.audioId) setHookText(null);
    setApproval(next);
    goNext();
  }

  /** Leaving the pointers step: a changed brief means the held script is stale. */
  function continueFromPointers() {
    if (script && pointersChanged(script, pointers)) discardScript();
    setSkipped(false);
    goNext();
  }

  /** Leaving the script step: later steps must use the latest scriptId only,
   *  and the hook text follows the script it was derived from. */
  function continueFromScript(latest: ScriptState) {
    // Through the script step means the teleprompter is wanted, whatever an
    // earlier skip said (a rail visit back to the script step).
    setSkipped(false);
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
                doors={VOICE_DOORS.map((door) => ({
                  ...door,
                  onChoose: () => chooseVoice(door.id),
                }))}
              />
            )}

            {step === "pointers" && persona && (
              <StepPointers
                pointers={pointers}
                setPointers={setPointers}
                onBack={goBack}
                onContinue={continueFromPointers}
                {...(voice === "own" && { onSkip: skipToRecord, skipLabel: POINTERS_SKIP_LABEL })}
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
                voice={voice}
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

            {step === "record" && persona && (
              <StepRecord
                businessId={businessId}
                scriptText={!skipped && script ? editedText || script.text : null}
                existingRecording={recording}
                onContinueExisting={goNext}
                onRecorded={recorded}
                onBack={goBack}
                onFatal={setFatal}
              />
            )}

            {step === "transcript" && persona && recording && (
              <StepTranscript
                personaId={persona.id}
                recording={recording}
                setRecording={setRecording}
                edits={transcriptEdits}
                setEdits={setTranscriptEdits}
                approval={approval}
                onApproved={approved}
                onBack={goBack}
                onRecordAgain={recordAgain}
                onFatal={setFatal}
              />
            )}

            {step === "effect" && persona && spoken && (
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

            {/* persona.personaImageId is always set on the B catalog (a persona
                without a selfie is not listed); the check narrows the type. */}
            {step === "render" && persona?.personaImageId && spoken && (
              <StepRender
                businessId={businessId}
                personaId={persona.id}
                personaImageId={persona.personaImageId}
                scriptId={spoken.scriptId}
                audioId={spoken.audioId}
                hookEffect={hookEffect}
                hookText={effectText}
                hookTextSafeArea={rect ?? undefined}
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
