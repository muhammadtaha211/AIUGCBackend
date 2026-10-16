import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import {
  getDb,
  getScheduledPost,
  getStorage,
  listSocialAccounts,
  POSTING_HORIZON_DAYS,
  postingHorizon,
  schema,
} from "@aiugc/core";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/api";
import { authedUser } from "@/lib/auth-user";
import type { SoundChoice } from "@/lib/schedule-form";
import { businessAccess, isUuid } from "@/lib/service-b";
import { renderDownloadFilename } from "@/lib/service-b-ui";
import { userPlatforms } from "@/lib/social";
import { preScreenPath, tiktokStartPath } from "@/lib/social-paths";
import { createServerSupabase } from "@/lib/supabase/server";
import { ScheduleFlow } from "./schedule-flow";

/**
 * /schedule/[renderId] — "תזמון פרסום" (decision 0101, PR 3): a page, not a
 * modal, so the first-time connect has an address to come back to
 * (decision 7: the customer returns to the same video). The layout has already
 * turned away a hidden account; the page checks again, then the video — the
 * caller's own, released, its file still kept — and the accounts.
 *
 * `?from=<postId>` is a failed post's "תזמון מחדש": the caption, the sound,
 * the tick and the account carried forward (0101 planning default).
 */
export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ renderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createServerSupabase();
  const user = authedUser(await supabase.auth.getUser());
  if (!user) notFound();
  // The accounts, the prefill and the connect link follow the account's
  // switches (decision 0115): a platform it cannot see leaves no trace here.
  const platforms = await userPlatforms(user.id);
  if (platforms.length === 0) notFound();

  const { renderId } = await params;
  if (!isUuid(renderId)) notFound();
  const db = getDb();
  const render = (
    await db.select().from(schema.videoRenders).where(eq(schema.videoRenders.id, renderId)).limit(1)
  )[0];
  if (!render) notFound();
  const [business] = await db
    .select()
    .from(schema.businesses)
    .where(eq(schema.businesses.id, render.businessId))
    .limit(1);
  const [requester] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);
  if (businessAccess(business, requester) !== "ok") notFound();
  if (render.status !== "released" || !render.filePath) notFound();

  const accounts = await listSocialAccounts(db, user.id, platforms);
  const storage = getStorage();
  const thumbUrl = render.thumbPath
    ? await storage.signedUrl(render.thumbPath, SIGNED_URL_TTL_SECONDS)
    : null;
  const downloadUrl = await storage.signedUrl(render.filePath, SIGNED_URL_TTL_SECONDS, {
    download: renderDownloadFilename(render),
  });
  const horizon = await postingHorizon(db, render);

  const query = await searchParams;
  const from =
    typeof query.from === "string" && isUuid(query.from)
      ? await getScheduledPost(db, { userId: user.id, postId: query.from, platforms })
      : undefined;
  const prefill =
    from && from.videoRenderId === renderId
      ? {
          accountIds: [from.socialAccountId],
          caption: from.caption,
          sound: (from.sound as SoundChoice | null) ?? null,
          aiLabel: from.aiLabel,
        }
      : null;

  const format = (render.params as { format?: string } | null)?.format;
  return (
    <ScheduleFlow
      render={{
        id: render.id,
        service: render.service,
        // A retired full-format A render carries a voiceover (0102 §2).
        voiced: render.service === "a" && format === "full",
        thumbUrl,
        downloadUrl,
      }}
      accounts={accounts.map((account) => ({
        id: account.id,
        platform: account.platform,
        username: account.username,
        displayName: account.displayName,
        pictureUrl: account.pictureUrl,
        status: account.status,
        canSearchSounds: account.canSearchSounds,
      }))}
      horizon={{
        maxScheduledAt: horizon.maxScheduledAt.toISOString(),
        limitedBy: horizon.limitedBy,
        days: POSTING_HORIZON_DAYS,
      }}
      connectHref={connectHrefFor(platforms, `/schedule/${renderId}`)}
      platforms={platforms}
      prefill={prefill}
    />
  );
}

/**
 * Where the no-account card sends a first-time customer, back to this video
 * afterwards: Instagram's pre-screen, TikTok's connect, or — both open —
 * the חיבורים section, where each platform has its card.
 */
function connectHrefFor(platforms: ("instagram" | "tiktok")[], returnTo: string): string {
  if (platforms.length > 1) {
    return `/home/settings?${new URLSearchParams({ return: returnTo }).toString()}#connections`;
  }
  return platforms[0] === "tiktok"
    ? tiktokStartPath({ returnTo })
    : preScreenPath({ returnTo, add: false });
}
