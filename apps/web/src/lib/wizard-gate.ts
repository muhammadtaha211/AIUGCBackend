import { businessOwnerId, creditBalance, getDb, isAdminOwned } from "@aiugc/core";

/**
 * Server-only. Whether this business may enter a render wizard at all.
 *
 * Spam control, not enforcement: the real boundary is the 402 at confirm,
 * where the exact quote is known. This only stops someone with an empty
 * balance from walking the whole flow — uploading a demo, burning LLM and TTS
 * money on scripts and previews — to be refused at the last screen.
 *
 * Deliberately a balance check and nothing else, so a future resume-draft flow
 * can reopen a wizard without fighting it.
 */
export async function canStartWizard(businessId: string): Promise<boolean> {
  const db = getDb();
  if (await isAdminOwned(db, businessId)) return true;
  return (await creditBalance(db, await businessOwnerId(db, businessId))) > 0;
}
