import { and, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { getEnv } from "../config";
import type { Db } from "../db";
import {
  businesses,
  events,
  scheduledPosts,
  socialAccounts,
  users,
  videoRenders,
} from "../db/schema";
import { isLocalWorkerId, isProductionDatabaseUrl } from "../jobs/queue";
import { logger } from "../logger";
import { EmailSendError, getEmailProvider } from "../providers/resend";
import { failureEmail, type FailureEmailPost } from "../social-copy";
import { getPostingAccess } from "./social";

/**
 * The failure email (decision 0107): a scheduled post that failed for good is
 * told to the Tavnit account by email as well as in the app, because the point
 * of scheduling is not opening the app.
 *
 * A sweep on the worker, never part of `publish_post`: an email problem can
 * never fail, delay or retry a post, and the in-app notice reads only the post
 * row, so it is the same whether or not an email went out.
 *
 * The rules, each a constant below and each pinned by a test:
 * - A **cause** is (Tavnit account, failure kind). A cause sends at most one
 *   email per 24 h; a failure of the same cause inside the 24 h after an email
 *   is folded — never emailed, on the calendar and in the notice instead.
 * - A cause goes out once its newest failure is 2 minutes old, so posts that
 *   fail together share one email.
 * - Only failures from the last 24 h are emailed: a key placed later, or a
 *   ceiling that held a failure back past its day, sends nothing stale.
 * - At most 20 failure emails per UTC day, Resend's own day (its free plan:
 *   100 a day, shared with the sign-up and password mail Supabase sends).
 *
 * The log is `events` rows of kind `post_failure_email` (actor = the account;
 * payload: the failure kind, the post ids, the outcome) — no migration, and no
 * address or customer text in it. The kind is not an ALERT_EVENT_KINDS kind, so
 * it never reaches Sentry.
 */

export const POST_FAILURE_EMAIL = "post_failure_email";
export const FAILURE_EMAIL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const FAILURE_EMAIL_QUIET_MS = 2 * 60 * 1000;
export const FAILURE_EMAIL_FRESH_MS = 24 * 60 * 60 * 1000;
export const FAILURE_EMAIL_DAILY_CEILING = 20;
/** After a send that may succeed later (a network fault, a 5xx, a per-second 429). */
export const FAILURE_EMAIL_RETRY_PAUSE_MS = 5 * 60 * 1000;
/** After a 401/403: the key or the domain is wrong, and only the founder can fix it. */
export const FAILURE_EMAIL_ACCOUNT_PAUSE_MS = 60 * 60 * 1000;

export type FailureEmailOff = "no_provider" | "local_worker" | "paused";

/**
 * Whether this process sends failure emails at all, and if not, why: no key
 * (or an empty one), a dry run, or `claim`'s own guard (jobs/queue.ts) — a
 * developer machine never acts for the production box. The sweep and the
 * worker's startup line read the same answer.
 */
export function failureEmailState(workerId: string): "on" | "no_provider" | "local_worker" {
  if (!getEmailProvider()) return "no_provider";
  if (isProductionDatabaseUrl(getEnv().DATABASE_URL) && isLocalWorkerId(workerId)) {
    return "local_worker";
  }
  return "on";
}

export interface FailureEmailSweepResult {
  off?: FailureEmailOff;
  sent: number;
  refused: number;
  /** Causes held back by the daily ceiling this tick. */
  heldByCeiling: number;
}

// In memory on purpose: a restart forgets a pause and costs at most one call
// Resend answers with the same refusal.
let pausedUntil: Date | undefined;

/** Test hook. */
export function resetFailureEmailPause(): void {
  pausedUntil = undefined;
}

function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function utcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The post's planned time as the customer scheduled it: their zone, Hebrew. */
export function formatPostTime(at: Date, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  try {
    return new Intl.DateTimeFormat("he-IL", { ...opts, timeZone }).format(at);
  } catch {
    // A zone this runtime does not know: Israel's, which is where the customers are.
    return new Intl.DateTimeFormat("he-IL", { ...opts, timeZone: "Asia/Jerusalem" }).format(at);
  }
}

interface FailedPost {
  id: string;
  userId: string;
  renderId: string;
  accountId: string;
  email: string;
  failureKind: string;
  failedAt: Date;
  scheduledAt: Date;
  timezone: string;
  platform: "instagram" | "tiktok";
  username: string | null;
  displayName: string | null;
  businessName: string;
  service: "a" | "b" | "c";
}

/**
 * One tick. Sends what is due and returns what it did; never throws for an
 * email problem (a database fault does throw — the worker's caller swallows it
 * and tries again next interval).
 */
export async function sweepPostFailureEmails(
  db: Db,
  opts: { workerId: string; now?: Date },
): Promise<FailureEmailSweepResult> {
  const now = opts.now ?? new Date();
  const result: FailureEmailSweepResult = { sent: 0, refused: 0, heldByCeiling: 0 };

  const state = failureEmailState(opts.workerId);
  if (state !== "on") return { ...result, off: state };
  const provider = getEmailProvider()!;
  if (pausedUntil && now < pausedUntil) return { ...result, off: "paused" };
  pausedUntil = undefined;

  const rows = await db
    .select({
      id: scheduledPosts.id,
      userId: scheduledPosts.userId,
      renderId: scheduledPosts.videoRenderId,
      accountId: scheduledPosts.socialAccountId,
      email: users.email,
      failureKind: scheduledPosts.failureKind,
      failedAt: scheduledPosts.failedAt,
      scheduledAt: scheduledPosts.scheduledAt,
      timezone: scheduledPosts.timezone,
      platform: scheduledPosts.platform,
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
        eq(scheduledPosts.status, "failed"),
        gt(scheduledPosts.failedAt, new Date(now.getTime() - FAILURE_EMAIL_FRESH_MS)),
      ),
    );
  const failed: FailedPost[] = rows.flatMap((row) =>
    row.failedAt
      ? [{ ...row, failedAt: row.failedAt, failureKind: row.failureKind ?? "internal_error" }]
      : [],
  );
  if (failed.length === 0) return result;

  // Every email of the last 48 h for these accounts: a failure under 24 h old
  // can be folded only by an email from the 24 h before it.
  const userIds = [...new Set(failed.map((p) => p.userId))];
  const sentRows = await db
    .select({
      userId: events.actorUserId,
      createdAt: events.createdAt,
      kind: sql<string>`${events.payload}->>'failureKind'`,
    })
    .from(events)
    .where(
      and(
        eq(events.kind, POST_FAILURE_EMAIL),
        inArray(events.actorUserId, userIds),
        gt(events.createdAt, new Date(now.getTime() - 2 * FAILURE_EMAIL_COOLDOWN_MS)),
      ),
    );

  const [today] = await db
    .select({ n: sql<string>`count(*)` })
    .from(events)
    .where(
      and(
        eq(events.kind, POST_FAILURE_EMAIL),
        gte(events.createdAt, utcMidnight(now)),
        sql`${events.payload}->>'outcome' = 'sent'`,
      ),
    );
  let remaining = FAILURE_EMAIL_DAILY_CEILING - Number(today?.n ?? 0);

  // Group by cause, oldest cause first; inside a cause, oldest failure first
  // (the id breaks a tie, so the order — and the key below — never wobbles).
  const causes = new Map<string, FailedPost[]>();
  const ordered = [...failed].sort(
    (a, b) => a.failedAt.getTime() - b.failedAt.getTime() || a.id.localeCompare(b.id),
  );
  for (const post of ordered) {
    const key = `${post.userId}:${post.failureKind}`;
    causes.set(key, [...(causes.get(key) ?? []), post]);
  }

  for (const posts of causes.values()) {
    const { userId, failureKind, email } = posts[0]!;
    const emails = sentRows
      .filter((row) => row.userId === userId && row.kind === failureKind)
      .map((row) => row.createdAt.getTime());
    // The cooldown: this cause already emailed in the last 24 h.
    if (emails.some((at) => now.getTime() - at < FAILURE_EMAIL_COOLDOWN_MS)) continue;
    // Folded: failed inside the 24 h after an earlier email of the same cause.
    const due = posts.filter(
      (p) =>
        !emails.some(
          (at) =>
            at <= p.failedAt.getTime() && p.failedAt.getTime() - at < FAILURE_EMAIL_COOLDOWN_MS,
        ),
    );
    if (due.length === 0) continue;
    // Wait for the burst to settle.
    if (now.getTime() - due[due.length - 1]!.failedAt.getTime() < FAILURE_EMAIL_QUIET_MS) continue;
    // A switch narrowed since the post was scheduled leaves no trace either.
    if ((await getPostingAccess(db, userId)) === "hidden") continue;
    if (remaining <= 0) {
      result.heldByCeiling += 1;
      continue;
    }

    const message = failureEmail({
      kind: failureKind,
      posts: due.map((p): FailureEmailPost => ({
        renderId: p.renderId,
        accountId: p.accountId,
        service: p.service,
        businessName: p.businessName,
        accountName: p.username ? `@${p.username}` : (p.displayName ?? ""),
        platform: p.platform,
        when: formatPostTime(p.scheduledAt, p.timezone),
      })),
    });
    const postIds = due.map((p) => p.id);
    try {
      const sent = await provider.send({
        to: email,
        ...message,
        // The cause and its OLDEST due post: a key that does not change while the
        // burst grows, so a retry after an ambiguous send or a failed log write
        // is deduplicated by Resend (24 h) instead of sent again.
        idempotencyKey: `post-failure/${userId}/${failureKind}/${postIds[0]}`,
      });
      await logEmail(db, now, userId, failureKind, postIds, { outcome: "sent", resendId: sent.id });
      result.sent += 1;
      remaining -= 1;
    } catch (err) {
      if (!(err instanceof EmailSendError)) throw err;
      // Resend saw this key with a different body: the first send went out
      // (an earlier tick's, before the burst grew). It counts as sent.
      if (err.status === 409 && err.errorName === "invalid_idempotent_request") {
        await logEmail(db, now, userId, failureKind, postIds, {
          outcome: "sent",
          resendId: "idempotent-replay",
        });
        result.sent += 1;
        remaining -= 1;
        continue;
      }
      if (err.accountFault) {
        // Not this cause's fault: no row, so nothing is blamed and the failures
        // go out once the key or the domain is fixed (while under 24 h old).
        pausedUntil = new Date(now.getTime() + FAILURE_EMAIL_ACCOUNT_PAUSE_MS);
        logger.warn(
          { status: err.status, error: err.errorName },
          "failure email: Resend refused the account (key or domain) — paused an hour",
        );
        return result;
      }
      if (err.dailyQuota) {
        pausedUntil = nextUtcMidnight(now);
        logger.warn(
          { status: err.status, error: err.errorName },
          "failure email: Resend quota spent — paused until 00:00 UTC",
        );
        return result;
      }
      if (err.retryable) {
        pausedUntil = new Date(now.getTime() + FAILURE_EMAIL_RETRY_PAUSE_MS);
        logger.warn(
          { status: err.status, error: err.errorName },
          "failure email: send failed — retrying later",
        );
        return result;
      }
      // A refusal that will never succeed: logged, so the cause cools down and
      // nothing retries it.
      await logEmail(db, now, userId, failureKind, postIds, {
        outcome: "refused",
        error: err.errorName ?? String(err.status),
      });
      logger.warn({ status: err.status, error: err.errorName }, "failure email: refused by Resend");
      result.refused += 1;
    }
  }
  return result;
}

// Stamped with the sweep's own clock, the one every window above is measured on.
async function logEmail(
  db: Db,
  now: Date,
  userId: string,
  failureKind: string,
  postIds: string[],
  outcome: { outcome: "sent"; resendId: string } | { outcome: "refused"; error: string },
): Promise<void> {
  await db.insert(events).values({
    kind: POST_FAILURE_EMAIL,
    actorUserId: userId,
    payload: { failureKind, postIds, ...outcome },
    createdAt: now,
  });
}
