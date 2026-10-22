"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { RenderPlayer } from "@/components/render-player";
import { Button } from "@/components/ui/button";
import { Check, Spinner } from "@/components/ui/icons";
import { RenderProgress } from "@/components/ui/progress-bar";
import { useBalance } from "@/app/home/balance-context";
import { renderRequestResult } from "@/lib/analytics";
import { track } from "@/lib/analytics-client";
import { ADD_CREDITS_LINK } from "@/lib/plans-ui";
import { hasShortfall, shortfallLine, type QuoteView } from "@/lib/quote-ui";
import {
  A_RENDER_STAGES,
  aRenderStageIndex,
  isActiveARenderStatus,
  renderWaitView,
  stepsBalanceLine,
  stepsConfirmLabel,
  type JobProgressWire,
} from "@/lib/service-a-ui";
import { failedRenderNotice, type NextVersion, type RenderState } from "@/lib/service-b-ui";
import {
  C_LIBRARY_LINK,
  C_RENDER_COPY,
  cShapeSummary,
  retryableTextBlockFailure,
} from "@/lib/service-c-ui";
import type { TextBlockRenderCreateResponse } from "@/lib/service-c";
import { apiFetch, postJson, useJobPoll } from "@/lib/use-api";

/** The render poll, and the interval the progress bar glides over. */
const RENDER_POLL_MS = 2_500;

type StepRenderProps = {
  businessId: string;
  clipId: string;
  clipDurationMs: number;
  /** The saved text's row — an edit was saved on the studio's continue. */
  scriptId: string;
  /** The studio's box, or the clip's own area when the customer left it alone. */
  textSafeArea: SafeRect;
  render: RenderState | null;
  setRender: (render: RenderState | null) => void;
  /** The confirm POST in flight — the wizard's, so it can lock the rail too:
   *  the debit lands while it is pending, and a render must never resolve
   *  behind steps the customer is still editing. */
  starting: boolean;
  setStarting: (starting: boolean) => void;
  onBack: () => void;
  onFatal: (message: string) => void;
};

/**
 * Step 4: the price on the confirm button (A's stepsConfirmLabel, read from
 * the quote — never a literal, the price is config), then an explicit confirm
 * debits and enqueues the render. Like A it auto-releases, so the timeline is
 * A's: queued, rendering, ready. Nothing blocks except a shortfall.
 */
export function StepRender({
  businessId,
  clipId,
  clipDurationMs,
  scriptId,
  textSafeArea,
  render,
  setRender,
  starting,
  setStarting,
  onBack,
  onFatal,
}: StepRenderProps) {
  /** undefined = not loaded yet; null = admin bypass (nothing is charged). */
  const [quote, setQuote] = useState<QuoteView | undefined>(undefined);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<{ message: string; retryable: boolean } | null>(
    null,
  );
  /** The shortfall recheck's in-flight flag — one press, one GET. */
  const [rechecking, setRechecking] = useState(false);
  /** The sidebar's number, pushed on the spend and on the refund. */
  const { setBalance } = useBalance();

  async function loadQuote() {
    setQuoteError(null);
    const result = await apiFetch<{ quote: QuoteView }>(
      `/api/businesses/${businessId}/text-blocks/renders/quote`,
    );
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setQuoteError(result.error);
    }
    setQuote(result.body.quote);
  }

  useEffect(() => {
    if (render === null && quote === undefined) void loadQuote();
    // loadQuote reads only props; render/quote gate the one-time fetch.
  }, [render, quote]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setStarting(true);
    setCreateError(null);
    const result = await postJson<TextBlockRenderCreateResponse>(
      `/api/businesses/${businessId}/text-blocks/renders`,
      { clipId, scriptId, textSafeArea },
    );
    setStarting(false);
    track("render_requested", { service: "c", result: renderRequestResult(result) });
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      // The balance moved under us — the shortfall gate on the FRESH quote
      // is what disables the button.
      if (result.status === 402) void loadQuote();
      return setCreateError({
        message: result.error,
        retryable: retryableTextBlockFailure(result.status),
      });
    }
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
    nextVersion?: NextVersion;
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
      if (body.refunded && body.balance !== undefined) setBalance(body.balance);
      setRender({
        ...render,
        status: body.status,
        videoUrl: body.videoUrl,
        downloadUrl: body.downloadUrl,
        scheduleHref: body.scheduleHref,
        pendingPosts: body.pendingPosts,
        nextVersion: body.nextVersion,
        failureReason: body.failureReason,
        refunded: body.refunded,
        job: body.job,
      });
    },
    onFatal,
  );

  // Before enqueue: the shape + the price on the confirm. Back allowed.
  if (render === null) {
    return (
      <div>
        <StepHeader
          title={C_RENDER_COPY.title}
          sub={C_RENDER_COPY.sub}
          onBack={starting ? undefined : onBack}
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
              {cShapeSummary(clipDurationMs)}
            </p>

            {quote && !hasShortfall(quote) && (
              <p className="mt-3 text-[13px] text-ink/60">{stepsBalanceLine(quote)}</p>
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

            {/* A 429 (a daily quota) disables rather than hides — "try again"
                on it would lie. */}
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

            {/* Below the confirm on purpose, as in A: a successful recheck
                shrinks the content above without sliding the newly-enabled
                confirm under the parked cursor. */}
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

  // Polling gave up. The render may still be progressing — retry only
  // resumes the status checks.
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
              // The refund moved the balance: re-quote before the next confirm.
              setQuote(undefined);
              setRender(null);
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
        <StepHeader title="הסרטון מוכן 🎉" sub="אפשר לצפות, להוריד ולפרסם." />
        {render.videoUrl && (
          <RenderPlayer
            videoUrl={render.videoUrl}
            downloadUrl={render.downloadUrl}
            scheduleHref={render.scheduleHref}
            pendingPosts={render.pendingPosts}
            nextVersion={render.nextVersion}
            className="mx-auto mt-6 w-full max-w-60"
            frameClassName="border-ink/10"
          />
        )}
        <Link href="/home/renders" className="mt-7 block">
          <Button type="button" size="lg" className="w-full">
            {C_LIBRARY_LINK}
          </Button>
        </Link>
      </div>
    );
  }

  // In flight: A's timeline and wait line (C auto-releases — no QC stage).
  const stage = aRenderStageIndex(render.status);
  const wait = renderWaitView(render.status, render.job);
  return (
    <div>
      <StepHeader
        title="יוצרים את הסרטון"
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
