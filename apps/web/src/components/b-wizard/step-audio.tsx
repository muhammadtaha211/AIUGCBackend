"use client";

import { useEffect, useRef, useState } from "react";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import type { AudioState, ScriptState } from "@/lib/service-b-ui";
import { postJson, useJobPoll } from "@/lib/use-api";

type StepAudioProps = {
  script: ScriptState;
  audio: AudioState | null;
  setAudio: (audio: AudioState | null) => void;
  onBack: () => void;
  onContinue: () => void;
  onFatal: (message: string) => void;
  /**
   * Collapse approve + continue into one button with this label (Service A).
   * Approve still runs first and a failure stays on the step — the hard gate
   * is unchanged. Absent = the two-button flow (Service B).
   */
  approveContinueLabel?: string;
};

/**
 * Step 4: the mandatory audio-only preview gate. TTS runs on the worker; we
 * poll until the mp3 is ready, let the customer listen, and require an
 * explicit approve before any video render.
 */
export function StepAudio({
  script,
  audio,
  setAudio,
  onBack,
  onContinue,
  onFatal,
  approveContinueLabel,
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
  } = useJobPoll<{ status: string; audioUrl?: string }>(
    generating,
    `/api/audio/${audio?.id}`,
    2_000,
    (body) => {
      if (!audio) return;
      setAudio({ ...audio, status: body.status, audioUrl: body.audioUrl });
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
