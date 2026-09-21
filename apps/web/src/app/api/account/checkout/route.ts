import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  accountContact,
  CheckoutVerificationError,
  createCheckoutIntent,
  getDb,
  getEnv,
} from "@aiugc/core";
import { UPDATED as TERMS_VERSION } from "@/app/(legal)/legal";
import { coreErrorResponse, INVALID_BODY, jsonError, requireUser } from "@/lib/api";
import { ALREADY_SUBSCRIBED, PAYMENTS_SOON } from "@/lib/api-errors";
import {
  checkoutRedirectUrl,
  checkoutRequestSchema,
  clientIp,
  parseCheckoutPages,
} from "@/lib/billing";
import { BUSINESS_COOKIE, pickSelectedBusiness } from "@/lib/service-b-ui";

/**
 * Hosted checkout (decision 0062): write the intent, hand back the Sumit
 * payment-page URL for the plan. The page carries the fixed price; the intent
 * carries the same price for the return leg to compare against. A body
 * without `acceptedTerms: true` is a 400 before anything is written — the
 * checkbox is the point (0056). No SUMIT_CHECKOUT_PAGES, or no page for this
 * plan, is the 503 the client has always shown, and nothing is written for it.
 * An account that already has a live, non-suspended subscription is a 409
 * (core refuses before writing): a payment-page URL handed to it would take
 * money the return leg could never activate on.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const body = checkoutRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const raw = getEnv().SUMIT_CHECKOUT_PAGES;
    const pages = parseCheckoutPages(raw);
    if (raw && !pages)
      console.error("SUMIT_CHECKOUT_PAGES is set but is not a JSON map of https URLs");
    const page = pages?.[body.data.planCode];
    if (!page) return jsonError(503, PAYMENTS_SOON);

    const db = getDb();
    const { intent } = await createCheckoutIntent(db, {
      userId: auth.userId,
      planCode: body.data.planCode,
      termsVersion: TERMS_VERSION,
      ip: clientIp(request.headers),
      userAgent: request.headers.get("user-agent"),
    });
    // The selected business names the Sumit customer (B2B: the payer is the
    // business); the account email is where Sumit sends the receipt.
    const contact = await accountContact(db, auth.userId);
    const cookieStore = await cookies();
    const selected = pickSelectedBusiness(
      contact.businesses,
      cookieStore.get(BUSINESS_COOKIE)?.value,
    );
    return NextResponse.json({
      redirectUrl: checkoutRedirectUrl(page, {
        intentId: intent.id,
        userId: auth.userId,
        name: selected?.name ?? null,
        email: contact.email,
      }),
    });
  } catch (err) {
    if (err instanceof CheckoutVerificationError && err.reason === "already_subscribed") {
      return jsonError(409, ALREADY_SUBSCRIBED);
    }
    return coreErrorResponse(err);
  }
}
