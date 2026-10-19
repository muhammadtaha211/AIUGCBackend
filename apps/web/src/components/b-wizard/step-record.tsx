"use client";

import { useEffect, useRef, useState } from "react";
import { RECORDING_ACCEPT, recordingFileError, recordingLengthError } from "@aiugc/core/own-voice";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import type { RecordingUploadUrlResponse } from "@/lib/service-b";
import {
  micErrorLine,
  pickRecorderMime,
  RECORD_COPY,
  RECORDER_MAX_MS,
  recordedFileName,
  recorderClockLine,
  type RecordingState,
} from "@/lib/service-b-ui";
import { postJson } from "@/lib/use-api";

type StepRecordProps = {
  businessId: string;
  /** The teleprompter: the script as the customer left it. null after the skip. */
  scriptText: string | null;
  /** A recording already made on this visit — the customer may go on with it. */
  existingRecording: RecordingState | null;
  onContinueExisting: () => void;
  /** The upload is registered and its transcription queued. */
  onRecorded: (recording: RecordingState) => void;
  onBack: () => void;
  onFatal: (message: string) => void;
};

type Take = { blob: Blob; url: string; mime: string; ms: number };

/**
 * XHR for the upload progress and a cancel that stops the bytes (step-demo's
 * putWithProgress), with the type the upload route settled rather than the
 * browser's: a WhatsApp .opus often has none, and the raw bucket only takes
 * the canonical types.
 */
function putWithProgress(
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (percent: number) => void,
): { promise: Promise<"ok" | "failed" | "aborted">; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<"ok" | "failed" | "aborted">((resolve) => {
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300 ? "ok" : "failed");
    xhr.onerror = () => resolve("failed");
    xhr.onabort = () => resolve("aborted");
    xhr.send(body);
  });
  return { promise, abort: () => xhr.abort() };
}

/** A picked file's length, when the browser can tell (it often cannot for
 *  ogg on iOS or an unfinalised webm) — undefined means "let the server say". */
function readDuration(file: Blob): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement("audio");
    const done = (ms: number | undefined) => {
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    const timer = window.setTimeout(() => done(undefined), 4000);
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const seconds = media.duration;
      done(Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined);
    };
    media.onerror = () => {
      window.clearTimeout(timer);
      done(undefined);
    };
    media.src = url;
  });
}

/**
 * The own-voice record step (decision 0118): the script as a teleprompter
 * under a recorder whose timer and stop control stay on screen however far
 * the script scrolls, plus an upload for a file the customer already has.
 * Nothing goes over the network until the customer uses a take, so a bad take
 * costs no transcription.
 */
