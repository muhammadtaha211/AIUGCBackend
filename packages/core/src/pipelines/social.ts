import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { POST_FAILED } from "../alerts";
import { getConfigValue, getConfigValueOr } from "../appConfig";
import { retentionDaysSchema } from "../config";
import type { Db } from "../db";
import {
  businesses,
  events,
  jobs,
  scheduledPosts,
  socialAccounts,
  users,
  videoRenders,
} from "../db/schema";
import { PermanentError } from "../jobs/errors";
import { enqueue, isLastAttempt, type Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import {
  getMetaGraphProvider,
  isTokenLapse,
  MetaGraphError,
  type MetaAudioItem,
  type MetaPageWithInstagram,
} from "../providers/meta-graph";
import { openSecret, sealSecret, socialTokenAad } from "../secret-box";
import { getStorage } from "../storage";

/**
 * Social posting (decision 0101, docs/09-social-posting.md): a connected
 * platform account, a scheduled post per video × account, and the job that
 * publishes it exactly once.
 *
 * The invariants, each pinned by a test:
 * - A post is edited or cancelled only while `status = 'scheduled'`; the job's
 *   first act after a claim is the guarded move to `publishing`, so `scheduled`
 *   means "not started". Postgres row locks decide a race, never JS.
 * - `media_publish` is reached only from a FINISHED container and only when
 *   the job's state carries no media id; the step before it is a checkpoint, so
 *   a crash mid-call resumes by reading the container, and a PUBLISHED
 *   container is marked posted with no second call.
 * - Tokens are opened on the worker and in the web's OAuth/sound routes and
 *   nowhere else; a view never carries one.
 */

// ---------------------------------------------------------------------------
// Constants — the plan's defaults, each one knob
// ---------------------------------------------------------------------------

/** Schedule at most this far ahead (PLANNING DEFAULT, 0101). */
export const POSTING_HORIZON_DAYS = 30;
/**
 * Tavnit's own posts per Instagram account within a day either side of an
 * instant — a margin under the 50 Meta's reference pages name (its guide says
 * 100; the job reads the account's live quota at post time regardless).
 */
export const INSTAGRAM_DAILY_POST_MARGIN = 45;
/**
 * Days kept between the latest schedulable instant and the janitor's delete:
 * a day of quota deferral plus the poll budget and backoff must fit inside.
 */
export const HORIZON_RETENTION_MARGIN_DAYS = 2;
/** Instagram's caption limit. */
export const CAPTION_MAX_CHARS = 2200;
/** Meta's guidance: query a container once a minute. */
export const CONTAINER_POLL_DELAY_MS = 60_000;
/** Counted in polls, not wall-clock, so transient backoff cannot eat it. */
export const CONTAINER_MAX_POLLS = 30;
/** Instagram's daily quota is spent: wait it out hourly, up to a day. */
export const QUOTA_DEFER_DELAY_MS = 60 * 60_000;
export const QUOTA_DEFER_MAX_MS = 24 * 60 * 60_000;
/** The mix (0101 Q2): a silent render gives the sound the floor; one with its own audio keeps it. */
export const SOUND_VOLUMES = {
  silentVideo: { audioVolume: 100, videoVolume: 0 },
  ownAudio: { audioVolume: 35, videoVolume: 100 },
} as const;
/** 0101 Q1: generated personas and the generated reaction clip are labelled; your own footage is not. */
export const AI_LABELLED_SERVICES: Record<"a" | "b" | "c", boolean> = {
  a: true,
  b: true,
  c: false,
};
/** 0101 Q6: a Reel also appears in the profile grid. */
export const SHARE_TO_FEED = true;
/** Signed URLs minted at post time; Meta downloads within the hour. */
const POST_SIGNED_URL_TTL_SECONDS = 3600;

export const SOCIAL_FAILURE_KINDS = [
  "connection_expired",
  "sound_unavailable",
  "platform_refused",
  "platform_timeout",
  "quota_exhausted",
  "removed_on_platform",
  "file_missing",
  // Our fault, not the platform's: a missing key on the box, a corrupted row.
  "internal_error",
] as const;
/** How many times media_publish may fail transiently (the request may have landed) before we give up. */
export const PUBLISH_MAX_TRIES = 5;
export type SocialFailureKind = (typeof SOCIAL_FAILURE_KINDS)[number];

export type SocialPlatform = "instagram" | "tiktok";
export type SoundSnapshot = MetaAudioItem;

// ---------------------------------------------------------------------------
// The switch
// ---------------------------------------------------------------------------

/** app_config.social_posting — absent means admins only (getConfigValueOr). */
export const socialPostingSchema = z.object({ access: z.enum(["admins", "everyone"]) });

/**
 * Who sees the feature: admins always; everyone once the founder inserts
 * {"access":"everyone"} after Meta's approval. Checked in every page and route.
 */
export async function getPostingAccess(db: Db, userId: string): Promise<"allowed" | "hidden"> {
  const user = (
    await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  if (user?.role === "admin") return "allowed";
  const config = await getConfigValueOr(db, "social_posting", socialPostingSchema, {
    access: "admins" as const,
  });
  return config.access === "everyone" ? "allowed" : "hidden";
}

// ---------------------------------------------------------------------------
// Errors a route maps to Hebrew
// ---------------------------------------------------------------------------

export type SocialErrorCode =
  | "not_found"
  | "not_pending"
  | "render_not_released"
  | "file_missing"
  | "no_accounts"
  | "account_not_connected"
  | "in_the_past"
  | "beyond_horizon"
  | "beyond_retention"
  | "bad_timezone"
  | "caption_too_long"
  | "sound_without_instagram"
  | "instagram_daily_cap";

export class SocialSchedulingError extends Error {
  constructor(
    readonly code: SocialErrorCode,
    message = code,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/** What a page shows about a connection — never a token. */
export interface SocialAccountView {
  id: string;
  platform: SocialPlatform;
  externalId: string;
  username: string | null;
  displayName: string | null;
  pictureUrl: string | null;
  pageName: string | null;
  status: "connected" | "expired";
  /** The sound picker's token is still good (Instagram). */
  canSearchSounds: boolean;
  pendingPosts: number;
}

type AccountRow = typeof socialAccounts.$inferSelect;

export async function listSocialAccounts(db: Db, userId: string): Promise<SocialAccountView[]> {
  const rows = await db
    .select()
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.userId, userId),
        inArray(socialAccounts.status, ["connected", "expired"]),
      ),
    )
    .orderBy(asc(socialAccounts.connectedAt));
  if (rows.length === 0) return [];
  const pending = await db
    .select({ accountId: scheduledPosts.socialAccountId, n: sql<string>`count(*)` })
    .from(scheduledPosts)
    .where(
      and(
        inArray(
          scheduledPosts.socialAccountId,
          rows.map((r) => r.id),
        ),
        inArray(scheduledPosts.status, ["scheduled", "publishing"]),
      ),
    )
    .groupBy(scheduledPosts.socialAccountId);
  const counts = new Map(pending.map((p) => [p.accountId, Number(p.n)]));
  const now = Date.now();
  return rows.map((row) => toView(row, counts.get(row.id) ?? 0, now));
}

function toView(row: AccountRow, pendingPosts: number, now: number): SocialAccountView {
  return {
    id: row.id,
    platform: row.platform,
    externalId: row.externalId,
    username: row.username,
    displayName: row.displayName,
    pictureUrl: row.pictureUrl,
    pageName: row.pageName,
    status: row.status === "expired" ? "expired" : "connected",
    canSearchSounds:
      row.platform === "instagram" &&
      row.status === "connected" &&
      row.userTokenEnc !== null &&
      (row.userTokenExpiresAt === null || row.userTokenExpiresAt.getTime() > now),
    pendingPosts,
  };
}

/**
 * The Facebook round trip's result: every Page with an Instagram account,
 * upserted in place. A reconnect of the same account restores its live row
 * (tokens renewed, status back to connected); a new account gets a new row.
 */
export async function upsertInstagramConnections(
  db: Db,
  opts: {
    userId: string;
    fbUserId: string;
    userToken: string;
    userTokenExpiresAt: Date | null;
    pages: MetaPageWithInstagram[];
  },
): Promise<SocialAccountView[]> {
  const out: SocialAccountView[] = [];
  for (const page of opts.pages) {
    const identity = {
      userId: opts.userId,
      platform: "instagram" as const,
      externalId: page.instagram.id,
    };
    const aad = socialTokenAad(identity);
    const sealed = {
      accessTokenEnc: sealSecret(page.pageToken, aad),
      userTokenEnc: sealSecret(opts.userToken, aad),
      userTokenExpiresAt: opts.userTokenExpiresAt,
    };
    const profile = {
      username: page.instagram.username ?? null,
      displayName: page.instagram.name ?? null,
      pictureUrl: page.instagram.pictureUrl ?? null,
      pageId: page.pageId,
      pageName: page.pageName,
      fbUserId: opts.fbUserId,
    };
    const live = (
      await db
        .select()
        .from(socialAccounts)
        .where(
          and(
            eq(socialAccounts.userId, identity.userId),
            eq(socialAccounts.platform, identity.platform),
            eq(socialAccounts.externalId, identity.externalId),
            inArray(socialAccounts.status, ["connected", "expired"]),
          ),
        )
        .limit(1)
    )[0];
    const row = live
      ? (
          await db
            .update(socialAccounts)
            .set({
              ...profile,
              ...sealed,
              status: "connected",
              lastError: null,
              disconnectedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(socialAccounts.id, live.id))
            .returning()
        )[0]!
      : (
          await db
            .insert(socialAccounts)
            .values({ ...identity, ...profile, ...sealed })
            .returning()
        )[0]!;
    out.push(toView(row, 0, Date.now()));
  }
  return out;
}

/**
 * ניתוק: erase every token, keep the row, cancel the account's pending posts
 * and say how many. No Facebook permission is revoked — that is per app per
 * Facebook user, and disconnecting one account must not disconnect the others.
 */
export async function disconnectSocialAccount(
  db: Db,
  opts: { userId: string; accountId: string },
): Promise<{ cancelled: number }> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(socialAccounts)
      .set({
        status: "disconnected",
        accessTokenEnc: null,
        userTokenEnc: null,
        refreshTokenEnc: null,
        disconnectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(socialAccounts.id, opts.accountId),
          eq(socialAccounts.userId, opts.userId),
          inArray(socialAccounts.status, ["connected", "expired"]),
        ),
      )
      .returning({ id: socialAccounts.id });
    if (updated.length === 0) throw new SocialSchedulingError("not_found");
    const cancelled = await tx
      .update(scheduledPosts)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(scheduledPosts.socialAccountId, opts.accountId),
          eq(scheduledPosts.status, "scheduled"),
        ),
      )
      .returning({ id: scheduledPosts.id });
    return { cancelled: cancelled.length };
  });
}

