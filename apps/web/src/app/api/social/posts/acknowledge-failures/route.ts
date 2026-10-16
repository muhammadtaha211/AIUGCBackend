import { NextResponse } from "next/server";
import { acknowledgeFailedPosts, getDb } from "@aiugc/core";
import { coreErrorResponse } from "@/lib/api";
import { requirePostingUser } from "@/lib/social";

/**
 * POST /api/social/posts/acknowledge-failures — the /home notice's "הבנתי":
 * every failed post of the account stops counting toward the notice. The
 * calendar still shows them, and nothing here touches the failure email.
 */
export async function POST() {
  const auth = await requirePostingUser();
  if ("response" in auth) return auth.response;
  try {
    const acknowledged = await acknowledgeFailedPosts(getDb(), auth.userId, auth.platforms);
    return NextResponse.json({ ok: true, acknowledged });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
