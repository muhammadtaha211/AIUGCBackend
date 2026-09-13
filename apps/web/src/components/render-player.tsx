"use client";

import { Button, PRIMARY_BUTTON_CLASS } from "@/components/ui/button";
import { Download, Remix, Spinner } from "@/components/ui/icons";

type RenderPlayerProps = {
  /** The signed playback URL. Undefined = still being fetched — both modals
   *  sign per open, so there is a beat before it lands. */
  videoUrl?: string;
  /** The same object signed as an attachment, from GET /api/renders/[id]. */
  downloadUrl?: string;
  autoPlay?: boolean;
  /** Absent = remix is the disabled "בקרוב" placeholder. */
  onRemix?: () => void;
  /** The player's outer box — width and margins, which differ per surface. */
  className?: string;
  /** The video box itself. Only the border differs (the modals sit on a black
   *  backdrop, the wizards on paper), so unifying it would be a restyle. */
  frameClassName?: string;
};

/**
 * Every finished render the customer watches: the homepage strip's modal, the
 * library's modal, and both wizards' released step. One component so a change
 * to how a finished render is played or saved happens once.
 *
 * Native controls, minus the ⋮ overflow menu. `nodownload` removes the
 * browser's own Download, leaving ONE download path — the הורדה button, which
 * points at an attachment URL the browser's item cannot produce.
 * `noplaybackrate` and `disablePictureInPicture` empty what is left, so the
 * menu has nothing to open.
 *
 * The action row renders whether or not the URLs have arrived. Gating it would
 * let it appear a beat later and shove the page under a waiting cursor.
 */
export function RenderPlayer({
  videoUrl,
  downloadUrl,
  autoPlay = false,
  onRemix,
  className = "",
  frameClassName = "",
}: RenderPlayerProps) {
  const frame = `aspect-[9/16] w-full rounded-xl border ${frameClassName}`;
  return (
    <div className={className}>
      {videoUrl ? (
        <video
          src={videoUrl}
          controls
          autoPlay={autoPlay}
          playsInline
          controlsList="nodownload noplaybackrate"
          disablePictureInPicture
          className={`${frame} bg-black`}
        />
      ) : (
        <div className={`${frame} flex items-center justify-center bg-white/5`}>
          <Spinner className="size-6 text-gray-400" />
        </div>
      )}

      {/* Download first: the primary action, and in RTL the first child reads
          first. min-w-36 is a wrap threshold, not a size: below ~144px a button
          clips "רמיקס בקרוב", so the pair drops to two full-width rows instead
          of squeezing. One row above ~296px, so the modals (max-w-xs) keep it
          side by side and the wizards' 240px player stacks — as does the modal
          on a phone narrow enough that the backdrop's padding eats into it. */}
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={downloadUrl}
          download
          // No href at all until the URL lands: an anchor without one is not a
          // link, so there is nothing to click or tab to. `disabled:` styles
          // never fire on an anchor, hence the explicit inert look.
          aria-disabled={downloadUrl === undefined || undefined}
          className={`${PRIMARY_BUTTON_CLASS} min-w-36 flex-1 ${
            downloadUrl === undefined ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <Download />
          הורדה
        </a>
        <Button
          type="button"
          variant="secondary"
          className="min-w-36 flex-1"
          disabled={onRemix === undefined}
          onClick={onRemix}
        >
          <Remix />
          רמיקס
          {onRemix === undefined && <span className="text-[11px] opacity-70">בקרוב</span>}
        </Button>
      </div>
    </div>
  );
}