/** The tokens a route or the job needs, opened — never returned to a page. */
export function openAccountTokens(account: AccountRow): {
  accessToken: string | null;
  userToken: string | null;
} {
  const aad = socialTokenAad(account);
  return {
    accessToken: account.accessTokenEnc ? openSecret(account.accessTokenEnc, aad) : null,
    userToken: account.userTokenEnc ? openSecret(account.userTokenEnc, aad) : null,
  };
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

type PostRow = typeof scheduledPosts.$inferSelect;

export interface SchedulePostsInput {
  userId: string;
  videoRenderId: string;
  accountIds: string[];
  scheduledAt: Date;
  timezone: string;
  caption: string;
  sound?: SoundSnapshot | null;
}

/**
 * The latest instant a render can be scheduled for: the earlier of the policy
 * horizon and two days before the janitor deletes the file, at the retention
 * in force when it is scheduled (read from app_config — a watermarked sample
 * lives `watermarked_samples` days, a released render `released_renders`).
 */
export async function postingHorizon(
  db: Db,
  render: { releasedAt: Date | null; createdAt: Date; watermarked: boolean },
  now: Date = new Date(),
): Promise<{ maxScheduledAt: Date; limitedBy: "policy" | "retention" }> {
  const retention = await getConfigValue(db, "retention_days", retentionDaysSchema);
  const days = render.watermarked ? retention.watermarked_samples : retention.released_renders;
  const anchor = render.releasedAt ?? render.createdAt;
  const byRetention = new Date(
    anchor.getTime() + (days - HORIZON_RETENTION_MARGIN_DAYS) * 86_400_000,
  );
  const byPolicy = new Date(now.getTime() + POSTING_HORIZON_DAYS * 86_400_000);
  return byRetention < byPolicy
    ? { maxScheduledAt: byRetention, limitedBy: "retention" }
    : { maxScheduledAt: byPolicy, limitedBy: "policy" };
}

function assertTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    throw new SocialSchedulingError("bad_timezone");
  }
}

