import { cutawayColour, cutawayLetter } from "@/lib/service-b-ui";

/**
 * A clip's name on every surface — the script, its card, the picker and the
 * effect step: its letter on its colour (vault 0122). Decorative next to text
 * that already names the clip, so hidden from screen readers.
 */
export function CutawayChip({ id, className = "" }: { id: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] leading-none font-bold ${cutawayColour(id).chip} ${className}`}
    >
      {cutawayLetter(id)}
    </span>
  );
}
