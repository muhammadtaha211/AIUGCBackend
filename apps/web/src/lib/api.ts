import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { schema, type Db } from "@aiugc/core";
import { createServerSupabase } from "@/lib/supabase/server";
import { businessAccess, isUuid } from "@/lib/service-b";

/**
 * Route-handler plumbing for the Service B API: session auth, the explicit
 * ownership gate (core's getDb() bypasses RLS), and mapping core pipeline
 * errors to Hebrew responses with proper status codes.
 */

export const GENERIC_ERROR = "משהו השתבש. נסו שוב בעוד רגע.";
export const NOT_FOUND = "לא נמצא.";
export const INVALID_BODY = "הבקשה לא תקינה.";

/** Signed URLs are minted server-side only, always with this expiry. */
export const SIGNED_URL_TTL_SECONDS = 3600;

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function requireUser(): Promise<{ userId: string } | { response: NextResponse }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: jsonError(401, "צריך להתחבר קודם.") };
  return { userId: user.id };
}

/**
 * The ownership gate: the target business must belong to the session user
 * (owner_user_id = auth uid) or the user must be an admin. 403 on mismatch,
 * 404 on missing — including ids that are not UUIDs at all.
 */
export async function requireBusiness(
  db: Db,
  businessId: string,
  userId: string,
): Promise<{ business: typeof schema.businesses.$inferSelect } | { response: NextResponse }> {
  if (!isUuid(businessId)) return { response: jsonError(404, NOT_FOUND) };
  const businessRows = await db
    .select()
    .from(schema.businesses)
    .where(eq(schema.businesses.id, businessId))
    .limit(1);
  const requesterRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const access = businessAccess(businessRows[0], requesterRows[0]);
  if (access === "missing") return { response: jsonError(404, NOT_FOUND) };
  if (access === "forbidden") return { response: jsonError(403, "אין לך גישה לעסק הזה.") };
  return { business: businessRows[0]! };
}

/**
 * Resource loaders for routes reached by id: fetch the row, join back to its
 * business, and run the same ownership gate. 404 covers both a missing row
 * and a malformed id.
 */

export async function requireComposite(
  db: Db,
  compositeId: string,
  userId: string,
): Promise<{ composite: typeof schema.composites.$inferSelect } | { response: NextResponse }> {
  if (!isUuid(compositeId)) return { response: jsonError(404, NOT_FOUND) };
  const rows = await db
    .select()
    .from(schema.composites)
    .where(eq(schema.composites.id, compositeId))
    .limit(1);
  if (!rows[0]) return { response: jsonError(404, NOT_FOUND) };
  const owned = await requireBusiness(db, rows[0].businessId, userId);
  if ("response" in owned) return owned;
  return { composite: rows[0] };
}

export async function requireScript(
  db: Db,
  scriptId: string,
  userId: string,
): Promise<{ script: typeof schema.scripts.$inferSelect } | { response: NextResponse }> {
  if (!isUuid(scriptId)) return { response: jsonError(404, NOT_FOUND) };
  const rows = await db
    .select()
    .from(schema.scripts)
    .where(eq(schema.scripts.id, scriptId))
    .limit(1);
  if (!rows[0]) return { response: jsonError(404, NOT_FOUND) };
  const owned = await requireBusiness(db, rows[0].businessId, userId);
  if ("response" in owned) return owned;
  return { script: rows[0] };
}

export async function requireAudio(
  db: Db,
  audioId: string,
  userId: string,
): Promise<{ audio: typeof schema.audioRenders.$inferSelect } | { response: NextResponse }> {
  if (!isUuid(audioId)) return { response: jsonError(404, NOT_FOUND) };
  const rows = await db
    .select({ audio: schema.audioRenders, businessId: schema.scripts.businessId })
    .from(schema.audioRenders)
    .innerJoin(schema.scripts, eq(schema.audioRenders.scriptId, schema.scripts.id))
    .where(eq(schema.audioRenders.id, audioId))
    .limit(1);
  if (!rows[0]) return { response: jsonError(404, NOT_FOUND) };
  const owned = await requireBusiness(db, rows[0].businessId, userId);
  if ("response" in owned) return owned;
  return { audio: rows[0].audio };
}

export async function requireRender(
  db: Db,
  renderId: string,
  userId: string,
): Promise<{ render: typeof schema.videoRenders.$inferSelect } | { response: NextResponse }> {
  if (!isUuid(renderId)) return { response: jsonError(404, NOT_FOUND) };
  const rows = await db
    .select()
    .from(schema.videoRenders)
    .where(eq(schema.videoRenders.id, renderId))
    .limit(1);
  if (!rows[0]) return { response: jsonError(404, NOT_FOUND) };
  const owned = await requireBusiness(db, rows[0].businessId, userId);
  if ("response" in owned) return owned;
  return { render: rows[0] };
}

/**
 * Map known core pipeline errors to user-facing Hebrew responses. Anything
 * unrecognized is logged and returned as a generic 500.
 */
export function coreErrorResponse(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : "";
  if (/ארוך מדי/.test(message)) return jsonError(400, message); // word budget — already Hebrew
  if (/has no questionnaire yet/.test(message)) {
    return jsonError(400, "צריך למלא קודם את שאלון העסק.");
  }
  if (/only available for physical products/.test(message)) {
    return jsonError(400, "תמונת דמות עם המוצר זמינה רק לעסקים עם מוצר פיזי.");
  }
  if (/is not voiceable/.test(message)) return jsonError(400, "אי אפשר להקליט תסריט מהסוג הזה.");
  if (/not found/.test(message)) return jsonError(404, NOT_FOUND);
  if (/audio must be approved/.test(message)) {
    return jsonError(409, "צריך לאשר את האודיו לפני יצירת הסרטון.");
  }
  if (/composite must be approved/.test(message)) {
    return jsonError(409, "צריך לאשר את תמונת הדמות עם המוצר לפני יצירת הסרטון.");
  }
  if (/is retired/.test(message)) {
    return jsonError(400, "התמונה הזאת הוסרה — בחרו תמונה אחרת.");
  }
  if (/is not ready yet/.test(message)) return jsonError(409, "עוד לא מוכן — נסו שוב בעוד רגע.");
  if (/daily audio preview limit/.test(message)) {
    return jsonError(429, "הגעתם למכסת ההשמעות היומית — נסו שוב מחר.");
  }
  if (/insufficient credits/.test(message)) {
    return jsonError(402, "אין מספיק קרדיטים ליצירת הסרטון.");
  }
  if (/watermarked sample was already used|only a single Service A sample/.test(message)) {
    return jsonError(402, "סרטוני אווטאר דורשים מנוי פעיל.");
  }
  console.error("service B route failed", err);
  return jsonError(500, GENERIC_ERROR);
}
