"use client";

import { useEffect, useState } from "react";
import { RenderPlayer } from "@/components/render-player";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import { rendersPageCount, SERVICE_LABELS, type RenderRow } from "@/lib/service-b-ui";
import { apiFetch } from "@/lib/use-api";
import { RenderTile } from "../render-tile";

/**
 * The paged archive. Deliberately NOT the strip: no polling, no live
 * indicator, no job progress — the route's paged shape sends none, and a
 * library that re-signed 24 thumbs every five seconds would cost far more than
 * it tells anyone. A render still being made shows its status word here and
 * its percent on the homepage, which is where the customer is watching it.
 */
export function RendersLibrary({ businessId }: { businessId: string }) {
  const [page, setPage] = useState(1);
  const [renders, setRenders] = useState<RenderRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{
    id: string;
    videoUrl?: string;
    downloadUrl?: string;
    scheduleHref?: string;
    pendingPosts?: number;
  } | null>(null);
  /** The modal's own failure. Kept apart from the list's: this surface has no
   *  poll and no focus refetch, so an error written by a click would otherwise
   *  sit over the grid until a page turn. */
  const [playError, setPlayError] = useState<string | null>(null);
  /** Bumped by the retry button — a failed page load otherwise dead-ends. */
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRenders(null);
    // The modal's error has no close button and this surface never refetches on
    // its own — without this it would outlive the click that caused it forever.
    setPlayError(null);
    void (async () => {
      const result = await apiFetch<{ renders: RenderRow[]; total: number }>(
        `/api/businesses/${businessId}/renders?page=${page}`,
      );
      if (cancelled) return;
      if (!result.ok) {
        // Drop the count with the rows: a stale total would keep offering
        // pages of a list that is no longer on screen.
        setTotal(0);
        return setError(result.error);
      }
      // The visible set can shrink under someone sitting on the last page — a
      // QC reject drops a row out of the list — and an out-of-range page comes
      // back empty, where the empty state would claim the account has never
      // made a video. Snap to the last real page and let the effect refetch.
      // Total first: the snap below re-runs this effect, and the pager renders
      // from `total` meanwhile — the stale one would describe the old, larger list.
      setTotal(result.body.total);
      const lastPage = rendersPageCount(result.body.total);
      if (page > lastPage) return setPage(lastPage);
      setRenders(result.body.renders);
      setError(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, page, nonce]);

  const pageCount = rendersPageCount(total);

  /** Fetch a fresh signed video URL on every open — never reuse a stale one. */
  async function play(renderId: string) {
    // An allowed account's rows carry `postTag` (social posting PR 3): the
    // schedule button takes its place from the open, so nothing moves under
    // the cursor when the signed URLs land.
    const row = renders?.find((render) => render.id === renderId);
    setPlaying({
      id: renderId,
      scheduleHref: row?.postTag !== undefined ? `/schedule/${renderId}` : undefined,
    });
    setPlayError(null);
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
      setPlayError(result.ok ? "הסרטון עדיין לא זמין לצפייה." : result.error);
    }
  }

  return (
    <section className="mt-8">
      {error && (
        <div className="mb-4">
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
            {error}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-2"
            onClick={() => setNonce((n) => n + 1)}
          >
            נסה שוב
          </Button>
        </div>
      )}

      {playError && (
        <p role="alert" className="mb-4 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          {playError}
        </p>
      )}

      {renders === null && !error && (
        <div className="flex items-center gap-2 text-sm text-ink/55">
          <Spinner /> טוענים…
        </div>
      )}

      {renders !== null && renders.length === 0 && (
        <p className="rounded-xl border border-dashed border-ink/15 bg-white px-6 py-6 text-center text-sm text-ink/60">
          עוד אין סרטונים. הסרטון הראשון שתיצרו יופיע כאן.
        </p>
      )}

      {renders !== null && renders.length > 0 && (
        <ul className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {renders.map((render) => (
            <li key={render.id} className="min-w-0">
              <RenderTile render={render} onPlay={(id) => void play(id)} />
              <p className="mt-1 text-center text-[11px] leading-tight text-ink/60">
                {SERVICE_LABELS[render.service]}
              </p>
              <p className="mt-0.5 text-center text-[11px] leading-tight text-ink/45">
                {new Date(render.createdAt).toLocaleDateString("he-IL")}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* One page of everything needs no pager. In RTL the first child sits on
          the right, so "הקודם" leads and "הבא" trails — the reading order. */}
      {pageCount > 1 && (
        <nav
          aria-label="ניווט בין עמודי היצירות"
          className="mt-8 flex items-center justify-center gap-3"
        >
          <Button
            type="button"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            הקודם
          </Button>
          {/* role="status" so a screen reader hears the page change — the grid
              it labels is swapped out asynchronously and announces nothing. */}
          <span role="status" className="text-sm tabular-nums text-ink/60">
            עמוד {page} מתוך {pageCount}
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => current + 1)}
          >
            הבא
          </Button>
        </nav>
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
