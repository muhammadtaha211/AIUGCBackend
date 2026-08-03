import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@aiugc/core";
import { createServerSupabase } from "@/lib/supabase/server";
import { adminAccess } from "@/lib/admin";

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
 * The admin gate: resolve the session, load the users row on the same
 * service-role path, and pass only role='admin'. adminSession is the page-side
 * form (server components redirect to /login on null); requireAdmin is the
 * route-handler form — EVERY route handler must call it, because the
 * middleware is a separate layer that must never be trusted alone (Next
 * middleware bypass CVEs exist).
 */
export async function adminSession(db: Db): Promise<{ userId: string } | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  return adminAccess(rows[0]) === "ok" ? { userId: user.id } : null;
}

export async function requireAdmin(
  db: Db,
): Promise<{ userId: string } | { response: NextResponse }> {
  const session = await adminSession(db);
  if (!session) return { response: jsonError(403, "אין הרשאה.") };
  return session;
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
