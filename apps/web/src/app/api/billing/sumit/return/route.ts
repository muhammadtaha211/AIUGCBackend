import { NextResponse } from "next/server";
import {
  CheckoutVerificationError,
  completeCheckout,
  getCheckoutIntent,
  getDb,
  recordUnconfirmedCheckoutReturn,
  SumitApiError,
} from "@aiugc/core";
import { jsonError } from "@/lib/api";
import { authReadFailed } from "@/lib/auth-user";
import {
  clientIp,
  IpRateLimiter,
  parseSumitReturnParams,
  sumitPaymentIdParam,
  sumitReturnPath,
} from "@/lib/billing";
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
 * Landings, all on /home/plan and all one Hebrew line:
 *
 *   ?checkout=success      the intent completed (or was already complete with
 *                          this payment).
 *   ?checkout=refused      Sumit holds a valid payment and completeCheckout
 *                          refused to activate on it — core recorded it as
 *                          `checkout_refused`; the line says do not pay again.
 *   ?checkout=failed       ONLY when Sumit positively answered that this
 *                          payment is not valid. This is the one line that
 *                          invites another attempt, so it is the one landing
 *                          that needs Sumit to have said so.
 *   ?checkout=unconfirmed  everything else after a browser arrived carrying a
 *                          payment id — a Sumit outage, a misconfigured key, a
 *                          payment Sumit does not know, our own database down,
 *                          any unexpected throw. Payment received, being
 *                          confirmed, do not pay again; recorded in
 *                          gateway_events as `checkout_unconfirmed` — best
 *                          effort, since when the failure IS the database that
 *                          write fails too and the log line is the record.
 *
 * An intro intent (the ₪5 offer, decision 0109) lands on the same four with an
 * `intro` prefix — `?checkout=intro` for its success — once the intent is
 * known; the page shows the same lines, and the analytics step tells them apart.
 *
 * Why the default is `unconfirmed` and not `failed`: measured on the test
 * business, the payment page redirects here ONLY after a payment it accepted
 * — a decline re-rendered the page and the browser never left it. So a
 * browser on this URL has almost certainly paid, and every failure to VERIFY
 * that payment (as opposed to Sumit saying it is invalid) is our ignorance,
 * not the customer's problem to solve with a second card. This is not
 * hypothetical: on 2026-09-21 a real ₪150 payment landed on `?checkout=failed`
 * — "אפשר לנסות שוב" — because Vercel's Sumit credentials were malformed and
 * /billing/payments/get/ threw. (docs/vault/defects/sumit-return-failure-invited-a-second-payment.md)
 *
 * Every failure line AFTER the three ids parse carries all of them plus the
 * return path, so the return can be replayed from the log alone. (The
 * malformed-params line has only what parsed; the auth-read lines precede the
 * ids entirely and end in the /login redirect, which keeps the whole URL.) No
 * stack ever renders.
 */

const SUCCESS = "/home/plan?checkout=success";
const FAILED = "/home/plan?checkout=failed";
const REFUSED = "/home/plan?checkout=refused";
const UNCONFIRMED = "/home/plan?checkout=unconfirmed";
/**
 * The ₪5 intro offer's own codes (decision 0109) — the same lines on the page,
 * but the payment_returned step tells a trial from a plan. Only reachable once
 * the intent is known; before that a return lands on the plan codes above.
 */
const INTRO_LANDINGS = {
  success: "/home/plan?checkout=intro",
  failed: "/home/plan?checkout=intro_failed",
  refused: "/home/plan?checkout=intro_refused",
  unconfirmed: "/home/plan?checkout=intro_unconfirmed",
};
const PLAN_LANDINGS = {
  success: SUCCESS,
  failed: FAILED,
  refused: REFUSED,
  unconfirmed: UNCONFIRMED,
};
const limiter = new IpRateLimiter(10, 60_000);

