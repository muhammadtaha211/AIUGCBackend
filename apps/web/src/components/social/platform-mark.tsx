/**
 * Each platform's mark (decision 0115), the brand owners' official files as
 * served from public/brand: Meta's black Instagram glyph and TikTok's icon on
 * its black circle. Their brand rules forbid a redrawn, recoloured or cropped
 * logo, so this is only ever the file itself, small, beside a name or a word.
 * Decorative: the name or the word beside it (or an sr-only line) says which —
 * the Hebrew names are core's PLATFORM_LABELS (@aiugc/core/social-copy).
 */
const MARK_SRC: Record<"instagram" | "tiktok", string> = {
  instagram: "/brand/instagram-glyph-black.svg",
  tiktok: "/brand/tiktok-icon-black-circle.png",
};

export function PlatformMark({
  platform,
  className = "size-4",
}: {
  platform: "instagram" | "tiktok";
  /** The size (and any spacing); the default suits a line of text-sm. */
  className?: string;
}) {
  // A static file at its own size: next/image adds nothing at 16px.
  return <img src={MARK_SRC[platform]} alt="" aria-hidden className={`shrink-0 ${className}`} />;
}
