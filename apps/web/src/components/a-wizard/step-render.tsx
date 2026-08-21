"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { Check, Spinner } from "@/components/ui/icons";
import {
  A_RENDER_STAGES,
  aRenderStageIndex,
  isActiveARenderStatus,
  retryableCreateFailure,
  stepsShapeSummary,
  type HookClip,
  type HookLineOption,
  type PinnedPlan,
} from "@/lib/service-a-ui";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import { hasShortfall, quoteLine, shortfallLine, type QuoteView } from "@/lib/quote-ui";
import { failedRenderNotice, type RenderState } from "@/lib/service-b-ui";
import { apiFetch, postJson, useJobPoll } from "@/lib/use-api";

type StepARenderProps = {
  businessId: string;
  demoId: string;
  hook: HookClip;
  hookLine: HookLineOption;
  /** The hook-studio placement; null = the clip's default safe area. */
  rect: SafeRect | null;
  /** Pinned at continue-click time — a fork after the click cannot switch
   *  what renders (createSet's approval gate on this id is the backstop). */
  plan: PinnedPlan;
  render: RenderState | null;
  setRender: (render: RenderState | null) => void;
  onBack: () => void;
  onFatal: (message: string) => void;
};

/**
 * Step 5, steps format (8e): the flat price + the composition summary first,
 * then an explicit confirm enqueues the render. Everything heavy is local
 * (Remotion on the worker) — no VO, no ending, no lipsync — so the price is
 * one flat and the shape is one sentence. Nothing blocks except a shortfall.
 */
