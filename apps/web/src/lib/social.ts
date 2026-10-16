import { cache } from "react";
import type { NextResponse } from "next/server";
import { and, inArray, sql } from "drizzle-orm";
import {
  allowedPlatforms,
  getDb,
  getPlatformAccess,
  schema,
  type SocialPlatform,
} from "@aiugc/core";
import { jsonError, NOT_FOUND, requireUser } from "@/lib/api";

/**
 * Server-only. The switches as the web reads them: `app_config.social_posting`
 * (Instagram's, decisions 0101 and 0102) and `app_config.tiktok_posting`
 * (TikTok's, independent — decision 0115). An account a platform's switch does
 * not allow sees no trace of that platform — no card, no account, no chip, a
 * 404 on its routes; an account no switch allows sees no trace of posting.
 *
 * cache(): the settings page and anything it renders ask once per request.
 */
export const platformAccess = cache(
  async (userId: string): Promise<Record<SocialPlatform, boolean>> =>
    getPlatformAccess(getDb(), userId),
);

/** Posting at all — any platform: the shared surfaces open on this. */
export const postingAllowed = cache(async (userId: string): Promise<boolean> => {
  const access = await platformAccess(userId);
  return access.instagram || access.tiktok;
});

/** The platforms the account sees, Instagram first — what every read is filtered to. */
export const userPlatforms = cache(async (userId: string): Promise<SocialPlatform[]> =>
  allowedPlatforms(await platformAccess(userId)),
);

/**
 * The gate for every shared social route (posts, disconnect, the notice). A
 * hidden account AND a signed-out visitor both get the same 404 a missing
 * resource gets — a 401 would tell a signed-out prober that the route exists.
 * A failed auth read stays a 503 (requireUser's reason: it is not an absent
 * session). `platforms` is what the route passes core to filter by.
 */
export async function requirePostingUser(): Promise<
  { userId: string; platforms: SocialPlatform[] } | { response: NextResponse }
> {
  const auth = await requireUser();
  if ("response" in auth) {
    return auth.response.status === 401 ? { response: jsonError(404, NOT_FOUND) } : auth;
  }
  const platforms = await userPlatforms(auth.userId);
  if (platforms.length === 0) return { response: jsonError(404, NOT_FOUND) };
  return { userId: auth.userId, platforms };
}

/** One platform's own routes (its connect, its sounds): its switch alone opens them. */
export async function requirePlatformUser(
  platform: SocialPlatform,
): Promise<{ userId: string } | { response: NextResponse }> {
  const auth = await requireUser();
  if ("response" in auth) {
    return auth.response.status === 401 ? { response: jsonError(404, NOT_FOUND) } : auth;
  }
  if (!(await platformAccess(auth.userId))[platform])
    return { response: jsonError(404, NOT_FOUND) };
  return { userId: auth.userId };
}

export type PlatformPostCounts = { waiting: number; delivered: number; posted: number };

/**
 * Per video and platform, its posts waiting (scheduled or publishing),
 * delivered (TikTok's inbox) and posted — what the tile's tags are decided from
 * (postTags, decision 0115 §3, amending 0108 §1). One grouped query over the
 * page's released rows and the caller's platforms; a video with none is absent.
 */
export async function postCountsByRender(
  db: ReturnType<typeof getDb>,
  renderIds: string[],
  platforms: readonly SocialPlatform[],
): Promise<Map<string, Partial<Record<SocialPlatform, PlatformPostCounts>>>> {
  if (renderIds.length === 0 || platforms.length === 0) return new Map();
  const { scheduledPosts } = schema;
  const rows = await db
    .select({
      renderId: scheduledPosts.videoRenderId,
      platform: scheduledPosts.platform,
      waiting: sql<string>`count(*) filter (where ${scheduledPosts.status} in ('scheduled', 'publishing'))`,
      delivered: sql<string>`count(*) filter (where ${scheduledPosts.status} = 'delivered')`,
      posted: sql<string>`count(*) filter (where ${scheduledPosts.status} = 'posted')`,
    })
    .from(scheduledPosts)
    .where(
      and(
        inArray(scheduledPosts.videoRenderId, renderIds),
        inArray(scheduledPosts.platform, [...platforms]),
        inArray(scheduledPosts.status, ["scheduled", "publishing", "delivered", "posted"]),
      ),
    )
    .groupBy(scheduledPosts.videoRenderId, scheduledPosts.platform);
  const out = new Map<string, Partial<Record<SocialPlatform, PlatformPostCounts>>>();
  for (const r of rows) {
    const byPlatform = out.get(r.renderId) ?? {};
    byPlatform[r.platform] = {
      waiting: Number(r.waiting),
      delivered: Number(r.delivered),
      posted: Number(r.posted),
    };
    out.set(r.renderId, byPlatform);
  }
  return out;
}