export function StepRecord({
  businessId,
  scriptText,
  existingRecording,
  onContinueExisting,
  onRecorded,
  onBack,
  onFatal,
}: StepRecordProps) {
  const [phase, setPhase] = useState<"idle" | "starting" | "recording" | "recorded" | "uploading">(
    "idle",
  );
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadPercent, setUploadPercent] = useState(0);

  /** False once the step has unmounted: late callbacks must not act. */
  const alive = useRef(true);
  /** Set while getUserMedia is pending: a second tap must not start a second take. */
  const starting = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const tick = useRef<number | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const stopReason = useRef<"user" | "cap" | "interrupted">("user");
  const fileInput = useRef<HTMLInputElement | null>(null);
  const takeUrl = useRef<string | null>(null);
  const abortUpload = useRef<(() => void) | null>(null);
  /** The slot an earlier attempt reserved for this same file: a retry after a
   *  failed PUT reuses it rather than spending another of the day's 20. */
  const reserved = useRef<{ file: Blob; target: RecordingUploadUrlResponse } | null>(null);

  function releaseDevices() {
    if (tick.current !== null) window.clearInterval(tick.current);
    tick.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  }

  function discardTake() {
    if (takeUrl.current) URL.revokeObjectURL(takeUrl.current);
    takeUrl.current = null;
    setTake(null);
  }

  // Leaving the step mid-take or mid-upload: the microphone is released and
  // the upload stopped, never left running behind the wizard.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      releaseDevices();
      abortUpload.current?.();
      if (takeUrl.current) URL.revokeObjectURL(takeUrl.current);
    };
  }, []);

  // A phone that switches app or locks mid-take loses the microphone; stop
  // cleanly and say so, keeping what was recorded.
  useEffect(() => {
    if (phase !== "recording") return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop("interrupted");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  function stop(reason: "user" | "cap" | "interrupted") {
    const active = recorder.current;
    if (!active || active.state === "inactive") return;
    stopReason.current = reason;
    if (tick.current !== null) window.clearInterval(tick.current);
    tick.current = null;
    active.stop();
  }

  async function start() {
    if (starting.current || recorder.current?.state === "recording") return;
    setError(null);
    setNotice(null);
    discardTake();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return setError(RECORD_COPY.unsupported);
    }
    starting.current = true;
    setPhase("starting");
    let media: MediaStream;
    try {
      // The browser's own defaults: turning echo cancellation off moves iPhone
      // playback to the earpiece (WebKit 326286). "No noise cleanup" is about
      // our pipeline, which adds none.
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      starting.current = false;
      if (!alive.current) return;
      setPhase("idle");
      return setError(micErrorLine((err as DOMException | undefined)?.name));
    }
    starting.current = false;
    // The customer left while the permission prompt was open: release the
    // microphone they just granted instead of recording behind the wizard.
    if (!alive.current) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    stream.current = media;
    const mime = pickRecorderMime((type) => MediaRecorder.isTypeSupported(type));
    let active: MediaRecorder;
    try {
      active = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
    } catch {
      releaseDevices();
      setPhase("idle");
      return setError(RECORD_COPY.unsupported);
    }
    // This take's own chunks and clock — never shared with another take.
    const chunks: Blob[] = [];
    const startedAt = performance.now();
    active.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    active.onstop = () => {
      const ms = Math.min(RECORDER_MAX_MS, Math.round(performance.now() - startedAt));
      releaseDevices();
      if (!alive.current) return;
      const type = active.mimeType || mime || "audio/webm";
      const blob = new Blob(chunks, { type });
      const url = URL.createObjectURL(blob);
      takeUrl.current = url;
      setTake({ blob, url, mime: type, ms });
      setElapsed(ms);
      setPhase("recorded");
      if (stopReason.current === "cap") setNotice(RECORD_COPY.capped);
      if (stopReason.current === "interrupted") setNotice(RECORD_COPY.interrupted);
    };
    // The microphone gone (another app took it) or silenced under us (a call,
    // Siri): stop the take rather than record silence.
    media.getAudioTracks().forEach((track) => {
      track.onended = () => stop("interrupted");
      track.onmute = () => stop("interrupted");
    });
    recorder.current = active;
    stopReason.current = "user";
    active.start(1000);
    setElapsed(0);
    setPhase("recording");
    tick.current = window.setInterval(() => {
      const ms = performance.now() - startedAt;
      setElapsed(ms);
      if (ms >= RECORDER_MAX_MS) stop("cap");
    }, 200);
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
      };
      wakeLock.current = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      // No wake lock (older Safari, a denied request): the take still records.
    }
  }

  async function upload(file: Blob, name: string) {
    setError(null);
    const problem = recordingFileError({ type: file.type, size: file.size, name });
    if (problem) return setError(problem);
    const backTo = take ? "recorded" : "idle";
    setPhase("uploading");
    setUploadPercent(0);

    let target = reserved.current?.file === file ? reserved.current.target : null;
    if (!target) {
      const minted = await postJson<RecordingUploadUrlResponse>(
        `/api/businesses/${businessId}/recordings/upload-url`,
        { type: file.type, size: file.size, name },
      );
      if (!alive.current) return;
      if (!minted.ok) {
        setPhase(backTo);
        if (minted.status === 403 || minted.status === 404) return onFatal(minted.error);
        return setError(minted.error); // includes the daily pool's 429
      }
      target = minted.body;
      reserved.current = { file, target };
    }
    const put = putWithProgress(target.uploadUrl, file, target.contentType, setUploadPercent);
    abortUpload.current = put.abort;
    const outcome = await put.promise;
    abortUpload.current = null;
    if (!alive.current) return;
    if (outcome === "aborted") return setPhase(backTo);
    if (outcome === "failed") {
      setPhase(backTo);
      return setError(RECORD_COPY.uploadFailed);
    }
    const registered = await postJson<{ recordingId: string }>(
      `/api/businesses/${businessId}/recordings`,
      { uploadPath: target.uploadPath },
    );
    if (!alive.current) return;
    if (!registered.ok) {
      setPhase(backTo);
      if (registered.status === 403 || registered.status === 404) return onFatal(registered.error);
      return setError(registered.error);
    }
    reserved.current = null;
    onRecorded({ id: registered.body.recordingId, status: "queued", startedAt: Date.now() });
  }

  function submitTake() {
    if (!take) return;
    const tooShortOrLong = recordingLengthError(take.ms);
    if (tooShortOrLong) return setError(tooShortOrLong);
    void upload(take.blob, recordedFileName(take.mime));
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice(null);
    const problem = recordingFileError({ type: file.type, size: file.size, name: file.name });
    if (problem) return setError(problem);
    const ms = await readDuration(file);
    const lengthProblem = ms === undefined ? undefined : recordingLengthError(ms);
    if (lengthProblem) return setError(lengthProblem);
    discardTake();
    void upload(file, file.name);
  }

  const busy = phase === "uploading";
  const live = phase === "recording" || phase === "starting";

  return (
    <div>
      <StepHeader
        title={RECORD_COPY.title}
        sub={scriptText ? RECORD_COPY.subWithScript : RECORD_COPY.subFree}
        onBack={live || busy ? undefined : onBack}
      />

      {existingRecording && phase === "idle" && !take && (
        <Button type="button" size="lg" className="mt-5 w-full" onClick={onContinueExisting}>
          {RECORD_COPY.continueExisting}
        </Button>
      )}

      {/* The controls stay pinned while the script scrolls under them: a
          teleprompter that scrolls the stop button away is not one. */}
      <div className="sticky top-0 z-10 -mx-6 mt-5 border-b border-ink/[0.06] bg-white px-6 py-3 sm:-mx-10 sm:px-10">
        <div className="flex items-center gap-3">
          {phase === "recording" ? (
            <Button type="button" size="lg" className="flex-1" onClick={() => stop("user")}>
              <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-red-600" />
              {RECORD_COPY.stop}
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              variant={take || existingRecording ? "secondary" : "primary"}
              className="flex-1"
              disabled={busy || phase === "starting"}
              loading={phase === "starting"}
              onClick={() => void start()}
            >
              {take ? RECORD_COPY.again : RECORD_COPY.start}
            </Button>
          )}
          {/* Not a live region: a screen reader reading the clock every
              second would be recorded along with the customer. */}
          <span className="min-w-[6.5rem] text-center text-sm tabular-nums text-ink/70">
            {recorderClockLine(elapsed)}
          </span>
        </div>

        {take && !live && (
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <audio controls src={take.url} className="w-full sm:flex-1" />
            <Button type="button" size="lg" disabled={busy} onClick={submitTake}>
              {RECORD_COPY.use}
            </Button>
          </div>
        )}

        {busy && (
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-sm text-ink/60" aria-live="polite">
              {RECORD_COPY.uploading} <span dir="ltr">{uploadPercent}%</span>
            </p>
            <Button type="button" variant="ghost" onClick={() => abortUpload.current?.()}>
              {RECORD_COPY.cancelUpload}
            </Button>
          </div>
        )}
      </div>

      {notice && <p className="mt-3 text-sm text-amber-800">{notice}</p>}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {scriptText && (
        <div className="mt-4">
          <p className="text-[13px] text-ink/55">{RECORD_COPY.scriptLabel}</p>
          <div className="mt-1 max-h-[max(9rem,calc(100dvh-27rem))] overflow-y-auto rounded-xl border border-ink/[0.08] bg-ink/[0.02] px-4 py-3 text-lg leading-8 whitespace-pre-wrap text-ink">
            {scriptText}
          </div>
        </div>
      )}

      <div className="mt-5">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="w-full"
          disabled={live || busy}
          onClick={() => fileInput.current?.click()}
        >
          {RECORD_COPY.upload}
        </Button>
        <p className="mt-1.5 text-center text-[13px] text-ink/55">{RECORD_COPY.uploadHint}</p>
        <input
          ref={fileInput}
          type="file"
          accept={RECORDING_ACCEPT}
          className="hidden"
          onChange={(event) => {
            void pickFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
