import { businessOwnerId, creditBalance, getDb, isAdminOwned } from "@aiugc/core";

export type WizardGate = {
  allowed: boolean;
  /** The owner's balance; null = admin bypass (nothing is charged, so no credits are named). */
  balance: number | null;
};

/**
 * Server-only. Whether this business may enter a render wizard at all, plus
 * the balance behind the verdict — the headers show it, so the number the
 * customer sees is the number the gate decided on.
 *
 * Spam control, not enforcement: the real boundary is the 402 at confirm,
 * where the exact quote is known. This only stops someone with an empty
 * balance from walking the whole flow — uploading a demo, burning LLM and TTS
 * money on scripts and previews — to be refused at the last screen.
 *
 * Deliberately a balance check and nothing else, so a future resume-draft flow
 * can reopen a wizard without fighting it.
 */
export async function wizardGate(businessId: string): Promise<WizardGate> {
  const db = getDb();
  if (await isAdminOwned(db, businessId)) return { allowed: true, balance: null };
  const balance = await creditBalance(db, await businessOwnerId(db, businessId));
  return { allowed: balance > 0, balance };
}
