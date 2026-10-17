import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "../db";
import {
  businesses,
  events,
  scheduledPosts,
  socialAccounts,
  users,
  videoRenders,
} from "../db/schema";
import { deliveryEmail, type DeliveryEmailPost } from "../social-copy";
import { getPlatformAccess } from "./social";
import {
  emailSweepGate,
  emailsSentToday,
  FAILURE_EMAIL_DAILY_CEILING,
  FAILURE_EMAIL_QUIET_MS,
  formatPostTime,
  POST_DELIVERY_EMAIL,
  sendPostEmail,
  type FailureEmailSweepResult,
} from "./social-failure-email";

/**
 * The delivery email (decision 0116): a TikTok video that reached the owner's
 * inbox is told to the Tavnit account by email, with the path to it inside
 * TikTok — TikTok's own notification is easy to miss, and an unfinished video
 * blocks the next ones (five a day per account).
 *
 * The failure email's sibling and built the same way: a sweep on the worker,
 * never part of `publish_post` or the webhook, so an email problem can never
 * fail, delay or retry a post. It shares the failure email's gate (no key, a dry
 * run, a developer machine), pause, Resend error ladder and daily ceiling —
 * all in social-failure-email.ts. The rules, each a constant below and pinned
 * by a test:
 * - **Due:** a TikTok post still `delivered` (one the owner already posted needs
 *   no reminder), delivered within the last 24 h, that no earlier delivery email
 *   lists. `delivered_at` is written once, by the one guarded `publishing →
 *   delivered` writer the webhook, the job's poll and the nets all share, so
 *   whichever moved the post, it is due once.
 * - **One per post, folded per sweep:** every due post of a Tavnit account goes
 *   in one email, oldest first. There is no cooldown (a failure email folds a
 *   day of the same cause; here every video gets told) — only the settle time
 *   below, so videos that land together share an email.
 * - **Settle:** a batch goes out once its newest post was delivered 2 minutes
 *   ago.
 * - **Switch:** a TikTok switch that no longer includes the account leaves no
 *   trace — no email, no row.
 * - **Ceiling:** the failure email's 20 a UTC day, counted over both kinds.
 *   Failure emails are swept first each tick; a held video goes out after
 *   midnight UTC while it is still unfinished and under 24 h old.
 *
 * The log is `events` rows of kind `post_delivery_email` (actor = the account;
 * payload: the platform, the post ids, the outcome) — no migration, and no
 * address or customer text in it. A row lists the posts it covers whether it was
 * sent or refused, and is what "never twice" reads.
 */
export const DELIVERY_EMAIL_QUIET_MS = FAILURE_EMAIL_QUIET_MS;
export const DELIVERY_EMAIL_FRESH_MS = 24 * 60 * 60 * 1000;

interface DeliveredPost {
  id: string;
  userId: string;
  renderId: string;
  accountId: string;
  email: string;
  deliveredAt: Date;
  scheduledAt: Date;
  timezone: string;
  username: string | null;
  displayName: string | null;
  businessName: string;
  service: "a" | "b" | "c";
}

/** The ids a log row lists, whatever shape the driver hands the jsonb back in. */
function loggedPostIds(value: unknown): string[] {
  let list: unknown = value;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
}

/**
 * One tick. Sends what is due and returns what it did; never throws for an
 * email problem (a database fault does throw — the worker's caller swallows it
 * and tries again next interval).
 */
