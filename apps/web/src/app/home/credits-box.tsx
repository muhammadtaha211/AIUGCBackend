"use client";

import Link from "next/link";
import { useBalance } from "./balance-context";
import { CREDITS_BOX_LABEL, CREDITS_BOX_TITLE, formatCredits } from "@/lib/plans-ui";

/**
 * The credits pill at the content pane's top-start corner, on every /home
 * page (founder's screenshot, 2026-09-17). It replaced the sidebar's bottom
 * "היתרה שלכם" card.
 *
 * It reads the balance from the context rather than a prop because the number
 * changes at two client-visible moments — the wizard's debit at confirm and
 * its refund on terminal failure — and those paths PUSH the fresh value into
 * the provider instead of re-running the layout (balance-context.tsx explains
 * why nothing here may router.refresh()). null = admin bypass: nothing is
 * charged, so no pill.
 *
 * A Link, not a static badge: every question a customer has about the number
 * ("why is it low", "how do I get more") ends at /home/plan.
 */
export function CreditsBox() {
  const { balance } = useBalance();
  if (balance === null) return null;
  return (
    <Link
      href="/home/plan"
      title={CREDITS_BOX_TITLE}
      className="hidden md:inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink/10 bg-white px-3 text-sm text-ink/80 shadow-sm transition-colors duration-150 hover:border-ink/25 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <span className="font-semibold text-ink tabular-nums">{formatCredits(balance)}</span>
      {CREDITS_BOX_LABEL}
    </Link>
  );
}
