import { NextResponse } from "next/server";
import { getDb, searchInstagramSounds } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError } from "@/lib/api";
import { isUuid } from "@/lib/service-b";
import { requirePlatformUser } from "@/lib/social";

/**
 * GET /api/social/instagram/sounds?accountId=&kind=&q=&after= — the sound
 * picker's proxy to Meta's `ig_audio` (decision 0101, PR 3): one kind per call
 * (`original_sound` = סאונדים מרילס, `music` = מוזיקה), trending when `q` is
 * empty, the next page by `after`. JSON only — a Vercel function may make these
 * calls; video bytes never pass through one. `reconnect` when the account's
 * User token is gone: the picker says so and the post goes on without a sound.
 */
export async function GET(request: Request) {
  const auth = await requirePlatformUser("instagram");
  if ("response" in auth) return auth.response;
  const params = new URL(request.url).searchParams;
  const accountId = params.get("accountId") ?? "";
  const kind = params.get("kind");
  const query = (params.get("q") ?? "").slice(0, 100);
  const after = params.get("after") ?? undefined;
  if (!isUuid(accountId) || (kind !== "original_sound" && kind !== "music")) {
    return jsonError(400, INVALID_BODY);
  }
  if (after !== undefined && after.length > 512) return jsonError(400, INVALID_BODY);
  try {
    const result = await searchInstagramSounds(getDb(), {
      userId: auth.userId,
      accountId,
      kind,
      query: query || undefined,
      after,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
