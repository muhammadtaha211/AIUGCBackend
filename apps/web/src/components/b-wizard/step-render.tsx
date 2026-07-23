"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { Check, Spinner } from "@/components/ui/icons";
import { RENDER_STAGES, renderStageIndex, type RenderState } from "@/lib/service-b-ui";
import { postJson, useJobPoll } from "@/lib/use-api";

type StepRenderProps = {
  businessId: string;
  personaId: string;
  scriptId: string;
  audioId: string;
  compositeId?: string;
  render: RenderState | null;
  setRender: (render: RenderState | null) => void;
  onBack: () => void;
  onFatal: (message: string) => void;
};

/**
 * Step 5: enqueue the InfiniteTalk render and follow it through the Hebrew
 * status timeline. Once the render row exists there is no going back — only
 * retry on failure or home on release.
 */
export function StepRender({
  businessId,
  personaId,
  scriptId,
  audioId,
  compositeId,
  render,
  setRender,
  onBack,
  onFatal,
}: StepRenderProps) {
  const [startError, setStartError] = useState<string | null>(null);
  const starting = useRef(false);

  async function start() {
    if (starting.current) return;
    starting.current = true;
    setStartError(null);
    const result = await postJson<{ renderId: string }>(`/api/businesses/${businessId}/renders`, {
      scriptId,
      audioId,
      personaId,
      ...(compositeId ? { compositeId } : {}),
    });
    starting.current = false;
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setStartError(result.error);
    }
    setRender({ id: result.body.renderId, status: "queued" });
  }

  // Entering the step starts the render — back navigation ends here.
  // The starting ref keeps a StrictMode double-mount from enqueueing twice.
  useEffect(() => {
    if (render === null) void start();
    // render === null is the real trigger; start reads only props/refs.
  }, [render]); // eslint-disable-line react-hooks/exhaustive-deps

  const inFlight =
    render !== null &&
    (render.status === "queued" || render.status === "rendering" || render.status === "qc_pending");

  const {
    slow,
    stalled,
    retry: retryPolling,
  } = useJobPoll<{ status: string; videoUrl?: string }>(
    inFlight,
    `/api/renders/${render?.id}`,
    2_500,
    (body) => {
      if (!render) return;
      setRender({ ...render, status: body.status, videoUrl: body.videoUrl });
    },
    onFatal,
  );

  const stage = render ? renderStageIndex(render.status) : -1;

  // The POST failed — the render never started, so going back is still allowed.
  if (startError) {
    return (
      <div>
        <StepHeader title="יצירת הסרטון" onBack={onBack} />
        <p role="alert" className="mt-6 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
          {startError}
        </p>
        <Button type="button" variant="secondary" className="mt-4" onClick={() => void start()}>
          נסה שוב
        </Button>
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
          יצירת הסרטון נכשלה — נסו שוב.
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