async function assertInstant(
  db: Db,
  render: { releasedAt: Date | null; createdAt: Date; watermarked: boolean },
  scheduledAt: Date,
  now: Date,
): Promise<void> {
  // A minute of grace: "עכשיו" is the earliest choice, and a form's clock lags.
  if (scheduledAt.getTime() < now.getTime() - 60_000)
    throw new SocialSchedulingError("in_the_past");
  const horizon = await postingHorizon(db, render, now);
  if (scheduledAt > horizon.maxScheduledAt) {
    throw new SocialSchedulingError(
      horizon.limitedBy === "retention" ? "beyond_retention" : "beyond_horizon",
    );
  }
}

/**
 * Instagram only — TikTok's inbox cap arrives with its connect route (PR 4).
 * Counts Tavnit's own posts within a day either side of the instant, which can
 * only over-refuse against Meta's rolling day. `excludePostId` keeps a post
 * being moved from counting against itself.
 */
async function assertAccountCaps(
  db: Db,
  account: AccountRow,
  scheduledAt: Date,
  excludePostId?: string,
): Promise<void> {
  if (account.platform !== "instagram") return;
  const dayMs = 86_400_000;
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.socialAccountId, account.id),
        inArray(scheduledPosts.status, ["scheduled", "publishing", "posted"]),
        gte(scheduledPosts.scheduledAt, new Date(scheduledAt.getTime() - dayMs)),
        lte(scheduledPosts.scheduledAt, new Date(scheduledAt.getTime() + dayMs)),
        ...(excludePostId ? [sql`${scheduledPosts.id} <> ${excludePostId}`] : []),
      ),
    );
  if (Number(row?.n ?? 0) + 1 > INSTAGRAM_DAILY_POST_MARGIN) {
    throw new SocialSchedulingError("instagram_daily_cap");
  }
}

/**
 * The render must belong to the scheduling user's business (an admin may
 * schedule any) — core's own check at the one choke point, not only the route's.
 */
async function assertRenderOwned(
  db: Db,
  render: { businessId: string },
  userId: string,
): Promise<void> {
  const [owner] = await db
    .select({ ownerUserId: businesses.ownerUserId })
    .from(businesses)
    .where(eq(businesses.id, render.businessId))
    .limit(1);
  if (owner?.ownerUserId === userId) return;
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (user?.role !== "admin") throw new SocialSchedulingError("not_found");
}

/**
 * One transaction: the guards, N rows, N jobs under `post:<id>`. The queue's
 * own `run_at` carries a post weeks out; nothing else is needed.
 */
export async function schedulePosts(
  db: Db,
  input: SchedulePostsInput,
  now: Date = new Date(),
): Promise<ScheduledPostView[]> {
  if (input.accountIds.length === 0) throw new SocialSchedulingError("no_accounts");
  if (input.caption.length > CAPTION_MAX_CHARS) throw new SocialSchedulingError("caption_too_long");
  assertTimezone(input.timezone);

  const render = (
    await db.select().from(videoRenders).where(eq(videoRenders.id, input.videoRenderId)).limit(1)
  )[0];
  if (!render) throw new SocialSchedulingError("not_found");
  await assertRenderOwned(db, render, input.userId);
  if (render.status !== "released") throw new SocialSchedulingError("render_not_released");
  if (!render.filePath) throw new SocialSchedulingError("file_missing");
  await assertInstant(db, render, input.scheduledAt, now);

  const unique = [...new Set(input.accountIds)];

  return db.transaction(async (tx) => {
    // The account rows are locked for the transaction, so two schedule calls
    // for one account serialise and the cap counts what the other inserted.
    const accounts = await tx
      .select()
      .from(socialAccounts)
      .where(and(inArray(socialAccounts.id, unique), eq(socialAccounts.userId, input.userId)))
      .for("update");
    if (accounts.length !== unique.length) throw new SocialSchedulingError("not_found");
    if (accounts.some((a) => a.status !== "connected"))
      throw new SocialSchedulingError("account_not_connected");
    if (input.sound && !accounts.some((a) => a.platform === "instagram")) {
      throw new SocialSchedulingError("sound_without_instagram");
    }
    for (const account of accounts) {
      await assertAccountCaps(tx as Db, account, input.scheduledAt);
    }

    const rows: PostRow[] = [];
    for (const account of accounts) {
      const [row] = await tx
        .insert(scheduledPosts)
        .values({
          userId: input.userId,
          businessId: render.businessId,
          videoRenderId: render.id,
          socialAccountId: account.id,
          platform: account.platform,
          scheduledAt: input.scheduledAt,
          timezone: input.timezone,
          caption: input.caption,
          // The sound belongs to Instagram; a TikTok row of the same batch carries none.
          sound: account.platform === "instagram" && input.sound ? input.sound : null,
        })
        .returning();
      await enqueue(tx as Db, {
        type: "publish_post",
        idempotencyKey: `post:${row!.id}`,
        payload: { postId: row!.id },
        runAt: input.scheduledAt,
      });
      rows.push(row!);
    }
    return rows.map(toPostView);
  });
}

