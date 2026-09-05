import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAudioWithScript, getStepPlan, schema, type Db } from "@aiugc/core";
import { createServerSupabase } from "@/lib/supabase/server";
import { businessAccess, isUuid } from "@/lib/service-b";
import { coreErrorMapping } from "@/lib/api-errors";

/**
 * Route-handler plumbing for the Service B API: session auth, the explicit
 * ownership gate (core's getDb() bypasses RLS), and mapping core pipeline
 * errors to Hebrew responses with proper status codes.
 */

// The strings and the mapping itself live in ./api-errors, which has no `@/`
// imports and is therefore unit-testable; re-exported so the 18 route files
// that import them from "@/lib/api" keep working.
export { GENERIC_ERROR, NOT_FOUND, INVALID_BODY } from "@/lib/api-errors";
import { NOT_FOUND } from "@/lib/api-errors";

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
 * Map known core pipeline errors to user-facing Hebrew responses. The decision
 * lives in ./api-errors (pure, tested); this wraps it in a NextResponse and
 * keeps the log for anything unrecognized.
 */
export function coreErrorResponse(err: unknown): NextResponse {
  const { status, error, mapped } = coreErrorMapping(err);
  if (!mapped) {
    // Stack and cause go into the message string itself: the deployed log
    // surface rendered the bare error object without its stack, which left a
    // driver-level TypeError untraceable to a call site.
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    const cause =
      err instanceof Error && err.cause !== undefined
        ? `\ncaused by: ${err.cause instanceof Error ? (err.cause.stack ?? err.cause.message) : String(err.cause)}`
        : "";
    console.error(`api route failed: ${detail}${cause}`, err);
  }
  return jsonError(status, error);
}
