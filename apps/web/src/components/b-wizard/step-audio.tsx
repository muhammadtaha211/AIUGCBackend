"use client";

import { useEffect, useRef, useState } from "react";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import { AUDIO_SCRIPT_CHANGED_NOTICE, AUDIO_SCRIPT_LABEL } from "@/lib/quote-ui";
import { endingForRemainder, endingSentence } from "@/lib/service-a-ui";
import {
  applyAudioPoll,
  needsScriptAdoption,
  type AudioPollResult,
  type AudioState,
  type ScriptState,
} from "@/lib/service-b-ui";
import { postJson, useJobPoll } from "@/lib/use-api";

type StepAudioProps = {
  script: ScriptState;
  audio: AudioState | null;
  setAudio: (audio: AudioState | null) => void;
  /**
   * Adopt the script the server resolved through audio_renders.script_id. The
   * shell must take it whole — id, text and word budget — or back-navigation
   * shows the old text with needsTextSave blind to it, and the script step's
   * ending estimate reads a budget that belongs to a different script.
   */
  onScriptResolved: (script: ScriptState) => void;
  onBack: () => void;
  onContinue: () => void;
  onFatal: (message: string) => void;
  /**
   * Collapse approve + continue into one button with this label (Service A).
   * Approve still runs first and a failure stays on the step — the hard gate
   * is unchanged. Absent = the two-button flow (Service B).
   */
  approveContinueLabel?: string;
  /**
   * Service A only: the demo's length. When set, the ready card names the
   * exact ending (none/freeze/avatar) from the measured recording — before
   * approval, while regenerating is still one click away.
   */
  demoDurationMs?: number;
};

/**
 * Step 4: the mandatory audio-only preview gate. TTS runs on the worker; we
 * poll until the mp3 is ready, let the customer listen and READ what was
 * spoken, and require an explicit approve before any video render.
 *
 * The text on screen comes from the poll, which resolves it through
 * audio_renders.script_id — the same pointer the render reads. An approval gate
 * that doesn't show what is being approved isn't one.
 */
