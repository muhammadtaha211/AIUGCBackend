"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { RenderPlayer } from "@/components/render-player";
import { Button } from "@/components/ui/button";
import { Check, Spinner } from "@/components/ui/icons";
import { RenderProgress } from "@/components/ui/progress-bar";
import { renderRequestResult } from "@/lib/analytics";
import { track } from "@/lib/analytics-client";
import {
  A_RENDER_STAGES,
  aRenderStageIndex,
  isActiveARenderStatus,
  renderWaitView,
  retryableCreateFailure,
  stepsBalanceLine,
  type JobProgressWire,
  stepsConfirmLabel,
  stepsShapeSummary,
  type HookClip,
  type HookLineOption,
  type PinnedPlan,
} from "@/lib/service-a-ui";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import { useBalance } from "@/app/home/balance-context";
import { ADD_CREDITS_LINK } from "@/lib/plans-ui";
import {
  hasShortfall,
  shortfallLine,
  stepsPriceBreakdown,
  type StepsQuoteView,
} from "@/lib/quote-ui";
import type { AStepsCreateResponse } from "@/lib/service-a";
import { failedRenderNotice, type RenderState } from "@/lib/service-b-ui";
import { apiFetch, postJson, useJobPoll } from "@/lib/use-api";

/** The render poll, and the interval the progress bar glides over — one
 *  constant so the fill can never drift out of step with the samples. */
const RENDER_POLL_MS = 2_500;

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
  const [quote, setQuote] = useState<StepsQuoteView | undefined>(undefined);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<{ message: string; retryable: boolean } | null>(
    null,
  );
  const [starting, setStarting] = useState(false);
  /** The shortfall recheck's in-flight flag — its button disables while the
   *  fresh quote is loading, so one press means one GET. */
  const [rechecking, setRechecking] = useState(false);
  /** The sidebar's number. The create and refund paths below push the
   *  server-computed balance here — the moment of the spend, no refresh. */
  const { setBalance } = useBalance();

  async function loadQuote() {
    setQuoteError(null);
    // The demo decides the price: its analysis is paid for once, on the first
    // render of it that is charged. Without this id the route would quote a
    // brand-new recording and overstate a reused one by the analysis part.
    const result = await apiFetch<{ quote: StepsQuoteView }>(
      `/api/businesses/${businessId}/a-sets/steps/quote?demoId=${encodeURIComponent(demoId)}`,
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
    const result = await postJson<AStepsCreateResponse>(
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
    track("render_requested", { service: "a", result: renderRequestResult(result) });
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
    // The debit just happened — the sidebar shows it the same moment the
    // processing screen appears (null = admin bypass, card stays hidden).
    setBalance(result.body.balance);
    setRender({ id: result.body.renderId, status: "queued" });
  }

  const inFlight = render !== null && isActiveARenderStatus(render.status);
  const {
    slow,
    stalled,
    retry: retryPolling,
  } = useJobPoll<{
    status: string;
    videoUrl?: string;
    downloadUrl?: string;
    scheduleHref?: string;
    pendingPosts?: number;
    failureReason?: string;
    refunded?: boolean;
    balance?: number;
    job?: JobProgressWire;
  }>(
    inFlight,
    `/api/renders/${render?.id}`,
    RENDER_POLL_MS,
    (body) => {
      if (!render) return;
      // The refund's terminal tick carries the post-refund balance — the
      // sidebar climbs back the moment the refund sentence appears.
      if (body.refunded && body.balance !== undefined) setBalance(body.balance);
      setRender({
        ...render,
        status: body.status,
        videoUrl: body.videoUrl,
        downloadUrl: body.downloadUrl,
        scheduleHref: body.scheduleHref,
        pendingPosts: body.pendingPosts,
        failureReason: body.failureReason,
        refunded: body.refunded,
        job: body.job,
      });
    },
    onFatal,
  );

  // Before enqueue: the summary + the price + explicit confirm. Back allowed.
  if (render === null) {
    // null on a recording that has already been paid for once, and on the
    // admin bypass — both of which want the plain number and nothing else.
    const breakdown = quote === undefined ? null : stepsPriceBreakdown(quote);
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

            {/* The price rides on the confirm button itself
                (stepsConfirmLabel); this is the balance, plus — only on a
                recording nobody has rendered from yet — what the number on the
                button is made of. Absent entirely on the admin bypass. */}
            {quote && !hasShortfall(quote) && (
              <>
                {breakdown && <p className="mt-3 text-[13px] text-ink/70">{breakdown}</p>}
                <p className="mt-2 text-[13px] text-ink/60">{stepsBalanceLine(quote)}</p>
              </>
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
              {stepsConfirmLabel(quote)}
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
              <div className="mt-3 flex items-center gap-4">
                <Button
                  type="button"
                  variant="secondary"
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
                <Link
                  href="/home/plan"
                  className="text-sm text-ink/70 underline decoration-ink/25 underline-offset-4 transition-colors duration-150 hover:text-ink"
                >
                  {ADD_CREDITS_LINK}
                </Link>
              </div>
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
              // The quote goes with it. A failed render that was REFUNDED can
              // have flipped this demo back to unpaid — it was the only thing
              // holding it paid — and then the analysis is owed again and the
              // real price is higher than the cached one on the button.
              // createSet re-quotes server-side either way, so leaving the
              // stale number up would show 3 and debit 5.
              setQuote(undefined);
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
          <RenderPlayer
            videoUrl={render.videoUrl}
            downloadUrl={render.downloadUrl}
            scheduleHref={render.scheduleHref}
            pendingPosts={render.pendingPosts}
            className="mx-auto mt-6 w-full max-w-60"
            frameClassName="border-ink/10"
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

  // In flight: the status timeline (A auto-releases — no QC stage), with the
  // 8d job payload deciding the line under it — queue position, then percent
  // + elapsed, then an honest amber "stuck" when no worker is claiming.
  const stage = aRenderStageIndex(render.status);
  const wait = renderWaitView(render.status, render.job);
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
                {/* No spinning while the stuck line below says nothing is
                    progressing — the two signals must not contradict. */}
                {done ? (
                  <Check />
                ) : current && wait.kind !== "stuck" ? (
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

      {/* The bar carries the number. The caption is what keeps that number
          honest: the fraction is renderMedia's frame loop only, so "of the
          frames" is the claim, not "of the video". */}
      <div className="mt-7">
        {wait.bar.percent !== undefined && (
          <p className="mb-2 text-center text-[13px] text-ink/60">מרנדרים את הפריימים</p>
        )}
        <RenderProgress bar={wait.bar} label="התקדמות יצירת הסרטון" stepMs={RENDER_POLL_MS} />
      </div>

      {wait.kind === "stuck" ? (
        <p
          role="alert"
          className="mt-6 rounded-lg bg-amber-50 px-3 py-2.5 text-center text-sm text-amber-900"
        >
          {wait.line}
        </p>
      ) : (
        wait.sub && <p className="mt-6 text-center text-sm text-ink/60">{wait.sub}</p>
      )}
      {wait.kind !== "stuck" && slow && !wait.sub && (
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
