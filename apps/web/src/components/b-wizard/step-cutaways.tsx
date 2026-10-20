"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipVideo, useClipPlayer, type ClipPlayer } from "@/components/a-wizard/clip-player";
import { StepDemo } from "@/components/a-wizard/step-demo";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { Play, Spinner } from "@/components/ui/icons";
import { AUDIO_SCRIPT_LABEL } from "@/lib/quote-ui";
import {
  analysisIndexBatches,
  analysisWaitView,
  isAnalysisWorkingStatus,
  type AnalysisStateWire,
  type DemoState,
  type JobProgressWire,
} from "@/lib/service-a-ui";
import {
  CUTAWAY_COPY,
  cutawayScriptRuns,
  cutawaySeconds,
  type CutawayPlanWire,
} from "@/lib/service-b-ui";
import { apiFetch, postJson, useJobPoll } from "@/lib/use-api";
import { CutawayPicker } from "./cutaway-picker";

type StepCutawaysProps = {
  businessId: string;
  audioId: string;
  /** The final hook text the slots are laid out from ('' = none; cutawayHookText). */
  hookText: string;
  demo: DemoState | null;
  setDemo: (demo: DemoState | null) => void;
  /** The live plan, or null — the shell decides liveness (liveCutawayPlan). */
  plan: CutawayPlanWire | null;
  setPlan: (plan: CutawayPlanWire | null) => void;
  onBack: () => void;
  onContinue: () => void;
  /** Continue without cutaways: the option goes off and the flow is today's. */
  onSkip: () => void;
  onFatal: (message: string) => void;
};

type AnalysisPoll = {
  status: string;
  failReason?: string;
  job?: JobProgressWire;
  requestedElapsedMs?: number;
};

/**
 * Demo cutaways (vault 0121), the step after the effect step when the customer
 * ticked the option on the audio card. In phases: pick (or upload) a demo with
 * Service A's own picker; wait for its analysis (once per demo, free here);
 * draft the slots — the demo in order, no model call — and show each slot with
 * the words it covers; correct any one in the window picker. The draft is
 * requested when a demo's analysis is ready and no live plan is held, never on
 * a revisit of a held plan; a new hook text makes the held plan stale, so the
 * step drafts again (founder, 2026-10-20).
 */
