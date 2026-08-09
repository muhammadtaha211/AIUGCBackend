"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { Check, Spinner } from "@/components/ui/icons";
import {
  bShapeSummary,
  hasShortfall,
  quoteLine,
  shortfallLine,
  type QuoteView,
} from "@/lib/quote-ui";
import {
  RENDER_STAGES,
  renderRequestBody,
  renderStageIndex,
  type RenderState,
} from "@/lib/service-b-ui";
import { postJson, useJobPoll } from "@/lib/use-api";

type StepRenderProps = {
  businessId: string;
  personaId: string;
  /** The background chosen in the image step; absent -> persona default. */
  personaImageId?: string;
  scriptId: string;
  audioId: string;
  compositeId?: string;
  render: RenderState | null;
  setRender: (render: RenderState | null) => void;
  onBack: () => void;
  onFatal: (message: string) => void;
};

/**
 * Step 5: the advisory shape and price first — length from the approved audio,
 * credits from the same function createBRender debits with — then an explicit
 * confirm enqueues the render. This step used to fire the render from a mount
 * effect, which meant NAVIGATING here spent credits; a confirm is the only
 * honest shape once credits are real. Mirrors Service A's advisory step.
 *
 * Once the render row exists there is no going back — only retry on failure or
 * home on release.
 */
export function StepRender({
  businessId,
  personaId,
  personaImageId,
  scriptId,
  audioId,
  compositeId,
  render,
  setRender,
  onBack,
  onFatal,
}: StepRenderProps) {
  const [shape, setShape] = useState<{ voSeconds: number; quote: QuoteView } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const loading = useRef(false);

  async function loadShape() {
    if (loading.current) return;
    loading.current = true;
    setStartError(null);
    const result = await postJson<{ voSeconds: number; quote: QuoteView }>(
      `/api/businesses/${businessId}/renders/preview`,
      { audioId },
    );
    loading.current = false;
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setStartError(result.error);
    }
    setShape(result.body);
  }

  async function start() {
    setStarting(true);
    setStartError(null);
    const result = await postJson<{ renderId: string }>(
      `/api/businesses/${businessId}/renders`,
      renderRequestBody({ scriptId, audioId, personaId, personaImageId, compositeId }),
    );
    setStarting(false);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setStartError(result.error);
    }
    setRender({ id: result.body.renderId, status: "queued" });
  }

  // Entering the step only PRICES the render. Nothing is spent until confirm.
  useEffect(() => {
    if (render === null && shape === null) void loadShape();
    // loadShape reads only props/refs; render/shape gate the one-time fetch.
  }, [render, shape]); // eslint-disable-line react-hooks/exhaustive-deps

  const inFlight =
    render !== null &&
    (render.status === "queued" || render.status === "rendering" || render.status === "qc_pending");

  const {
    slow,
    stalled,
    retry: retryPolling,
  } = useJobPoll<{ status: string; videoUrl?: string; failureReason?: string }>(
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
      });
    },
    onFatal,
  );

  const stage = render ? renderStageIndex(render.status) : -1;

  // Before enqueue: the advisory shape + price, then an explicit confirm.
  // Back is still allowed — nothing has been spent.
  if (render === null) {
    const quote = shape?.quote ?? null;
    return (
      <div>
        <StepHeader
          title="ככה הסרטון ייבנה"
          sub="מבנה הסרטון לפי ההקלטה שאישרתם — אפשר לחזור אחורה ולשנות."
          onBack={onBack}
        />

        {startError && (
          <div className="mt-6">
            <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
              {startError}
            </p>
            <Button
              type="button"
              variant="secondary"
              className="mt-4"
              onClick={() => (shape === null ? void loadShape() : void start())}
            >
              נסה שוב
            </Button>
          </div>
        )}

        {shape === null && !startError && (
          <div className="mt-8 flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
            <Spinner /> מחשבים את מבנה הסרטון…
          </div>
        )}

        {shape !== null && (
          <>
            <p className="mt-6 rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-sm leading-relaxed text-gray-200">
              {bShapeSummary(shape.voSeconds)}
            </p>

            {quote && !hasShortfall(quote) && (
              <p className="mt-3 text-[13px] text-gray-400">{quoteLine(quote)}</p>
            )}
            {hasShortfall(quote) && (
              <p
                role="alert"
                className="mt-3 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300"
              >
                {shortfallLine(quote!)}
              </p>
            )}

            <Button
              type="button"
              size="lg"
              className="mt-7 w-full"
              loading={starting}
              disabled={hasShortfall(quote)}
              onClick={() => void start()}
            >
              צור סרטון
            </Button>
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
        <p role="alert" className="mt-6 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
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

  if (render?.status === "failed") {
    return (
      <div>
        <StepHeader title="יצירת הסרטון" />
        <p role="alert" className="mt-6 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
          {render.failureReason ?? "יצירת הסרטון נכשלה — נסו שוב."}
        </p>
        <p className="mt-3 text-sm text-gray-400">
          הקרדיטים על הסרטון הזה הוחזרו לחשבונכם.
        </p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            size="lg"
            className="flex-1"
            onClick={() => {
              setRender(null); // the mount effect re-enqueues with the same inputs
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

  if (render?.status === "rejected") {
    return (
      <div>
        <StepHeader title="יצירת הסרטון" />
        <p className="mt-6 rounded-lg bg-white/5 px-3 py-2.5 text-sm text-gray-300">
          הסרטון לא עבר את בדיקת האיכות שלנו — אנחנו כבר מכינים גרסה חדשה. הוא יופיע בדף הבית כשיהיה
          מוכן.
        </p>
        <Link href="/home" className="mt-6 inline-block">
          <Button type="button" variant="secondary">
            חזרה לדף הבית
          </Button>
        </Link>
      </div>
    );
  }

  if (render?.status === "released") {
    return (
      <div>
        <StepHeader title="הסרטון מוכן 🎉" sub="אפשר לצפות, להוריד ולפרסם." />
        {render.videoUrl && (
          <video
            src={render.videoUrl}
            controls
            playsInline
            className="mx-auto mt-6 aspect-[9/16] w-full max-w-60 rounded-xl border border-white/10 bg-black"
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

  // In flight: the status timeline.
  return (
    <div>
      <StepHeader
        title="יוצרים את הסרטון"
        sub="אפשר להישאר כאן או לחזור לדף הבית — הסרטון יופיע שם כשיהיה מוכן."
      />

      <ol className="mt-8 space-y-4">
        {RENDER_STAGES.map((label, index) => {
          const done = stage > index;
          const current = stage === index;
          return (
            <li key={label} className="flex items-center gap-3">
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full border ${
                  done
                    ? "border-accent bg-accent/15 text-accent"
                    : current
                      ? "border-accent text-accent"
                      : "border-white/15 text-gray-600"
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
              <span className={`text-sm ${done || current ? "text-white" : "text-gray-500"}`}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {slow && (
        <p className="mt-6 text-center text-sm text-gray-500">
          עדיין עובד… סרטון לוקח בדרך כלל כמה דקות.
        </p>
      )}

      <Link href="/home" className="mt-8 block text-center">
        <span className="text-sm text-gray-400 transition-colors duration-150 hover:text-white">
          חזרה לדף הבית
        </span>
      </Link>
    </div>
  );
}
