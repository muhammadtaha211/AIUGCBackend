import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { accountContact, createIntroIntent, getDb, getEnv } from "@aiugc/core";
import { UPDATED as TERMS_VERSION } from "@/app/(legal)/legal";
import { coreErrorResponse, INVALID_BODY, jsonError, requireUser } from "@/lib/api";
import { PAYMENTS_SOON } from "@/lib/api-errors";
import { checkoutRedirectUrl, clientIp, introRequestSchema, parseIntroPage } from "@/lib/billing";
import { BUSINESS_COOKIE, pickSelectedBusiness } from "@/lib/service-b-ui";

/**
 * The ₪5 intro offer (decision 0109): write the intro intent, hand back the
 * offer's own Sumit payment page. The same contract as /api/account/checkout
 * — the checkbox is required (400 without it), no page configured is the 503
 * before anything is written, and the return route binds on the intent — with
 * the offer's one refusal ladder in front: an account that already had a
 * trial, ever paid, or meets the switch off is a 409 before any write
 * (createIntroIntent refuses first, decision 0109 §1.6).
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const body = introRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const raw = getEnv().SUMIT_INTRO_PAGE;
    const page = parseIntroPage(raw);
    if (raw && !page) console.error("SUMIT_INTRO_PAGE is set but is not an https URL");
    if (!page) return jsonError(503, PAYMENTS_SOON);

    const db = getDb();
    const { intent } = await createIntroIntent(db, {
      userId: auth.userId,
      termsVersion: TERMS_VERSION,
      ip: clientIp(request.headers),
      userAgent: request.headers.get("user-agent"),
    });
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
    return coreErrorResponse(err);
  }
}
