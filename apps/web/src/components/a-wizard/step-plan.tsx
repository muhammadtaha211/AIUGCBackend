"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HOOK_FRAME } from "@aiugc/core/hook-geometry";
import { MAX_LABEL_CHARS, totalRuntimeMs } from "@aiugc/core/plan-format";
import { fitFontSize, HOOK_FONT, STEP_LABEL_RECT } from "@aiugc/remotion/text-fit";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import {
  analysisIndexBatches,
  deleteWarning,
  draftBlockedReason,
  fmtTimestamp,
  isActivePlanStatus,
  isAnalysisWorkingStatus,
  labelWordWarning,
  planFailureNotice,
  planStepsDirty,
  retryOutcome,
  sortedPlanSteps,
  stepHeadroomMs,
  stepsPayload,
  type AnalysisStateWire,
  type PlanStepWire,
  type StepPlanWire,
} from "@/lib/service-a-ui";
import { apiFetch, patchJson, postJson, useJobPoll, type ApiResult } from "@/lib/use-api";
import { useHookLineMeasure } from "./placement-editor";

type StepPlanProps = {
  demoId: string;
  /** The chosen clip's real length — the steps-only total names it when known. */
  hookDurationMs?: number;
  onBack: () => void;
  onFatal: (message: string) => void;
};

const ALREADY_RUNNING = "התוכנית כבר נוצרת ברגעים אלה — אין צורך ללחוץ שוב.";

type PlanAction = "save" | "approve" | "fork";

/**
 * Step 4, the plan editor (8b): the generated step plan as chronological
 * cards — a live still preview (frame + label at render geometry), an editable
 * RTL label beside the state's visibleText, timestamp, ASSEMBLED duration and
 * live read-time headroom — plus delete, save, and the approve gate. Approved
 * plans go read-only; the explicit "edit a copy" button PATCHes the stored
 * steps, which forks a fresh unapproved row server-side (updatePlanSteps), and
 * the wizard adopts the fork. No reordering, no trim, no timeline — ever.
 *
 * Failure is the prior here, not the edge case: plan generation has failed 7
 * of 12 times all-time, so every one of the five states renders something the
 * customer can act on — including the 404s, which are NORMAL (no plan yet /
 * analysis row not inserted yet) and must never eject through onFatal.
 */