/**
 * Change a pending post. Two guarded updates in one transaction: the post row
 * on `status = 'scheduled'` (the load-bearing one) and, when the time moves,
 * the job row on `status = 'queued'` — which only closes the instant between a
 * claim and the handler's first act. Zero rows on either → not_pending, and the
 * transaction rolls back.
 */
export async function updateScheduledPost(
  db: Db,
  opts: {
    userId: string;
    postId: string;
    scheduledAt?: Date;
    timezone?: string;
    caption?: string;
    sound?: SoundSnapshot | null;
  },
  now: Date = new Date(),
): Promise<ScheduledPostView> {
  const existing = await getScheduledPost(db, opts);
  if (!existing) throw new SocialSchedulingError("not_found");
  if (existing.status !== "scheduled") throw new SocialSchedulingError("not_pending");
  if (opts.caption !== undefined && opts.caption.length > CAPTION_MAX_CHARS) {
    throw new SocialSchedulingError("caption_too_long");
  }
  if (opts.timezone !== undefined) assertTimezone(opts.timezone);
  if (opts.sound && existing.platform !== "instagram")
    throw new SocialSchedulingError("sound_without_instagram");
  if (opts.scheduledAt !== undefined) {
    const render = (
      await db
        .select()
        .from(videoRenders)
        .where(eq(videoRenders.id, existing.videoRenderId))
        .limit(1)
    )[0]!;
    await assertInstant(db, render, opts.scheduledAt, now);
  }

  return db.transaction(async (tx) => {
    if (opts.scheduledAt !== undefined) {
      // The same cap a new post meets, under the same account lock, with this
      // post left out of the count it is moving within.
      const [account] = await tx
        .select()
        .from(socialAccounts)
        .where(eq(socialAccounts.id, existing.socialAccountId))
        .for("update");
      if (account) await assertAccountCaps(tx as Db, account, opts.scheduledAt, opts.postId);
    }
    const [row] = await tx
      .update(scheduledPosts)
      .set({
        ...(opts.scheduledAt !== undefined ? { scheduledAt: opts.scheduledAt } : {}),
        ...(opts.timezone !== undefined ? { timezone: opts.timezone } : {}),
        ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
        ...(opts.sound !== undefined ? { sound: opts.sound } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(scheduledPosts.id, opts.postId), eq(scheduledPosts.status, "scheduled")))
      .returning();
    if (!row) throw new SocialSchedulingError("not_pending");
    if (opts.scheduledAt !== undefined) {
      const moved = await tx
        .update(jobs)
        .set({ runAt: opts.scheduledAt, updatedAt: new Date() })
        .where(and(eq(jobs.idempotencyKey, `post:${opts.postId}`), eq(jobs.status, "queued")))
        .returning({ id: jobs.id });
      if (moved.length === 0) throw new SocialSchedulingError("not_pending");
    }
    return toPostView(row);
  });
}

/**
 * Cancel: the post-row guard alone; the job sees the cancelled row and
 * completes as a no-op. A post waiting out Instagram's quota is `publishing`
 * with no container yet — nothing has reached Meta — so it can still be
 * cancelled (not edited: its job is mid-deferral).
 */
export async function cancelScheduledPost(
  db: Db,
  opts: { userId: string; postId: string },
): Promise<ScheduledPostView> {
  const existing = await getScheduledPost(db, opts);
  if (!existing) throw new SocialSchedulingError("not_found");
  const [row] = await db
    .update(scheduledPosts)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      deferredUntil: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(scheduledPosts.id, opts.postId),
        sql`(${scheduledPosts.status} = 'scheduled' or (${scheduledPosts.status} = 'publishing' and ${scheduledPosts.providerContainerId} is null and ${scheduledPosts.deferredUntil} is not null))`,
      ),
    )
    .returning();
  if (!row) throw new SocialSchedulingError("not_pending");
  return toPostView(row);
}

