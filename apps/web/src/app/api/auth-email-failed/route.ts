import { NextResponse } from "next/server";
import { AUTH_EMAIL_FAILURE_REASONS, getDb, recordAuthEmailFailure } from "@aiugc/core";

/**
 * A signup could not complete because its confirmation email was not sent.
 *
 * **Unauthenticated, necessarily.** The failure IS "no account was created", so
 * there is no session to require. Three things make that safe, and all three are
 * load-bearing:
 *
 * 1. **It stores nothing a caller supplies.** The only thing that survives the
 *    parse is one value from `AUTH_EMAIL_FAILURE_REASONS`; anything else is a
 *    400 and no row. No email address, no password, no free text — so the worst
 *    a stranger can write is a row we would have written ourselves.
 * 2. **It is rate-limited in the database, not in memory** (`recordAuthEmailFailure`).
 *    This runs as a Vercel function with no shared state between invocations, so
 *    an in-process counter would reset on every cold start. The guarded INSERT
 *    gives every invocation the same answer without coordinating them, which is
 *    what stops this becoming a way to spam the founder's mail.
 * 3. **It can never fail a signup.** The caller fires it and forgets it
 *    (`apps/web/src/lib/auth.ts`), so every response here — 200, 400, 500,
 *    a network error — is discarded by the browser before it reaches the user.
 *
 * It reports nothing itself. It writes an `events` row and the WORKER reports
 * it, because decisions/0037 puts the Sentry SDK in apps/worker and nowhere
 * else; apps/web still never loads it.
 */
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => null);
    const reason = (body as { reason?: unknown } | null)?.reason;
    if (
      typeof reason !== "string" ||
      !(AUTH_EMAIL_FAILURE_REASONS as readonly string[]).includes(reason)
    ) {
      return NextResponse.json({ error: "unknown reason" }, { status: 400 });
    }

    const recorded = await recordAuthEmailFailure(
      getDb(),
      reason as (typeof AUTH_EMAIL_FAILURE_REASONS)[number],
    );
    return NextResponse.json({ ok: true, recorded });
  } catch {
    // Swallowed on purpose, and the body says nothing: an alert that cannot be
    // written must not become a second failure the customer can see, and this
    // route answers strangers.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
