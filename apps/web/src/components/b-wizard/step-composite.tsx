"use client";

import { useRef, useState } from "react";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import { clientPhotoError, type CompositeState } from "@/lib/service-b-ui";
import { postJson, useJobPoll, NETWORK_ERROR } from "@/lib/use-api";

type StepCompositeProps = {
  businessId: string;
  personaId: string;
  composite: CompositeState | null;
  setComposite: (composite: CompositeState | null) => void;
  onBack: () => void;
  onContinue: () => void;
  onFatal: (message: string) => void;
};

/**
 * Step 2 (physical products only, skippable): upload a product photo, poll the
 * nano-banana composite, approve it or regenerate. Approving makes the
 * composite the lipsync source for the render step.
 */
export function StepComposite({
  businessId,
  personaId,
  composite,
  setComposite,
  onBack,
  onContinue,
  onFatal,
}: StepCompositeProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<"approve" | "regenerate" | null>(null);

  const generating =
    composite !== null && (composite.status === "queued" || composite.status === "generating");

  const {
    slow,
    stalled,
    retry: retryPolling,
  } = useJobPoll<{ status: string; previewUrl?: string; error?: string }>(
    generating,
    `/api/composites/${composite?.id}`,
    2_000,
    (body) => {
      if (!composite) return;
      setComposite({
        ...composite,
        status: body.status,
        previewUrl: body.previewUrl,
        error: body.error,
      });
    },
    onFatal,
  );

  async function upload(photo: File) {
    const invalid = clientPhotoError(photo);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setUploading(true);
    const form = new FormData();
    form.append("photo", photo);
    form.append("personaId", personaId);
    let result;
    try {
      const response = await fetch(`/api/businesses/${businessId}/composites`, {
        method: "POST",
        body: form,
      });
      const body = (await response.json().catch(() => null)) as {
        compositeId?: string;
        error?: string;
      } | null;
      result = { status: response.status, body };
    } catch {
      setError(NETWORK_ERROR);
      setUploading(false);
      return;
    }
    setUploading(false);
    if (result.status === 401) return window.location.assign("/login");
    if (result.status === 403 || result.status === 404) {
      return onFatal(result.body?.error ?? "אין גישה.");
    }
    if (!result.body?.compositeId) {
      return setError(result.body?.error ?? "ההעלאה נכשלה. נסו שוב בעוד רגע.");
    }
    setComposite({ id: result.body.compositeId, status: "queued", approved: false });
  }

  async function approve() {
    if (!composite) return;
    setBusy("approve");
    const result = await postJson<{ ok: boolean }>(`/api/composites/${composite.id}/approve`);
    setBusy(null);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setError(result.error);
    }
    setComposite({ ...composite, approved: true });
    onContinue();
  }

  /** A fresh attempt from the same stored photo — the server returns a NEW composite id. */
  async function regenerate() {
    if (!composite) return;
    setError(null);
    setBusy("regenerate");
    const result = await postJson<{ compositeId: string }>(
      `/api/composites/${composite.id}/regenerate`,
    );
    setBusy(null);
    if (!result.ok) {
      if (result.status === 403 || result.status === 404) return onFatal(result.error);
      return setError(result.error);
    }
    setComposite({ id: result.body.compositeId, status: "queued", approved: false });
  }

  return (
    <div>
      <StepHeader
        title="הדמות מחזיקה את המוצר שלכם"
        sub="מעלים תמונה של המוצר ואנחנו משלבים אותו ביד של הדמות. אפשר גם להמשיך בלי."
        onBack={onBack}
      />

      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const photo = event.target.files?.[0];
          event.target.value = "";
          if (photo) void upload(photo);
        }}
      />

      {error && (
        <p role="alert" className="mt-6 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* No composite yet: the upload zone. */}
      {composite === null && (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="mt-6 flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-white/20 bg-ink/[0.04] px-6 py-10 text-center transition-colors duration-150 hover:border-white/35 hover:bg-ink/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:pointer-events-none disabled:opacity-50"
        >
          {uploading ? (
            <span className="flex items-center gap-2 text-sm text-ink/75">
              <Spinner /> מעלים את התמונה…
            </span>
          ) : (
            <>
              <span className="text-base font-medium text-ink">העלאת תמונת מוצר</span>
              <span className="text-sm text-ink/60">JPG, PNG או WebP, עד 10MB</span>
            </>
          )}
        </button>
      )}

      {/* Polling gave up (persistent network/server errors) — never spin silently. */}
      {generating && stalled && (
        <div className="mt-6">
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
            {stalled}
          </p>
          <Button type="button" variant="secondary" className="mt-4" onClick={retryPolling}>
            נסה שוב
          </Button>
        </div>
      )}

      {/* Composite in flight: polling with reassurance. */}
      {generating && !stalled && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-ink/[0.08] bg-white px-6 py-10 text-center">
          <Spinner className="size-6 text-ink/60" />
          <p className="text-sm text-ink/75">יוצרים את התמונה של הדמות עם המוצר…</p>
          {slow && <p className="text-sm text-ink/55">עדיין עובד… זה יכול לקחת עוד רגע.</p>}
        </div>
      )}

      {/* Ready: preview + approve / retry / different photo. */}
      {composite?.status === "ready" && (
        <div className="mt-6">
          {composite.previewUrl && (
            // Signed, short-lived URL — next/image optimization would break it.
            <img
              src={composite.previewUrl}
              alt="הדמות עם המוצר"
              className="mx-auto w-full max-w-60 rounded-xl border border-ink/10"
            />
          )}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              size="lg"
              className="flex-1"
              loading={busy === "approve"}
              disabled={busy === "regenerate"}
              onClick={() => void approve()}
            >
              אישור והמשך
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="flex-1"
              loading={busy === "regenerate"}
              disabled={busy === "approve"}
              onClick={() => void regenerate()}
            >
              נסה שוב
            </Button>
          </div>
          <button
            type="button"
            onClick={() => {
              setComposite(null);
              setError(null);
            }}
            className="mt-4 w-full text-center text-sm text-ink/60 transition-colors duration-150 hover:text-ink"
          >
            העלאת תמונה אחרת
          </button>
        </div>
      )}

      {/* Failed: Hebrew message + retry from the same photo or a new upload. */}
      {composite?.status === "failed" && (
        <div className="mt-6">
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
            {composite.error ?? "יצירת התמונה נכשלה, נסו שוב או בחרו דמות אחרת."}
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="flex-1"
              loading={busy === "regenerate"}
              onClick={() => void regenerate()}
            >
              נסה שוב
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="flex-1"
              onClick={() => {
                setComposite(null);
                setError(null);
              }}
            >
              העלאת תמונה אחרת
            </Button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          // Skipping means the render must NOT ride on an earlier approval.
          if (composite?.approved) setComposite({ ...composite, approved: false });
          onContinue();
        }}
        className="mt-6 w-full text-center text-sm font-medium text-ink/60 transition-colors duration-150 hover:text-ink"
      >
        המשך בלי תמונת מוצר
      </button>
    </div>
  );
}
