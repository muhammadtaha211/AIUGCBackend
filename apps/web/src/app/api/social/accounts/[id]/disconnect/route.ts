import { NextResponse } from "next/server";
import { disconnectSocialAccount, getDb, SocialSchedulingError } from "@aiugc/core";
import { coreErrorResponse, jsonError, NOT_FOUND } from "@/lib/api";
import { isUuid } from "@/lib/service-b";
import { requirePostingUser } from "@/lib/social";

/**
 * POST /api/social/accounts/[id]/disconnect — ניתוק (decision 0101, PR 2). A
 * POST, the web's convention for user-owned mutations. Erases every token,
 * keeps the row, cancels the account's scheduled posts and answers how many,
 * so Integrations can say it. No Facebook permission is revoked: that is per
 * app per Facebook user, and one account's disconnect must not take the
 * others with it.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePostingUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, NOT_FOUND);
  try {
    const { cancelled } = await disconnectSocialAccount(getDb(), {
      userId: auth.userId,
      accountId: id,
    });
    return NextResponse.json({ ok: true, cancelled });
  } catch (err) {
    // Someone else's account, or one already gone: the same 404 either way.
    if (err instanceof SocialSchedulingError && err.code === "not_found") {
      return jsonError(404, NOT_FOUND);
    }
    return coreErrorResponse(err);
  }
}
