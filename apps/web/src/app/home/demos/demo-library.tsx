"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/field";
import { Spinner } from "@/components/ui/icons";
import { isIngestingDemoStatus, type DemoSummary } from "@/lib/service-a-ui";
import { apiFetch } from "@/lib/use-api";

/**
 * The business's demos, newest first, with an editable footage note per ready
 * demo and a way into that demo's step plan. Edits PATCH the demo row — the
 * wizard's reuse picker prefills from the same row, so the library and the
 * wizard never diverge. No delete: sets and scripts reference demos, so
 * removal is a bigger decision than this page.
 */
export function DemoLibrary({ businessId }: { businessId: string }) {
  const [demos, setDemos] = useState<DemoSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await apiFetch<{ demos: DemoSummary[] }>(
        `/api/businesses/${businessId}/demos`,
      );
      if (cancelled) return;
      if (result.ok) {
        setDemos(result.body.demos);
        setError(null);
      } else {
        setError(result.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  return (
    <section className="mt-8">
      {error && (
        <p role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      {demos === null && !error && (
        <div className="flex items-center gap-2 text-sm text-ink/55">
          <Spinner /> טוענים…
        </div>
      )}

      {demos !== null && demos.length === 0 && (
        <p className="rounded-xl border border-dashed border-ink/15 bg-ink/[0.04] px-6 py-8 text-center text-sm text-ink/60">
          עוד אין סרטונים, הסרטון הראשון שתעלו במסלול ״הוק + דמו״ יופיע כאן.
        </p>
      )}

      {demos !== null && demos.length > 0 && (
        <>
          {/* Says what the button on each row actually does, before anyone
              presses it — so it follows the BUTTON's condition, not the list's:
              only ready demos carry it, and a library of nothing but rejected
              uploads would otherwise explain a control that is not there. */}
          {demos.some((demo) => demo.status === "ready") && (
            <p className="mb-4 text-sm text-ink/60">
              בוחרים אילו צעדים נכנסים לסרטון ומה כתוב על כל אחד — כמו בשלב התוכנית ביצירת מודעה.
            </p>
          )}
          <ul className="flex flex-col gap-4">
            {demos.map((demo) => (
              <DemoRow key={demo.id} demo={demo} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function statusLabel(status: string): string {
  if (status === "ready") return "מוכן";
  if (status === "rejected") return "נדחה";
  if (isIngestingDemoStatus(status)) return "בעיבוד";
  return status;
}

const STATUS_COLORS: Record<string, string> = {
  ready: "bg-accent/25 text-ink",
  rejected: "bg-red-100 text-red-700",
};

function DemoRow({ demo }: { demo: DemoSummary }) {
  const [description, setDescription] = useState(demo.description ?? "");
  const [savedDescription, setSavedDescription] = useState(demo.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = description.trim() !== savedDescription.trim();

  async function save() {
    setSaving(true);
    setError(null);
    const result = await apiFetch<{ ok: true }>(`/api/demos/${demo.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description }),
    });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    setSavedDescription(description);
  }

  return (
    <li className="rounded-xl border border-ink/[0.08] bg-white p-4">
      <div className="flex items-start gap-4">
        {demo.thumbUrl ? (
          // Signed, short-lived URL — next/image optimization would break it.
          <img
            src={demo.thumbUrl}
            alt="תמונה מתוך הסרטון"
            className="aspect-[9/16] w-16 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="aspect-[9/16] w-16 shrink-0 rounded-lg bg-ink/10" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[demo.status] ?? "bg-ink/10 text-ink/75"}`}
            >
              {statusLabel(demo.status)}
            </span>
            <span className="text-sm text-ink/60">
              {demo.durationMs !== undefined && `${Math.round(demo.durationMs / 1000)} שניות · `}
              הועלה ב־{new Date(demo.createdAt).toLocaleDateString("he-IL")}
            </span>
          </div>

          {demo.status === "rejected" && (
            <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">
              {demo.rejectReason ?? "הסרטון לא עבר את הבדיקה."}
            </p>
          )}

          {demo.status === "ready" && (
            <div className="mt-3">
              {/* The row's primary action, above the note: a real button, not
                  a link buried in a sentence — editing the plan is what this
                  page is for now, the note is the footnote. */}
              <Link href={`/home/demos/${demo.id}`} className="inline-block">
                <Button type="button">עריכת הצעדים והכיתובים</Button>
              </Link>

              <div className="mt-3">
                <TextAreaField
                  label="מה רואים בסרטון?"
                  rows={2}
                  maxLength={500}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="לדוגמה: מצלמים את האפליקציה, גלילה בתפריט, הוספה לעגלה, מסך תשלום"
                />
                {error && (
                  <p role="alert" className="mt-2 text-sm text-red-700">
                    {error}
                  </p>
                )}
                {dirty && (
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-2"
                    loading={saving}
                    onClick={() => void save()}
                  >
                    שמירת התיאור
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