/** The /home notice's "הבנתי": every failed post of the account stops counting. */
export async function acknowledgeFailedPosts(db: Db, userId: string): Promise<number> {
  const rows = await db
    .update(scheduledPosts)
    .set({ failureAcknowledgedAt: new Date() })
    .where(
      and(
        eq(scheduledPosts.userId, userId),
        eq(scheduledPosts.status, "failed"),
        isNull(scheduledPosts.failureAcknowledgedAt),
      ),
    )
    .returning({ id: scheduledPosts.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * What a page may see of a post: the row minus the diagnostics. `failure_detail`
 * is Meta's or our error text ("never reaches a customer" — schema.ts) and the
 * container id is an internal handle; both stay behind this function the way
 * tokens stay behind `toView`.
 */
export type ScheduledPostView = Omit<PostRow, "failureDetail" | "providerContainerId">;

export function toPostView(row: PostRow): ScheduledPostView {
  const { failureDetail: _detail, providerContainerId: _container, ...view } = row;
  return view;
}

export async function getScheduledPost(
  db: Db,
  opts: { userId: string; postId: string },
): Promise<ScheduledPostView | undefined> {
  const row = (
    await db
      .select()
      .from(scheduledPosts)
      .where(and(eq(scheduledPosts.id, opts.postId), eq(scheduledPosts.userId, opts.userId)))
      .limit(1)
  )[0];
  return row ? toPostView(row) : undefined;
}

/** A calendar entry: the post plus what the chip shows about its account and video. */
export interface ScheduledPostListItem {
  post: ScheduledPostView;
  account: {
    id: string;
    platform: SocialPlatform;
    username: string | null;
    displayName: string | null;
    pictureUrl: string | null;
  };
  render: { id: string; service: "a" | "b" | "c"; thumbPath: string | null };
}

export async function listScheduledPosts(
  db: Db,
  opts: { userId: string; from: Date; to: Date },
): Promise<ScheduledPostListItem[]> {
  const rows = await db
    .select({
      post: scheduledPosts,
      accountId: socialAccounts.id,
      platform: socialAccounts.platform,
      username: socialAccounts.username,
      displayName: socialAccounts.displayName,
      pictureUrl: socialAccounts.pictureUrl,
      renderId: videoRenders.id,
      service: videoRenders.service,
      thumbPath: videoRenders.thumbPath,
    })
    .from(scheduledPosts)
    .innerJoin(socialAccounts, eq(socialAccounts.id, scheduledPosts.socialAccountId))
    .innerJoin(videoRenders, eq(videoRenders.id, scheduledPosts.videoRenderId))
    .where(
      and(
        eq(scheduledPosts.userId, opts.userId),
        gte(scheduledPosts.scheduledAt, opts.from),
        lt(scheduledPosts.scheduledAt, opts.to),
      ),
    )
    .orderBy(asc(scheduledPosts.scheduledAt));
  return rows.map((r) => ({
    post: toPostView(r.post),
    account: {
      id: r.accountId,
      platform: r.platform,
      username: r.username,
      displayName: r.displayName,
      pictureUrl: r.pictureUrl,
    },
    render: { id: r.renderId, service: r.service, thumbPath: r.thumbPath },
  }));
}

/** The grey tag: how many posts are pending per render (absent = none). */
export async function pendingPostsByRender(
  db: Db,
  renderIds: string[],
): Promise<Map<string, number>> {
  if (renderIds.length === 0) return new Map();
  const rows = await db
    .select({ renderId: scheduledPosts.videoRenderId, n: sql<string>`count(*)` })
    .from(scheduledPosts)
    .where(
      and(
        inArray(scheduledPosts.videoRenderId, renderIds),
        inArray(scheduledPosts.status, ["scheduled", "publishing"]),
      ),
    )
    .groupBy(scheduledPosts.videoRenderId);
  return new Map(rows.map((r) => [r.renderId, Number(r.n)]));
}

/** What the /home notice says: unacknowledged failures, and expired accounts with posts waiting. */
export async function postingNotices(
  db: Db,
  userId: string,
): Promise<{
  unacknowledgedFailures: number;
  expiredAccounts: { id: string; name: string; pendingPosts: number }[];
}> {
  const [failed] = await db
    .select({ n: sql<string>`count(*)` })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.userId, userId),
        eq(scheduledPosts.status, "failed"),
        isNull(scheduledPosts.failureAcknowledgedAt),
        gte(scheduledPosts.failedAt, new Date(Date.now() - 7 * 86_400_000)),
      ),
    );
  const expired = await db
    .select({
      id: socialAccounts.id,
      username: socialAccounts.username,
      displayName: socialAccounts.displayName,
    })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.userId, userId), eq(socialAccounts.status, "expired")));
  const pending =
    expired.length === 0
      ? []
      : await db
          .select({ accountId: scheduledPosts.socialAccountId, n: sql<string>`count(*)` })
          .from(scheduledPosts)
          .where(
            and(
              inArray(
                scheduledPosts.socialAccountId,
                expired.map((a) => a.id),
              ),
              eq(scheduledPosts.status, "scheduled"),
            ),
          )
          .groupBy(scheduledPosts.socialAccountId);
  const counts = new Map(pending.map((p) => [p.accountId, Number(p.n)]));
  return {
    unacknowledgedFailures: Number(failed?.n ?? 0),
    expiredAccounts: expired
      .map((a) => ({
        id: a.id,
        name: a.displayName ?? a.username ?? "",
        pendingPosts: counts.get(a.id) ?? 0,
      }))
      .filter((a) => a.pendingPosts > 0),
  };
}

// ---------------------------------------------------------------------------
// The publish job
// ---------------------------------------------------------------------------

/** A post's own failure: permanent for the queue, typed for the row. */
export class PostFailure extends PermanentError {
  constructor(
    readonly kind: SocialFailureKind,
    detail: string,
  ) {
    super(`post failed (${kind}): ${detail}`);
  }
}

interface PublishState {
  containerId?: string;
  polls?: number;
  publishAttemptedAt?: number;
  /** media_publish threw transiently after the request may have landed; re-read the container first. */
  publishTries?: number;
  mediaId?: string;
  deferredSince?: number;
  /** An EXPIRED container (never published) was replaced once already. */
  recreated?: boolean;
}

/** Container ERROR subcodes that name the audio — the sound was withdrawn. */
function isSoundProblem(detail: string | undefined): boolean {
  return /audio|music|sound/i.test(detail ?? "");
}

/**
 * Terminal write for a post, in one transaction with the founder's alert row.
 * Guarded on a non-terminal status so a late write can never undo a posted or
 * cancelled row. Returns true when it marked the post.
 */
export async function failPost(
  db: Db,
  postId: string,
  kind: SocialFailureKind,
  detail: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(scheduledPosts)
      .set({
        status: "failed",
        failureKind: kind,
        failureDetail: detail.slice(0, 1000),
        failedAt: new Date(),
        deferredUntil: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scheduledPosts.id, postId),
          inArray(scheduledPosts.status, ["scheduled", "publishing"]),
        ),
      )
      .returning({
        id: scheduledPosts.id,
        platform: scheduledPosts.platform,
        businessId: scheduledPosts.businessId,
      });
    if (!row) return false;
    await tx.insert(events).values({
      kind: POST_FAILED,
      businessId: row.businessId,
      subjectType: "scheduled_post",
      subjectId: row.id,
      // The detail is the diagnostic (Meta's error text, a job's last_error) —
      // never the caption or any customer text — so the founder's alert names
      // the cause without opening the database.
      payload: {
        postId: row.id,
        platform: row.platform,
        failureKind: kind,
        detail: detail.slice(0, 200),
      },
    });
    return true;
  });
}

