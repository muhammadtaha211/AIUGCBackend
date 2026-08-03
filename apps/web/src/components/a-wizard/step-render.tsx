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
  shapeSummary,
  type AShape,
} from "@/lib/service-a-ui";
import type { RenderState } from "@/lib/service-b-ui";
import { postJson, useJobPoll } from "@/lib/use-api";

type StepARenderProps = {
  businessId: string;
  demoId: string;
  hookClipId: string;
  hookLineScriptId: string;
  audioId: string;
  personaId: string;
  render: RenderState | null;
  setRender: (render: RenderState | null) => void;
  onBack: () => void;
  onFatal: (message: string) => void;
};

/**
 * Step 6: the advisory shape first — the projected composition (hook + demo +
 * ending), computed from the approved audio's exact duration — then an
 * explicit confirm enqueues the render. A long ending is chosen here, never
 * discovered. Nothing blocks.
 */
export function StepARender({
  businessId,
  demoId,
  hookClipId,
  hookLineScriptId,
  audioId,
  personaId,
  render,
  setRender,
  onBack,
  onFatal,
}: StepARenderProps) {
  const [shape, setShape] = useState<AShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function loadShape() {
    setError(null);
    const result = await postJson<AShape>(`/api/businesses/${businessId}/a-sets/preview`, {
      demoId,
      audioId,
      hookClipId,
    });
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setError(result.error);
    }
    setShape(result.body);
  }

  // The shape is informative, not a gate — load it once on entering the step.
  useEffect(() => {
    if (render === null && shape === null) void loadShape();
    // loadShape reads only props; render/shape gate the one-time fetch.
  }, [render, shape]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setStarting(true);
    setError(null);
    const result = await postJson<{ renderId: string }>(`/api/businesses/${businessId}/a-sets`, {
      demoId,
      hookClipId,
      hookLineScriptId,
      audioId,
      personaId,
    });
    setStarting(false);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setError(result.error);
    }
    setRender({ id: result.body.renderId, status: "queued" });
  }

  const inFlight = render !== null && isActiveARenderStatus(render.status);
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

  // Before enqueue: the advisory shape + explicit confirm. Back still allowed.
  if (render === null) {
    return (
      <div>
        <StepHeader
          title="ככה המודעה תיבנה"
          sub="מבנה הסרטון לפי ההקלטה שאישרתם — אפשר לחזור אחורה ולשנות."
          onBack={onBack}
        />

        {error && (
          <div className="mt-6">
            <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
              {error}
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

        {shape === null && !error && (
          <div className="mt-8 flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
            <Spinner /> מחשבים את מבנה הסרטון…
          </div>
        )}

        {shape !== null && (
          <>
            <p className="mt-6 rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-sm leading-relaxed text-gray-200">
              {shapeSummary(shape)}
            </p>
            <Button
              type="button"
              size="lg"
              className="mt-7 w-full"
              loading={starting}
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

  if (render.status === "failed") {
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
              setRender(null); // back to the shape screen; confirm re-enqueues
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

  // In flight: the status timeline (A auto-releases — no QC stage).
  const stage = aRenderStageIndex(render.status);
  return (
    <div>
      <StepHeader
        title="יוצרים את המודעה"
        sub="אפשר להישאר כאן או לחזור לדף הבית — הסרטון יופיע שם כשיהיה מוכן."
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
          עדיין עובד… סרטון עם סיום דמות יכול לקחת כמה דקות.
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
