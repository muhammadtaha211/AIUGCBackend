"use client";

import { useEffect, useRef, useState } from "react";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/field";
import { Spinner } from "@/components/ui/icons";
import {
  clientDemoFileError,
  DEMO_PAGE_SIZE,
  demoDurationError,
  isIngestingDemoStatus,
  type DemoState,
  type DemoSummary,
} from "@/lib/service-a-ui";
import { apiFetch, postJson, useJobPoll } from "@/lib/use-api";

type StepDemoProps = {
  businessId: string;
  demo: DemoState | null;
  setDemo: (demo: DemoState | null) => void;
  /** The optional "what the footage shows" note — wizard state, saved on continue. */
  description: string;
  setDescription: (value: string) => void;
  onContinue: () => void;
  onFatal: (message: string) => void;
};

const UPLOAD_FAILED = "ההעלאה נכשלה, בדקו את החיבור ונסו שוב.";

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

/**
 * Same geometry as a real reuse row (thumb-dominated height), so the list
 * area is identical before and after data lands. `ghost` renders it invisible
 * — the last page's padding cells, keeping the section height fixed across
 * pages.
 */
function DemoRowSkeleton({ ghost = false }: { ghost?: boolean }) {
  const pulse = ghost ? "" : "animate-pulse";
  return (
    <li
      aria-hidden
      className={`flex items-center gap-4 rounded-xl border border-ink/[0.08] bg-white p-3 ${
        ghost ? "invisible" : ""
      }`}
    >
      <span className={`aspect-[9/16] w-12 shrink-0 rounded-lg bg-ink/10 ${pulse}`} />
      <span className="min-w-0 flex-1">
        <span className={`block h-3.5 w-36 max-w-full rounded bg-ink/10 ${pulse}`} />
        <span className={`mt-2 block h-3 w-52 max-w-full rounded bg-ink/10 ${pulse}`} />
      </span>
    </li>
  );
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
export function StepDemo({
  businessId,
  demo,
  setDemo,
  description,
  setDescription,
  onContinue,
  onFatal,
}: StepDemoProps) {
  const [error, setError] = useState<string | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  /** The current page of ready demos — null while a page is in flight (skeletons). */
  const [pageDemos, setPageDemos] = useState<DemoSummary[] | null>(null);
  /** Ready-demo count across all pages — null until the first response lands. */
  const [readyTotal, setReadyTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Refetch whenever the picker is showing (mount, "החלפת הסרטון", page change)
  // so a demo uploaded moments ago appears too. The route pages ready demos
  // server-side and signs only this page's thumbnails. A failed fetch just
  // hides the list — the upload path is untouched and surfaces its own errors.
  const pickerShowing = demo === null;
  useEffect(() => {
    if (!pickerShowing) return;
    let cancelled = false;
    setPageDemos(null);
    void (async () => {
      const result = await apiFetch<{ demos: DemoSummary[]; total: number }>(
        `/api/businesses/${businessId}/demos?page=${page}`,
      );
      if (cancelled) return;
      if (!result.ok) {
        setPageDemos([]);
        setReadyTotal(0);
        return;
      }
      // A page past the end (the list shrank since the pager rendered).
      if (result.body.demos.length === 0 && page > 1) return setPage(1);
      setPageDemos(result.body.demos);
      setReadyTotal(result.body.total);
    })();
    return () => {
      cancelled = true;
    };
  }, [pickerShowing, businessId, page]);

  /** Reuse: the saved description prefills the field and stays editable. */
  function selectPrevious(row: DemoSummary) {
    setError(null);
    setDemo({ id: row.id, status: "ready", durationMs: row.durationMs, thumbUrl: row.thumbUrl });
    setDescription(row.description ?? "");
  }

  /** Persist the footage note on the demo row, then advance. Blank clears. */
  async function saveDescriptionAndContinue() {
    if (!demo) return;
    setSaving(true);
    setError(null);
    const result = await apiFetch<{ ok: true }>(`/api/demos/${demo.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description }),
    });
    setSaving(false);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setError(result.error);
    }
    onContinue();
  }

  /** Any failure returns to the picker with its Hebrew error. */
  function fail(message: string) {
    setUploadPercent(null);
    setError(message);
  }

  async function upload(file: File) {
    if (busy.current) return;
    busy.current = true;
    // The picker dies synchronously on selection: the uploading state (and the
    // description field) render this same frame; the metadata pre-check and
    // signed-URL mint run behind it, never in front of it.
    setError(null);
    setUploadPercent(0);
    // A new file is a new demo row — a description prefilled from a reused
    // demo must not silently attach to it.
    setDescription("");
    try {
      const invalid = clientDemoFileError(file);
      if (invalid) return fail(invalid);
      const seconds = await readVideoSeconds(file);
      const badDuration = seconds !== undefined ? demoDurationError(seconds) : null;
      if (badDuration) return fail(badDuration);

      const target = await postJson<{ uploadUrl: string; uploadPath: string }>(
        `/api/businesses/${businessId}/demos/upload-url`,
        { type: file.type, size: file.size },
      );
      if (!target.ok) {
        if (target.status === 403 || target.status === 404) return onFatal(target.error);
        return fail(target.error);
      }

      const uploaded = await putWithProgress(target.body.uploadUrl, file, setUploadPercent);
      if (!uploaded) return fail(UPLOAD_FAILED);

      const registered = await postJson<{ demoId: string }>(`/api/businesses/${businessId}/demos`, {
        uploadPath: target.body.uploadPath,
      });
      if (!registered.ok) {
        if (registered.status === 403 || registered.status === 404) {
          return onFatal(registered.error);
        }
        return fail(registered.error);
      }
      setDemo({ id: registered.body.demoId, status: "uploaded" });
      setUploadPercent(null);
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

  /**
   * The optional "what the footage shows" note — mounts the moment a file is
   * chosen (upload + ingest are dead time anyway) and stays editable while on
   * the step. Once per demo; saved on continue. Every VO script for this demo
   * inherits it.
   */
  const descriptionField = (
    <div className="mt-5">
      <TextAreaField
        label="מה רואים בסרטון? (לא חובה)"
        rows={3}
        maxLength={500}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="לדוגמה: מצלמים את האפליקציה, גלילה בתפריט, הוספה לעגלה, מסך תשלום"
      />
      <p className="mt-1.5 text-[13px] text-ink/55">
        כותבים פעם אחת לכל סרטון, זה עוזר לקריינות להתייחס למה שבאמת רואים. אפשר לדלג, נכתוב לפי
        השאלון.
      </p>
    </div>
  );

  const totalPages = readyTotal === null ? 1 : Math.ceil(readyTotal / DEMO_PAGE_SIZE);

  /**
   * Reuse a previous demo — below the upload button (the primary action never
   * moves as this loads or pages). While a page is in flight the same slots
   * hold skeleton rows, so the section height never jumps; a short last page
   * pads with invisible rows for the same reason. Zero ready demos (or a
   * failed fetch) removes the whole section — a first-time user sees only
   * the upload button.
   */
  const previousSection = (readyTotal === null || readyTotal > 0) && (
    <div className="mt-6">
      <div className="flex items-center gap-3 text-xs text-ink/55">
        <span className="h-px flex-1 bg-ink/10" />
        או
        <span className="h-px flex-1 bg-ink/10" />
      </div>
      <p className="mt-5 text-sm font-medium text-ink">סרטונים שכבר העליתם</p>
      <p className="mt-1 text-[13px] text-ink/55">אפשר לבחור סרטון קיים במקום להעלות חדש.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {pageDemos === null
          ? Array.from({ length: DEMO_PAGE_SIZE }, (_, i) => <DemoRowSkeleton key={i} />)
          : pageDemos.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => selectPrevious(row)}
                  className="flex w-full items-center gap-4 rounded-xl border border-ink/[0.08] bg-white p-3 text-start transition-colors duration-150 hover:border-accent/60 hover:bg-ink/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  {row.thumbUrl ? (
                    // Signed, short-lived URL — next/image optimization would break it.
                    <img
                      src={row.thumbUrl}
                      alt=""
                      className="aspect-[9/16] w-12 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="aspect-[9/16] w-12 shrink-0 rounded-lg bg-ink/10" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm text-ink/75">
                      {row.durationMs !== undefined &&
                        `${Math.round(row.durationMs / 1000)} שניות · `}
                      הועלה ב־{new Date(row.createdAt).toLocaleDateString("he-IL")}
                    </span>
                    {row.description && (
                      <span className="mt-1 line-clamp-2 block text-[13px] text-ink/55">
                        {row.description}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
        {pageDemos !== null &&
          totalPages > 1 &&
          Array.from({ length: DEMO_PAGE_SIZE - pageDemos.length }, (_, i) => (
            <DemoRowSkeleton key={`pad-${i}`} ghost />
          ))}
      </ul>
      {totalPages > 1 && (
        <div className="mt-3 flex justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setPage(n)}
              aria-current={n === page ? "page" : undefined}
              className={`size-8 rounded-lg border text-sm tabular-nums transition-colors duration-150 ${
                n === page
                  ? "border-accent bg-accent/15 text-ink"
                  : "border-ink/[0.08] bg-white text-ink/75 hover:border-ink/25 hover:bg-ink/[0.06]"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
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
        className="mt-6 w-full rounded-xl border border-dashed border-white/20 bg-ink/[0.04] px-6 py-12 text-center transition-colors duration-150 hover:border-accent/60 hover:bg-ink/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <span className="block text-base font-medium text-ink">בחירת סרטון מהמכשיר</span>
        <span className="mt-2 block text-sm text-ink/60">
          וידאו אנכי (9:16), באורך 8–60 שניות, MP4 או MOV עד 200MB
        </span>
      </button>
    </>
  );

  return (
    <div>
      <StepHeader
        title="מעלים את סרטון המוצר"
        sub="סרטון שצילמתם בטלפון של המוצר או השירות, עליו נרכיב את המודעה."
      />

      {error && (
        <p role="alert" className="mt-6 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Uploading: browser -> storage, with real progress (mounted from the
          selection frame — pre-checks run behind this state). */}
      {uploadPercent !== null && (
        <>
          <div className="mt-6 rounded-xl border border-ink/[0.08] bg-white px-6 py-8">
            <p className="text-sm text-ink/75">מעלים את הסרטון…</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink/10">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${uploadPercent}%` }}
              />
            </div>
            <p dir="ltr" className="mt-2 text-end text-xs tabular-nums text-ink/55">
              {uploadPercent}%
            </p>
          </div>
          {descriptionField}
        </>
      )}

      {demo === null && uploadPercent === null && (
        <>
          {picker}
          {previousSection}
        </>
      )}

      {ingesting && stalled && (
        <div className="mt-6">
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
            {stalled}
          </p>
          <Button type="button" variant="secondary" className="mt-4" onClick={retryPolling}>
            נסה שוב
          </Button>
        </div>
      )}

      {ingesting && !stalled && (
        <>
          <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-ink/[0.08] bg-white px-6 py-10 text-center">
            <Spinner className="size-6 text-ink/60" />
            <p className="text-sm text-ink/75">בודקים ומכינים את הסרטון…</p>
            {slow && <p className="text-sm text-ink/55">עדיין עובד… זה יכול לקחת עוד רגע.</p>}
          </div>
          {descriptionField}
        </>
      )}

      {demo?.status === "rejected" && (
        <div className="mt-6">
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
            {demo.rejectReason ?? "הסרטון לא עבר את הבדיקה, נסו סרטון אחר."}
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
          <div className="flex items-center gap-4 rounded-xl border border-ink/[0.08] bg-white p-4">
            {demo.thumbUrl ? (
              // Signed, short-lived URL — next/image optimization would break it.
              <img
                src={demo.thumbUrl}
                alt="תמונה מתוך הסרטון"
                className="aspect-[9/16] w-16 rounded-lg object-cover"
              />
            ) : (
              <div className="aspect-[9/16] w-16 rounded-lg bg-ink/10" />
            )}
            <div>
              <p className="text-sm font-medium text-ink">הסרטון מוכן</p>
              {demo.durationMs !== undefined && (
                <p className="mt-1 text-sm text-ink/60">
                  {Math.round(demo.durationMs / 1000)} שניות
                </p>
              )}
            </div>
          </div>

          {descriptionField}

          <Button
            type="button"
            size="lg"
            className="mt-6 w-full"
            loading={saving}
            onClick={() => void saveDescriptionAndContinue()}
          >
            המשך
          </Button>
          <button
            type="button"
            onClick={() => {
              setDemo(null);
              setError(null);
            }}
            className="mt-4 w-full text-center text-sm text-ink/60 transition-colors duration-150 hover:text-ink"
          >
            החלפת הסרטון
          </button>
        </div>
      )}
    </div>
  );
}
