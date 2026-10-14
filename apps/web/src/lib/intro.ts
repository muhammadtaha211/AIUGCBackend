import { getDb, getEnv, INTRO_OFFER, introEligibility, introOfferEnabled } from "@aiugc/core";
import { parseIntroPage } from "@/lib/billing";
import type { IntroOfferView } from "@/lib/plans-ui";

/**
 * Server-only. Where the ₪5 intro offer (decision 0109) may be shown. Two
 * things must both hold before any surface names it: its Sumit page is
 * configured (SUMIT_INTRO_PAGE) and core says so — the switch on, and for an
 * account, that account eligible. The numbers are core's INTRO_OFFER, handed
 * to plans-ui as arguments.
 */

export const INTRO_OFFER_VIEW: IntroOfferView = { ...INTRO_OFFER };

export function introPageConfigured(): boolean {
  return parseIntroPage(getEnv().SUMIT_INTRO_PAGE) !== null;
}

/** The offer when THIS account may buy it now (eligible already includes the switch), else null. */
export async function introOfferFor(userId: string): Promise<IntroOfferView | null> {
  if (!introPageConfigured()) return null;
  return (await introEligibility(getDb(), userId)) === "eligible" ? INTRO_OFFER_VIEW : null;
}

/**
 * /pricing: the offer when it is switched on and its page set, whoever is
 * reading. Read per request, outside the cached plans view, so turning the
 * switch off takes the line down at once; a failed read hides one optional
 * line rather than the page.
 */
export async function publicIntroOffer(): Promise<IntroOfferView | null> {
  if (!introPageConfigured()) return null;
  const on = await introOfferEnabled(getDb()).catch((err: unknown) => {
    console.error("pricing: intro offer switch read failed", err);
    return false;
  });
  return on ? INTRO_OFFER_VIEW : null;
}