export async function sweepPostDeliveryEmails(
  db: Db,
  opts: { workerId: string; now?: Date },
): Promise<FailureEmailSweepResult> {
  const now = opts.now ?? new Date();
  const result: FailureEmailSweepResult = { sent: 0, refused: 0, heldByCeiling: 0 };

  const gate = emailSweepGate(opts.workerId, now);
  if ("off" in gate) return { ...result, off: gate.off };
  const { provider } = gate;

  const rows = await db
    .select({
      id: scheduledPosts.id,
      userId: scheduledPosts.userId,
      renderId: scheduledPosts.videoRenderId,
      accountId: scheduledPosts.socialAccountId,
      email: users.email,
      deliveredAt: scheduledPosts.deliveredAt,
      scheduledAt: scheduledPosts.scheduledAt,
      timezone: scheduledPosts.timezone,
      username: socialAccounts.username,
      displayName: socialAccounts.displayName,
      businessName: businesses.name,
      service: videoRenders.service,
    })
    .from(scheduledPosts)
    .innerJoin(users, eq(users.id, scheduledPosts.userId))
    .innerJoin(socialAccounts, eq(socialAccounts.id, scheduledPosts.socialAccountId))
    .innerJoin(businesses, eq(businesses.id, scheduledPosts.businessId))
    .innerJoin(videoRenders, eq(videoRenders.id, scheduledPosts.videoRenderId))
    .where(
      and(
        eq(scheduledPosts.platform, "tiktok"),
        eq(scheduledPosts.status, "delivered"),
        gt(scheduledPosts.deliveredAt, new Date(now.getTime() - DELIVERY_EMAIL_FRESH_MS)),
      ),
    );
  const delivered: DeliveredPost[] = rows.flatMap((row) =>
    row.deliveredAt ? [{ ...row, deliveredAt: row.deliveredAt }] : [],
  );
  if (delivered.length === 0) return result;

  // Every post an earlier delivery email covers, sent or refused: a video under
  // 24 h old can only have been emailed in the 24 h before this tick, so 48 h
  // of rows is more than enough.
  const userIds = [...new Set(delivered.map((p) => p.userId))];
  const loggedRows = await db
    .select({ postIds: sql<unknown>`${events.payload}->'postIds'` })
    .from(events)
    .where(
      and(
        eq(events.kind, POST_DELIVERY_EMAIL),
        inArray(events.actorUserId, userIds),
        gt(events.createdAt, new Date(now.getTime() - 2 * DELIVERY_EMAIL_FRESH_MS)),
      ),
    );
  const alreadyTold = new Set(loggedRows.flatMap((row) => loggedPostIds(row.postIds)));

  // One batch per Tavnit account, oldest delivery first (the id breaks a tie, so
  // the order — and the idempotency key below — never wobbles).
  const batches = new Map<string, DeliveredPost[]>();
  const ordered = [...delivered]
    .filter((p) => !alreadyTold.has(p.id))
    .sort((a, b) => a.deliveredAt.getTime() - b.deliveredAt.getTime() || a.id.localeCompare(b.id));
  for (const post of ordered) batches.set(post.userId, [...(batches.get(post.userId) ?? []), post]);

  let remaining = FAILURE_EMAIL_DAILY_CEILING - (await emailsSentToday(db, now));

  for (const due of batches.values()) {
    const { userId, email } = due[0]!;
    // Wait for the burst to settle.
    if (now.getTime() - due[due.length - 1]!.deliveredAt.getTime() < DELIVERY_EMAIL_QUIET_MS) {
      continue;
    }
    // A switch narrowed since the post was scheduled leaves no trace either.
    if (!(await getPlatformAccess(db, userId)).tiktok) continue;
    if (remaining <= 0) {
      result.heldByCeiling += 1;
      continue;
    }

    const message = deliveryEmail({
      posts: due.map((p): DeliveryEmailPost => ({
        postId: p.id,
        renderId: p.renderId,
        accountId: p.accountId,
        service: p.service,
        businessName: p.businessName,
        accountName: p.username ? `@${p.username}` : (p.displayName ?? ""),
        platform: "tiktok",
        when: formatPostTime(p.scheduledAt, p.timezone),
      })),
    });
    const postIds = due.map((p) => p.id);
    const outcome = await sendPostEmail({
      provider,
      now,
      to: email,
      message,
      // The account and its OLDEST due post: a key that does not change while the
      // batch grows, so a retry after an ambiguous send or a failed log write is
      // deduplicated by Resend (24 h) instead of sent again.
      idempotencyKey: `post-delivery/${userId}/${postIds[0]}`,
      label: "delivery email",
      log: (logged) => logDelivery(db, now, userId, postIds, logged),
    });
    if (outcome === "stop") return result;
    if (outcome === "sent") {
      result.sent += 1;
      remaining -= 1;
    } else {
      result.refused += 1;
    }
  }
  return result;
}

// Stamped with the sweep's own clock, the one every window above is measured on.
async function logDelivery(
  db: Db,
  now: Date,
  userId: string,
  postIds: string[],
  outcome: { outcome: "sent"; resendId: string } | { outcome: "refused"; error: string },
): Promise<void> {
  await db.insert(events).values({
    kind: POST_DELIVERY_EMAIL,
    actorUserId: userId,
    payload: { platform: "tiktok", postIds, ...outcome },
    createdAt: now,
  });
}
