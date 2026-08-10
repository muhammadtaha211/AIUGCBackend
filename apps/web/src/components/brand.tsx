/**
 * The brand lockup: placeholder 9:16 frame mark + Hebrew wordmark.
 * Swap the mark here once the real logo exists.
 */
export function Brand() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span aria-hidden className="block h-5 w-3 rounded-[3px] bg-accent ring-1 ring-ink/15" />
      <span className="text-lg font-bold tracking-tight text-ink">תבנית</span>
    </span>
  );
}
