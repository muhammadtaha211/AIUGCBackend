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
  cutawayColour,
  cutawayEdits,
  cutawayLetter,
  cutawayPhrases,
  cutawayScriptRuns,
  cutawaySeconds,
  cutawayWords,
  longHeadRuns,
  nextCutawayId,
  placeCutawayAt,
  type CutawayEditWire,
  type CutawayPlanWire,
  type CutawaySlotWire,
} from "@/lib/service-b-ui";
import { apiFetch, postJson, useJobPoll } from "@/lib/use-api";
import { CutawayChip } from "./cutaway-chip";
import { CutawayPicker } from "./cutaway-picker";

type StepCutawaysProps = {
  businessId: string;
  audioId: string;
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

/** What the step shows instead of the clip list: a clip's window picker, or
 *  the script's phrases to move a clip to or add one at. */
type CutawayMode = { kind: "window"; id: number } | { kind: "move"; id: number } | { kind: "add" };

/**
 * Demo cutaways (vault 0121, 0122), the step right after the audio card where
 * the customer ticked the option — the effect comes after it. In phases: pick
 * (or upload) a demo with Service A's own picker; wait for its analysis (once
 * per demo, free here); draft the clips — from where the script first names
 * the product, the demo in order, no model call — and show each with the words
 * it covers. Then the customer changes any clip's footage in the window
 * picker, moves a clip to another phrase, adds one or removes one, each saved
 * at once; a long run of the character is noted, never blocked. The draft is
 * requested when a demo's analysis is ready and no live plan is held, never on
 * a revisit of a held plan.
 */
export function StepCutaways({
  businessId,
  audioId,
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
  /** The picker or phrase choice open over the clip list; null = the list. */
  const [mode, setMode] = useState<CutawayMode | null>(null);
  const requested = useRef<string | null>(null);

  // A different demo: its analysis, error and picker state start over.
  useEffect(() => {
    setAnalysis(null);
    setDraftError(null);
    setMode(null);
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

  const draftKey = `${demo?.id}|${audioId}|${retryNonce}`;
  useEffect(() => {
    if (!demoReady || !demo || plan !== null || analysis?.status !== "ready") return;
    if (requested.current === draftKey) return;
    requested.current = draftKey;
    void (async () => {
      setDrafting(true);
      setDraftError(null);
      const result = await postJson<CutawayPlanWire>(
        `/api/businesses/${businessId}/cutaway-plans`,
        { audioId, demoId: demo.id },
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

  const skipButton = (disabled = false) => (
    <button
      type="button"
      onClick={onSkip}
      disabled={disabled}
      className="mt-4 w-full text-center text-sm text-ink/60 transition-colors duration-150 hover:text-ink disabled:opacity-50"
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
        {skipButton()}
      </div>
    );
  }

  return (
    <CutawayBody
      demoId={demo.id}
      plan={plan}
      mode={mode}
      setMode={setMode}
      businessId={businessId}
      setPlan={setPlan}
      onFatal={onFatal}
    >
      {(slots, saving) => (
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

          {/* A clip edit still saving holds the step: leaving now would carry
              the list as it was before it. */}
          {plan && (
            <Button
              type="button"
              size="lg"
              className="mt-6 w-full"
              disabled={saving}
              onClick={onContinue}
            >
              {CUTAWAY_COPY.continue}
            </Button>
          )}
          <button
            type="button"
            onClick={changeDemo}
            disabled={saving}
            className="mt-4 w-full text-center text-sm text-ink/60 transition-colors duration-150 hover:text-ink disabled:opacity-50"
          >
            {CUTAWAY_COPY.changeDemo}
          </button>
          {skipButton(saving)}
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

/**
 * The clip list, the window picker and the phrase choice share one clip
 * player, one thumbnail cache and one save: every change — a window, a move,
 * an add, a remove — PATCHes the whole list with the version it was made on.
 */
function CutawayBody({
  demoId,
  plan,
  mode,
  setMode,
  businessId,
  setPlan,
  onFatal,
  children,
}: {
  demoId: string;
  plan: CutawayPlanWire | null;
  mode: CutawayMode | null;
  setMode: (mode: CutawayMode | null) => void;
  businessId: string;
  setPlan: (plan: CutawayPlanWire) => void;
  onFatal: (message: string) => void;
  children: (slots: React.ReactNode, saving: boolean) => React.ReactNode;
}) {
  const player = useClipPlayer(demoId);
  const { thumbs, want } = useStateThumbs(demoId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!plan) return;
    want(plan.slots.map((s) => s.stateIndex).filter((i): i is number => i !== null));
  }, [plan, want]);

  /** One edit, saved at once; true when the server took it. */
  async function save(slots: CutawayEditWire[]): Promise<boolean> {
    if (!plan) return false;
    setSaving(true);
    setSaveError(null);
    const result = await apiFetch<CutawayPlanWire>(
      `/api/businesses/${businessId}/cutaway-plans/${plan.planId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: plan.updatedAt, slots }),
      },
    );
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) {
        setSaving(false);
        onFatal(result.error);
        return false;
      }
      setSaveError(
        result.status === 409 || result.status === 422 ? result.error : CUTAWAY_COPY.saveFailed,
      );
      // A 409 (another tab, or the demo's analysis replaced) or a lost
      // response: take the plan as the server now holds it — the same free,
      // idempotent request the step drafts with — so the next edit is made
      // on the right version instead of failing again.
      if (result.status !== 422) {
        const fresh = await postJson<CutawayPlanWire>(
          `/api/businesses/${businessId}/cutaway-plans`,
          { audioId: plan.audioId, demoId: plan.demoId },
        );
        if (fresh.ok) setPlan(fresh.body);
      }
      setSaving(false);
      return false;
    }
    setSaving(false);
    setPlan(result.body);
    return true;
  }

  function openMode(next: CutawayMode) {
    setSaveError(null);
    setMode(next);
  }

  function closeMode() {
    setSaveError(null);
    setMode(null);
  }

  const modeSlot =
    plan && mode && mode.kind !== "add" ? plan.slots.find((s) => s.id === mode.id) : undefined;

  if (plan && mode?.kind === "window" && modeSlot) {
    return (
      <CutawayPicker
        plan={plan}
        id={modeSlot.id}
        player={player}
        thumbs={thumbs}
        wantThumbs={want}
        saving={saving}
        error={saveError}
        onSave={async (demoStartMs) => {
          const edits = cutawayEdits(plan.slots).map((s) =>
            s.id === modeSlot.id ? { ...s, demoStartMs } : s,
          );
          if (await save(edits)) closeMode();
        }}
        onCancel={closeMode}
      />
    );
  }

  if (plan && (mode?.kind === "add" || (mode?.kind === "move" && modeSlot))) {
    const moving = modeSlot ?? null;
    return (
      <CutawayPhrasePick
        plan={plan}
        moving={moving}
        saving={saving}
        error={saveError}
        onPick={async (edit) => {
          const others = cutawayEdits(plan.slots).filter((s) => s.id !== edit.id);
          if (await save([...others, edit].sort((a, b) => a.fromMs - b.fromMs))) closeMode();
        }}
        onCancel={closeMode}
      />
    );
  }

  return (
    <>
      {children(
        plan && (
          <CutawaySlots
            plan={plan}
            player={player}
            thumbs={thumbs}
            saving={saving}
            error={saveError}
            onWindow={(id) => openMode({ kind: "window", id })}
            onMove={(id) => openMode({ kind: "move", id })}
            onAdd={() => openMode({ kind: "add" })}
            onRemove={(id) => void save(cutawayEdits(plan.slots).filter((s) => s.id !== id))}
          />
        ),
        saving,
      )}
    </>
  );
}

/** The phrases a clip may start on: where placeCutawayAt lands it, or null. */
function phraseOptions(plan: CutawayPlanWire, moving: CutawaySlotWire | null) {
  return cutawayPhrases(plan).map((phrase) => ({
    ...phrase,
    edit: placeCutawayAt(plan, moving, phrase.startMs),
  }));
}

/**
 * The script with each clip's words in its colour and its letter at the
 * start, the notes, then one card per clip — full width at every size: a
 * 9:16 preview that plays the clip's window when tapped, its words, and its
 * three actions.
 */
function CutawaySlots({
  plan,
  player,
  thumbs,
  saving,
  error,
  onWindow,
  onMove,
  onAdd,
  onRemove,
}: {
  plan: CutawayPlanWire;
  player: ClipPlayer;
  thumbs: Record<number, string>;
  saving: boolean;
  error: string | null;
  onWindow: (id: number) => void;
  onMove: (id: number) => void;
  onAdd: () => void;
  onRemove: (id: number) => void;
}) {
  const words = cutawayWords(plan);
  const runs = cutawayScriptRuns(words, plan.slots);
  const canAdd =
    nextCutawayId(plan.slots) !== undefined &&
    phraseOptions(plan, null).some((option) => option.edit !== null);
  return (
    <>
      <div className="mt-6">
        <p className="text-[13px] text-ink/55">{AUDIO_SCRIPT_LABEL}</p>
        <p className="mt-1 text-sm leading-loose text-ink/75">
          {runs.map((run, i) =>
            run.slot === null ? (
              <span key={i}>{run.text} </span>
            ) : (
              <span key={i}>
                <mark className={`rounded px-1 py-0.5 text-ink ${cutawayColour(run.slot).mark}`}>
                  <CutawayChip id={run.slot} className="me-1 align-[-4px]" />
                  {run.text}
                </mark>{" "}
              </span>
            ),
          )}
        </p>
        {longHeadRuns(plan).map((run) => (
          <p key={`${run.afterId}-${run.beforeId}`} className="mt-2 text-[13px] text-amber-700">
            {CUTAWAY_COPY.longRun(
              {
                after: run.afterId === null ? null : cutawayLetter(run.afterId),
                before: run.beforeId === null ? null : cutawayLetter(run.beforeId),
                byName: plan.mentionMethod !== "share",
              },
              cutawaySeconds(run.ms),
            )}
          </p>
        ))}
        {plan.slots.length === 0 && (
          <p className="mt-3 rounded-lg bg-ink/[0.04] px-3 py-2.5 text-sm text-ink/75">
            {canAdd ? CUTAWAY_COPY.emptyCanAdd : CUTAWAY_COPY.emptyNoFootage}
          </p>
        )}
      </div>

      <ol className="mt-5 flex flex-col gap-3">
        {plan.slots.map((slot) => (
          <CutawayCard
            key={slot.id}
            slot={slot}
            words={words}
            player={player}
            thumb={slot.stateIndex === null ? undefined : thumbs[slot.stateIndex]}
            canMove={phraseOptions(plan, slot).some(
              (option) => option.edit !== null && option.startMs !== slot.fromMs,
            )}
            saving={saving}
            onWindow={() => onWindow(slot.id)}
            onMove={() => onMove(slot.id)}
            onRemove={() => onRemove(slot.id)}
          />
        ))}
      </ol>

      {canAdd && (
        <Button
          type="button"
          variant="secondary"
          className="mt-3 w-full"
          disabled={saving}
          onClick={onAdd}
        >
          {CUTAWAY_COPY.add}
        </Button>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}
    </>
  );
}

const CARD_ACTION =
  "inline-flex h-11 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-lg border border-ink/15 bg-white px-1.5 text-[13px] font-medium text-ink transition-colors duration-150 hover:bg-ink/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50";

function CutawayCard({
  slot,
  words,
  player,
  thumb,
  canMove,
  saving,
  onWindow,
  onMove,
  onRemove,
}: {
  slot: CutawaySlotWire;
  words: string[];
  player: ClipPlayer;
  thumb: string | undefined;
  canMove: boolean;
  saving: boolean;
  onWindow: () => void;
  onMove: () => void;
  onRemove: () => void;
}) {
  const letter = cutawayLetter(slot.id);
  const target = {
    key: `slot-${slot.id}-${slot.demoStartMs}-${slot.lengthMs}`,
    startMs: slot.demoStartMs,
    endMs: slot.demoStartMs + slot.lengthMs,
  };
  const playing = player.active?.key === target.key;
  return (
    <li
      className={`rounded-xl border border-s-4 border-ink/[0.08] bg-white p-3 ${cutawayColour(slot.id).edge}`}
      aria-label={CUTAWAY_COPY.clipName(letter)}
    >
      <div className="flex flex-wrap gap-3">
        <span className="relative mx-auto block aspect-[9/16] w-36 shrink-0 overflow-hidden rounded-lg bg-ink/10">
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
              <span className="flex size-10 items-center justify-center rounded-full bg-ink/60 text-white">
                <Play className="size-5 translate-x-[1px]" />
              </span>
            )}
          </button>
        </span>
        <span className="min-w-[13rem] flex-1">
          <span className="flex items-center gap-2 text-sm font-medium text-ink">
            <CutawayChip id={slot.id} />
            {CUTAWAY_COPY.slotLabel(letter, cutawaySeconds(slot.lengthMs))}
          </span>
          <span className="mt-1.5 line-clamp-4 text-[13px] leading-relaxed text-ink/70">
            {words.slice(slot.wordFrom, slot.wordTo).join(" ")}
          </span>
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" className={CARD_ACTION} disabled={saving} onClick={onWindow}>
          {CUTAWAY_COPY.changeWindow}
        </button>
        <button
          type="button"
          className={CARD_ACTION}
          disabled={saving || !canMove}
          onClick={onMove}
        >
          {CUTAWAY_COPY.move}
        </button>
        <button type="button" className={CARD_ACTION} disabled={saving} onClick={onRemove}>
          {CUTAWAY_COPY.remove}
        </button>
      </div>
    </li>
  );
}

/**
 * Moving a clip, or adding one: the script as one button per caption phrase.
 * A phrase that can hold the clip is outlined in its colour; one that cannot
 * — under the hook text, inside another clip (tinted in that clip's colour),
 * too close to the next one or the end, or with no footage left — is dimmed
 * and inert. One tap places the clip and saves.
 */
function CutawayPhrasePick({
  plan,
  moving,
  saving,
  error,
  onPick,
  onCancel,
}: {
  plan: CutawayPlanWire;
  moving: CutawaySlotWire | null;
  saving: boolean;
  error: string | null;
  onPick: (edit: CutawayEditWire) => void;
  onCancel: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  // The phrases replace a list the customer may have scrolled far down.
  useEffect(() => root.current?.scrollIntoView({ block: "start" }), []);
  // They also mount right under the finger that opened them: the second tap
  // of a double-tap must not place a clip, so taps count after a beat.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), 400);
    return () => clearTimeout(timer);
  }, []);
  const id = moving?.id ?? nextCutawayId(plan.slots) ?? 1;
  const colour = cutawayColour(id);
  const options = phraseOptions(plan, moving);
  const coveredBy = (wordFrom: number) =>
    plan.slots.find((s) => wordFrom >= s.wordFrom && wordFrom < s.wordTo);
  return (
    <div ref={root} className="scroll-mt-24">
      <StepHeader
        title={moving ? CUTAWAY_COPY.clipName(cutawayLetter(id)) : CUTAWAY_COPY.add}
        sub={moving ? CUTAWAY_COPY.pickMove(cutawayLetter(id)) : CUTAWAY_COPY.pickAdd}
        onBack={onCancel}
      />
      {options.every((option) => option.edit === null) && (
        <p className="mt-4 text-sm text-amber-700">{CUTAWAY_COPY.pickNone}</p>
      )}
      <div className="mt-5 flex flex-wrap">
        {options.map((option) => {
          const owner = coveredBy(option.wordFrom);
          return (
            <button
              key={option.startMs}
              type="button"
              disabled={option.edit === null || saving}
              onClick={() => armed && option.edit && onPick({ ...option.edit, id })}
              className={`m-0.5 inline-flex min-h-11 items-center rounded-lg border-2 px-2 text-sm text-ink transition-colors duration-150 ${
                option.edit ? `${colour.ring} hover:bg-ink/[0.04]` : "border-transparent opacity-40"
              } ${owner ? cutawayColour(owner.id).mark : "bg-white"}`}
            >
              {option.text}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}
      <Button
        type="button"
        size="lg"
        variant="secondary"
        className="mt-6 w-full"
        onClick={onCancel}
      >
        {CUTAWAY_COPY.cancel}
      </Button>
    </div>
  );
}
