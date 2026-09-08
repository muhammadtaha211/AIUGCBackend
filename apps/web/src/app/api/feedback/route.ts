import { NextResponse } from "next/server";
import { countFeedbackSince, getDb, submitFeedback } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireBusiness,
  requireUser,
} from "@/lib/api";
import {
  FEEDBACK_CAP_ERROR,
  FEEDBACK_DAILY_CAP,
  FEEDBACK_WINDOW_MS,
  feedbackRequestSchema,
} from "@/lib/feedback";

/**
 * One message from /home/feedback. It lands in the feedback table and the
 * founder reads it in the admin console — nothing is emailed, posted or
 * notified anywhere.
 *
 * businessId comes from the sidebar cookie, which the browser can set to any
 * value, so it goes through the same ownership gate as every other route. A
 * user with no business omits it entirely.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const body = feedbackRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    if (body.data.businessId) {
      const owned = await requireBusiness(db, body.data.businessId, auth.userId);
      if ("response" in owned) return owned.response;
    }

    const since = new Date(Date.now() - FEEDBACK_WINDOW_MS);
    if ((await countFeedbackSince(db, auth.userId, since)) >= FEEDBACK_DAILY_CAP) {
      return jsonError(429, FEEDBACK_CAP_ERROR);
    }

    await submitFeedback(db, {
      userId: auth.userId,
      businessId: body.data.businessId ?? null,
      message: body.data.message,
      page: body.data.page ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
