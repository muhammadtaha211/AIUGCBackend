/**
 * Each platform's mark (decision 0115), the brand owners' official files as
 * served from public/brand: Meta's black Instagram glyph and TikTok's icon on
 * its black circle. Their brand rules forbid a redrawn, recoloured or cropped
 * logo, so this is only ever the file itself, small, beside a name or a word.
 * Decorative: the name or the word beside it says which — or, where nothing
 * visible does, `labelled` adds the platform's Hebrew name for screen readers
 * (core's PLATFORM_LABELS).
 */
import { PLATFORM_LABELS } from "@aiugc/core/social-copy";

const MARK_SRC: Record<"instagram" | "tiktok", string> = {
  instagram: "/brand/instagram-glyph-black.svg",
  tiktok: "/brand/tiktok-icon-black-circle.png",
};

export function PlatformMark({
  platform,
  className = "size-4",
  labelled = false,
}: {
  platform: "instagram" | "tiktok";
  /** The size (and any spacing); the default suits a line of text-sm. */
  className?: string;
  /** Say the platform's name to screen readers (nothing visible names it here). */
  labelled?: boolean;
}) {
  // A static file at its own size: next/image adds nothing at 16px.
  const mark = (
    <img src={MARK_SRC[platform]} alt="" aria-hidden className={`shrink-0 ${className}`} />
  );
  if (!labelled) return mark;
  return (
    <>
      {mark}
      <span className="sr-only">{`${PLATFORM_LABELS[platform]}: `}</span>
    </>
  );
}