export function StepPlan({ demoId, hookDurationMs, onBack, onFatal }: StepPlanProps) {
  const [plan, setPlan] = useState<StepPlanWire | null>(null);
  /** The editable copy of a ready plan's steps, chronological. Reseeded from
   *  every server response (adoptPlan) — the response is the wizard's truth. */
  const [draft, setDraft] = useState<PlanStepWire[] | null>(null);
  const [actionBusy, setActionBusy] = useState<PlanAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Latest plan GET said 404 — a normal state, not an error. */
  const [planMissing, setPlanMissing] = useState(false);
  /** null = not fetched yet; "missing" = analysis GET 404s (job not started). */
  const [analysis, setAnalysis] = useState<{ status: string; failReason?: string } | null>(null);
  /** sourceIndex -> state, for the ready plan's cards. null while loading. */
  const [cards, setCards] = useState<Map<number, AnalysisStateWire> | null>(null);
  /** Mirror for the cards effect's missing-index check: reading `cards` there
   *  directly would make the effect depend on its own output. */
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const [cardsError, setCardsError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by the attach-retry button — the one recovery from a failed mount
   *  GET, which otherwise dead-ends (no poll runs and nothing clears error). */
  const [attachNonce, setAttachNonce] = useState(0);
  /** The last generate press was refused by a daily quota (429). Retrying
   *  cannot succeed until the rolling window clears and the customer cannot
   *  raise their own cap, so every "try again" control comes off the screen —
   *  the banner already says נסו שוב מחר, and a live button contradicts it. */
  const [quotaBlocked, setQuotaBlocked] = useState(false);

  /** Every plan body the server hands back becomes the whole truth at once —
   *  row and draft together, so the editor can never show one plan's labels
   *  over another plan's identity (saves and forks change both). */
  function adoptPlan(body: StepPlanWire) {
    setPlan(body);
    setDraft(body.status === "ready" ? sortedPlanSteps(body.steps) : null);
  }

  async function refreshAnalysis() {
    const result = await apiFetch<{ status: string; failReason?: string }>(
      `/api/demos/${demoId}/analysis`,
    );
    if (result.ok) {
      setError(null);
      return setAnalysis(result.body);
    }
    if (result.status === 404) return setAnalysis({ status: "missing" });
    if (result.status === 403) return onFatal(result.error);
    setError(result.error);
  }

  // Attach: one plan GET decides the branch; a 404 falls through to the
  // analysis poll below instead of an error anywhere.
  useEffect(() => {
    let cancelled = false;
    setPlan(null);
    setDraft(null);
    setActionError(null);
    setPlanMissing(false);
    setAnalysis(null);
    setCards(null);
    setLoaded(false);
    // Also on retry: a ready/failed plan starts no poll, so nothing else
    // would ever clear a stale banner — and while cleared, the loading
    // spinner (gated on !error) shows instead of a frozen alert.
    setError(null);
    void (async () => {
      const result = await apiFetch<StepPlanWire>(`/api/demos/${demoId}/plan`);
      if (cancelled) return;
      if (result.ok) adoptPlan(result.body);
      else if (result.status === 404) {
        setPlanMissing(true);
        await refreshAnalysis();
      } else if (result.status === 403) return onFatal(result.error);
      else setError(result.error);
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // refreshAnalysis reads only demoId; onFatal is a useState setter.
  }, [demoId, attachNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // No plan yet: wait for the analysis. analyze_demo runs on the HEAVY lane
  // behind renders, so the 404/pending window is minutes — poll gently and say
  // "queued", never spin silently and never read as failed.
  const waitingForAnalysis =
    loaded &&
    planMissing &&
    (analysis === null ||
      analysis.status === "missing" ||
      isAnalysisWorkingStatus(analysis.status));
  const analysisPoll = useJobPoll<{ status: string; failReason?: string }>(
    waitingForAnalysis,
    `/api/demos/${demoId}/analysis`,
    3_000,
    (body) => {
      // The world moved on — a stale attach-time error over a healthy flow
      // reads as a fatal problem that is not happening.
      setError(null);
      setAnalysis(body);
    },
    onFatal,
    () => setAnalysis({ status: "missing" }),
  );

  // A generating plan: poll until ready/failed. 404 here means the row we
  // were watching vanished — fall back to the empty state, not onFatal.
  const generating = plan !== null && isActivePlanStatus(plan.status);
  const planPoll = useJobPoll<StepPlanWire>(
    generating,
    `/api/demos/${demoId}/plan`,
    2_000,
    (body) => {
      setError(null);
      adoptPlan(body);
      if (!isActivePlanStatus(body.status)) setNotice(null);
    },
    onFatal,
    () => {
      setPlan(null);
      setPlanMissing(true);
      void refreshAnalysis();
    },
  );

  // Ready plan -> the cards' states, signed via batched ?indexes= requests.
  // Keyed by the INDEX SIGNATURE, not array identity: every poll body is a
  // fresh array, and identity-keying would blank rendered cards back to
  // skeletons and re-sign every thumb on a late-arriving duplicate.
  const readySteps = plan?.status === "ready" ? plan.steps : null;
  const cardsKey =
    readySteps && readySteps.length > 0
      ? [...new Set(readySteps.map((step) => step.sourceIndex))].join(",")
      : null;
  useEffect(() => {
    if (cardsKey === null) return;
    let cancelled = false;
    setCardsError(false);
    // Merge, never reset: after a save that deleted steps the key shrinks to
    // a subset we already hold, and clearing would blank every surviving card
    // back to a skeleton and re-sign its thumb for nothing. Only missing
    // indexes are fetched, batched — the route caps one request at
    // ANALYSIS_PAGE_SIZE signs, and a_steps_max can push a plan past it.
    // (Cross-demo staleness can't leak through the merge: the attach effect
    // resets cards to null before any new demo's plan can supply a key.)
    const missing = cardsKey
      .split(",")
      .map(Number)
      .filter((index) => !cardsRef.current?.has(index));
    if (missing.length === 0) return;
    const batches = analysisIndexBatches(missing);
    void (async () => {
      const results = await Promise.all(
        batches.map((batch) =>
          apiFetch<{ states?: AnalysisStateWire[] }>(
            `/api/demos/${demoId}/analysis?indexes=${batch.join(",")}`,
          ),
        ),
      );
      if (cancelled) return;
      const states: AnalysisStateWire[] = [];
      for (const result of results) {
        if (!result.ok) {
          if (result.status === 403) return onFatal(result.error);
          return setCardsError(true);
        }
        if (!result.body.states) return setCardsError(true);
        states.push(...result.body.states);
      }
      setCards(
        (prev) =>
          new Map([
            ...(prev ?? []),
            ...states.map((state): [number, AnalysisStateWire] => [state.index, state]),
          ]),
      );
    })();
    return () => {
      cancelled = true;
    };
    // onFatal is a useState setter; cardsKey changes only with the selection.
  }, [demoId, cardsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Generate / retry — one button, disabled through the collapse window. */
  async function requestPlan() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await postJson<{ planId: string }>(`/api/demos/${demoId}/plan`);
    setBusy(false);
    if (!result.ok) {
      if (result.status === 403) return onFatal(result.error);
      // 429 = the account's daily quota, not a transient failure. The route
      // rejects before it inserts a plan row, so there is nothing to poll and
      // nothing a second press can change.
      if (result.status === 429) setQuotaBlocked(true);
      // 409 = the analysis stopped being ready under us — re-read it, and
      // only then set the message: refreshAnalysis clears error on success,
      // which would wipe a message set before it resolved.
      if (result.status === 409) await refreshAnalysis();
      return setError(result.error);
    }
    setQuotaBlocked(false);
    if (retryOutcome(plan?.planId ?? null, result.body) === "already_running") {
      return setNotice(ALREADY_RUNNING);
    }
    setPlanMissing(false);
    adoptPlan({
      planId: result.body.planId,
      demoId,
      analysisId: "",
      status: "pending",
      steps: [],
    });
  }

  /** One editor action at a time; the response body is adopted as the truth.
   *  Non-403 failures — including the approve/edit 409s ("only ready plans…")
   *  — are normal states: the Hebrew shows inline and the surface stays. */
  async function runAction(action: PlanAction, request: () => Promise<ApiResult<StepPlanWire>>) {
    setActionBusy(action);
    setActionError(null);
    const result = await request();
    setActionBusy(null);
    if (!result.ok) {
      if (result.status === 403) return onFatal(result.error);
      return setActionError(result.error);
    }
    adoptPlan(result.body);
  }

  function saveDraft() {
    if (!plan || !draft) return;
    void runAction("save", () =>
      patchJson<StepPlanWire>(`/api/plans/${plan.planId}`, { steps: stepsPayload(draft) }),
    );
  }

  /** The approve gate — renders require it, server-enforced (createSet). */
  function approve() {
    if (!plan) return;
    void runAction("approve", () => postJson<StepPlanWire>(`/api/plans/${plan.planId}/approve`));
  }

  /** Change-after-approve: an explicit fork. PATCHing an approved plan clones
   *  its steps into a fresh unapproved row (updatePlanSteps); the approved row
   *  keeps its approval and every rendered ad keeps pointing at it via
   *  stepPlanId, so nothing already made can change under the customer. */
  function editCopy() {
    if (!plan) return;
    void runAction("fork", () =>
      patchJson<StepPlanWire>(`/api/plans/${plan.planId}`, {
        steps: stepsPayload(sortedPlanSteps(plan.steps)),
      }),
    );
  }

  function setLabel(sourceIndex: number, label: string) {
    setDraft((d) => d && d.map((s) => (s.sourceIndex === sourceIndex ? { ...s, label } : s)));
  }

  /** Delete removes the clip and the video gets shorter — no redistribution.
   *  The last card stays (the server rejects an empty plan). */
  function deleteStep(sourceIndex: number) {
    setDraft((d) => d && (d.length > 1 ? d.filter((s) => s.sourceIndex !== sourceIndex) : d));
  }

  function discardDraft() {
    if (plan) setDraft(sortedPlanSteps(plan.steps));
    setActionError(null);
  }

  const failure = plan?.status === "failed" ? planFailureNotice(plan.failReason) : null;

  return (
    <div>
      <StepHeader
        title="תוכנית הצעדים"
        sub="המערכת בוחרת מהסרטון שלכם את הצעדים שיופיעו במודעה, עם כיתוב לכל צעד."
        onBack={onBack}
      />

      {error && (
        <p role="alert" className="mt-6 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* A failed mount GET has no poll running and no other control on
          screen — without this button the banner says "try again" with
          nothing to press. */}
      {error && loaded && !plan && !planMissing && (
        <Button
          type="button"
          variant="secondary"
          className="mt-4"
          onClick={() => setAttachNonce((n) => n + 1)}
        >
          נסה שוב
        </Button>
      )}

      {!loaded && !error && (
        <div className="mt-8 flex items-center justify-center gap-2 py-10 text-sm text-ink/55">
          <Spinner /> טוענים את התוכנית…
        </div>
      )}

      {/* The analysis is still queued/running (heavy lane — minutes, not
          seconds). Queued, never "failed", never a silent spinner. */}
      {waitingForAnalysis && !analysisPoll.stalled && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-ink/[0.08] bg-white px-6 py-10 text-center">
          <Spinner className="size-6 text-ink/60" />
          <p className="text-sm text-ink/75">הסרטון בתור לניתוח — זה לוקח כמה דקות.</p>
          {analysisPoll.slow && (
            <p className="text-sm text-ink/55">עדיין עובד… אפשר להשאיר את החלון פתוח.</p>
          )}
        </div>
      )}
      {waitingForAnalysis && analysisPoll.stalled && (
        <div className="mt-6">
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
            {analysisPoll.stalled}
          </p>
          <Button type="button" variant="secondary" className="mt-4" onClick={analysisPoll.retry}>
            נסה שוב
          </Button>
        </div>
      )}

      {loaded &&
        planMissing &&
        (analysis?.status === "failed" || analysis?.status === "rejected") && (
          <p role="alert" className="mt-6 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
            {analysis.failReason ?? "ניתוח הסרטון נכשל — נסו סרטון אחר."}
          </p>
        )}

      {loaded && planMissing && analysis?.status === "ready" && (
        <div className="mt-6 rounded-xl border border-dashed border-ink/15 bg-ink/[0.04] px-6 py-10 text-center">
          <p className="text-sm text-ink/75">עוד אין תוכנית צעדים לסרטון הזה.</p>
          {!quotaBlocked && (
            <Button
              type="button"
              size="lg"
              className="mt-5"
              loading={busy}
              onClick={() => void requestPlan()}
            >
              צור תוכנית צעדים
            </Button>
          )}
        </div>
      )}

      {generating && !planPoll.stalled && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-ink/[0.08] bg-white px-6 py-10 text-center">
          <Spinner className="size-6 text-ink/60" />
          <p className="text-sm text-ink/75">בונים את תוכנית הצעדים…</p>
          {planPoll.slow && (
            <p className="text-sm text-ink/55">עדיין עובד… זה יכול לקחת עוד רגע.</p>
          )}
          {notice && <p className="text-sm text-ink/55">{notice}</p>}
        </div>
      )}
      {generating && planPoll.stalled && (
        <div className="mt-6">
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
            {planPoll.stalled}
          </p>
          <Button type="button" variant="secondary" className="mt-4" onClick={planPoll.retry}>
            נסה שוב
          </Button>
        </div>
      )}

      {failure && (
        <div className="mt-6">
          <div role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
            <p>{failure.message}</p>
            {failure.raw && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-red-700/80">פרטים טכניים</summary>
                <code dir="ltr" className="mt-1 block break-all text-xs text-red-700/80">
                  {failure.raw}
                </code>
              </details>
            )}
          </div>
          {/* Two ways the quota reaches this card: the route refused THIS
              client's press (quotaBlocked), or the plan JOB hit the cap at
              execution and stored the quota Hebrew as fail_reason
              (failure.retryable). Both must take the button away. */}
          {!quotaBlocked && failure.retryable && (
            <Button
              type="button"
              size="lg"
              className="mt-4"
              loading={busy}
              onClick={() => void requestPlan()}
            >
              נסה שוב
            </Button>
          )}
          {notice && <p className="mt-3 text-sm text-ink/60">{notice}</p>}
        </div>
      )}

      {plan?.status === "ready" && draft && (
        <PlanEditor
          plan={plan}
          draft={draft}
          cards={cards}
          cardsError={cardsError}
          hookDurationMs={hookDurationMs}
          actionBusy={actionBusy}
          actionError={actionError}
          onLabelChange={setLabel}
          onDelete={deleteStep}
          onDiscard={discardDraft}
          onSave={saveDraft}
          onApprove={approve}
          onEditCopy={editCopy}
        />
      )}
    </div>
  );
}

const fmtSeconds = (ms: number): string => `${Math.round(ms / 100) / 10}`;

/** Still-preview width in px. Fixed (not rem/fluid) so the frame→preview
 *  scale is a plain constant and no ResizeObserver is needed. */
const STILL_WIDTH = 150;

/**
 * The live still: the step's frame with the label overlaid in CSS at the
 * exact geometry the render burns — STEP_LABEL_RECT + fitFontSize, scaled to
 * the preview. Not a render, just an image; shrink-to-fit (and clipping past
 * it) is what tells the customer a line is too long. Styling mirrors HookLine
 * as ServiceASteps mounts it: weight 800, ACTIVE_WORD_COLOR yellow
 * (packages/remotion/src/overlays.tsx), four-way dark outline.
 */
function StepStill({ thumbUrl, label }: { thumbUrl?: string; label: string }) {
  const measure = useHookLineMeasure();
  const fontSize = useMemo(
    () =>
      fitFontSize({
        text: label,
        maxWidth: STEP_LABEL_RECT.w,
        maxHeight: STEP_LABEL_RECT.h,
        base: HOOK_FONT.base,
        min: HOOK_FONT.min,
        lineHeight: HOOK_FONT.lineHeight,
        measure,
      }),
    [label, measure],
  );
  const scale = STILL_WIDTH / HOOK_FRAME.width;
  // The composition's 5px outline lands sub-pixel at this scale — clamp to 1.
  const outline = Math.max(1, Math.round(5 * scale));
  return (
    <span
      className="relative block shrink-0 overflow-hidden rounded-lg bg-ink/10"
      style={{ width: STILL_WIDTH, aspectRatio: "9 / 16" }}
    >
      {thumbUrl ? (
        // Signed, short-lived URL — next/image optimization would break it.
        <img src={thumbUrl} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <span className="absolute inset-0 animate-pulse bg-ink/10" />
      )}
      <span
        className="absolute flex items-center justify-center overflow-hidden"
        style={{
          left: `${(STEP_LABEL_RECT.x / HOOK_FRAME.width) * 100}%`,
          top: `${(STEP_LABEL_RECT.y / HOOK_FRAME.height) * 100}%`,
          width: `${(STEP_LABEL_RECT.w / HOOK_FRAME.width) * 100}%`,
          height: `${(STEP_LABEL_RECT.h / HOOK_FRAME.height) * 100}%`,
          direction: "rtl",
          textAlign: "center",
          fontWeight: 800,
          fontSize: fontSize * scale,
          lineHeight: HOOK_FONT.lineHeight,
          color: "#FFE04A",
          textShadow: `${outline}px ${outline}px 0 rgba(0,0,0,0.92), ${-outline}px ${outline}px 0 rgba(0,0,0,0.92), ${outline}px ${-outline}px 0 rgba(0,0,0,0.92), ${-outline}px ${-outline}px 0 rgba(0,0,0,0.92)`,
        }}
      >
        {/* isolate, not plaintext — matches HookLine in the composition. */}
        <span style={{ unicodeBidi: "isolate" }}>{label}</span>
      </span>
    </span>
  );
}

/**
 * The cards plus the editor chrome. Unapproved: editable labels, delete,
 * save/discard, and the approve gate (approve hides while dirty — what gets
 * approved is always exactly what is saved). Approved: read-only cards, the
 * approval badge, and the explicit edit-a-copy fork.
 */
function PlanEditor({
  plan,
  draft,
  cards,
  cardsError,
  hookDurationMs,
  actionBusy,
  actionError,
  onLabelChange,
  onDelete,
  onDiscard,
  onSave,
  onApprove,
  onEditCopy,
}: {
  plan: StepPlanWire;
  draft: PlanStepWire[];
  cards: Map<number, AnalysisStateWire> | null;
  cardsError: boolean;
  hookDurationMs?: number;
  actionBusy: PlanAction | null;
  actionError: string | null;
  onLabelChange: (sourceIndex: number, label: string) => void;
  onDelete: (sourceIndex: number) => void;
  onDiscard: () => void;
  onSave: () => void;
  onApprove: () => void;
  onEditCopy: () => void;
}) {
  const approved = plan.approvedAt !== undefined;
  const dirty = planStepsDirty(draft, plan.steps);
  const blocked = draftBlockedReason(draft);
  const thinWarning = deleteWarning(draft.length);
  // Draft durations are the STORED assembly — a label/delete edit can widen a
  // step's window server-side, so pre-save numbers are conservative and the
  // save response corrects them.
  const totalMs = totalRuntimeMs(draft);
  return (
    <div className="mt-6">
      {plan.notes && (
        <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <p className="font-semibold">שימו לב</p>
          <p className="mt-0.5">{plan.notes}</p>
        </div>
      )}

      {cardsError && (
        <p role="alert" className="mt-3 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          לא הצלחנו לטעון את תמונות הצעדים — רעננו את הדף כדי לנסות שוב.
        </p>
      )}

      <ol className="mt-3 flex flex-col gap-2">
        {draft.map((step, position) => {
          const state = cards?.get(step.sourceIndex);
          // Live: the draft label's read time against the stored duration.
          const headroom = stepHeadroomMs(step);
          const wordWarning = labelWordWarning(step.label);
          return (
            <li
              key={step.sourceIndex}
              className="flex items-start gap-4 rounded-xl border border-ink/[0.08] bg-white p-3"
            >
              <StepStill thumbUrl={state?.thumbUrl} label={step.label} />
              <div className="min-w-0 flex-1">
                {approved ? (
                  <p className="text-sm font-medium text-ink">
                    {position + 1}. {step.label}
                  </p>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{position + 1}.</span>
                    <input
                      dir="rtl"
                      value={step.label}
                      maxLength={MAX_LABEL_CHARS}
                      // Disabled while a request is in flight: adoptPlan will
                      // reseed the draft from the response, and a keystroke
                      // raced against that reseed would be silently lost.
                      disabled={actionBusy !== null}
                      onChange={(event) => onLabelChange(step.sourceIndex, event.target.value)}
                      aria-label={`כיתוב לצעד ${position + 1}`}
                      className="w-full rounded-lg border border-ink/15 bg-white px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none disabled:opacity-60"
                    />
                  </div>
                )}
                {!approved && wordWarning && (
                  <p className="mt-1 text-[13px] text-amber-700">{wordWarning}</p>
                )}
                <p className="mt-1 text-[13px] text-ink/60">
                  <span dir="ltr">{fmtTimestamp(step.timestampMs)}</span> בסרטון · מוצג{" "}
                  {fmtSeconds(step.durationMs)} שנ׳
                </p>
                {/* A caption on screen for less than its read time is the exact
                    defect the model path rejects and a human edit allows. The
                    copy names the consequence and the remedy — "displayed X
                    less than its read time" confused the founder (user #1). */}
                {headroom < 0 ? (
                  <p className="mt-1 text-[13px] text-amber-700">
                    הצעד הזה קצר מדי לכיתוב — הוא ייחתך לצעד הבא לפני שיספיקו לקרוא אותו (חסרות{" "}
                    {fmtSeconds(-headroom)} שנ׳). קצרו את הכיתוב.
                  </p>
                ) : (
                  <p className="mt-1 text-[13px] text-ink/45">
                    מרווח קריאה {fmtSeconds(headroom)} שנ׳
                  </p>
                )}
                {state && state.visibleText.length > 0 && (
                  // In edit mode the list is the palette the customer picks
                  // words from — never clamp it there.
                  <p className={`mt-1.5 text-xs text-ink/50 ${approved ? "line-clamp-2" : ""}`}>
                    על המסך: {state.visibleText.join(" · ")}
                  </p>
                )}
                {!approved && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-1.5 !h-8 !px-2 text-[13px]"
                    disabled={draft.length === 1 || actionBusy !== null}
                    onClick={() => onDelete(step.sourceIndex)}
                  >
                    מחיקת הצעד
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {thinWarning && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          {thinWarning}
        </p>
      )}

      <p className="mt-3 text-sm text-ink/60">
        סך הצעדים: {fmtSeconds(totalMs)} שנ׳ — בלי הפתיח
        {hookDurationMs !== undefined
          ? `, שמוסיף עוד ${fmtSeconds(hookDurationMs)} שנ׳ בתחילת הסרטון`
          : ", שמתווסף בתחילת הסרטון"}
        .
      </p>

      {actionError && (
        <p role="alert" className="mt-3 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {approved ? (
        <div className="mt-5">
          <p className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800">
            התוכנית אושרה ✓
          </p>
          <p className="mt-2 text-[13px] text-ink/55">
            רוצים לשנות משהו? עריכה תיצור עותק חדש שידרוש אישור מחדש — סרטונים שכבר נוצרו
            ממשיכים להשתמש בתוכנית שאושרה.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-3"
            loading={actionBusy === "fork"}
            disabled={actionBusy !== null && actionBusy !== "fork"}
            onClick={onEditCopy}
          >
            עריכת עותק חדש
          </Button>
        </div>
      ) : (
        <div className="mt-5">
          {blocked && <p className="mb-2 text-[13px] text-red-700">{blocked}</p>}
          {/* Approve keeps ONE stable position and is disabled (never hidden)
              while dirty: if it swapped in where Save just was, the second
              click of an impatient double-click on Save would land on Approve
              and silently cross the hard render gate. Here nothing ever
              mounts into the spot the cursor is parked on. */}
          <Button
            type="button"
            size="lg"
            loading={actionBusy === "approve"}
            disabled={dirty || (actionBusy !== null && actionBusy !== "approve")}
            onClick={onApprove}
          >
            אישור התוכנית
          </Button>
          {dirty && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                loading={actionBusy === "save"}
                disabled={blocked !== null || (actionBusy !== null && actionBusy !== "save")}
                onClick={onSave}
              >
                שמירת השינויים
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={actionBusy !== null}
                onClick={onDiscard}
              >
                ביטול השינויים
              </Button>
            </div>
          )}
          <p className="mt-2 text-[13px] text-ink/55">
            {dirty
              ? "שמרו את השינויים כדי לאשר את התוכנית."
              : "אחרי האישור אפשר יהיה ליצור סרטונים מהתוכנית. עריכה אחרי האישור תיצור עותק חדש שידרוש אישור משלו."}
          </p>
        </div>
      )}
    </div>
  );
}