export function StepAudio({
  script,
  audio,
  setAudio,
  onScriptResolved,
  onBack,
  onContinue,
  onFatal,
  approveContinueLabel,
  demoDurationMs,
}: StepAudioProps) {
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  /** DRY_RUN stubs may not decode — approval must not depend on playback. */
  const [playbackBroken, setPlaybackBroken] = useState(false);
  const requesting = useRef(false);

  async function requestAudio() {
    if (requesting.current) return;
    requesting.current = true;
    setError(null);
    const result = await postJson<{ audioId: string }>(`/api/scripts/${script.scriptId}/audio`);
    requesting.current = false;
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setError(result.error); // includes the 429 daily-preview limit
    }
    setAudio({
      id: result.body.audioId,
      scriptId: script.scriptId,
      status: "queued",
      approved: false,
    });
  }

  // Entering the step (or after a script change cleared the old audio): enqueue
  // TTS once. The requesting ref keeps a StrictMode double-mount from paying twice.
  useEffect(() => {
    if (audio === null) void requestAudio();
    // audio === null is the real trigger; requestAudio reads only props/refs.
  }, [audio]); // eslint-disable-line react-hooks/exhaustive-deps

  const generating = audio !== null && (audio.status === "queued" || audio.status === "generating");

  const {
    slow,
    stalled,
    retry: retryPolling,
  } = useJobPoll<AudioPollResult>(
    generating,
    // No client state in the request: the server decides both what this audio
    // speaks and whether the pointer was rewritten, so the notice is right even
    // for a wizard that never saw the original script.
    `/api/audio/${audio?.id}`,
    2_000,
    (body) => {
      if (!audio) return;
      setAudio(applyAudioPoll(audio, body));
      if (needsScriptAdoption(script, body)) {
        onScriptResolved({
          scriptId: body.scriptId,
          text: body.text,
          wordBudget: body.wordBudget,
        });
      }
    },
    onFatal,
  );

  /** Returns whether the approve call landed (state already updated). */
  async function approve(): Promise<boolean> {
    if (!audio) return false;
    setApproving(true);
    const result = await postJson<{ ok: boolean }>(`/api/audio/${audio.id}/approve`);
    setApproving(false);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) onFatal(result.error);
      else setError(result.error);
      return false;
    }
    setAudio({ ...audio, approved: true });
    return true;
  }

  /** Collapsed mode: approve, then advance in the same click. */
  async function approveAndContinue() {
    if (audio?.approved) return onContinue();
    if (await approve()) onContinue();
  }

  return (
    <div>
      <StepHeader
        title="ככה זה יישמע"
        sub="מאזינים להקלטה ומאשרים — הסרטון נוצר רק אחרי אישור שלכם."
        onBack={onBack}
      />

      {error && (
        <div className="mt-6">
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
            {error}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            onClick={() => void requestAudio()}
          >
            נסה שוב
          </Button>
        </div>
      )}

      {/* Polling gave up (persistent network/server errors) — never spin silently. */}
      {generating && stalled && (
        <div className="mt-6">
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
            {stalled}
          </p>
          <Button type="button" variant="secondary" className="mt-4" onClick={retryPolling}>
            נסה שוב
          </Button>
        </div>
      )}

      {generating && !stalled && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-6 py-10 text-center">
          <Spinner className="size-6 text-accent" />
          <p className="text-sm text-gray-300">מקליטים את התסריט בקול של הדמות…</p>
          {slow && <p className="text-sm text-gray-500">עדיין עובד… זה יכול לקחת עוד רגע.</p>}
        </div>
      )}

      {audio?.status === "failed" && !error && (
        <div className="mt-6">
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
            ההקלטה נכשלה — נסו שוב.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            onClick={() => {
              setAudio(null); // the mount effect re-requests
            }}
          >
            נסה שוב
          </Button>
        </div>
      )}

      {audio?.status === "ready" && (
        <div className="mt-6">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            {audio.audioUrl && (
              <audio
                controls
                src={audio.audioUrl}
                onError={() => setPlaybackBroken(true)}
                className="w-full"
              />
            )}
            {(playbackBroken || !audio.audioUrl) && (
              <p className="mt-2 text-sm text-gray-500">
                ההשמעה לא זמינה כרגע — אפשר בכל זאת לאשר ולהמשיך.
              </p>
            )}
          </div>

          {/* What is actually being approved, resolved through the audio's
              script pointer. Read-only and visually under the player: changing
              it means new audio, which is the script step's job. */}
          <div className="mt-4">
            {/* Once the length-fit regeneration is deleted from pipelines/tts.ts
                nothing rewrites audio_renders.script_id and this notice should
                never appear again. Keep it: it is what turns a silent
                substitution into a visible one if anything ever starts moving
                the pointer, and it costs nothing while it never fires. */}
            {audio.scriptChanged && (
              <p
                role="alert"
                className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2.5 text-sm text-amber-200"
              >
                {AUDIO_SCRIPT_CHANGED_NOTICE}
              </p>
            )}
            <p className="text-[13px] text-gray-500">{AUDIO_SCRIPT_LABEL}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
              {script.text}
            </p>
          </div>

          {/* Service A: the exact ending from the measured recording — the
              last moment a regenerate is one click away. */}
          {demoDurationMs !== undefined && audio.durationMs !== undefined && (
            <p className="mt-3 text-[13px] text-gray-400">
              {endingSentence(endingForRemainder((audio.durationMs - demoDurationMs) / 1000), true)}
            </p>
          )}

          {approveContinueLabel ? (
            <Button
              type="button"
              size="lg"
              className="mt-6 w-full"
              loading={approving}
              onClick={() => void approveAndContinue()}
            >
              {approveContinueLabel}
            </Button>
          ) : audio.approved ? (
            <Button type="button" size="lg" className="mt-6 w-full" onClick={onContinue}>
              המשך ליצירת הסרטון
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              className="mt-6 w-full"
              loading={approving}
              onClick={() => void approve()}
            >
              אשר הקלטה
            </Button>
          )}

          <button
            type="button"
            onClick={onBack}
            className="mt-4 w-full text-center text-sm text-gray-400 transition-colors duration-150 hover:text-white"
          >
            חזרה לתסריט
          </button>
        </div>
      )}
    </div>
  );
}