async function markPosted(
  db: Db,
  postId: string,
  result: { mediaId: string | null; permalink: string | null },
): Promise<void> {
  await db
    .update(scheduledPosts)
    .set({
      status: "posted",
      postedAt: new Date(),
      providerMediaId: result.mediaId,
      permalink: result.permalink,
      deferredUntil: null,
      updatedAt: new Date(),
    })
    .where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.status, "publishing")));
}

/**
 * Handler-side terminal mapping, the render handlers' pattern: the post's own
 * failure kind; a Meta refusal → connection_expired when the token lapsed,
 * else platform_refused; a missing storage object → file_missing; a sealed-key
 * fault or any other permanent error → internal_error (ours, not the
 * platform's); the LAST transient attempt → platform_timeout. A transient
 * attempt with retries left leaves the row alone — the job is not dead.
 */
async function failPostOnTerminal(db: Db, postId: string, err: unknown, job: Job): Promise<void> {
  let kind: SocialFailureKind | undefined;
  if (err instanceof PostFailure) kind = err.kind;
  else if (err instanceof MetaGraphError)
    kind = isTokenLapse(err) ? "connection_expired" : "platform_refused";
  else if (err instanceof PermanentError && "storagePath" in err) kind = "file_missing";
  else if (err instanceof PermanentError) kind = "internal_error";
  else if (isLastAttempt(job)) {
    // The last attempt died after a publish was attempted (a DB blip between
    // the checkpoints and the row): ask Meta before calling a live Reel failed.
    const state = (job.state ?? {}) as PublishState;
    if (state.publishAttemptedAt && (await confirmPublishedByContainer(db, postId, state))) return;
    kind = "platform_timeout";
  }
  if (!kind) return;
  const detail = err instanceof Error ? err.message : String(err);
  const failed = await failPost(db, postId, kind, detail);
  if (failed && kind === "connection_expired") {
    const post = (
      await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, postId)).limit(1)
    )[0];
    if (post) await markAccountExpired(db, post.socialAccountId, detail);
  }
}

/**
 * A publish was attempted and nothing recorded its outcome: read the container
 * once with the account's token. PUBLISHED → the row is posted (no media id,
 * so no link) and true; anything else, or no way to ask, → false and the caller
 * decides. Never throws.
 */
async function confirmPublishedByContainer(
  db: Db,
  postId: string,
  state: PublishState,
): Promise<boolean> {
  if (!state.containerId) return false;
  try {
    const [post] = await db
      .select({ accountId: scheduledPosts.socialAccountId })
      .from(scheduledPosts)
      .where(eq(scheduledPosts.id, postId))
      .limit(1);
    if (!post) return false;
    const [account] = await db
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.id, post.accountId))
      .limit(1);
    const token = account ? tokenOrNull(account) : null;
    if (!token) return false;
    const status = await getMetaGraphProvider().containerStatus(state.containerId, token);
    if (status.code !== "PUBLISHED") return false;
    await markPosted(db, postId, { mediaId: null, permalink: null });
    return true;
  } catch {
    return false;
  }
}

async function markAccountExpired(db: Db, accountId: string, detail: string): Promise<void> {
  await db
    .update(socialAccounts)
    .set({ status: "expired", lastError: detail.slice(0, 500), updatedAt: new Date() })
    .where(and(eq(socialAccounts.id, accountId), eq(socialAccounts.status, "connected")));
}

