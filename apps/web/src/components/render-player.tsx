"use client";

import Link from "next/link";
import { PRIMARY_BUTTON_CLASS, WHITE_BUTTON_CLASS } from "@/components/ui/button";
import { Download, Spinner } from "@/components/ui/icons";
import { track } from "@/lib/analytics-client";
import { NEXT_VERSION_BUTTON, nextVersionLine } from "@/lib/quote-ui";
import type { NextVersion } from "@/lib/service-b-ui";
import { pendingPostsLine, SCHEDULE_BUTTON } from "@/lib/social-posting-ui";

type RenderPlayerProps = {
  /** The signed playback URL. Undefined = still being fetched — both modals
   *  sign per open, so there is a beat before it lands. */
  videoUrl?: string;
  /** The same object signed as an attachment, from GET /api/renders/[id]. */
  downloadUrl?: string;
  autoPlay?: boolean;
  /** The player's outer box — width and margins, which differ per surface. */
  className?: string;
  /** The video box itself. Only the border differs (the modals sit on a black
   *  backdrop, the wizards on paper), so unifying it would be a restyle. */
  frameClassName?: string;
  /** "תזמון פרסום" (social posting, decision 0101 §6): present only when
   *  GET /api/renders/[id] sent it — a released render, an account the switch
   *  allows. Absent, the player is exactly what it was. */
  scheduleHref?: string;
  /** Posts of this video still waiting; the line under the buttons. */
  pendingPosts?: number;
  /** "גרסה נוספת" (decision 0124): present only for a released A (steps) or C
   *  render — GET /api/renders/[id] sends it, a modal reserves it at open.
   *  Absent (every B render), the player is exactly what it was. */
  nextVersion?: NextVersion;
  /** The modals sit on a black backdrop, the wizards on paper — the one line
   *  of text under the buttons needs to know which. */
  onDark?: boolean;
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
 * The action renders whether or not the URL has arrived. Gating it would let
 * it appear a beat later and shove the page under a waiting cursor.
 */
export function RenderPlayer({
  videoUrl,
  downloadUrl,
  autoPlay = false,
  className = "",
  frameClassName = "",
  scheduleHref,
  pendingPosts = 0,
  nextVersion,
  onDark = false,
}: RenderPlayerProps) {
  const frame = `aspect-[9/16] w-full rounded-xl border ${frameClassName}`;
  const pendingLine = scheduleHref ? pendingPostsLine(pendingPosts) : null;
  const actions = 1 + (scheduleHref ? 1 : 0) + (nextVersion ? 1 : 0);
  // A only, and only once the route answered — C is a flat price.
  const nextLine =
    nextVersion?.service === "a" && nextVersion.href !== undefined
      ? nextVersionLine(nextVersion.credits)
      : null;
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

      {/* One action. The disabled רמיקס/בקרוב that used to sit beside it is
          gone — remix is not being built, and a permanently-disabled button is
          a promise the product does not keep. That also retires the min-w-36
          wrap threshold, which existed so the PAIR could drop to two rows. */}
      {/* One row: הורדה, and beside it "תזמון פרסום" when the account may
          schedule — two columns, so neither moves when the other appears.
          "גרסה נוספת" takes the second column when it is the only other
          action, and the whole second row when all three are there. */}
      <div className={`mt-3 ${actions > 1 ? "grid grid-cols-2 gap-2" : ""}`}>
        <a
          href={downloadUrl}
          download
          // No href at all until the URL lands: an anchor without one is not a
          // link, so there is nothing to click or tab to. `disabled:` styles
          // never fire on an anchor, hence the explicit inert look.
          aria-disabled={downloadUrl === undefined || undefined}
          className={`${PRIMARY_BUTTON_CLASS} w-full ${
            downloadUrl === undefined ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <Download />
          הורדה
        </a>
        {scheduleHref && (
          <Link href={scheduleHref} className={`${WHITE_BUTTON_CLASS} w-full`}>
            {SCHEDULE_BUTTON}
          </Link>
        )}
        {nextVersion && <NextVersionLink version={nextVersion} wide={actions === 3} />}
      </div>
      {pendingLine && (
        <p className={`mt-2 text-center text-xs ${onDark ? "text-gray-300" : "text-ink/60"}`}>
          {pendingLine}
        </p>
      )}
      {nextLine && (
        <p
          className={`mt-2 text-center text-xs leading-relaxed ${onDark ? "text-gray-300" : "text-ink/60"}`}
        >
          {nextLine}
        </p>
      )}
    </div>
  );
}

/**
 * Inert, like הורדה, until the href lands. A wizard's own finish step links to
 * the page it is on, and a soft navigation there keeps the mounted wizard —
 * nothing would start over — so that one case is a full load, whose mount
 * reads the new address. The event goes as a beacon for the same reason.
 */
function NextVersionLink({ version, wide }: { version: NextVersion; wide: boolean }) {
  const className = `${WHITE_BUTTON_CLASS} w-full ${wide ? "col-span-2" : ""}`;
  const { href } = version;
  if (href === undefined) {
    return (
      <span aria-disabled className={`${className} pointer-events-none opacity-50`}>
        {NEXT_VERSION_BUTTON}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={className}
      onClick={(event) => {
        track("next_version_started", { service: version.service }, { beacon: true });
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        if (new URL(href, window.location.href).pathname === window.location.pathname) {
          event.preventDefault();
          window.location.assign(href);
        }
      }}
    >
      {NEXT_VERSION_BUTTON}
    </Link>
  );
}
