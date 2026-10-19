"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TRANSCRIPT_EMPTY, transcriptWordError } from "@aiugc/core/own-voice";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Spinner } from "@/components/ui/icons";
import { ADD_CREDITS_LINK } from "@/lib/plans-ui";
import { hasShortfall, quoteLine, shortfallLine } from "@/lib/quote-ui";
import type { RecordingApproveResponse, RecordingPollResponse } from "@/lib/service-b";
import {
  keptWords,
  RECORDING_STUCK_AFTER_MS,
  TRANSCRIPT_COPY,
  type OwnVoiceApproval,
  type RecordingState,
  type TranscriptEdits,
} from "@/lib/service-b-ui";
import { postJson, useJobPoll } from "@/lib/use-api";

type StepTranscriptProps = {
  personaId: string;
  recording: RecordingState;
  setRecording: (recording: RecordingState) => void;
  edits: TranscriptEdits;
  setEdits: (edits: TranscriptEdits) => void;
  /** The pair the last approval made — reused when nothing changed since. */
  approval: OwnVoiceApproval | null;
  onApproved: (approval: OwnVoiceApproval) => void;
  /** Back to the recorder, this recording kept (it can be continued there). */
  onBack: () => void;
  /** Back to the recorder, this recording dropped. */
  onRecordAgain: () => void;
  onFatal: (message: string) => void;
};

/**
 * The own-voice audio gate (decision 0118, locked #5). The customer hears the
 * processed recording — the very file HeyGen will lip-sync — reads what was
 * heard word by word, respells or drops words (never adds: there is no control
 * for it, and the server refuses one), sees the price of a render this long,
 * and approves. Approving charges nothing.
 */