export function StepCutaways({
  businessId,
  audioId,
  hookText,
  demo,
  setDemo,
  plan,
  setPlan,
  onBack,
  onContinue,
  onSkip,
  onFatal,
}: StepCutawaysProps) {
  const demoReady = demo?.status === "ready";
  const [analysis, setAnalysis] = useState<AnalysisPoll | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  /** The slot being corrected in the picker; null = the slot list. */
  const [editing, setEditing] = useState<number | null>(null);
  const requested = useRef<string | null>(null);

  // A different demo: its analysis, error and picker state start over.
  useEffect(() => {
    setAnalysis(null);
    setDraftError(null);
    setEditing(null);
  }, [demo?.id]);

  // analyze_demo runs on the heavy lane behind renders: minutes, not seconds —
  // the same gentle poll and wait view Service A's plan step shows.
  const waitingForAnalysis =
    demoReady &&
    plan === null &&
    (analysis === null ||
      analysis.status === "missing" ||
      isAnalysisWorkingStatus(analysis.status));
  const analysisPoll = useJobPoll<AnalysisPoll>(
    waitingForAnalysis,
    `/api/demos/${demo?.id}/analysis`,
    3_000,
    (body) => setAnalysis(body),
    onFatal,
    () => setAnalysis({ status: "missing" }),
  );

  const draftKey = `${demo?.id}|${audioId}|${hookText}|${retryNonce}`;
  useEffect(() => {
    if (!demoReady || !demo || plan !== null || analysis?.status !== "ready") return;
    if (requested.current === draftKey) return;
    requested.current = draftKey;
    void (async () => {
      setDrafting(true);
      setDraftError(null);
      const result = await postJson<CutawayPlanWire>(
        `/api/businesses/${businessId}/cutaway-plans`,
        { audioId, demoId: demo.id, hookText },
      );
      setDrafting(false);
      if (!result.ok) {
        if (result.status === 403 || result.status === 404) return onFatal(result.error);
        return setDraftError(result.error);
      }
      setPlan(result.body);
    })();
    // businessId/onFatal/setPlan are stable for the step's life; the key covers the rest.
  }, [demoReady, plan, analysis?.status, draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeDemo() {
    // Picking the same demo again must draft again.
    requested.current = null;
    setPlan(null);
    setDemo(null);
  }

  const skipButton = (
    <button
      type="button"
      onClick={onSkip}
      className="mt-4 w-full text-center text-sm text-ink/60 transition-colors duration-150 hover:text-ink"
    >
      {CUTAWAY_COPY.skip}
    </button>
  );

  if (!demoReady) {
    return (
      <div>
        <StepDemo
          variant="b"
          copy={{ title: CUTAWAY_COPY.pickTitle, sub: CUTAWAY_COPY.pickSub }}
          onBack={onBack}
          businessId={businessId}
          demo={demo}
          setDemo={setDemo}
          description=""
          setDescription={() => {}}
          onContinue={() => {}}
          onFatal={onFatal}
        />
        {skipButton}
      </div>
    );
  }

  return (
    <CutawayBody
      demoId={demo.id}
      plan={plan}
      editing={editing}
      setEditing={setEditing}
      businessId={businessId}
      setPlan={setPlan}
    >
      {(slots) => (
        <div>
          <StepHeader
            title={CUTAWAY_COPY.slotsTitle}
            sub={plan ? CUTAWAY_COPY.slotsSub : CUTAWAY_COPY.analysingSub}
            onBack={onBack}
          />

          {waitingForAnalysis &&
            !analysisPoll.stalled &&
            (() => {
              const view = analysisWaitView(analysis?.job, analysis?.requestedElapsedMs);
              if (view.kind === "failed") {
                return (
                  <p
                    role="alert"
                    className="mt-6 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700"
                  >
                    {CUTAWAY_COPY.analysisFailed}
                  </p>
                );
              }
              if (view.kind === "stuck") {
                return (
                  <p
                    role="alert"
                    className="mt-6 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
                  >
                    {view.line}
                  </p>
                );
              }
              return (
                <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-ink/[0.08] bg-white px-6 py-10 text-center">
                  <Spinner className="size-6 text-ink/60" />
                  <p className="text-sm text-ink/75">{view.line}</p>
                  {view.sub && <p className="text-sm text-ink/55">{view.sub}</p>}
                </div>
              );
            })()}
          {waitingForAnalysis && analysisPoll.stalled && (
            <div className="mt-6">
              <p role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
                {analysisPoll.stalled}
              </p>
              <Button
                type="button"
                variant="secondary"
                className="mt-4"
                onClick={analysisPoll.retry}
              >
                נסה שוב
              </Button>
            </div>
          )}

          {plan === null && (analysis?.status === "failed" || analysis?.status === "rejected") && (
            <p role="alert" className="mt-6 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
              {analysis.failReason ?? CUTAWAY_COPY.analysisFailed}
            </p>
          )}

          {drafting && (
            <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-ink/[0.08] bg-white px-6 py-10 text-center">
              <Spinner className="size-6 text-ink/60" />
              <p className="text-sm text-ink/75">{CUTAWAY_COPY.drafting}</p>
            </div>
          )}

          {draftError && !drafting && (
            <div className="mt-6">
              <p role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
                {draftError}
              </p>
              <Button
                type="button"
                variant="secondary"
                className="mt-4"
                onClick={() => setRetryNonce((n) => n + 1)}
              >
                נסה שוב
              </Button>
            </div>
          )}

          {plan && slots}

          {plan && (
            <Button type="button" size="lg" className="mt-6 w-full" onClick={onContinue}>
              {CUTAWAY_COPY.continue}
            </Button>
          )}
          <button
            type="button"
            onClick={changeDemo}
            className="mt-4 w-full text-center text-sm text-ink/60 transition-colors duration-150 hover:text-ink"
          >
            {CUTAWAY_COPY.changeDemo}
          </button>
          {skipButton}
        </div>
      )}
    </CutawayBody>
  );
}

/**
 * Signed thumbnails of analysis states, fetched by index in the route's
 * batches and kept for the step's life (the URLs outlive any one visit).
 */
function useStateThumbs(demoId: string) {
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const asked = useRef(new Set<number>());
  const want = useCallback(
    (indexes: number[]) => {
      const missing = indexes.filter((i) => !asked.current.has(i));
      if (missing.length === 0) return;
      for (const i of missing) asked.current.add(i);
      for (const batch of analysisIndexBatches(missing)) {
        void (async () => {
          const result = await apiFetch<{ states?: AnalysisStateWire[] }>(
            `/api/demos/${demoId}/analysis?indexes=${batch.join(",")}`,
          );
          if (!result.ok) {
            for (const i of batch) asked.current.delete(i);
            return;
          }
          const found = Object.fromEntries(
            (result.body.states ?? [])
              .filter((s) => s.thumbUrl)
              .map((s) => [s.index, s.thumbUrl!] as const),
          );
          setThumbs((current) => ({ ...current, ...found }));
        })();
      }
    },
    [demoId],
  );
  return { thumbs, want };
}

/** The slot list and the picker share one clip player and one thumbnail cache. */
function CutawayBody({
  demoId,
  plan,
  editing,
  setEditing,
  businessId,
  setPlan,
  children,
}: {
  demoId: string;
  plan: CutawayPlanWire | null;
  editing: number | null;
  setEditing: (index: number | null) => void;
  businessId: string;
  setPlan: (plan: CutawayPlanWire) => void;
  children: (slots: React.ReactNode) => React.ReactNode;
}) {
  const player = useClipPlayer(demoId);
  const { thumbs, want } = useStateThumbs(demoId);

  useEffect(() => {
    if (!plan) return;
    want(plan.slots.map((s) => s.stateIndex).filter((i): i is number => i !== null));
  }, [plan, want]);

  if (plan && editing !== null) {
    return (
      <CutawayPicker
        businessId={businessId}
        plan={plan}
        index={editing}
        player={player}
        thumbs={thumbs}
        wantThumbs={want}
        onSaved={(next) => {
          setPlan(next);
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <>
      {children(
        plan && <CutawaySlots plan={plan} player={player} thumbs={thumbs} onEdit={setEditing} />,
      )}
    </>
  );
}

/** The script with each slot's words marked, then one row per slot. */
function CutawaySlots({
  plan,
  player,
  thumbs,
  onEdit,
}: {
  plan: CutawayPlanWire;
  player: ClipPlayer;
  thumbs: Record<number, string>;
  onEdit: (index: number) => void;
}) {
  const runs = cutawayScriptRuns(plan.words, plan.slots);
  return (
    <>
      <div className="mt-6">
        <p className="text-[13px] text-ink/55">{AUDIO_SCRIPT_LABEL}</p>
        <p className="mt-1 text-sm leading-relaxed text-ink/75">
          {runs.map((run, i) =>
            run.slot === null ? (
              <span key={i}>{run.text} </span>
            ) : (
              <span key={i}>
                <mark className="rounded bg-accent/25 px-0.5 text-ink">
                  {run.text}
                  <sup className="ms-0.5 text-[10px] font-semibold">{run.slot + 1}</sup>
                </mark>{" "}
              </span>
            ),
          )}
        </p>
      </div>
      <ol className="mt-5 flex flex-col gap-2">
        {plan.slots.map((slot, k) => {
          const target = {
            key: `slot-${k}-${slot.demoStartMs}`,
            startMs: slot.demoStartMs,
            endMs: slot.demoStartMs + slot.lengthMs,
          };
          const playing = player.active?.key === target.key;
          const thumb = slot.stateIndex === null ? undefined : thumbs[slot.stateIndex];
          return (
            <li
              key={k}
              className="flex items-center gap-3 rounded-xl border border-ink/[0.08] bg-white p-3"
            >
              <span className="relative block aspect-[9/16] w-12 shrink-0 overflow-hidden rounded-lg bg-ink/10">
                {thumb && (
                  // Signed, short-lived URL — next/image optimization would break it.
                  <img src={thumb} alt="" className="absolute inset-0 size-full object-cover" />
                )}
                {playing && <ClipVideo player={player} />}
                <button
                  type="button"
                  aria-label={playing ? "עצירת התצוגה" : CUTAWAY_COPY.play}
                  onClick={() => (playing ? player.stop() : player.play(target))}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  {!playing && (
                    <span className="flex size-7 items-center justify-center rounded-full bg-ink/60 text-white">
                      <Play className="size-3.5 translate-x-[1px]" />
                    </span>
                  )}
                </button>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">
                  {CUTAWAY_COPY.slotLabel(k + 1, cutawaySeconds(slot.lengthMs))}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-[13px] text-ink/60">
                  {plan.words.slice(slot.wordFrom, slot.wordTo).join(" ")}
                </span>
              </span>
              <Button type="button" variant="secondary" onClick={() => onEdit(k)}>
                {CUTAWAY_COPY.change}
              </Button>
            </li>
          );
        })}
      </ol>
    </>
  );
}
