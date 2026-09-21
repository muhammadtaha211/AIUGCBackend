import { NextResponse } from "next/server";
import { CheckoutVerificationError, completeCheckout, getCheckoutIntent, getDb } from "@aiugc/core";
import { jsonError } from "@/lib/api";
import { authReadFailed } from "@/lib/auth-user";
import { clientIp, IpRateLimiter, parseSumitReturnParams } from "@/lib/billing";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Where the Sumit payment page sends the browser after a payment (decision
 * 0062). Nothing on the URL is trusted. The three ids only say which intent
 * to look at and which payment to ask Sumit about; completeCheckout refuses
 * anything that does not agree with the intent, server-to-server.
 *
 * Binding is on the INTENT and on the SESSION together: the intent knows its
 * account, and only that account's browser may complete it. A session for a
 * different account is a 403 — that browser is not the buyer's. No session
 * at all completes NOTHING: the browser is sent through /login with this
 * very URL as `next`, and the email sign-in lands back here with the session
 * to finish. (The Google round-trip lands on /home instead; the intent stays
 * pending with the payment beside it at Sumit, and the next click reuses the
 * intent.) Without the session requirement, whoever's browser hit this URL
 * would bind whatever Sumit customer paid to the intent's account — a
 * stranger's card as the recurring ref, or a stranger's account on the
 * customer's card.
 *
 * Landings, all on /home/plan and all one Hebrew line: ?checkout=success
 * when the intent completed (or was already complete with this payment);
 * ?checkout=refused when Sumit holds a valid payment and we refused to
 * activate on it (the customer must NOT pay again); ?checkout=failed for
 * everything else — malformed params, an unknown intent, a payment Sumit
 * does not know, a thrown error. Every failure is logged here with its
 * reason. No stack ever renders.
 */

const SUCCESS = "/home/plan?checkout=success";
const FAILED = "/home/plan?checkout=failed";
const REFUSED = "/home/plan?checkout=refused";
const limiter = new IpRateLimiter(10, 60_000);

function landing(request: Request, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

export async function GET(request: Request) {
  if (!limiter.allow(clientIp(request.headers) ?? "unknown")) {
    return jsonError(429, "יותר מדי ניסיונות. נסו שוב בעוד דקה.");
  }

  const url = new URL(request.url);
  const params = parseSumitReturnParams(url.searchParams);
  if (!params) {
    console.warn("sumit return: missing or malformed og-* parameters");
    return landing(request, FAILED);
  }

  // A failed session read is logged and treated as "no session": the
  // customer goes through /login and comes back to this URL with one.
  let sessionUserId: string | null = null;
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (authReadFailed(error)) console.error("sumit return: auth read failed", error);
    sessionUserId = user?.id ?? null;
  } catch (err) {
    console.error("sumit return: auth read threw", err);
  }
  if (!sessionUserId) {
    const next = encodeURIComponent(url.pathname + url.search);
    return NextResponse.redirect(new URL(`/login?next=${next}`, request.url), 303);
  }

  try {
    const db = getDb();
    const intent = await getCheckoutIntent(db, params.intentId);
    if (!intent) {
      console.warn(`sumit return: no intent ${params.intentId} (payment ${params.paymentId})`);
      return landing(request, FAILED);
    }
    if (sessionUserId !== intent.userId) {
      console.warn(`sumit return: session user is not the intent's account (intent ${intent.id})`);
      return jsonError(403, "החשבון המחובר אינו החשבון שביצע את התשלום.");
    }
    await completeCheckout(db, {
      intentId: params.intentId,
      sumitPaymentId: params.paymentId,
      sumitCustomerId: params.customerId,
    });
    return landing(request, SUCCESS);
  } catch (err) {
    if (err instanceof CheckoutVerificationError) {
      console.error(
        `sumit return: verification refused (${err.reason}) — intent ${params.intentId}, payment ${params.paymentId}, customer ${params.customerId}${err.payment ? " — the payment is valid at Sumit: refund or activate by hand" : ""}`,
      );
      return landing(request, err.payment ? REFUSED : FAILED);
    }
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`sumit return: failed for intent ${params.intentId}: ${detail}`);
    return landing(request, FAILED);
  }
}
