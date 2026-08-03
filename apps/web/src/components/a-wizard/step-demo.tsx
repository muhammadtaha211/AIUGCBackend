"use client";

import { useRef, useState } from "react";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import {
  clientDemoFileError,
  demoDurationError,
  isIngestingDemoStatus,
  type DemoState,
} from "@/lib/service-a-ui";
import { postJson, useJobPoll } from "@/lib/use-api";

type StepDemoProps = {
  businessId: string;
  demo: DemoState | null;
  setDemo: (demo: DemoState | null) => void;
  onContinue: () => void;
  onFatal: (message: string) => void;
};

const UPLOAD_FAILED = "ההעלאה נכשלה — בדקו את החיבור ונסו שוב.";

/** Duration off the file's metadata; undefined when the browser can't decode. */
function readVideoSeconds(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(video.duration) ? video.duration : undefined);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    video.src = url;
  });
}

/** XHR instead of fetch for the one thing fetch can't do: upload progress. */
function putWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.send(file);
  });
}

/**
 * Step 1: the customer's phone-filmed product demo. The bytes go browser ->
 * storage directly (signed upload URL — a demo is far over the route body
 * limit); a small route registers the object and queues ingest, and we poll
 * until the demo is ready or rejected with a Hebrew reason.
 */
export function StepDemo({ businessId, demo, setDemo, onContinue, onFatal }: StepDemoProps) {
  const [error, setError] = useState<string | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const invalid = clientDemoFileError(file);
      if (invalid) return setError(invalid);
      const seconds = await readVideoSeconds(file);
      const badDuration = seconds !== undefined ? demoDurationError(seconds) : null;
      if (badDuration) return setError(badDuration);

      const target = await postJson<{ uploadUrl: string; uploadPath: string }>(
        `/api/businesses/${businessId}/demos/upload-url`,
        { type: file.type, size: file.size },
      );
      if (!target.ok) {
        if (target.status === 403 || target.status === 404) return onFatal(target.error);
        return setError(target.error);
      }

      setUploadPercent(0);
      const uploaded = await putWithProgress(target.body.uploadUrl, file, setUploadPercent);
      setUploadPercent(null);
      if (!uploaded) return setError(UPLOAD_FAILED);

      const registered = await postJson<{ demoId: string }>(`/api/businesses/${businessId}/demos`, {
        uploadPath: target.body.uploadPath,
      });
      if (!registered.ok) {
        if (registered.status === 403 || registered.status === 404) {
          return onFatal(registered.error);
        }
        return setError(registered.error);
      }
      setDemo({ id: registered.body.demoId, status: "uploaded" });
    } finally {
      busy.current = false;
    }
  }

  const ingesting = demo !== null && isIngestingDemoStatus(demo.status);
  const {
    slow,
    stalled,
    retry: retryPolling,
  } = useJobPoll<{ status: string; rejectReason?: string; durationMs?: number; thumbUrl?: string }>(
    ingesting,
    `/api/demos/${demo?.id}`,
    2_000,
    (body) => {
      if (!demo) return;
      setDemo({ ...demo, ...body });
    },
    onFatal,
  );

  const picker = (
    <>
      <input
        ref={fileInput}
        type="file"
        accept="video/mp4,video/quicktime"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = ""; // re-selecting the same file must re-trigger
          if (file) void upload(file);
        }}
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        className="mt-6 w-full rounded-xl border border-dashed border-white/20 bg-white/5 px-6 py-12 text-center transition-colors duration-150 hover:border-accent/60 hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span className="block text-base font-medium text-white">בחירת סרטון מהמכשיר</span>
        <span className="mt-2 block text-sm text-gray-400">
          וידאו אנכי (9:16), באורך 8–60 שניות, MP4 או MOV עד 200MB
        </span>
      </button>
    </>
  );

  return (
    <div>
      <StepHeader
        title="מעלים את סרטון המוצר"
        sub="סרטון שצילמתם בטלפון של המוצר או השירות — עליו נרכיב את המודעה."
      />

      {error && (
        <p role="alert" className="mt-6 rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* Uploading: browser -> storage, with real progress. */}
      {uploadPercent !== null && (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/5 px-6 py-8">
          <p className="text-sm text-gray-300">מעלים את הסרטון…</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${uploadPercent}%` }}
            />
          </div>
          <p dir="ltr" className="mt-2 text-end text-xs tabular-nums text-gray-500">
            {uploadPercent}%
          </p>
        </div>
      )}

      {demo === null && uploadPercent === null && picker}

      {ingesting && stalled && (
        <div className="mt-6">
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
            {stalled}
          </p>
          <Button type="button" variant="secondary" className="mt-4" onClick={retryPolling}>
            נסה שוב
          </Button>
        </div>
      )}

      {ingesting && !stalled && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-6 py-10 text-center">
          <Spinner className="size-6 text-accent" />
          <p className="text-sm text-gray-300">בודקים ומכינים את הסרטון…</p>
          {slow && <p className="text-sm text-gray-500">עדיין עובד… זה יכול לקחת עוד רגע.</p>}
        </div>
      )}

      {demo?.status === "rejected" && (
        <div className="mt-6">
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
            {demo.rejectReason ?? "הסרטון לא עבר את הבדיקה — נסו סרטון אחר."}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-4"
            onClick={() => {
              setDemo(null);
              setError(null);
            }}
          >
            בחירת סרטון אחר
          </Button>
        </div>
      )}

      {demo?.status === "ready" && (
        <div className="mt-6">
          <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
            {demo.thumbUrl ? (
              // Signed, short-lived URL — next/image optimization would break it.
              <img
                src={demo.thumbUrl}
                alt="תמונה מתוך הסרטון"
                className="aspect-[9/16] w-16 rounded-lg object-cover"
              />
            ) : (
              <div className="aspect-[9/16] w-16 rounded-lg bg-white/10" />
            )}
            <div>
              <p className="text-sm font-medium text-white">הסרטון מוכן</p>
              {demo.durationMs !== undefined && (
                <p className="mt-1 text-sm text-gray-400">
                  {Math.round(demo.durationMs / 1000)} שניות
                </p>
              )}
            </div>
          </div>

          <Button type="button" size="lg" className="mt-6 w-full" onClick={onContinue}>
            המשך
          </Button>
          <button
            type="button"
            onClick={() => {
              setDemo(null);
              setError(null);
            }}
            className="mt-4 w-full text-center text-sm text-gray-400 transition-colors duration-150 hover:text-white"
          >
            החלפת הסרטון
          </button>
        </div>
      )}
    </div>
  );
}