export async function handlePublishPost(job: Job, ctx: JobContext): Promise<JobResult> {
  const { db } = ctx;
  const { postId } = job.payload as { postId: string };
  let post = (
    await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, postId)).limit(1)
  )[0];
  // The no-op guard: cancelled, posted or failed earlier (a resurrected or
  // reclaimed job) does nothing.
  if (!post || (post.status !== "scheduled" && post.status !== "publishing"))
    return { kind: "done" };

  if (post.status === "scheduled") {
    const [started] = await db
      .update(scheduledPosts)
      .set({ status: "publishing", startedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.status, "scheduled")))
      .returning();
    // Lost the race to a cancel between the read above and this write.
    if (!started) return { kind: "done" };
    // What the lock saw is what is published: an edit that landed between the
    // read above and this write is in `started`, not in `post`.
    post = started;
  }

  try {
    const meta = getMetaGraphProvider();
    const state = { ...(job.state as PublishState) };
    const account = (
      await db
        .select()
        .from(socialAccounts)
        .where(eq(socialAccounts.id, post.socialAccountId))
        .limit(1)
    )[0];

    // The Reel is live: a crash between the media-id checkpoint and the row
    // write. Finish the write BEFORE any guard — an account that lapsed since,
    // or a file the janitor took since, must not turn a live post into a
    // failure. The permalink is best-effort and needs a token we may not have.
    if (state.mediaId) {
      const token = account?.status === "connected" ? tokenOrNull(account) : null;
      const permalink = token
        ? await meta.mediaPermalink(state.mediaId, token).catch(() => undefined)
        : undefined;
      await markPosted(db, postId, { mediaId: state.mediaId, permalink: permalink ?? null });
      return { kind: "done" };
    }

    if (!account || account.status !== "connected") {
      throw new PostFailure(
        "connection_expired",
        `account ${post.socialAccountId} is ${account?.status ?? "missing"}`,
      );
    }
    if (account.platform !== "instagram") {
      // TikTok is the next task (0101): no connect route exists, so no row can
      // reach here; the refusal is a guard, not a path.
      throw new PostFailure("platform_refused", `publishing to ${account.platform} is not built`);
    }
    const { accessToken } = openAccountTokens(account);
    if (!accessToken) throw new PostFailure("connection_expired", "no page token on the account");

    if (!state.containerId) {
      // The render matters only until Meta holds the container: once it does,
      // the file's fate no longer decides the post's.
      const render = (
        await db.select().from(videoRenders).where(eq(videoRenders.id, post.videoRenderId)).limit(1)
      )[0];
      if (!render?.filePath)
        throw new PostFailure("file_missing", `render ${post.videoRenderId} has no file`);
      const limit = await meta.publishingLimit(account.externalId, accessToken);
      if (limit.usage >= limit.total) {
        const since = state.deferredSince ?? Date.now();
        if (Date.now() - since >= QUOTA_DEFER_MAX_MS) {
          throw new PostFailure(
            "quota_exhausted",
            `instagram quota ${limit.usage}/${limit.total} for a day`,
          );
        }
        await db
          .update(scheduledPosts)
          .set({
            deferredUntil: new Date(Date.now() + QUOTA_DEFER_DELAY_MS),
            updatedAt: new Date(),
          })
          .where(eq(scheduledPosts.id, postId));
        ctx.log.info(
          { postId, usage: limit.usage, total: limit.total },
          "publish deferred: instagram quota spent",
        );
        return {
          kind: "reschedule",
          delayMs: QUOTA_DEFER_DELAY_MS,
          state: { ...state, deferredSince: since },
        };
      }
      const videoUrl = await getStorage().signedUrl(render.filePath, POST_SIGNED_URL_TTL_SECONDS);
      const sound = post.sound as SoundSnapshot | null;
      // The live הוק + דמו format is silent; the retired "full" format (CLI
      // only, vault 0020) carries a voiceover and keeps it like B and C.
      const format = (render.params as { format?: string } | null)?.format;
      const silent = render.service === "a" && format !== "full";
      const volumes = silent ? SOUND_VOLUMES.silentVideo : SOUND_VOLUMES.ownAudio;
      const { containerId } = await meta.createReelContainer({
        igUserId: account.externalId,
        token: accessToken,
        videoUrl,
        caption: post.caption,
        audio: sound ? { audioId: sound.audioId, ...volumes } : undefined,
        aiGenerated: AI_LABELLED_SERVICES[render.service],
        shareToFeed: SHARE_TO_FEED,
      });
      // BEFORE anything else: a retry polls this container instead of making another.
      state.containerId = containerId;
      state.polls = 0;
      delete state.deferredSince;
      await ctx.checkpoint({ ...state });
      await db
        .update(scheduledPosts)
        .set({ providerContainerId: containerId, deferredUntil: null, updatedAt: new Date() })
        .where(eq(scheduledPosts.id, postId));
    }

    const status = await meta.containerStatus(state.containerId, accessToken);
    switch (status.code) {
      case "IN_PROGRESS": {
        // Thirty reads a minute apart — Tavnit's budget for a Reel, over Meta's
        // five-minute suggestion — counted in polls so backoff cannot eat it.
        const polls = (state.polls ?? 0) + 1;
        if (polls >= CONTAINER_MAX_POLLS) {
          throw new PostFailure(
            "platform_timeout",
            `container ${state.containerId} still in progress after ${polls} polls`,
          );
        }
        return { kind: "reschedule", delayMs: CONTAINER_POLL_DELAY_MS, state: { ...state, polls } };
      }
      case "ERROR":
        // Provisional (docs/09): Meta puts the error SUBCODE in `status`, and
        // no audio-specific subcode is documented; the live test records what a
        // withdrawn sound actually returns.
        throw new PostFailure(
          isSoundProblem(status.detail) ? "sound_unavailable" : "platform_refused",
          `container ${state.containerId} ERROR: ${status.detail ?? ""}`,
        );
      case "EXPIRED": {
        // Meta discarded the container unpublished (24 h — the box was down a
        // day). Nothing was judged and nothing went out, so one fresh container
        // cannot double a post; a second expiry is a timeout.
        if (state.recreated) {
          throw new PostFailure(
            "platform_timeout",
            `container ${state.containerId} expired a second time`,
          );
        }
        const fresh: PublishState = { recreated: true };
        await ctx.checkpoint({ ...fresh });
        return { kind: "reschedule", delayMs: 0, state: { ...fresh } };
      }
      case "PUBLISHED":
        // A previous attempt's publish landed before we could record its id.
        // Meta documents no way to recover the media id, so: posted, no link.
        await markPosted(db, postId, { mediaId: null, permalink: null });
        return { kind: "done" };
      case "FINISHED": {
        const publishTries = (state.publishTries ?? 0) + 1;
        const attempted: PublishState = { ...state, publishAttemptedAt: Date.now(), publishTries };
        await ctx.checkpoint({ ...attempted });
        let mediaId: string;
        try {
          ({ mediaId } = await meta.publish(account.externalId, state.containerId, accessToken));
        } catch (err) {
          // A refusal is a verdict. Anything else — a timeout, a 5xx, a dropped
          // socket — may have landed at Meta, so the next run re-reads the
          // container (PUBLISHED → posted) instead of this attempt failing a
          // post whose Reel may be live. The tries budget stops a dead Meta
          // from spinning forever.
          if (err instanceof PermanentError) throw err;
          if (publishTries >= PUBLISH_MAX_TRIES) {
            throw new PostFailure(
              "platform_timeout",
              `media_publish failed ${publishTries} times: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          ctx.log.warn(
            { err, postId, publishTries },
            "media_publish failed; re-reading the container next run",
          );
          return { kind: "reschedule", delayMs: CONTAINER_POLL_DELAY_MS, state: { ...attempted } };
        }
        // The instant it returns — before the permalink, before the row.
        await ctx.checkpoint({ ...attempted, mediaId });
        const permalink = await meta.mediaPermalink(mediaId, accessToken).catch(() => undefined);
        await markPosted(db, postId, { mediaId, permalink: permalink ?? null });
        return { kind: "done" };
      }
    }
  } catch (err) {
    await failPostOnTerminal(db, postId, err, job);
    throw err;
  }
}

/** A token when the row has one and the key opens it; null otherwise (never throws). */
function tokenOrNull(account: AccountRow): string | null {
  try {
    return openAccountTokens(account).accessToken;
  } catch {
    return null;
  }
}

/**
 * The net under a job that died outside the handler: the lease sweep writes
 * `dead` on the last attempt and runs no handler code; five faults before the
 * handler's `try` do the same; a box on an older build has no handler at all.
 * Any scheduled or publishing post whose job is dead or failed is ended here —
 * posted when the job's state carries a media id (the Reel is live), failed as
 * platform_timeout otherwise, with the job's last error as the detail. Zero
 * rows in normal operation. Called by the reaper (every ~60 s) and the daily
 * token check.
 */
export async function failOrphanedPosts(db: Db): Promise<number> {
  const rows = await db
    .select({ postId: scheduledPosts.id, state: jobs.state, lastError: jobs.lastError })
    .from(scheduledPosts)
    .innerJoin(jobs, eq(jobs.idempotencyKey, sql`'post:' || ${scheduledPosts.id}::text`))
    .where(
      and(
        inArray(scheduledPosts.status, ["scheduled", "publishing"]),
        inArray(jobs.status, ["dead", "failed"]),
      ),
    );
  let ended = 0;
  for (const row of rows) {
    const state = (row.state ?? {}) as PublishState;
    if (state.mediaId) {
      await markPosted(db, row.postId, { mediaId: state.mediaId, permalink: null });
      ended++;
    } else if (
      state.publishAttemptedAt &&
      (await confirmPublishedByContainer(db, row.postId, state))
    ) {
      ended++;
    } else if (
      await failPost(
        db,
        row.postId,
        "platform_timeout",
        `the job ended without the handler's terminal write: ${row.lastError ?? "no error recorded"}`,
      )
    ) {
      ended++;
    }
  }
  return ended;
}

// ---------------------------------------------------------------------------
// The daily token check
// ---------------------------------------------------------------------------

/**
 * One cheap call per connected Instagram account: a lapsed Page token marks
 * the account `expired` (and the /home notice tells the customer while their
 * posts are still pending); a good one refreshes the name and picture, whose
 * CDN link expires. Errors are per account and swallowed — a daily sweep must
 * not die on one bad row.
 */
export async function handleCheckSocialTokens(_job: Job, ctx: JobContext): Promise<JobResult> {
  const { db, log } = ctx;
  const accounts = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.status, "connected"), eq(socialAccounts.platform, "instagram")));
  const meta = getMetaGraphProvider();
  let expired = 0;
  let refreshed = 0;
  for (const account of accounts) {
    try {
      const { accessToken } = openAccountTokens(account);
      if (!accessToken) {
        await markAccountExpired(db, account.id, "no page token on the account");
        expired++;
        continue;
      }
      const profile = await meta.instagramUser(account.externalId, accessToken);
      await db
        .update(socialAccounts)
        .set({
          username: profile.username ?? account.username,
          displayName: profile.name ?? account.displayName,
          pictureUrl: profile.pictureUrl ?? account.pictureUrl,
          updatedAt: new Date(),
        })
        .where(eq(socialAccounts.id, account.id));
      refreshed++;
    } catch (err) {
      if (isTokenLapse(err)) {
        await markAccountExpired(db, account.id, err instanceof Error ? err.message : String(err));
        expired++;
      } else {
        log.warn({ err, accountId: account.id }, "social token check: call failed, left as is");
      }
    }
  }
  const orphaned = await failOrphanedPosts(db);
  log.info({ checked: accounts.length, refreshed, expired, orphaned }, "social token check digest");
  return { kind: "done" };
}

