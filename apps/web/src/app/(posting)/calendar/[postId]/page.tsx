import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import {
  getDb,
  getScheduledPostItem,
  getStorage,
  listSocialAccounts,
  POSTING_HORIZON_DAYS,
  postingHorizon,
  schema,
} from "@aiugc/core";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/api";
import { authedUser } from "@/lib/auth-user";
import { isUuid } from "@/lib/service-b";
import { renderDownloadFilename } from "@/lib/service-b-ui";
import { userPlatforms } from "@/lib/social";
import { toPostWire } from "@/lib/social-posting";
import { createServerSupabase } from "@/lib/supabase/server";
import { PostDetail } from "./post-detail";

/**
 * /calendar/[postId] — "פרסום" (Appendix A): the post's account, time,
 * caption, sound and video; while it has not started, the edit form and
 * "ביטול הפרסום"; once failed, the failure line with "תזמון מחדש" and הורדה;
 * once posted, the link to it. Only the caller's own post (core filters by
 * owner) — anyone else's id is the same 404 a missing one is.
 */
export default async function PostPage({ params }: { params: Promise<{ postId: string }> }) {
  const supabase = await createServerSupabase();
  const user = authedUser(await supabase.auth.getUser());
  if (!user) notFound();
  // A post on a platform the account's switches hide reads as not found (0115).
  const platforms = await userPlatforms(user.id);
  if (platforms.length === 0) notFound();

  const { postId } = await params;
  if (!isUuid(postId)) notFound();
  const db = getDb();
  const item = await getScheduledPostItem(db, { userId: user.id, postId, platforms });
  if (!item) notFound();

  const [render] = await db
    .select()
    .from(schema.videoRenders)
    .where(eq(schema.videoRenders.id, item.render.id))
    .limit(1);
  const downloadUrl = render?.filePath
    ? await getStorage().signedUrl(render.filePath, SIGNED_URL_TTL_SECONDS, {
        download: renderDownloadFilename(render),
      })
    : null;
  const horizon = render ? await postingHorizon(db, render) : null;
  const account = (await listSocialAccounts(db, user.id, platforms)).find(
    (row) => row.id === item.account.id,
  );
  const format = (render?.params as { format?: string } | null)?.format;

  return (
    <PostDetail
      post={await toPostWire(item)}
      downloadUrl={downloadUrl}
      horizon={
        horizon && {
          maxScheduledAt: horizon.maxScheduledAt.toISOString(),
          limitedBy: horizon.limitedBy,
          days: POSTING_HORIZON_DAYS,
        }
      }
      soundAccountId={account?.canSearchSounds ? account.id : null}
      voiced={item.render.service === "a" && format === "full"}
    />
  );
}
