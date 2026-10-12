"use client";

import { useCallback, useEffect, useState } from "react";
import { RenderPlayer } from "@/components/render-player";
import { Spinner } from "@/components/ui/icons";
import { renderWaitView } from "@/lib/service-a-ui";
import {
  generatingLine,
  isActiveRenderStatus,
  pickActiveHead,
  type RenderRow,
} from "@/lib/service-b-ui";
import { apiFetch, usePolling } from "@/lib/use-api";
import { RenderTile } from "./render-tile";

/**
 * Fast enough for a percent that visibly moves (a render is minutes, and the
 * frame fraction is checkpointed at most every 2s), slow enough that the
 * route's per-row signed-URL loop is not hammered. Only runs while something
 * is actually in flight.
 */
const ACTIVE_POLL_MS = 5_000;

/** The live chip's dot. It breathes only while something is actually being
 *  worked on — a pulse over a parked job would say the opposite of the line. */
function LiveDot({ paused }: { paused: boolean }) {
  if (paused) {
    return <span aria-hidden className="size-2 shrink-0 rounded-full bg-ink/25" />;
  }
  return (
    <span aria-hidden className="relative grid size-2 shrink-0 place-items-center">
      <span className="live-ring absolute inset-0 hidden rounded-full bg-accent motion-safe:block" />
      <span className="relative size-2 rounded-full bg-accent-deep" />
    </span>
  );
}

/**
 * Recent renders for the selected business (both services — the list is not
 * filtered by service), newest first. Polls while any render is still moving
 * and refetches on window focus — signed thumb URLs expire, so we always
 * render the latest response.
 */
export function RendersStrip({ businessId }: { businessId: string }) {
  const [renders, setRenders] = useState<RenderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{
    id: string;
    videoUrl?: string;
    downloadUrl?: string;
    scheduleHref?: string;
    pendingPosts?: number;
  } | null>(null);

  const refetch = useCallback(async () => {
    const result = await apiFetch<{ renders: RenderRow[] }>(
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

  const activeCount = renders?.filter((render) => isActiveRenderStatus(render.status)).length ?? 0;
  usePolling(activeCount > 0, ACTIVE_POLL_MS, () => {
    void refetch();
  });

  // The render the indicator describes, and the only one the route sends job
  // progress for. Undefined = nothing in flight, so no indicator at all.
  const head = pickActiveHead(renders ?? []);
  const wait = head ? renderWaitView(head.status, head.job) : null;
  // The lane is sequential, so a parked or unclaimed head means nothing behind
  // it is moving either — every tile stops sweeping, not just the head's.
  const sweeping = wait !== null && !wait.bar.paused;

  /** Fetch a fresh signed video URL on every open — never reuse a stale one. */
  async function play(renderId: string) {
    setPlaying({ id: renderId });
    const result = await apiFetch<{
      status: string;
      videoUrl?: string;
      downloadUrl?: string;
      scheduleHref?: string;
      pendingPosts?: number;
    }>(`/api/renders/${renderId}`);
    if (result.ok && result.body.videoUrl) {
      // Both URLs come from this one response — the download is never a
      // second request.
      setPlaying({
        id: renderId,
        videoUrl: result.body.videoUrl,
        downloadUrl: result.body.downloadUrl,
        scheduleHref: result.body.scheduleHref,
        pendingPosts: result.body.pendingPosts,
      });
    } else {
      setPlaying(null);
      setError(result.ok ? "הסרטון עדיין לא זמין לצפייה." : result.error);
    }
  }

  return (
    <section className="mt-8">
      {/* The whole indicator costs the dashboard ZERO height: the live chip
          rides the heading row and the percent goes inside the placeholder
          tile the render already occupies. This pane is meant to fit a laptop
          without scrolling, and the wizard is where a full bar belongs. */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">סרטונים אחרונים</h2>
        {wait && (
          <span className="flex items-center gap-2 text-[13px] font-medium text-ink/70">
            <LiveDot paused={wait.bar.paused} />
            {generatingLine(activeCount, wait.bar.paused)}
          </span>
        )}
      </div>

      {/* The only wait copy that earns height here — nothing is claiming the
          job, so the tiles have stopped shimmering and something has to say
          why. The queue-position and elapsed lines stay in the wizard. */}
      {wait?.kind === "stuck" && (
        <p
          role="alert"
          className="mt-2.5 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900"
        >
          {wait.line}
        </p>
      )}

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
          {renders.map((render) => (
            <li key={render.id} className="w-20 shrink-0 sm:w-24">
              <RenderTile
                render={render}
                // Only the head render carries job progress (see
                // pickActiveHead), so it is the only tile that can show a real
                // number. The rest are queued behind it and keep their status
                // word.
                percent={render.id === head?.id ? wait?.bar.percent : undefined}
                sweeping={sweeping}
                onPlay={(id) => void play(id)}
              />
            </li>
          ))}
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
            <RenderPlayer
              videoUrl={playing.videoUrl}
              downloadUrl={playing.downloadUrl}
              autoPlay
              frameClassName="border-white/10"
              scheduleHref={playing.scheduleHref}
              pendingPosts={playing.pendingPosts}
              onDark
            />
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