export function StepARender({
  businessId,
  demoId,
  hook,
  hookLine,
  rect,
  plan,
  render,
  setRender,
  onBack,
  onFatal,
}: StepARenderProps) {
  /** undefined = not loaded yet; null = admin bypass (nothing is charged). */
  const [quote, setQuote] = useState<QuoteView | undefined>(undefined);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<{ message: string; retryable: boolean } | null>(
    null,
  );
  const [starting, setStarting] = useState(false);
  /** The shortfall recheck's in-flight flag — its button disables while the
   *  fresh quote is loading, so one press means one GET. */
  const [rechecking, setRechecking] = useState(false);

  async function loadQuote() {
    setQuoteError(null);
    const result = await apiFetch<{ quote: QuoteView }>(
      `/api/businesses/${businessId}/a-sets/steps/quote`,
    );
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setQuoteError(result.error);
    }
    setQuote(result.body.quote);
  }

  // The price is informative, not a gate — load it once on entering the step.
  useEffect(() => {
    if (render === null && quote === undefined) void loadQuote();
    // loadQuote reads only props; render/quote gate the one-time fetch.
  }, [render, quote]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setStarting(true);
    setCreateError(null);
    const result = await postJson<{ renderId: string }>(
      `/api/businesses/${businessId}/a-sets/steps`,
      {
        demoId,
        stepPlanId: plan.planId,
        hookClipId: hook.id,
        hookLineScriptId: hookLine.scriptId,
        textSafeArea: rect ?? undefined,
      },
    );
    setStarting(false);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      // The balance moved under us — refresh the numbers the screen shows;
      // the shortfall gate on the FRESH quote is what disables the button.
      if (result.status === 402) void loadQuote();
      return setCreateError({
        message: result.error,
        retryable: retryableCreateFailure(result.status),
      });
    }
    setRender({ id: result.body.renderId, status: "queued" });
  }

  const inFlight = render !== null && isActiveARenderStatus(render.status);
  const {
    slow,
    stalled,
    retry: retryPolling,
  } = useJobPoll<{ status: string; videoUrl?: string; failureReason?: string; refunded?: boolean }>(
    inFlight,
    `/api/renders/${render?.id}`,
    2_500,
    (body) => {
      if (!render) return;
      setRender({
        ...render,
        status: body.status,
        videoUrl: body.videoUrl,
        failureReason: body.failureReason,
        refunded: body.refunded,
      });
    },
    onFatal,
  );

  // Before enqueue: the summary + the price + explicit confirm. Back allowed.
  if (render === null) {
    return (
      <div>
        <StepHeader
          title="ככה המודעה תיבנה"
          sub="מבנה הסרטון לפי התוכנית שאישרתם, אפשר לחזור אחורה ולשנות."
          onBack={onBack}
        />

        {quoteError && (
          <div className="mt-6">
            <p role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
              {quoteError}
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-4"
              onClick={() => void loadQuote()}
            >
              נסה שוב
            </Button>
          </div>
        )}

        {quote === undefined && !quoteError && (
          <div className="mt-8 flex items-center justify-center gap-2 py-10 text-sm text-ink/55">
            <Spinner /> טוענים את המחיר…
          </div>
        )}

        {quote !== undefined && (
          <>
            <p className="mt-6 rounded-xl border border-ink/[0.08] bg-white px-5 py-4 text-sm leading-relaxed text-ink/80">
              {stepsShapeSummary(plan, hook.durationMs)}
            </p>

            {/* The exact price, from the same function the confirm debits
                with. Absent entirely on the admin bypass. */}
            {quote && !hasShortfall(quote) && (
              <p className="mt-3 text-[13px] text-ink/60">{quoteLine(quote)}</p>
            )}
            {hasShortfall(quote) && (
              <p
                role="alert"
                className="mt-3 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700"
              >
                {shortfallLine(quote!)}
              </p>
            )}

            {createError && (
              <p
                role="alert"
                className="mt-3 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700"
              >
                {createError.message}
              </p>
            )}

            {/* A non-retryable failure (409: the pinned plan lost its gate)
                disables rather than hides — "try again" on it would lie. */}
            <Button
              type="button"
              size="lg"
              className="mt-7 w-full"
              loading={starting}
              disabled={hasShortfall(quote) || (createError !== null && !createError.retryable)}
              onClick={() => void start()}
            >
              צור סרטון
            </Button>

            {/* The only other quote refresh (the 402 handler) sits behind the
                confirm this shortfall just disabled — without this, a top-up
                leaves the screen stale and dead-ended. BELOW the confirm on
                purpose: a successful recheck shrinks the content above, and
                had this sat above, the newly-enabled confirm would slide up
                into the spot the cursor is parked on (skeptic-caught). Down
                here the shrink leaves the cursor over empty space. Clearing
                createError drops a stale 402 alert that would otherwise
                contradict the fresh balance beside it. */}
            {hasShortfall(quote) && (
              <Button
                type="button"
                variant="secondary"
                className="mt-3"
                loading={rechecking}
                onClick={() =>
                  void (async () => {
                    setCreateError(null);
                    setRechecking(true);
                    await loadQuote();
                    setRechecking(false);
                  })()
                }
              >
                בדיקת היתרה מחדש
              </Button>
            )}
          </>
        )}
      </div>
    );
  }

  // Polling gave up (persistent network/server errors). The render itself may
  // still be progressing on the worker — retry only resumes the status checks.
  if (stalled) {
    return (
      <div>
        <StepHeader title="יצירת הסרטון" />
        <p role="alert" className="mt-6 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          {stalled}
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Button type="button" size="lg" className="flex-1" onClick={retryPolling}>
            נסה שוב
          </Button>
          <Link href="/home" className="flex-1">
            <Button type="button" variant="secondary" size="lg" className="w-full">
              חזרה לדף הבית
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (render.status === "failed") {
    const notice = failedRenderNotice(render);
    return (
      <div>
        <StepHeader title="יצירת הסרטון" />
        <p role="alert" className="mt-6 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          {notice.reason}
        </p>
        {notice.showRefund && (
          <p className="mt-3 text-sm text-ink/60">הקרדיטים על הסרטון הזה הוחזרו לחשבונכם.</p>
        )}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            size="lg"
            className="flex-1"
            onClick={() => {
              setRender(null); // back to the summary screen; confirm re-enqueues
            }}
          >
            נסה שוב
          </Button>
          <Link href="/home" className="flex-1">
            <Button type="button" variant="secondary" size="lg" className="w-full">
              חזרה לדף הבית
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (render.status === "released") {
    return (
      <div>
        <StepHeader title="המודעה מוכנה 🎉" sub="אפשר לצפות, להוריד ולפרסם." />
        {render.videoUrl && (
          <video
            src={render.videoUrl}
            controls
            playsInline
            className="mx-auto mt-6 aspect-[9/16] w-full max-w-60 rounded-xl border border-ink/10 bg-black"
          />
        )}
        <Link href="/home" className="mt-7 block">
          <Button type="button" size="lg" className="w-full">
            חזרה לדף הבית
          </Button>
        </Link>
      </div>
    );
  }

  // In flight: the status timeline (A auto-releases — no QC stage).
  const stage = aRenderStageIndex(render.status);
  return (
    <div>
      <StepHeader
        title="יוצרים את המודעה"
        sub="אפשר להישאר כאן או לחזור לדף הבית, הסרטון יופיע שם כשיהיה מוכן."
      />

      <ol className="mt-8 space-y-4">
        {A_RENDER_STAGES.map((label, index) => {
          const done = stage > index;
          const current = stage === index;
          return (
            <li key={label} className="flex items-center gap-3">
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full border ${
                  done
                    ? "border-accent bg-accent/20 text-ink"
                    : current
                      ? "border-accent text-ink"
                      : "border-ink/15 text-ink/40"
                }`}
              >
                {done ? (
                  <Check />
                ) : current ? (
                  <Spinner />
                ) : (
                  <span className="text-xs">{index + 1}</span>
                )}
              </span>
              <span className={`text-sm ${done || current ? "text-ink" : "text-ink/55"}`}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {slow && (
        <p className="mt-6 text-center text-sm text-ink/55">עדיין עובד… זה יכול לקחת עוד רגע.</p>
      )}

      <Link href="/home" className="mt-8 block text-center">
        <span className="text-sm text-ink/60 transition-colors duration-150 hover:text-ink">
          חזרה לדף הבית
        </span>
      </Link>
    </div>
  );
}