export function StepTranscript({
  personaId,
  recording,
  setRecording,
  edits,
  setEdits,
  approval,
  onApproved,
  onBack,
  onRecordAgain,
  onFatal,
}: StepTranscriptProps) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** False once the step has unmounted: a late approval must not move the wizard. */
  const alive = useRef(true);
  const editorRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // The editor sits under the whole transcript: bring it into view when a
  // word is tapped, and give a dropped word's "restore" the focus.
  useEffect(() => {
    if (editing === null) return;
    editorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    editorRef.current?.querySelector<HTMLButtonElement>("[data-restore]")?.focus();
  }, [editing]);

  const processing = recording.status === "queued" || recording.status === "generating";

  const { stalled, retry } = useJobPoll<RecordingPollResponse>(
    processing,
    `/api/recordings/${recording.id}`,
    2_000,
    (body) => setRecording({ ...recording, ...body }),
    onFatal,
  );

  // The stuck clock: a dead worker keeps the poll healthy forever.
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [processing]);
  const stuck = processing && now - recording.startedAt > RECORDING_STUCK_AFTER_MS;

  const words = recording.words ?? [];
  const kept = keptWords(words, edits);
  const keptKey = JSON.stringify(kept);
  const quote = recording.quote ?? null;

  function openEditor(i: number) {
    setError(null);
    setEditing(i);
    setDraft(edits[i]?.text ?? words[i]!.text);
  }

  function saveWord() {
    if (editing === null) return;
    const problem = transcriptWordError(draft);
    if (problem) return setError(problem);
    const text = draft.trim();
    const next = { ...edits };
    if (text === words[editing]!.text) delete next[editing];
    else next[editing] = { text };
    setEdits(next);
    setEditing(null);
  }

  function setDropped(i: number, dropped: boolean) {
    const next = { ...edits };
    if (dropped) next[i] = { ...next[i], dropped: true };
    else if (next[i]?.text) next[i] = { text: next[i]!.text };
    else delete next[i];
    setEdits(next);
    setEditing(null);
  }

  async function approve() {
    if (approval && approval.recordingId === recording.id && approval.keptKey === keptKey) {
      return onApproved(approval);
    }
    setError(null);
    setApproving(true);
    const result = await postJson<RecordingApproveResponse>(
      `/api/recordings/${recording.id}/approve`,
      { personaId, kept },
    );
    if (!alive.current) return;
    setApproving(false);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setError(result.error);
    }
    onApproved({ ...result.body, recordingId: recording.id, keptKey });
  }

  return (
    <div>
      <StepHeader
        title={TRANSCRIPT_COPY.title}
        sub={TRANSCRIPT_COPY.sub}
        onBack={approving ? undefined : onBack}
      />

      {processing && stalled && (
        <div className="mt-6">
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
            {stalled}
          </p>
          <Button type="button" variant="secondary" className="mt-4" onClick={retry}>
            נסה שוב
          </Button>
        </div>
      )}

      {processing && !stalled && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-ink/[0.08] bg-white px-6 py-10 text-center">
          <Spinner className="size-6 text-ink/60" />
          <p className="text-sm text-ink/75">{TRANSCRIPT_COPY.processing}</p>
          {stuck && (
            <>
              <p className="text-sm text-amber-800">{TRANSCRIPT_COPY.stuck}</p>
              <Button type="button" variant="secondary" onClick={onRecordAgain}>
                {TRANSCRIPT_COPY.again}
              </Button>
            </>
          )}
        </div>
      )}

      {recording.status === "failed" && (
        <div className="mt-6">
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
            {recording.error}
          </p>
          <Button type="button" variant="secondary" className="mt-4" onClick={onRecordAgain}>
            {TRANSCRIPT_COPY.again}
          </Button>
        </div>
      )}

      {recording.status === "ready" && (
        <div className="mt-6">
          {recording.audioUrl && (
            <audio controls controlsList="nodownload" src={recording.audioUrl} className="w-full" />
          )}

          {/* Every heard word, in order. A tap opens its editor; a dropped
              word stays visible, struck through, so it can come back. */}
          <p className="mt-5 text-lg leading-10 text-ink">
            {words.map((word, i) => {
              const edit = edits[i];
              return (
                <span key={i}>
                  <button
                    type="button"
                    onClick={() => openEditor(i)}
                    className={`rounded-md px-1 py-0.5 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ink ${
                      edit?.dropped
                        ? "text-ink/35 line-through"
                        : edit?.text
                          ? "bg-accent/25"
                          : "hover:bg-ink/[0.06]"
                    } ${editing === i ? "ring-2 ring-accent" : ""}`}
                  >
                    {edit?.text ?? word.text}
                    {edit?.dropped && <span className="sr-only"> {TRANSCRIPT_COPY.droppedSr}</span>}
                  </button>{" "}
                </span>
              );
            })}
          </p>

          {editing !== null && (
            <div ref={editorRef} className="mt-3 rounded-xl border border-ink/[0.08] bg-white p-4">
              {edits[editing]?.dropped ? (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    type="button"
                    className="flex-1"
                    data-restore
                    onClick={() => setDropped(editing, false)}
                  >
                    {TRANSCRIPT_COPY.restore}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex-1"
                    onClick={() => setEditing(null)}
                  >
                    {TRANSCRIPT_COPY.cancel}
                  </Button>
                </div>
              ) : (
                <>
                  <TextField
                    label={TRANSCRIPT_COPY.fixLabel}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      // One word: the space bar would start a second one.
                      if (event.key === " ") event.preventDefault();
                      if (event.key === "Enter") saveWord();
                    }}
                    autoFocus
                  />
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                    <Button type="button" className="flex-1" onClick={saveWord}>
                      {TRANSCRIPT_COPY.save}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      className="flex-1"
                      onClick={() => setDropped(editing, true)}
                    >
                      {TRANSCRIPT_COPY.drop}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="flex-1"
                      onClick={() => setEditing(null)}
                    >
                      {TRANSCRIPT_COPY.cancel}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
              {error}
            </p>
          )}
          {kept.length === 0 && <p className="mt-4 text-sm text-amber-800">{TRANSCRIPT_EMPTY}</p>}

          {/* The price of a render this long — the render step's own lines. */}
          {quote && !hasShortfall(quote) && (
            <p className="mt-5 text-[13px] text-ink/60">{quoteLine(quote)}</p>
          )}
          {hasShortfall(quote) && (
            <>
              <p
                role="alert"
                className="mt-5 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700"
              >
                {shortfallLine(quote!)}
              </p>
              <Link
                href="/home/plan"
                className="mt-2 inline-block text-sm text-ink/70 underline decoration-ink/25 underline-offset-4 transition-colors duration-150 hover:text-ink"
              >
                {ADD_CREDITS_LINK}
              </Link>
            </>
          )}

          <Button
            type="button"
            size="lg"
            className="mt-6 w-full"
            loading={approving}
            disabled={kept.length === 0 || editing !== null}
            onClick={() => void approve()}
          >
            {TRANSCRIPT_COPY.approve}
          </Button>
          <button
            type="button"
            onClick={onRecordAgain}
            disabled={approving}
            className="mt-4 w-full text-center text-sm text-ink/60 transition-colors duration-150 hover:text-ink disabled:pointer-events-none disabled:opacity-50"
          >
            {TRANSCRIPT_COPY.again}
          </button>
        </div>
      )}
    </div>
  );
}
