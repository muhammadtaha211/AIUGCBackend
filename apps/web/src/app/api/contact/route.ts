import { NextResponse } from "next/server";
import { countContactMessagesByIpSince, getDb, submitContactMessage } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError } from "@/lib/api";
import { clientIp } from "@/lib/billing";
import {
  CONTACT_CAP_ERROR,
  CONTACT_DAILY_CAP_PER_IP,
  CONTACT_HONEYPOT_FIELD,
  CONTACT_WINDOW_MS,
  contactRequestSchema,
} from "@/lib/feedback";

/**
 * One message from the PUBLIC /contact form. It lands in the same `feedback`
 * table the in-app form writes to, with `user_id` null (migration 0047), and
 * the founder reads it in the admin console. Nothing is emailed, posted or
 * notified anywhere.
 *
 * **Unauthenticated, necessarily** — a contact form that needs an account is
 * not a contact form; UPay's site requirements want a reachable one. This is
 * the second public route in the app (`auth-email-failed` is the first), so
 * the three things that make it safe are worth stating:
 *
 * 1. **A honeypot before anything else.** A filled trap gets the same 200 the
 *    success path returns and writes no row: a bot that cannot tell it failed
 *    has no signal to adapt to.
 * 2. **A per-IP soft cap in the database, not in memory.** This runs as a
 *    Vercel function with no shared state between invocations, so an in-process
 *    counter would reset on every cold start.
 * 3. **It stores only what the form collects** — a name, an address and a
 *    message, all length-bounded, all rendered as text and never navigated to
 *    or sent to. The IP is kept for the founder's spam triage and for nothing
 *    else; `/privacy` §3 says so.
 *
 * The cap is a count-then-insert, so two simultaneous submissions can both
 * pass. That is the same softness the in-app cap has and for the same reason:
 * it is a brake, not an access control.
 */
export async function POST(request: Request) {
  try {
    const db = getDb();
    const body = contactRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    // The trap, before the cap and before the write: a bot must not learn
    // anything from the shape of the answer, including how long it took.
    if (body.data[CONTACT_HONEYPOT_FIELD]?.trim()) return NextResponse.json({ ok: true });

    const ip = clientIp(request.headers);
    if (ip) {
      const since = new Date(Date.now() - CONTACT_WINDOW_MS);
      if ((await countContactMessagesByIpSince(db, ip, since)) >= CONTACT_DAILY_CAP_PER_IP) {
        return jsonError(429, CONTACT_CAP_ERROR);
      }
    }

    await submitContactMessage(db, {
      name: body.data.name,
      email: body.data.email,
      message: body.data.message,
      ip,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
