"use client";

import { useEffect, useRef, useState } from "react";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/field";
import { Spinner } from "@/components/ui/icons";
import {
  analysisBackgroundLine,
  clientDemoAspectError,
  clientDemoFileError,
  DEMO_PAGE_SIZE,
  demoDurationError,
  duplicateDemoMatch,
  ingestPhaseView,
  ingestStuckView,
  isIngestingDemoStatus,
  restoredDemo,
  type DemoState,
  type DemoSummary,
  type ReadyDemoDuration,
} from "@/lib/service-a-ui";
import { newDemoNudge, type StepsQuoteView } from "@/lib/quote-ui";
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
const EXISTING_LOAD_FAILED = "לא הצלחנו לטעון את הסרטון הקיים — נסו שוב.";
const UPLOAD_BUSY = "הפעולה הקודמת עדיין מסתיימת — נסו לבחור שוב בעוד רגע.";

/**
 * The rules that actually gate a usable recording — the analysis validator
 * hard-requires the last step to be a genuine success state, so footage with
 * no payoff cannot produce a plan at any number of retries. Guidance only:
 * nothing here gates the upload.
 */
const RECORDING_RULES = [
  "מצלמים משימה אחת שלמה, מההתחלה ועד הסוף.",
  "מסיימים על מסך הצלחה שרואים בבירור — אישור הזמנה, הודעת הצלחה, התוצאה המוכנה. בלי סוף כזה אין מודעה.",
  "אורך מומלץ: 30–90 שניות.",
  "מתחילים אחרי ההתחברות — בלי מסכי לוגין, הרשמה וטפסים אישיים.",
  "בלי זמן מת — כל שנייה מקדמת את המשימה.",
  "טקסט שמופיע על המסך צריך לצאת קריא בצילום.",
  "מצלמים את המסך בטלפון ביד — קצת רעד זה בסדר, זה בדיוק הסגנון.",
];

/** Metadata off the file; undefined when the browser can't decode it. */
function readVideoMeta(
  file: File,
): Promise<{ seconds: number; width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(
        Number.isFinite(video.duration)
          ? { seconds: video.duration, width: video.videoWidth, height: video.videoHeight }
          : undefined,
      );
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    video.src = url;
  });
}

/**
 * Mount-under-cursor guard: controls that swap into a just-clicked position
 * stay disabled until shortly after they mount (PlanEditor's
 * approvedActionsArmed pattern — geometry fixes are proven-failed twice).
 * Cancelling an upload or dismissing the duplicate card lands the picker's
 * enabled reuse rows in the clicked button's band; this arm is what keeps a
 * double-click's second press off them.
 */
function useArmedOnMount(active: boolean): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!active) {
      setArmed(false);
      return;
    }
    const timer = setTimeout(() => setArmed(true), 400);
    return () => clearTimeout(timer);
  }, [active]);
  return armed;
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

/**
 * XHR instead of fetch for the two things fetch can't do: upload progress and
 * a cancel that actually stops the bytes (8d). onabort resolves "aborted" so
 * the caller can return to the picker with no error shown.
 */
function putWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): { promise: Promise<"ok" | "failed" | "aborted">; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<"ok" | "failed" | "aborted">((resolve) => {
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300 ? "ok" : "failed");
    xhr.onerror = () => resolve("failed");
    xhr.onabort = () => resolve("aborted");
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

/**
 * Step 1: the customer's phone-filmed product demo. The bytes go browser ->
 * storage directly (signed upload URL — a demo is far over the route body
 * limit); a small route registers the object and queues ingest, and we poll
 * until the demo is ready or rejected with a Hebrew reason.
 *
 * 8d: reuse-first layout with good-input guidance before the upload button
 * (every demo that reaches ready is analyzed once, unconditionally — the
 * highest-leverage place to prevent unusable footage is here, before the
 * bytes move); a duration-match warning against fumbled re-uploads; cancel on
 * the upload; and a pipeline-derived stuck state, because a dead worker keeps
 * the status poll returning 200 forever.
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
  /** Every ready demo's duration — the duplicate brake checks all of them,
   *  not just the visible page. */
  const [allDurations, setAllDurations] = useState<ReadyDemoDuration[]>([]);
  /** The guidance example pair; null until fetched or when the objects are
   *  absent (the section then shows the rules without media). */
  const [samples, setSamples] = useState<{ recordingUrl: string; adUrl: string } | null>(null);
  /** A picked file whose duration matches an existing ready demo — held here
   *  while the customer decides; upload continues only on their explicit go. */
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    file: File;
    match: ReadyDemoDuration;
  } | null>(null);
  const [pickingExisting, setPickingExisting] = useState(false);
  const busy = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  /** Cancel token for the in-flight upload attempt — minted in upload() the
   *  same frame the cancel button first renders, so every window from the
   *  metadata decode to the end of the PUT is genuinely cancellable. */
  const cancelToken = useRef<{ cancelled: boolean } | null>(null);
  /** Aborts the XHR itself once the PUT is in flight. */
  const abortPut = useRef<(() => void) | null>(null);
  /** Registration committed: cancel is no longer implementable. The ref makes
   *  cancelUpload inert in the same frame (a state read would be stale); the
   *  state twin swaps the button out of the card. */
  const finalizing = useRef(false);
  const [finalizingUi, setFinalizingUi] = useState(false);

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
      const result = await apiFetch<{
        demos: DemoSummary[];
        total: number;
        durations?: ReadyDemoDuration[];
        samples?: { recordingUrl: string; adUrl: string };
      }>(`/api/businesses/${businessId}/demos?page=${page}`);
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
      setAllDurations(result.body.durations ?? []);
      setSamples(result.body.samples ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [pickerShowing, businessId, page]);

  /**
   * What a NEW recording costs on top of the render — the analysis, which is
   * paid for once per demo. Fetched with NO demoId on purpose: that is the
   * quote route's "a demo that does not exist yet", and it is the only place
   * this number may come from, since it is config and moves without a deploy.
   * null until it lands, and on the admin bypass; the nudge then says what it
   * always said, about time alone.
   */
  const [newDemoCredits, setNewDemoCredits] = useState<number | null>(null);
  useEffect(() => {
    if (!pickerShowing) return;
    let cancelled = false;
    void (async () => {
      const result = await apiFetch<{ quote: StepsQuoteView }>(
        `/api/businesses/${businessId}/a-sets/steps/quote`,
      );
      if (cancelled || !result.ok) return;
      setNewDemoCredits(result.body.quote?.analysis ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [pickerShowing, businessId]);

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

  /**
   * Pre-checks at file selection. The picker dies synchronously (the uploading
   * state renders this same frame; the metadata read runs behind it). A new
   * file is a new demo row — a description prefilled from a reused demo must
   * not silently attach to it, hence the reset. A duration match hands over to
   * the duplicate card instead of uploading: every demo that reaches ready is
   * a full fresh analysis, so a fumbled re-upload is real money.
   */
  async function upload(file: File) {
    // busy is only reachable here in the cancel-unwind window (the file input
    // is unmounted during an upload) — say so instead of silently eating the
    // newly-picked file.
    if (busy.current) return setError(UPLOAD_BUSY);
    busy.current = true;
    setError(null);
    // The token exists from the FIRST frame the cancel button does — a cancel
    // during the metadata decode (seconds on a 1GB tail-moov MOV) must stick,
    // not mutate a dead token while the upload proceeds underneath it.
    const token = { cancelled: false };
    cancelToken.current = token;
    setUploadPercent(0);
    setDescription("");
    try {
      const invalid = clientDemoFileError(file);
      if (invalid) return fail(invalid);
      const meta = await readVideoMeta(file);
      if (token.cancelled) return;
      // Aspect first: it already saves a possibly-1GB upload and the wait
      // (NOT analysis money — reject-at-probe precedes the analysis enqueue).
      const badAspect = clientDemoAspectError(meta?.width, meta?.height);
      if (badAspect) return fail(badAspect);
      const badDuration = meta !== undefined ? demoDurationError(meta.seconds) : null;
      if (badDuration) return fail(badDuration);
      const match = meta !== undefined ? duplicateDemoMatch(meta.seconds, allDurations) : null;
      if (match) {
        setUploadPercent(null);
        setPendingDuplicate({ file, match });
        return;
      }
      await proceedUpload(file, token);
    } finally {
      busy.current = false;
    }
  }

  /** Mint -> PUT (abortable) -> register. Checks the caller's cancel token
   *  between stages so ביטול works in the mint window and never registers a
   *  demo whose upload the customer walked away from. Once the PUT is done,
   *  registration is COMMITTED: cancel goes inert (ref, same frame) and the
   *  button unmounts — an un-cancellable button that pretends otherwise was
   *  the review's top money finding. */
  async function proceedUpload(file: File, token: { cancelled: boolean }) {
    setUploadPercent(0);

    const target = await postJson<{ uploadUrl: string; uploadPath: string }>(
      `/api/businesses/${businessId}/demos/upload-url`,
      { type: file.type, size: file.size },
    );
    if (token.cancelled) return setUploadPercent(null);
    if (!target.ok) {
      if (target.status === 403 || target.status === 404) return onFatal(target.error);
      return fail(target.error);
    }

    const put = putWithProgress(target.body.uploadUrl, file, setUploadPercent);
    abortPut.current = put.abort;
    const outcome = await put.promise;
    abortPut.current = null;
    if (outcome === "aborted" || token.cancelled) return setUploadPercent(null);
    if (outcome === "failed") return fail(UPLOAD_FAILED);

    finalizing.current = true;
    setFinalizingUi(true);
    try {
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
      finalizing.current = false;
      setFinalizingUi(false);
    }
  }

  /** ביטול on the progress card: silent return to the picker, no error.
   *  Inert once registration committed — nothing it could honestly do. */
  function cancelUpload() {
    if (finalizing.current) return;
    if (cancelToken.current) cancelToken.current.cancelled = true;
    abortPut.current?.();
    setUploadPercent(null);
  }

  /** The duplicate card's "upload anyway" — the explicit go. */
  async function forceUpload() {
    if (busy.current || !pendingDuplicate) return;
    busy.current = true;
    const file = pendingDuplicate.file;
    setPendingDuplicate(null);
    const token = { cancelled: false };
    cancelToken.current = token;
    try {
      await proceedUpload(file, token);
    } finally {
      busy.current = false;
    }
  }

  /** The duplicate card's "use the existing one": one GET for the full row
   *  (thumb, saved note) — the durations list carries neither. */
  async function selectExisting(match: ReadyDemoDuration) {
    setPickingExisting(true);
    setError(null);
    const result = await apiFetch<{
      status: string;
      businessId?: string;
      description?: string;
      durationMs?: number;
      thumbUrl?: string;
    }>(`/api/demos/${match.id}`);
    setPickingExisting(false);
    if (!result.ok) {
      if (result.status === 403) return onFatal(result.error);
      return setError(result.error);
    }
    const restored = restoredDemo(match.id, result.body, businessId);
    if (!restored) return setError(EXISTING_LOAD_FAILED);
    setPendingDuplicate(null);
    setDemo(restored.demo);
    setDescription(restored.description);
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
  /** Pipeline-derived stuck state (8d): a dead worker keeps the poll healthy
   *  forever, so "nothing is processing this" can only come from the body. */
  const stuck = ingesting ? ingestStuckView(demo.ingest) : null;
  const ingestPhase = ingesting ? ingestPhaseView(demo.status, demo.ingest) : null;

  const pickerVisible = demo === null && uploadPercent === null && pendingDuplicate === null;
  /** Both surfaces can mount under a parked cursor (cancel/dismiss for the
   *  picker; the metadata decode's card swap for the duplicate card). */
  const pickerArmed = useArmedOnMount(pickerVisible);
  const duplicateArmed = useArmedOnMount(pendingDuplicate !== null);

  /**
   * The optional "what the footage shows" note — mounts the moment a file is
   * chosen (upload + ingest are dead time anyway) and stays editable while on
   * the step. Once per demo; saved on continue. Feeds the step-plan prompt
   * and its caption vocabulary (plan_demo_steps v13) and every VO script for
   * this demo — the "improves the plan" promise below is real.
   *
   * `waiting` = upload/ingest still running: the lead line invites filling
   * the dead time; once the demo is ready the same line drops the clause.
   */
  const descriptionField = (waiting: boolean) => (
    <div className="mt-5">
      <p className="text-[13px] font-medium text-ink/70">
        {waiting
          ? "בזמן שהסרטון עולה, ספרו לנו מה רואים בו — זה עוזר לנו לבנות תוכנית צעדים וכיתובים מדויקים יותר."
          : "ספרו לנו מה רואים בסרטון — זה עוזר לנו לבנות תוכנית צעדים וכיתובים מדויקים יותר."}
      </p>
      <TextAreaField
        label="מה רואים בסרטון? (לא חובה)"
        rows={3}
        maxLength={500}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="לדוגמה: מצלמים את האפליקציה, גלילה בתפריט, הוספה לעגלה, מסך תשלום"
      />
      <p className="mt-1.5 text-[13px] text-ink/55">
        כותבים פעם אחת לכל סרטון — ההערה נשמרת יחד איתו. אפשר לדלג.
      </p>
    </div>
  );

  const totalPages = readyTotal === null ? 1 : Math.ceil(readyTotal / DEMO_PAGE_SIZE);

  /**
   * Reuse a previous demo — ABOVE the upload path (8d): picking an existing
   * demo costs nothing, a new upload is a full fresh analysis, so the free
   * path comes first. While a page is in flight the same slots hold skeleton
   * rows, so the section height never jumps; a short last page pads with
   * invisible rows for the same reason. Zero ready demos (or a failed fetch)
   * removes the whole section — a first-time user sees guidance then upload.
   */
  const previousSection = (readyTotal === null || readyTotal > 0) && (
    <div className="mt-6">
      <p className="text-sm font-medium text-ink">סרטונים שכבר העליתם</p>
      <p className="mt-1 text-[13px] text-ink/55">
        אפשר לבחור סרטון קיים במקום להעלות חדש — בחירה כזו לא מפעילה ניתוח חדש.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {pageDemos === null
          ? Array.from({ length: DEMO_PAGE_SIZE }, (_, i) => <DemoRowSkeleton key={i} />)
          : pageDemos.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  disabled={!pickerArmed}
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
              disabled={!pickerArmed}
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
      <div className="mt-6 flex items-center gap-3 text-xs text-ink/55">
        <span className="h-px flex-1 bg-ink/10" />
        או מעלים סרטון חדש
        <span className="h-px flex-1 bg-ink/10" />
      </div>
    </div>
  );

  /**
   * Good-input guidance, before the upload button (8d). The rules are the
   * ones the analysis actually gates on — footage with no payoff screen can
   * never produce a plan — and the example pair SHOWS the acceptable
   * handheld roughness no rule can describe. Guidance only, nothing gated.
   */
  const guidanceSection = (
    <div className="mt-6 rounded-xl border border-ink/[0.08] bg-white p-4">
      <p className="text-sm font-medium text-ink">מה כדאי לצלם?</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {RECORDING_RULES.map((rule) => (
          <li key={rule} className="flex gap-2 text-[13px] text-ink/70">
            <span aria-hidden className="text-accent">
              ✓
            </span>
            {rule}
          </li>
        ))}
      </ul>
      {samples && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            {/* Signed, short-lived URLs — refetched with the picker. */}
            <video
              src={samples.recordingUrl}
              controls
              playsInline
              preload="metadata"
              className="aspect-[9/16] w-full rounded-lg bg-ink/10 object-cover"
            />
            <p className="mt-1.5 text-center text-[13px] text-ink/60">ככה נראה צילום טוב</p>
          </div>
          <div>
            <video
              src={samples.adUrl}
              controls
              playsInline
              preload="metadata"
              className="aspect-[9/16] w-full rounded-lg bg-ink/10 object-cover"
            />
            <p className="mt-1.5 text-center text-[13px] text-ink/60">וזו המודעה שיצאה ממנו</p>
          </div>
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
        disabled={!pickerArmed}
        onClick={() => fileInput.current?.click()}
        className="mt-4 w-full rounded-xl border border-dashed border-white/20 bg-ink/[0.04] px-6 py-12 text-center transition-colors duration-150 hover:border-accent/60 hover:bg-ink/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <span className="block text-base font-medium text-ink">בחירת סרטון מהמכשיר</span>
        <span className="mt-2 block text-sm text-ink/60">
          וידאו אנכי (9:16), באורך 8 שניות עד 3 דקות, MP4 או MOV עד 1GB
        </span>
      </button>
      {readyTotal !== null && readyTotal > 0 && (
        <p className="mt-2 text-[13px] text-ink/55">{newDemoNudge(newDemoCredits)}</p>
      )}
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
          selection frame — pre-checks run behind this state). Cancel actually
          stops the bytes and returns to the picker silently. */}
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
            {/* Past the PUT, cancel is not implementable — the button gives
                way to a static line rather than lie (review's top finding). */}
            {finalizingUi ? (
              <p className="mt-4 text-sm text-ink/60">שומרים את הסרטון…</p>
            ) : (
              <Button type="button" variant="secondary" className="mt-4" onClick={cancelUpload}>
                ביטול ההעלאה
              </Button>
            )}
          </div>
          {descriptionField(true)}
        </>
      )}

      {/* The duplicate brake (8d): the picked file's duration matches a ready
          demo. The free path is the primary action; the paid override sits
          BELOW it, and nothing uploads until one is chosen. */}
      {demo === null && uploadPercent === null && pendingDuplicate !== null && (
        <div className="mt-6 rounded-xl border border-ink/[0.08] bg-white p-4">
          <p className="text-sm font-medium text-ink">נראה שכבר העליתם את הסרטון הזה</p>
          <p className="mt-1 text-[13px] text-ink/60">
            יש ברשימה סרטון באורך זהה
            {pendingDuplicate.match.durationMs !== undefined &&
              ` (${Math.round(pendingDuplicate.match.durationMs / 1000)} שניות)`}
            , שהועלה ב־
            {new Date(pendingDuplicate.match.createdAt).toLocaleDateString("he-IL")}. בחירה בסרטון
            הקיים חוסכת ניתוח כפול של אותו סרטון.
          </p>
          {pendingDuplicate.match.description && (
            <p className="mt-1.5 line-clamp-2 text-[13px] text-ink/55">
              {pendingDuplicate.match.description}
            </p>
          )}
          <div className="mt-4 flex flex-col items-start gap-3">
            <Button
              type="button"
              size="lg"
              loading={pickingExisting}
              disabled={!duplicateArmed}
              onClick={() => void selectExisting(pendingDuplicate.match)}
            >
              להשתמש בסרטון הקיים
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pickingExisting || !duplicateArmed}
              onClick={() => void forceUpload()}
            >
              זה סרטון חדש — להעלות בכל זאת
            </Button>
            <button
              type="button"
              disabled={pickingExisting || !duplicateArmed}
              onClick={() => setPendingDuplicate(null)}
              className="text-sm text-ink/60 transition-colors duration-150 hover:text-ink"
            >
              ביטול
            </button>
          </div>
        </div>
      )}

      {demo === null && uploadPercent === null && pendingDuplicate === null && (
        <>
          {previousSection}
          {guidanceSection}
          {picker}
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

      {/* The pipeline said "nothing is processing this" (8d) — a dead ingest
          job (red: re-uploading is the remedy) or no worker claiming past the
          heartbeat window (amber: the upload is safe, processing resumes by
          itself). The poll stays up either way so recovery heals the screen. */}
      {ingesting && !stalled && stuck && (
        <div className="mt-6">
          <p
            role="alert"
            className={`rounded-lg px-3 py-2.5 text-sm ${
              stuck.dead ? "bg-red-100 text-red-700" : "bg-amber-50 text-amber-900"
            }`}
          >
            {stuck.line}
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

      {ingesting && !stalled && !stuck && ingestPhase && (
        <>
          <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-ink/[0.08] bg-white px-6 py-10 text-center">
            <Spinner className="size-6 text-ink/60" />
            <p className="text-sm text-ink/75">{ingestPhase.line}</p>
            {ingestPhase.sub && <p className="text-sm text-ink/55">{ingestPhase.sub}</p>}
            {slow && <p className="text-sm text-ink/55">עדיין עובד… זה יכול לקחת עוד רגע.</p>}
          </div>
          {descriptionField(true)}
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

          {/* 8d: the analysis started at ingest and runs on behind this
              screen for minutes — said before the customer meets the wait. */}
          {analysisBackgroundLine(demo.analysis?.status) && (
            <p className="mt-3 text-[13px] text-ink/55">
              {analysisBackgroundLine(demo.analysis?.status)}
            </p>
          )}

          {descriptionField(false)}

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
