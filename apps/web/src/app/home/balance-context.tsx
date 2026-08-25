"use client";

import { createContext, useContext, useState } from "react";

/**
 * The sidebar balance, client-side. The number is born server-side (the
 * layout's wizardGate) and changes at exactly two client-visible moments —
 * a render's debit at confirm and its refund on terminal failure — so those
 * two paths PUSH the fresh number here instead of anything re-running the
 * layout. That is the whole design: zero router.refresh() calls, because a
 * refresh re-runs the wizard page's server gate and a balance that hit 0
 * mid-session would swap a mounted wizard (in-flight render screen, unsaved
 * plan edits) for the no-credits card (see sidebar.tsx's focus effect).
 *
 * The server stays authoritative: whenever the layout DOES re-render
 * (business switch, the dashboard focus refresh, a hard load), the provider
 * adopts the new server value. Multi-tab is explicitly out of scope — a
 * second tab updates through the existing focus-refresh on /home only.
 * null = admin bypass; the card hides.
 */
const BalanceContext = createContext<{
  balance: number | null;
  setBalance: (balance: number | null) => void;
} | null>(null);

export function BalanceProvider({
  initial,
  children,
}: {
  initial: number | null;
  children: React.ReactNode;
}) {
  const [balance, setBalance] = useState(initial);
  // Adopt a changed server value during render (the React-endorsed
  // derived-state-from-props shape) — an effect would flash the stale number.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setBalance(initial);
  }
  return (
    <BalanceContext.Provider value={{ balance, setBalance }}>{children}</BalanceContext.Provider>
  );
}

export function useBalance() {
  const ctx = useContext(BalanceContext);
  if (!ctx) throw new Error("useBalance outside BalanceProvider");
  return ctx;
}
