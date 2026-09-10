import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@aiugc/core";
import { createServerSupabase } from "@/lib/supabase/server";
import { adminAccess, authReadFailed } from "@/lib/admin";

/**
 * Route-handler plumbing for the admin API: session auth, the role gate, and
 * mapping core pipeline errors to Hebrew responses with proper status codes.
 */

export const GENERIC_ERROR = "משהו השתבש. נסו שוב בעוד רגע.";
export const NOT_FOUND = "לא נמצא.";
export const INVALID_BODY = "הבקשה לא תקינה.";

/** Signed URLs are minted server-side only, always with this expiry. */
export const SIGNED_URL_TTL_SECONDS = 3600;

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * The auth READ failed — we could not tell who you are. Deliberately distinct
 * from the two nulls below ("no session" and "signed in but not an admin"),
 * which are answers; this is the absence of one.
 * docs/vault/defects/auth-getuser-errors-read-as-signed-out.md
 */
class AuthReadError extends Error {}

/**
 * The admin gate: resolve the session, load the users row on the same
 * service-role path, and pass only role='admin'. adminSession is the page-side
 * form (server components redirect to /login on null); requireAdmin is the
 * route-handler form — EVERY route handler must call it, because the
 * middleware is a separate layer that must never be trusted alone (Next
 * middleware bypass CVEs exist).
 *
 * Both go through this one function, which returns null for BOTH answers — no
 * session, and a session that is not an admin — and throws AuthReadError only
 * when the read itself failed, so the two callers can answer that differently.
 * Anything else (a failed users read) propagates untouched.
 */
async function adminUserId(db: Db): Promise<string | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  // authReadFailed, not `if (error)`: getUser resolves an AuthSessionMissingError
  // for the ordinary signed-out case, which is a 403/redirect, not a 503.
  if (authReadFailed(error)) throw new AuthReadError(`auth read failed: ${error!.message}`);
  if (!user) return null;
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  return adminAccess(rows[0]) === "ok" ? user.id : null;
}

export async function adminSession(db: Db): Promise<{ userId: string } | null> {
  try {
    const userId = await adminUserId(db);
    return userId ? { userId } : null;
  } catch (err) {
    // The page form, and the one place the failure is deliberately swallowed:
    // apps/admin has NO error boundary at any level, so a throw out of here
    // reaches Next's built-in English screen. Pages keep today's behaviour —
    // /login, wrong but harmless for a founder-only console — and the log is
    // what separates it from a real sign-out. Narrow on purpose: a failed
    // users read still propagates, because turning THAT into /login would be
    // this defect again in a new place.
    if (!(err instanceof AuthReadError)) throw err;
    console.error("adminSession: auth read failed", err);
    return null;
  }
}

export async function requireAdmin(
  db: Db,
): Promise<{ userId: string } | { response: NextResponse }> {
  let userId: string | null;
  try {
    userId = await adminUserId(db);
  } catch (err) {
    // 503, not 403. A route handler has no boundary either, but it does have a
    // status code to tell the truth with: 403 says "you are not allowed", which
    // is a verdict we never reached. Same call as requireUser in apps/web.
    if (!(err instanceof AuthReadError)) throw err;
    console.error("requireAdmin: auth read failed", err);
    return { response: jsonError(503, GENERIC_ERROR) };
  }
  if (!userId) return { response: jsonError(403, "אין הרשאה.") };
  return { userId };
}

/**
 * Map known core errors to user-facing Hebrew responses — only the cases the
 * admin routes (persona bank + grants) can actually hit. Anything unrecognized
 * is logged and returned as a generic 500.
 */
export function coreErrorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "";
  if (/cannot retire the default image/.test(message)) {
    return jsonError(409, "אי אפשר להסיר את תמונת ברירת המחדל — קבעו קודם תמונה אחרת.");
  }
  if (/is retired/.test(message)) {
    return jsonError(400, "התמונה הזאת הוסרה — בחרו תמונה אחרת.");
  }
  if (/not found/.test(message)) return jsonError(404, NOT_FOUND);
  console.error("admin route failed", err);
  return jsonError(500, GENERIC_ERROR);
}
