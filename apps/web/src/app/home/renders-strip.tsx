"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/ui/icons";
import { isActiveRenderStatus, renderStatusLabel } from "@/lib/service-b-ui";
import { apiFetch, usePolling } from "@/lib/use-api";

type StripRender = { id: string; status: string; createdAt: string; thumbUrl?: string };

const CHIP_COLORS: Record<string, string> = {
  released: "bg-accent/30 text-ink",
  failed: "bg-red-100 text-red-700",
};

function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${CHIP_COLORS[status] ?? "bg-ink/[0.06] text-ink/70"}`}
    >
      {renderStatusLabel(status)}
    </span>
  );
}

/**
 * Recent Service B renders for the selected business, newest first. Polls
 * every 10s while any render is still moving and refetches on window focus —
 * signed thumb URLs expire, so we always render the latest response.
 */
export function RendersStrip({ businessId }: { businessId: string }) {
  const [renders, setRenders] = useState<StripRender[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ id: string; videoUrl?: string } | null>(null);

  const refetch = useCallback(async () => {
    const result = await apiFetch<{ renders: StripRender[] }>(
      `/api/businesses/${businessId}/renders`,
    );
    if (result.ok) {
      setRenders(result.body.renders);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [businessId]);

  useEffect(() => {
    setRenders(null);
    void refetch();
  }, [refetch]);

  useEffect(() => {
    const onFocus = () => void refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetch]);

  const hasActive = renders?.some((render) => isActiveRenderStatus(render.status)) ?? false;
  usePolling(hasActive, 10_000, () => {
    void refetch();
  });

  /** Fetch a fresh signed video URL on every open — never reuse a stale one. */
  async function play(renderId: string) {
    setPlaying({ id: renderId });
    const result = await apiFetch<{ status: string; videoUrl?: string }>(
      `/api/renders/${renderId}`,
    );
    if (result.ok && result.body.videoUrl) {
      setPlaying({ id: renderId, videoUrl: result.body.videoUrl });
    } else {
      setPlaying(null);
      setError(result.ok ? "הסרטון עדיין לא זמין לצפייה." : result.error);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-ink">סרטונים אחרונים</h2>

      {error && (
        <div className="mt-3">
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
            {error}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 text-sm font-medium text-ink/60 transition-colors duration-150 hover:text-ink"
          >
            נסה שוב
          </button>
        </div>
      )}

      {renders === null && !error && (
        <div className="mt-4 flex items-center gap-2 text-sm text-ink/55">
          <Spinner /> טוענים…
        </div>
      )}

      {renders !== null && renders.length === 0 && (
        <p className="mt-3 rounded-xl border border-dashed border-ink/15 bg-white px-6 py-6 text-center text-sm text-ink/60">
          עוד אין סרטונים. הסרטון הראשון שתיצרו יופיע כאן.
        </p>
      )}

      {renders !== null && renders.length > 0 && (
        <ul className="mt-3 flex gap-3 overflow-x-auto pb-2">
          {renders.map((render) => {
            const released = render.status === "released";
            const thumb = (
              <span className="relative block aspect-[9/16] w-full overflow-hidden rounded-lg border border-ink/10 bg-ink/[0.04]">
                {render.thumbUrl ? (
                  // Signed, short-lived URL — next/image optimization would break it.
                  <img src={render.thumbUrl} alt="" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center px-2 text-center text-xs text-ink/55">
                    {renderStatusLabel(render.status)}
                  </span>
                )}
              </span>
            );
            return (
              <li key={render.id} className="w-20 shrink-0 sm:w-24">
                {released ? (
                  <button
                    type="button"
                    onClick={() => void play(render.id)}
                    className="block w-full rounded-lg transition-opacity duration-150 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {thumb}
                  </button>
                ) : (
                  thumb
                )}
                <div className="mt-1.5 flex justify-center">
                  <StatusChip status={render.status} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {playing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="צפייה בסרטון"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPlaying(null)}
        >
          <div className="w-full max-w-xs" onClick={(event) => event.stopPropagation()}>
            {playing.videoUrl ? (
              <video
                src={playing.videoUrl}
                controls
                autoPlay
                playsInline
                className="aspect-[9/16] w-full rounded-xl border border-white/10 bg-black"
              />
            ) : (
              <div className="flex aspect-[9/16] w-full items-center justify-center rounded-xl border border-white/10 bg-white/5">
                <Spinner className="size-6 text-gray-400" />
              </div>
            )}
            <button
              type="button"
              onClick={() => setPlaying(null)}
              className="mt-3 w-full text-center text-sm text-gray-400 transition-colors duration-150 hover:text-white"
            >
              סגירה
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
