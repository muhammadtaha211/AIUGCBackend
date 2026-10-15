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

let malformedLogged = false;

export function introPageConfigured(): boolean {
  const raw = getEnv().SUMIT_INTRO_PAGE;
  const ok = parseIntroPage(raw) !== null;
  // Set but unusable (a quoted paste on Vercel, say) hides the offer on every
  // surface — say so once per instance, or nothing would explain it.
  if (raw && !ok && !malformedLogged) {
    malformedLogged = true;
    console.error("SUMIT_INTRO_PAGE is set but is not an https URL — the intro offer is hidden");
  }
  return ok;
}

/** The offer when THIS account may buy it now (eligible already includes the switch), else null. */
export async function introOfferFor(userId: string): Promise<IntroOfferView | null> {
  if (!introPageConfigured()) return null;
  return (await introEligibility(getDb(), userId)) === "eligible" ? INTRO_OFFER_VIEW : null;
}

/**
 * /pricing's card (decision 0112): for a signed-in account, only when THAT
 * account may buy it; for a stranger, whenever the offer is live. Read per
 * request, outside the cached plans view, so turning the switch off takes the
 * card down at once; a failed read hides one optional card rather than the page.
 */
export async function pricingIntroOffer(userId: string | null): Promise<IntroOfferView | null> {
  if (!userId) return publicIntroOffer();
  return introOfferFor(userId).catch((err: unknown) => {
    console.error("pricing: intro eligibility read failed", err);
    return null;
  });
}

/** The offer when it is switched on and its page set, whoever is reading. */
async function publicIntroOffer(): Promise<IntroOfferView | null> {
  if (!introPageConfigured()) return null;
  const on = await introOfferEnabled(getDb()).catch((err: unknown) => {
    console.error("pricing: intro offer switch read failed", err);
    return false;
  });
  return on ? INTRO_OFFER_VIEW : null;
}
