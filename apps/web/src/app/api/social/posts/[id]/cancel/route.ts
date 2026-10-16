import { NextResponse } from "next/server";
import { cancelScheduledPost, getDb } from "@aiugc/core";
import { coreErrorResponse, jsonError, NOT_FOUND } from "@/lib/api";
import { isUuid } from "@/lib/service-b";
import { requirePostingUser } from "@/lib/social";

/**
 * POST /api/social/posts/[id]/cancel — "ביטול הפרסום". Allowed while nothing
 * has reached the platform: not started, or waiting out Instagram's quota with
 * no container yet. The job then sees the cancelled row and ends as a no-op.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePostingUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, NOT_FOUND);
  try {
    await cancelScheduledPost(getDb(), {
      userId: auth.userId,
      postId: id,
      platforms: auth.platforms,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
