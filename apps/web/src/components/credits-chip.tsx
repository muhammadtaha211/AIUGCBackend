/**
 * The account's credit balance, shown wherever credits can be spent. null =
 * the admin bypass — nothing is charged, so no credits are named (the same
 * convention as QuoteView) and the chip renders nothing.
 *
 * Server-rendered with the page: the number is the balance at entry, not a
 * live ticker — the quote line at confirm stays the source of truth.
 */
export function CreditsChip({ balance }: { balance: number | null }) {
  if (balance === null) return null;
  return (
    <span className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-gray-300">
      יתרה:
      <span className="font-semibold tabular-nums text-white">{balance}</span>
      קרדיטים
    </span>
  );
}
