"use client";

import { PLATFORM_LABELS } from "@aiugc/core/social-copy";
import { PlatformMark } from "@/components/social/platform-mark";
import { isActiveRenderStatus, renderStatusLabel, type RenderRow } from "@/lib/service-b-ui";
import { TILE_TAG, TILE_TAG_DELIVERED, TILE_TAG_POSTED } from "@/lib/social-posting-ui";

const CHIP_COLORS: Record<string, string> = {
  released: "bg-accent/30 text-ink",
  failed: "bg-red-100 text-red-700",
};

/**
 * Grey while a post waits, sky once TikTok has the file in the owner's TikTok,
 * green once one went out — the calendar's colours.
 */
const POST_TAG = {
  scheduled: { label: TILE_TAG, className: "bg-ink/[0.06] text-ink/70" },
  delivered: { label: TILE_TAG_DELIVERED, className: "bg-sky-100 text-sky-800" },
  posted: { label: TILE_TAG_POSTED, className: "bg-emerald-100 text-emerald-800" },
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
 * One render as the customer sees it anywhere: the 9:16 poster frame, the
 * status chip, click-to-play once released, and the refund line when the
 * credits really came back.
 *
 * Shared by the homepage strip and the /home/renders library so the same
 * render never looks like two different things in the same account. The HOST
 * owns the cell around it — the strip's fixed-width <li>, the library's grid
 * cell — and anything below the chip that is page-specific (the library's date
 * and service label). Hence a fragment, not a wrapper element: the strip's
 * rendered DOM is unchanged by the extraction.
 *
 * `percent` and `sweeping` are the strip's live indicator reaching in: only
 * the head in-flight render carries progress, and the lane is sequential so
 * one boolean decides whether ANY tile shimmers. The library passes neither —
 * it lists finished work.
 */
export function RenderTile({
  render,
  percent,
  sweeping = false,
  onPlay,
}: {
  render: Pick<RenderRow, "id" | "status" | "thumbUrl" | "refunded" | "postTags">;
  /** The head render's frame fraction, whole percent. Strip only. */
  percent?: number;
  /** Shimmer the empty tile — only while something is actually claiming it. */
  sweeping?: boolean;
  onPlay: (renderId: string) => void;
}) {
  const released = render.status === "released";
  const working = isActiveRenderStatus(render.status);
  const thumb = (
    <span
      className={`relative block aspect-[9/16] w-full overflow-hidden rounded-lg border bg-ink/[0.04] ${
        working ? "border-accent" : "border-ink/10"
      }`}
    >
      {render.thumbUrl ? (
        // Signed, short-lived URL — next/image optimization would break it.
        <img src={render.thumbUrl} alt="" className="size-full object-cover" />
      ) : (
        // `relative` lifts it above the shimmer, which is absolutely
        // positioned and would otherwise wash over the number.
        <span className="relative flex size-full items-center justify-center px-2 text-center">
          {percent !== undefined ? (
            <span dir="ltr" className="text-lg font-bold tabular-nums text-ink">
              {percent}%
            </span>
          ) : (
            <span className="text-xs text-ink/55">{renderStatusLabel(render.status)}</span>
          )}
        </span>
      )}
      {/* The empty tile is where the video will appear — sweeping it
          says "this one, right now". w-1/3 at the PHYSICAL left edge
          is what the `sweep` keyframe is measured against, and it
          travels left-to-right with the progress bar (globals.css). */}
      {working && sweeping && (
        <span
          aria-hidden
          className="sweep absolute inset-y-0 left-0 hidden w-1/3 bg-gradient-to-r from-transparent via-accent/40 to-transparent motion-safe:block"
        />
      )}
    </span>
  );
  return (
    <>
      {released ? (
        <button
          type="button"
          // The thumb is decorative (alt=""), so without this the button has no
          // accessible name at all — it announces as "button". Lives in the
          // shared tile, so the strip is fixed by the same line.
          aria-label="צפייה בסרטון"
          onClick={() => onPlay(render.id)}
          className="block w-full rounded-lg transition-opacity duration-150 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {thumb}
        </button>
      ) : (
        thumb
      )}
      <div className="mt-1.5 flex flex-wrap justify-center gap-1">
        <StatusChip status={render.status} />
        {/* Social posting's tags (decisions 0101 §10, 0108 §1, per platform
            since 0115 §3): at most one per platform, Instagram first, each its
            mark and its word. The list route sends them only for the platforms
            the account's switches allow. A size down from the status chip, so
            "נשלח לטיקטוק" stays on one line in the strip's 96px tile (measured
            in Heebo at 94px); the 80px phone tile wraps it. */}
        {render.postTags?.map(({ platform, tag }) => (
          <span
            key={platform}
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${POST_TAG[tag].className}`}
          >
            <PlatformMark platform={platform} className="size-3" />
            <span className="sr-only">{`${PLATFORM_LABELS[platform]}: `}</span>
            {POST_TAG[tag].label}
          </span>
        ))}
      </div>
      {/* Only when the refund really happened — never claim money
          moved when it didn't (same rule as failedRenderNotice). */}
      {render.status === "failed" && render.refunded && (
        <p className="mt-1 text-center text-[10px] leading-tight text-ink/55">הקרדיטים הוחזרו</p>
      )}
    </>
  );
}
