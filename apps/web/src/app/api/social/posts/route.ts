import { NextResponse } from "next/server";
import { getDb, listScheduledPosts, schedulePosts } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError } from "@/lib/api";
import { requirePostingUser } from "@/lib/social";
import { scheduleBodySchema, toPostWire } from "@/lib/social-posting";

/** The calendar asks for a month plus a day either side, never more. */
const MAX_RANGE_MS = 45 * 86_400_000;

/**
 * GET /api/social/posts?from=&to= — the calendar's month (decision 0101, PR 3):
 * the account's posts in [from, to), across every business, cancelled ones left
 * out (0101 planning default, kept 2026-10-12, 0107 §4). Thumbs are signed per
 * read, like the renders list.
 */
export async function GET(request: Request) {
  const auth = await requirePostingUser();
  if ("response" in auth) return auth.response;
  const params = new URL(request.url).searchParams;
  const from = new Date(params.get("from") ?? "");
  const to = new Date(params.get("to") ?? "");
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    to <= from ||
    to.getTime() - from.getTime() > MAX_RANGE_MS
  ) {
    return jsonError(400, INVALID_BODY);
  }
  try {
    const items = await listScheduledPosts(getDb(), { userId: auth.userId, from, to });
    const posts = await Promise.all(
      items.filter((item) => item.post.status !== "cancelled").map(toPostWire),
    );
    return NextResponse.json({ ok: true, posts });
  } catch (err) {
    return coreErrorResponse(err);
  }
}

/**
 * POST /api/social/posts — "תזמון": one post per picked account at one
 * instant, one caption, one sound for every Instagram account, the AI tick as
 * the customer left it (absent = unticked). Core checks the rest: the video is
 * the caller's and released, the instant is inside the horizon, the caps.
 */
export async function POST(request: Request) {
  const auth = await requirePostingUser();
  if ("response" in auth) return auth.response;
  const parsed = scheduleBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, INVALID_BODY);
  const body = parsed.data;
  try {
    const posts = await schedulePosts(getDb(), {
      userId: auth.userId,
      videoRenderId: body.renderId,
      accountIds: body.accountIds,
      scheduledAt: new Date(body.scheduledAt),
      timezone: body.timezone,
      caption: body.caption,
      sound: body.sound ?? null,
      aiLabel: body.aiLabel === true,
    });
    return NextResponse.json({
      ok: true,
      posts: posts.map((post) => ({ id: post.id, scheduledAt: post.scheduledAt.toISOString() })),
    });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
