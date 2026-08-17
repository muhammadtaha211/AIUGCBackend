import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  AccountBudgetError,
  getAudioWithScript,
  getLatestDemoAnalysis,
  getStepPlan,
  InsufficientCreditsError,
  schema,
  type Db,
} from "@aiugc/core";
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

/**
 * The audio render and the script it will actually speak. Core resolves the
 * script through audio_renders.script_id — never a client-supplied id — and
 * that same row carries the business the ownership gate runs on. Callers
 * showing the customer what they are approving must read `script`, not wizard
 * state. `pointerMoved` says the pointer was rewritten after the audio was
 * enqueued; see getAudioWithScript for how it is derived and what it misses.
 */
export async function requireAudio(
  db: Db,
  audioId: string,
  userId: string,
): Promise<
  | {
      audio: typeof schema.audioRenders.$inferSelect;
      script: typeof schema.scripts.$inferSelect;
      pointerMoved: boolean;
    }
  | { response: NextResponse }
> {
  if (!isUuid(audioId)) return { response: jsonError(404, NOT_FOUND) };
  const found = await getAudioWithScript(db, audioId);
  if (!found) return { response: jsonError(404, NOT_FOUND) };
  const owned = await requireBusiness(db, found.script.businessId, userId);
  if ("response" in owned) return owned;
  return found;
}

export async function requireDemo(
  db: Db,
  demoId: string,
  userId: string,
): Promise<{ demo: typeof schema.demos.$inferSelect } | { response: NextResponse }> {
  if (!isUuid(demoId)) return { response: jsonError(404, NOT_FOUND) };
  const rows = await db.select().from(schema.demos).where(eq(schema.demos.id, demoId)).limit(1);
  if (!rows[0]) return { response: jsonError(404, NOT_FOUND) };
  const owned = await requireBusiness(db, rows[0].businessId, userId);
  if ("response" in owned) return owned;
  return { demo: rows[0] };
}

/**
 * The demo's NEWEST analysis attempt (any status — the wizard polls through
 * pending/analysing and must see rejected/failed with their Hebrew failReason).
 * 404 until the analyze job has inserted its row; the demo poll covers before.
 */
export async function requireAnalysis(
  db: Db,
  demoId: string,
  userId: string,
): Promise<
  | { demo: typeof schema.demos.$inferSelect; analysis: typeof schema.demoAnalyses.$inferSelect }
  | { response: NextResponse }
> {
  const found = await requireDemo(db, demoId, userId);
  if ("response" in found) return found;
  const analysis = await getLatestDemoAnalysis(db, demoId);
  if (!analysis) return { response: jsonError(404, NOT_FOUND) };
  return { demo: found.demo, analysis };
}

/** Step plan by id, ownership resolved through its demo's business. */
export async function requirePlan(
  db: Db,
  planId: string,
  userId: string,
): Promise<{ plan: typeof schema.demoStepPlans.$inferSelect } | { response: NextResponse }> {
  if (!isUuid(planId)) return { response: jsonError(404, NOT_FOUND) };
  const plan = await getStepPlan(db, planId);
  if (!plan) return { response: jsonError(404, NOT_FOUND) };
  const demoRows = await db
    .select()
    .from(schema.demos)
    .where(eq(schema.demos.id, plan.demoId))
    .limit(1);
  if (!demoRows[0]) return { response: jsonError(404, NOT_FOUND) };
  const owned = await requireBusiness(db, demoRows[0].businessId, userId);
  if ("response" in owned) return owned;
  return { plan };
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
  if (/demo is not ready/.test(message)) {
    return jsonError(409, "סרטון המוצר עדיין בעיבוד — נסו שוב בעוד רגע.");
  }
  if (/has no ready analysis/.test(message)) {
    return jsonError(409, "ניתוח הסרטון עדיין לא מוכן — נסו שוב עוד רגע.");
  }
  if (/only ready plans are editable/.test(message)) {
    return jsonError(409, "אפשר לערוך רק תוכנית מוכנה.");
  }
  if (/only ready plans can be approved/.test(message)) {
    return jsonError(409, "אפשר לאשר רק תוכנית מוכנה.");
  }
  if (/needs at least one step/.test(message)) {
    return jsonError(400, "התוכנית צריכה לפחות צעד אחד.");
  }
  // Step-shape rejections from updatePlanSteps: a well-behaved picker never
  // sends these (it mirrors the same filters), so the generic Hebrew suffices.
  if (
    /not in the analysis timeline|appears twice|unreadable state|empty label|label is over/.test(
      message,
    )
  ) {
    return jsonError(400, INVALID_BODY);
  }
  if (/demo note is empty/.test(message)) return jsonError(400, INVALID_BODY);
  if (/demo notes limit reached/.test(message)) {
    return jsonError(400, "הגעתם למגבלת ההערות על הסרטון.");
  }
  if (/daily audio preview limit/.test(message)) {
    return jsonError(429, "הגעתם למכסת ההשמעות היומית — נסו שוב מחר.");
  }
  // The per-account abuse ceiling. A fast rejection on purpose: the
  // platform-wide cap parks the job instead, and a parked job spins forever.
  if (err instanceof AccountBudgetError) {
    // The core message names the capped kind — GPU caps refuse renders, TTS
    // caps refuse recordings, LLM caps refuse plan/copy generation; the
    // Hebrew should say which.
    return jsonError(
      429,
      /gpu_seconds/.test(err.message)
        ? "הגעתם למכסת יצירת הסרטונים היומית של החשבון — נסו שוב מחר."
        : /llm_tokens/.test(err.message)
          ? "הגעתם למכסת יצירת התוכן היומית של החשבון — נסו שוב מחר."
          : "הגעתם למכסת ההקלטות היומית של החשבון — נסו שוב מחר.",
    );
  }
  // Typed, so the shortfall is a number the UI can render — not text scraped
  // back out of an English message.
  if (err instanceof InsufficientCreditsError) {
    return jsonError(402, `אין מספיק קרדיטים ליצירת הסרטון — חסרים ${err.shortfall}.`);
  }
  console.error("service B route failed", err);
  return jsonError(500, GENERIC_ERROR);
}
