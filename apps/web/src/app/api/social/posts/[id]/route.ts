import { NextResponse } from "next/server";
import { getDb, getScheduledPostItem, updateScheduledPost } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, NOT_FOUND } from "@/lib/api";
import { isUuid } from "@/lib/service-b";
import { requirePostingUser } from "@/lib/social";
import { editBodySchema, toPostWire } from "@/lib/social-posting";

/**
 * PATCH /api/social/posts/[id] — the post page's "שמירה": time, caption,
 * sound or the AI tick, while the post has not started (core's guard on
 * `status = 'scheduled'`; anything later is a 409 with its own line).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePostingUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, NOT_FOUND);
  const parsed = editBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, INVALID_BODY);
  const body = parsed.data;
  try {
    const db = getDb();
    await updateScheduledPost(db, {
      userId: auth.userId,
      postId: id,
      scheduledAt: body.scheduledAt !== undefined ? new Date(body.scheduledAt) : undefined,
      timezone: body.timezone,
      caption: body.caption,
      sound: body.sound,
      aiLabel: body.aiLabel,
    });
    const item = await getScheduledPostItem(db, { userId: auth.userId, postId: id });
    if (!item) return jsonError(404, NOT_FOUND);
    return NextResponse.json({ ok: true, post: await toPostWire(item) });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
