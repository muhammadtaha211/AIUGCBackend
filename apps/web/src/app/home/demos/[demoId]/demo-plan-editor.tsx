"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StepPlan } from "@/components/a-wizard/step-plan";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import { isIngestingDemoStatus } from "@/lib/service-a-ui";
import { apiFetch } from "@/lib/use-api";

/** The header's facts about the demo being edited — GET /api/demos/[id]. */
type DemoHeader = {
  status: string;
  createdAt: string;
  description?: string;
  name?: string;
  rejectReason?: string;
  durationMs?: number;
  thumbUrl?: string;
};

/**
 * The client half of /home/demos/[demoId]: everything StepPlan needs that
 * cannot cross the RSC boundary — the router for "back", and the fatal state.
 *
 * The header GET is doing two jobs. It fetches the thumb/date/note the header
 * shows, and — because it is ownership-gated by requireDemo like every other
 * route here — it is also what turns a foreign or nonexistent demo id into the
 * error card. Without it StepPlan would read a bad id's 404 as its perfectly
 * normal "no plan yet, waiting for the analysis" state and spin on it forever.
 */
export function DemoPlanEditor({ demoId }: { demoId: string }) {
  const router = useRouter();
  const [fatal, setFatal] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoHeader | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);
  /** Bumped by the retry button below — the header GET runs once and nothing
   *  else on the page repeats it, so without this a transient failure leaves
   *  the header spinning forever (StepPlan retries its OWN requests, never
   *  this one, and this one is what tells a bad demo from a normal wait). */
  const [headerNonce, setHeaderNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setHeaderError(null);
    void (async () => {
      const result = await apiFetch<DemoHeader>(`/api/demos/${demoId}`);
      if (cancelled) return;
      if (result.ok) return setDemo(result.body);
      // 403 (someone else's) and 404 (no such demo) are dead ends, not errors:
      // the id came from a URL and no control on this page can fix it.
      if (result.status === 403 || result.status === 404) return setFatal(result.error);
      setHeaderError(result.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [demoId, headerNonce]);

  if (fatal) {
    return (
      <div className="rounded-xl border border-ink/[0.08] bg-white p-6 text-center shadow-xl shadow-ink/[0.05] sm:p-10">
        <p className="text-base font-medium text-ink">{fatal}</p>
        <Link href="/home/demos" className="mt-6 inline-block">
          <Button type="button" variant="secondary">
            חזרה לסרטוני המוצר
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-start gap-4">
        {demo?.thumbUrl ? (
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
          {/* Names the DEMO, not the plan: StepPlan renders its own
              "תוכנית הצעדים" header 32px below this, at identical type, and two
              same-size titles for one object read as a mistake. */}
          <h1 className="text-2xl font-semibold tracking-tight text-ink">סרטון המוצר</h1>
          {headerError !== null ? (
            <div className="mt-2">
              <p role="alert" className="text-sm text-red-700">
                {headerError}
              </p>
              <Button
                type="button"
                variant="secondary"
                className="mt-2"
                onClick={() => setHeaderNonce((n) => n + 1)}
              >
                נסה שוב
              </Button>
            </div>
          ) : demo === null ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-ink/55">
              <Spinner /> טוענים…
            </p>
          ) : (
            <>
              {/* The customer's name for the recording (decision 0125), under
                  the fixed title rather than in it, so the h1 never swaps text
                  when the GET lands. Renamed on the library row. */}
              {demo.name && (
                <p className="mt-2 break-words text-base font-medium text-ink">{demo.name}</p>
              )}
              <p className="mt-2 text-sm text-ink/60">
                {demo.durationMs !== undefined && `${Math.round(demo.durationMs / 1000)} שניות · `}
                הועלה ב־{new Date(demo.createdAt).toLocaleDateString("he-IL")}
              </p>
              {/* Read-only here — the library row is where the note is edited,
                  so there is exactly one field writing this column. */}
              {demo.description && (
                <p className="mt-2 text-sm text-ink/70">בסרטון: {demo.description}</p>
              )}
            </>
          )}
          {/* The same rule StepPlan enforces on the plan itself, said up front
              so nobody edits an approved plan expecting it to change in place.
              Only where there IS a plan to describe — on a rejected or still
              ingesting demo it would explain a thing that cannot exist. */}
          {demo?.status === "ready" && (
            <p className="mt-2 text-[13px] text-ink/55">
              תוכנית שאושרה היא לקריאה בלבד — עריכה שלה תיצור עותק חדש שידרוש אישור משלו, וסרטונים
              שכבר נוצרו ימשיכו להשתמש בתוכנית שאושרה.
            </p>
          )}
        </div>
      </div>

      <div className="mt-8">
        {/* Only a READY demo has an analysis to plan from: enqueueAnalysis
            fires on the ingest->ready transition and nowhere else, so a
            rejected or still-ingesting demo has no analysis row AND no analyze
            job — and StepPlan reads that pair as "queued, the next poll will
            resolve it", which here it never will. The library's button is
            already gated on ready; this covers the URL typed by hand.

            Three states, in order. Header GET failed: the status is UNKNOWN, so
            mounting StepPlan could drop a non-ready demo into exactly that
            forever-spin — the header's own retry is the whole body. Known and
            not ready: say why. Otherwise (ready, or still loading): mount, so
            the common case pays no extra round trip. */}
        {headerError !== null ? null : demo !== null && demo.status !== "ready" ? (
          <div className="rounded-xl border border-dashed border-ink/15 bg-ink/[0.04] px-6 py-10 text-center">
            {isIngestingDemoStatus(demo.status) ? (
              <p className="text-sm text-ink/75">
                הסרטון עדיין בעיבוד. אפשר לחזור לכאן בעוד כמה דקות ולבחור את הצעדים.
              </p>
            ) : (
              <p className="text-sm text-red-700">
                {demo.rejectReason ?? "הסרטון לא עבר את הבדיקה, ואי אפשר לבנות ממנו צעדים."}
              </p>
            )}
            <Link href="/home/demos" className="mt-5 inline-block">
              <Button type="button" variant="secondary">
                חזרה לסרטוני המוצר
              </Button>
            </Link>
          </div>
        ) : (
          <StepPlan
            demoId={demoId}
            // No hook is picked here (that is the wizard's job), so no
            // onContinue: StepPlan simply omits the continue button.
            onBack={() => router.push("/home/demos")}
            onFatal={setFatal}
          />
        )}
      </div>
    </>
  );
}