function landing(request: Request, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

/** What the recorded row's `reason` says. The verification reasons are core's own. */
function unconfirmedReason(err: unknown): string {
  if (err instanceof CheckoutVerificationError) return err.reason;
  if (err instanceof SumitApiError) return `sumit_${err.kind}`;
  return "unexpected_error";
}

export async function GET(request: Request) {
  if (!limiter.allow(clientIp(request.headers) ?? "unknown")) {
    return jsonError(429, "יותר מדי ניסיונות. נסו שוב בעוד דקה.");
  }

  const url = new URL(request.url);
  const returnPath = sumitReturnPath(url);
  const params = parseSumitReturnParams(url.searchParams);
  if (!params) {
    // Nothing is written before the session is known: this request has proved
    // nothing about who is asking, and the row would be keyed on ids off an
    // unauthenticated URL. Only the LINE changes — a browser carrying a
    // payment id was redirected here by the payment page, so it is not told to
    // pay again.
    const paymentId = sumitPaymentIdParam(url.searchParams);
    console.warn(
      `sumit return: missing or malformed og-* parameters — payment ${paymentId ?? "none"}, returnPath ${returnPath}`,
    );
    return landing(request, paymentId ? UNCONFIRMED : FAILED);
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

  const ids = `intent ${params.intentId}, payment ${params.paymentId}, customer ${params.customerId}, returnPath ${returnPath}`;
  // Plan codes until the intent says otherwise.
  let landings = PLAN_LANDINGS;

  try {
    const db = getDb();
    const intent = await getCheckoutIntent(db, params.intentId);
    if (!intent) {
      // No intent to record against, and the ownership check has not run — so
      // nothing is written. The browser still came off the payment page.
      console.warn(`sumit return: no intent — ${ids}`);
      return landing(request, UNCONFIRMED);
    }
    if (sessionUserId !== intent.userId) {
      console.warn(`sumit return: session user is not the intent's account — ${ids}`);
      return jsonError(403, "החשבון המחובר אינו החשבון שביצע את התשלום.");
    }
    if (intent.kind === "intro") landings = INTRO_LANDINGS;
    await completeCheckout(db, {
      intentId: params.intentId,
      sumitPaymentId: params.paymentId,
      sumitCustomerId: params.customerId,
    });
    return landing(request, landings.success);
  } catch (err) {
    if (err instanceof CheckoutVerificationError && err.payment) {
      // Sumit answered, the payment is valid, and core refused to activate on
      // it — already on record as `checkout_refused` under the payment's id.
      console.error(
        `sumit return: verification refused (${err.reason}) — ${ids} — the payment is valid at Sumit: refund or activate by hand`,
      );
      return landing(request, landings.refused);
    }
    if (err instanceof CheckoutVerificationError && err.reason === "payment_invalid") {
      // The only answer that earns "אפשר לנסות שוב": Sumit read the payment
      // and said ValidPayment is false. Nothing moved, nothing to record.
      console.error(`sumit return: Sumit says the payment is not valid — ${ids} — ${err.message}`);
      return landing(request, landings.failed);
    }
    const reason = unconfirmedReason(err);
    const detail = err instanceof Error ? err.message : String(err);
    // This line first, and unconditionally: when the failure IS the database,
    // the row below cannot be written and this line is the whole record.
    console.error(
      `sumit return: could not confirm the payment (${reason}) — ${ids} — ${detail}`,
      err,
    );
    try {
      // getDb() again rather than the handle above: it is memoised, and this
      // path is reached when that line may not have run. Best-effort by
      // design — the customer lands on the same line either way.
      await recordUnconfirmedCheckoutReturn(getDb(), {
        intentId: params.intentId,
        sumitPaymentId: params.paymentId,
        sumitCustomerId: params.customerId,
        reason,
        detail,
        returnPath,
      });
    } catch (recordErr) {
      console.error(`sumit return: could not record the unconfirmed return — ${ids}`, recordErr);
    }
    return landing(request, landings.unconfirmed);
  }
}