// ---------------------------------------------------------------------------
// Meta's data-deletion callback
// ---------------------------------------------------------------------------

export const META_DATA_DELETION = "meta_data_deletion";

/**
 * The user removed the app on Facebook AND asked for their data to go: every
 * connection that Facebook user made loses its tokens and identifying fields
 * (the row stays `deleted` so post history keeps its keys), its pending posts
 * are cancelled, and an events row carries the confirmation code the status
 * page answers to.
 */
export async function processMetaDataDeletion(
  db: Db,
  opts: { fbUserId: string },
): Promise<{ confirmationCode: string; accounts: number; cancelled: number }> {
  const confirmationCode = randomUUID();
  return db.transaction(async (tx) => {
    const accounts = await tx
      .update(socialAccounts)
      .set({
        status: "deleted",
        accessTokenEnc: null,
        userTokenEnc: null,
        refreshTokenEnc: null,
        username: null,
        displayName: null,
        pictureUrl: null,
        pageName: null,
        disconnectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(socialAccounts.fbUserId, opts.fbUserId),
          inArray(socialAccounts.status, ["connected", "expired"]),
        ),
      )
      .returning({ id: socialAccounts.id });
    let cancelled = 0;
    if (accounts.length > 0) {
      const rows = await tx
        .update(scheduledPosts)
        .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            inArray(
              scheduledPosts.socialAccountId,
              accounts.map((a) => a.id),
            ),
            eq(scheduledPosts.status, "scheduled"),
          ),
        )
        .returning({ id: scheduledPosts.id });
      cancelled = rows.length;
    }
    await tx.insert(events).values({
      kind: META_DATA_DELETION,
      payload: { confirmationCode, accounts: accounts.length, cancelled },
    });
    return { confirmationCode, accounts: accounts.length, cancelled };
  });
}

/** The public status page: what a confirmation code did, or nothing. */
export async function getMetaDataDeletionStatus(
  db: Db,
  confirmationCode: string,
): Promise<{ accounts: number; cancelled: number; at: Date } | undefined> {
  const [row] = await db
    .select({ payload: events.payload, createdAt: events.createdAt })
    .from(events)
    .where(
      and(
        eq(events.kind, META_DATA_DELETION),
        sql`${events.payload}->>'confirmationCode' = ${confirmationCode}`,
      ),
    )
    .orderBy(desc(events.createdAt))
    .limit(1);
  if (!row) return undefined;
  const payload = row.payload as { accounts?: number; cancelled?: number };
  return { accounts: payload.accounts ?? 0, cancelled: payload.cancelled ?? 0, at: row.createdAt };
}
