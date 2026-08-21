"use client";

import { useEffect, useState } from "react";
import { totalRuntimeMs } from "@aiugc/core/plan-format";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import {
  analysisIndexBatches,
  fmtTimestamp,
  isActivePlanStatus,
  isAnalysisWorkingStatus,
  planFailureNotice,
  retryOutcome,
  sortedPlanSteps,
  stepHeadroomMs,
  type AnalysisStateWire,
  type StepPlanWire,
} from "@/lib/service-a-ui";
import { apiFetch, postJson, useJobPoll } from "@/lib/use-api";

type StepPlanProps = {
  demoId: string;
  /** The chosen clip's real length — the steps-only total names it when known. */
  hookDurationMs?: number;
  onBack: () => void;
  onFatal: (message: string) => void;
};

const ALREADY_RUNNING = "התוכנית כבר נוצרת ברגעים אלה — אין צורך ללחוץ שוב.";

/**
 * Step 4, read-only in 8a: the generated step plan as chronological cards —
 * thumbnail, label, timestamp, the state's visibleText, ASSEMBLED duration and
 * read-time headroom. No editing, no approve (both land with the editor in 8b).
 *
 * Failure is the prior here, not the edge case: plan generation has failed 7
 * of 12 times all-time, so every one of the five states renders something the
 * customer can act on — including the 404s, which are NORMAL (no plan yet /
 * analysis row not inserted yet) and must never eject through onFatal.
 */
export function StepPlan({ demoId, hookDurationMs, onBack, onFatal }: StepPlanProps) {
  const [plan, setPlan] = useState<StepPlanWire | null>(null);
  /** Latest plan GET said 404 — a normal state, not an error. */
  const [planMissing, setPlanMissing] = useState(false);
  /** null = not fetched yet; "missing" = analysis GET 404s (job not started). */
  const [analysis, setAnalysis] = useState<{ status: string; failReason?: string } | null>(null);
  /** sourceIndex -> state, for the ready plan's cards. null while loading. */
  const [cards, setCards] = useState<Map<number, AnalysisStateWire> | null>(null);
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
      if (result.ok) setPlan(result.body);
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
      setPlan(body);
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
    setCards(null);
    setCardsError(false);
    // Batched: the route caps one request at ANALYSIS_PAGE_SIZE signs, and
    // a_steps_max is a config knob that can push a plan past it.
    const batches = analysisIndexBatches(cardsKey.split(",").map(Number));
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
      setCards(new Map(states.map((state) => [state.index, state])));
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
    setPlan({
      planId: result.body.planId,
      demoId,
      analysisId: "",
      status: "pending",
      steps: [],
    });
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

      {plan?.status === "ready" && (
        <PlanCards
          plan={plan}
          cards={cards}
          cardsError={cardsError}
          hookDurationMs={hookDurationMs}
        />
      )}
    </div>
  );
}

const fmtSeconds = (ms: number): string => `${Math.round(ms / 100) / 10}`;

/** The read-only cards: chronological, one per plan step. */
function PlanCards({
  plan,
  cards,
  cardsError,
  hookDurationMs,
}: {
  plan: StepPlanWire;
  cards: Map<number, AnalysisStateWire> | null;
  cardsError: boolean;
  hookDurationMs?: number;
}) {
  const steps = sortedPlanSteps(plan.steps);
  const totalMs = totalRuntimeMs(plan.steps);
  return (
    <div className="mt-6">
      {plan.notes && (
        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">{plan.notes}</p>
      )}

      {cardsError && (
        <p role="alert" className="mt-3 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          לא הצלחנו לטעון את תמונות הצעדים — רעננו את הדף כדי לנסות שוב.
        </p>
      )}

      <ol className="mt-3 flex flex-col gap-2">
        {steps.map((step, position) => {
          const state = cards?.get(step.sourceIndex);
          const headroom = stepHeadroomMs(step);
          return (
            <li
              key={`${step.sourceIndex}-${step.timestampMs}`}
              className="flex items-start gap-4 rounded-xl border border-ink/[0.08] bg-white p-3"
            >
              {state?.thumbUrl ? (
                // Signed, short-lived URL — next/image optimization would break it.
                <img
                  src={state.thumbUrl}
                  alt=""
                  className="aspect-[9/16] w-14 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="aspect-[9/16] w-14 shrink-0 animate-pulse rounded-lg bg-ink/10" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  {position + 1}. {step.label}
                </p>
                <p className="mt-1 text-[13px] text-ink/60">
                  <span dir="ltr">{fmtTimestamp(step.timestampMs)}</span> בסרטון · מוצג{" "}
                  {fmtSeconds(step.durationMs)} שנ׳
                </p>
                {/* A caption on screen for less than its read time is the exact
                    defect the model path rejects and a human edit allows. */}
                {headroom < 0 ? (
                  <p className="mt-1 text-[13px] text-amber-700">
                    הכיתוב מוצג {fmtSeconds(-headroom)} שנ׳ פחות מזמן הקריאה שלו
                  </p>
                ) : (
                  <p className="mt-1 text-[13px] text-ink/45">
                    מרווח קריאה {fmtSeconds(headroom)} שנ׳
                  </p>
                )}
                {state && state.visibleText.length > 0 && (
                  <p className="mt-1.5 line-clamp-2 text-xs text-ink/50">
                    על המסך: {state.visibleText.join(" · ")}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-3 text-sm text-ink/60">
        סך הצעדים: {fmtSeconds(totalMs)} שנ׳ — בלי הפתיח
        {hookDurationMs !== undefined
          ? `, שמוסיף עוד ${fmtSeconds(hookDurationMs)} שנ׳ בתחילת הסרטון`
          : ", שמתווסף בתחילת הסרטון"}
        .
      </p>
    </div>
  );
}
