import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { POST_FAILED } from "../alerts";
import { getConfigValue } from "../appConfig";
import { retentionDaysSchema } from "../config";
import type { Db } from "../db";
import {
  appConfig,
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
  type AudioKind,
  type MetaAudioItem,
  type MetaPageWithInstagram,
} from "../providers/meta-graph";
import {
  getTiktokProvider,
  isTiktokPendingCap,
  isTiktokTokenLapse,
  rawIdField,
  TIKTOK_PULL_ORIGIN,
  TiktokApiError,
  type TiktokProfile,
  type TiktokTokens,
} from "../providers/tiktok";
import { openSecret, sealSecret, socialTokenAad } from "../secret-box";
import { getStorage } from "../storage";

/**
 * Social posting (decision 0101, docs/09-social-posting.md): a connected
 * platform account, a scheduled post per video × account, and the job that
 * publishes it exactly once. TikTok (PR 4, decision 0115) is its own section
 * near the end: an inbox delivery the owner finishes in the app, not a post.
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
/**
 * The mix per service (decision 0102, the founder's numbers, 2026-10-11): where
 * nobody speaks the sound leads, where the character speaks the voice sits
 * clearly on top. `audioVolume` is the picked sound, `videoVolume` the
 * render's own audio. Nothing measured — judged on the first live posts.
 */
export const SOUND_VOLUMES = {
  /** הוק + דמו: the render is silent. */
  a: { audioVolume: 100, videoVolume: 0 },
  /** דמות AI: the voice at full, the sound under it. */
  b: { audioVolume: 15, videoVolume: 100 },
  /** גוש טקסט: the sound leads, the clip's own sound under it. */
  c: { audioVolume: 100, videoVolume: 40 },
} as const;
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

/**
 * TikTok's inbox cap: "at most 5 pending shares within any 24-hour period"
 * (upload-video reference, read 2026-10-16) — drafts the owner has not finished.
 */
export const TIKTOK_PENDING_SHARE_CAP = 5;
/**
 * TikTok's PULL download "times out one hour after the download task is
 * initiated" (media-transfer guide): 65 polls a minute apart cover it. Each poll
 * is its own job run (a reschedule), so no lane is held between them.
 */
export const TIKTOK_MAX_POLLS = 65;
/** TikTok pulls within the hour after init; the signed URL outlives that window. */
const TIKTOK_PULL_URL_TTL_SECONDS = 7200;
/** Refresh a TikTok access token (24 h) once less than this remains. */
const TIKTOK_REFRESH_MARGIN_MS = 10 * 60_000;
/** The daily poll reads TikTok posts delivered within this many days. */
const TIKTOK_DELIVERED_POLL_DAYS = 7;

export type SocialPlatform = "instagram" | "tiktok";
export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = ["instagram", "tiktok"];
export type SoundSnapshot = MetaAudioItem;

// ---------------------------------------------------------------------------
// The switch
// ---------------------------------------------------------------------------

/**
 * app_config.social_posting — absent means admins only. `named` lets listed
 * accounts in beside the admins (decision 0102): Meta's reviewer has to walk the
 * flow inside Tavnit, and an admin account can open every customer's business.
 * Accounts are named by user id, which never changes.
 */
export const socialPostingSchema = z.discriminatedUnion("access", [
  z.object({ access: z.literal("admins") }),
  z.object({ access: z.literal("named"), userIds: z.array(z.string().uuid()) }),
  z.object({ access: z.literal("everyone") }),
]);

/**
 * Each platform's own switch (decision 0115 §5): `social_posting` was the one
 * switch and is now Instagram's; `tiktok_posting` is TikTok's, independent —
 * Meta's review and TikTok's audit clear on different days. Same schema, same
 * modes, an absent row is admins only for each.
 */
export const PLATFORM_SWITCH_KEYS: Record<SocialPlatform, string> = {
  instagram: "social_posting",
  tiktok: "tiktok_posting",
};

/**
 * Who sees each platform: admins always; a named account under `named`;
 * everyone once the founder inserts {"access":"everyone"} after the platform's
 * review. A row that does not parse hides that platform rather than throwing: a
 * throw would turn a customer's 404 into a 500, which is a trace of the feature
 * (0102).
 */
export async function getPlatformAccess(
  db: Db,
  userId: string,
): Promise<Record<SocialPlatform, boolean>> {
  const user = (
    await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  if (user?.role === "admin") return { instagram: true, tiktok: true };
  const rows = await db
    .select({ key: appConfig.key, value: appConfig.value })
    .from(appConfig)
    .where(inArray(appConfig.key, Object.values(PLATFORM_SWITCH_KEYS)));
  const allowed = (platform: SocialPlatform): boolean => {
    const row = rows.find((r) => r.key === PLATFORM_SWITCH_KEYS[platform]);
    const parsed = socialPostingSchema.safeParse(row?.value ?? { access: "admins" });
    if (!parsed.success) return false;
    const config = parsed.data;
    if (config.access === "everyone") return true;
    return (
      config.access === "named" &&
      config.userIds.some((id) => id.toLowerCase() === userId.toLowerCase())
    );
  };
  return { instagram: allowed("instagram"), tiktok: allowed("tiktok") };
}

/** The platforms a `getPlatformAccess` answer lets in, Instagram first. */
export function allowedPlatforms(access: Record<SocialPlatform, boolean>): SocialPlatform[] {
  return SOCIAL_PLATFORMS.filter((platform) => access[platform]);
}

/**
 * Whether the account sees posting at all — any platform. The shared surfaces
 * (the calendar, the schedule page, the notice, the nav, the shared post
 * routes) open on this; what each shows is filtered by `getPlatformAccess`.
 */
export async function getPostingAccess(db: Db, userId: string): Promise<"allowed" | "hidden"> {
  const access = await getPlatformAccess(db, userId);
  return access.instagram || access.tiktok ? "allowed" : "hidden";
}

/** A `platform in (…)` predicate when a filter is given; none means every platform. */
function platformIn(
  column: typeof scheduledPosts.platform | typeof socialAccounts.platform,
  platforms: readonly SocialPlatform[] | undefined,
) {
  if (platforms === undefined) return undefined;
  return platforms.length === 0 ? sql`false` : inArray(column, [...platforms]);
}

/**
 * app_config.instagram_connect — which Facebook window "חיבור חשבון" opens
 * (decision 0105). `"onboarding"` asks for Meta's one-window setup (convert to
 * professional, create the Page, link it — IG_API_ONBOARDING); absent means
 * today's connect. Founder-flipped in SQL until he rules on the live result, so
 * a value that does not parse is today's connect, never an error.
 */
export const instagramConnectModeSchema = z.enum(["standard", "onboarding"]);
export type InstagramConnectMode = z.infer<typeof instagramConnectModeSchema>;

export async function getInstagramConnectMode(db: Db): Promise<InstagramConnectMode> {
  const row = (
    await db
      .select({ value: appConfig.value })
      .from(appConfig)
      .where(eq(appConfig.key, "instagram_connect"))
      .limit(1)
  )[0];
  const parsed = instagramConnectModeSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : "standard";
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
  | "instagram_daily_cap"
  | "tiktok_pending_cap";

export class SocialSchedulingError extends Error {
  constructor(
    readonly code: SocialErrorCode,
    message = code,
  ) {
    super(message);
  }
}

/**
 * The posts a customer can still call back: not started (`scheduled`), or
 * waiting out Instagram's quota with nothing at Meta yet (`publishing`, no
 * container, `deferred_until` set). Manual cancel, disconnect, Meta's deletion
 * and the disconnect confirm's count all read this one predicate, so the
 * number the confirm promises is the number that gets cancelled.
 */
const cancellablePost = sql`(${scheduledPosts.status} = 'scheduled' or (${scheduledPosts.status} = 'publishing' and ${scheduledPosts.providerContainerId} is null and ${scheduledPosts.deferredUntil} is not null))`;

/** What every cancel writes; the job then sees the row and ends as a no-op. */
function cancelledNow() {
  return {
    status: "cancelled" as const,
    cancelledAt: new Date(),
    deferredUntil: null,
    updatedAt: new Date(),
  };
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
  /** Posts a disconnect would cancel (`cancellablePost`) — what its confirm counts. */
  pendingPosts: number;
}

type AccountRow = typeof socialAccounts.$inferSelect;

/** `platforms`: the caller's switches (`allowedPlatforms`); absent = every platform. */
export async function listSocialAccounts(
  db: Db,
  userId: string,
  platforms?: readonly SocialPlatform[],
): Promise<SocialAccountView[]> {
  const rows = await db
    .select()
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.userId, userId),
        inArray(socialAccounts.status, ["connected", "expired"]),
        platformIn(socialAccounts.platform, platforms),
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
        cancellablePost,
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
  opts: { userId: string; accountId: string; platforms?: readonly SocialPlatform[] },
): Promise<{ cancelled: number }> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(socialAccounts)
      .set({
        status: "disconnected",
        accessTokenEnc: null,
        userTokenEnc: null,
        refreshTokenEnc: null,
        accessTokenExpiresAt: null,
        disconnectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(socialAccounts.id, opts.accountId),
          eq(socialAccounts.userId, opts.userId),
          inArray(socialAccounts.status, ["connected", "expired"]),
          platformIn(socialAccounts.platform, opts.platforms),
        ),
      )
      .returning({ id: socialAccounts.id });
    if (updated.length === 0) throw new SocialSchedulingError("not_found");
    const cancelled = await tx
      .update(scheduledPosts)
      .set(cancelledNow())
      .where(and(eq(scheduledPosts.socialAccountId, opts.accountId), cancellablePost))
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

/**
 * The sound picker (PR 3): one `ig_audio` page of one kind, with the account's
 * User token — the token Meta documents the search against (Audio API page,
 * read 2026-10-12). `reconnect` when that token is missing, past its ~60 days
 * or refused as lapsed: the picker then says so and the post goes on without a
 * sound. The account must be the caller's own Instagram connection.
 */
export type SoundSearchResult =
  { status: "ok"; items: MetaAudioItem[]; after?: string } | { status: "reconnect" };

export async function searchInstagramSounds(
  db: Db,
  opts: { userId: string; accountId: string; kind: AudioKind; query?: string; after?: string },
  now: Date = new Date(),
): Promise<SoundSearchResult> {
  const account = (
    await db
      .select()
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.id, opts.accountId),
          eq(socialAccounts.userId, opts.userId),
          eq(socialAccounts.platform, "instagram"),
          inArray(socialAccounts.status, ["connected", "expired"]),
        ),
      )
      .limit(1)
  )[0];
  if (!account) throw new SocialSchedulingError("not_found");
  if (!toView(account, 0, now.getTime()).canSearchSounds) return { status: "reconnect" };
  const { userToken } = openAccountTokens(account);
  if (!userToken) return { status: "reconnect" };
  try {
    const page = await getMetaGraphProvider().searchAudio({
      igUserId: account.externalId,
      token: userToken,
      kind: opts.kind,
      query: opts.query,
      after: opts.after,
    });
    return { status: "ok", ...page };
  } catch (err) {
    if (isTokenLapse(err)) return { status: "reconnect" };
    throw err;
  }
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
  /** "Made with AI" — the customer's tick (0102); absent means unticked. */
  aiLabel?: boolean;
  /** The caller's switches (`allowedPlatforms`); an account outside them is not_found. */
  platforms?: readonly SocialPlatform[];
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
 * Counts Tavnit's own posts within a day either side of the instant, which can
 * only over-refuse against the platform's rolling day. `excludePostId` keeps a
 * post being moved from counting against itself. TikTok (decision 0115): the
 * inbox's 5 pending shares — scheduled, publishing and delivered count; a
 * posted draft is no longer pending at TikTok, and its 403 plus the hourly wait
 * cover the rest.
 */
async function assertAccountCaps(
  db: Db,
  account: AccountRow,
  scheduledAt: Date,
  excludePostId?: string,
): Promise<void> {
  const dayMs = 86_400_000;
  if (account.platform === "tiktok") {
    const [pending] = await db
      .select({ n: sql<string>`count(*)` })
      .from(scheduledPosts)
      .where(
        and(
          eq(scheduledPosts.socialAccountId, account.id),
          inArray(scheduledPosts.status, ["scheduled", "publishing", "delivered"]),
          gte(scheduledPosts.scheduledAt, new Date(scheduledAt.getTime() - dayMs)),
          lte(scheduledPosts.scheduledAt, new Date(scheduledAt.getTime() + dayMs)),
          ...(excludePostId ? [sql`${scheduledPosts.id} <> ${excludePostId}`] : []),
        ),
      );
    if (Number(pending?.n ?? 0) + 1 > TIKTOK_PENDING_SHARE_CAP) {
      throw new SocialSchedulingError("tiktok_pending_cap");
    }
    return;
  }
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
      .where(
        and(
          inArray(socialAccounts.id, unique),
          eq(socialAccounts.userId, input.userId),
          platformIn(socialAccounts.platform, input.platforms),
        ),
      )
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
      // Caption, sound and the AI tick are Instagram's (decision 0115 §2): the
      // TikTok inbox takes only the file, and the owner adds the rest in TikTok.
      const instagram = account.platform === "instagram";
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
          caption: instagram ? input.caption : "",
          sound: instagram && input.sound ? input.sound : null,
          aiLabel: instagram ? (input.aiLabel ?? false) : false,
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
    aiLabel?: boolean;
    platforms?: readonly SocialPlatform[];
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
  if (existing.platform === "tiktok") {
    // Time only (decision 0115 §2): TikTok's row keeps no caption and no tick.
    opts = { ...opts, caption: undefined, aiLabel: undefined };
  }
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
        ...(opts.aiLabel !== undefined ? { aiLabel: opts.aiLabel } : {}),
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
  opts: { userId: string; postId: string; platforms?: readonly SocialPlatform[] },
): Promise<ScheduledPostView> {
  const existing = await getScheduledPost(db, opts);
  if (!existing) throw new SocialSchedulingError("not_found");
  const [row] = await db
    .update(scheduledPosts)
    .set(cancelledNow())
    .where(and(eq(scheduledPosts.id, opts.postId), cancellablePost))
    .returning();
  if (!row) throw new SocialSchedulingError("not_pending");
  return toPostView(row);
}

/** The /home notice's "הבנתי": every failed post of the account stops counting. */
export async function acknowledgeFailedPosts(
  db: Db,
  userId: string,
  platforms?: readonly SocialPlatform[],
): Promise<number> {
  const rows = await db
    .update(scheduledPosts)
    .set({ failureAcknowledgedAt: new Date() })
    .where(
      and(
        eq(scheduledPosts.userId, userId),
        eq(scheduledPosts.status, "failed"),
        isNull(scheduledPosts.failureAcknowledgedAt),
        platformIn(scheduledPosts.platform, platforms),
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
  opts: { userId: string; postId: string; platforms?: readonly SocialPlatform[] },
): Promise<ScheduledPostView | undefined> {
  const row = (
    await db
      .select()
      .from(scheduledPosts)
      .where(
        and(
          eq(scheduledPosts.id, opts.postId),
          eq(scheduledPosts.userId, opts.userId),
          platformIn(scheduledPosts.platform, opts.platforms),
        ),
      )
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
  opts: { userId: string; from: Date; to: Date; platforms?: readonly SocialPlatform[] },
): Promise<ScheduledPostListItem[]> {
  return postItems(
    db,
    and(
      eq(scheduledPosts.userId, opts.userId),
      gte(scheduledPosts.scheduledAt, opts.from),
      lt(scheduledPosts.scheduledAt, opts.to),
      platformIn(scheduledPosts.platform, opts.platforms),
    ),
  );
}

/** One calendar entry by id, its owner's only — the post page (PR 3). */
export async function getScheduledPostItem(
  db: Db,
  opts: { userId: string; postId: string; platforms?: readonly SocialPlatform[] },
): Promise<ScheduledPostListItem | undefined> {
  const [item] = await postItems(
    db,
    and(
      eq(scheduledPosts.id, opts.postId),
      eq(scheduledPosts.userId, opts.userId),
      platformIn(scheduledPosts.platform, opts.platforms),
    ),
  );
  return item;
}

async function postItems(db: Db, where: ReturnType<typeof and>): Promise<ScheduledPostListItem[]> {
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
    .where(where)
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
  platforms?: readonly SocialPlatform[],
): Promise<Map<string, number>> {
  if (renderIds.length === 0) return new Map();
  const rows = await db
    .select({ renderId: scheduledPosts.videoRenderId, n: sql<string>`count(*)` })
    .from(scheduledPosts)
    .where(
      and(
        inArray(scheduledPosts.videoRenderId, renderIds),
        inArray(scheduledPosts.status, ["scheduled", "publishing"]),
        platformIn(scheduledPosts.platform, platforms),
      ),
    )
    .groupBy(scheduledPosts.videoRenderId);
  return new Map(rows.map((r) => [r.renderId, Number(r.n)]));
}

/** What the /home notice says: unacknowledged failures, and expired accounts with posts waiting. */
export async function postingNotices(
  db: Db,
  userId: string,
  platforms?: readonly SocialPlatform[],
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
        platformIn(scheduledPosts.platform, platforms),
      ),
    );
  const expired = await db
    .select({
      id: socialAccounts.id,
      username: socialAccounts.username,
      displayName: socialAccounts.displayName,
    })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.userId, userId),
        eq(socialAccounts.status, "expired"),
        platformIn(socialAccounts.platform, platforms),
      ),
    );
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
  // TikTok's run (decision 0115) keeps its own three beside `polls` and `deferredSince`:
  /** The inbox upload TikTok accepted — never re-initiated once checkpointed. */
  publishId?: string;
  /** A FAILED internal/video_pull_failed upload was initiated afresh once already. */
  reinitiated?: boolean;
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
  else if (err instanceof TiktokApiError)
    kind = isTiktokTokenLapse(err) ? "connection_expired" : "platform_refused";
  else if (err instanceof PermanentError && "storagePath" in err) kind = "file_missing";
  else if (err instanceof PermanentError) kind = "internal_error";
  else if (isLastAttempt(job)) {
    // The last attempt died after a publish was attempted (a DB blip between
    // the checkpoints and the row): ask Meta before calling a live Reel failed.
    const state = (job.state ?? {}) as PublishState;
    if (state.publishAttemptedAt && (await confirmPublishedByContainer(db, postId, state))) return;
    // TikTok: an upload TikTok accepted may already sit in the inbox.
    if (state.publishId && (await confirmTiktokByStatus(db, postId, state.publishId))) return;
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
    // TikTok's inbox delivery is its own run (decision 0115); everything below is Instagram's.
    if (account.platform === "tiktok") return await publishTiktok(ctx, job, post, account);
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
      // only, vault 0020) carries a voiceover, so it takes B's speech-on-top mix.
      const format = (render.params as { format?: string } | null)?.format;
      const volumes =
        render.service === "a" && format === "full"
          ? SOUND_VOLUMES.b
          : SOUND_VOLUMES[render.service];
      const { containerId } = await meta.createReelContainer({
        igUserId: account.externalId,
        token: accessToken,
        videoUrl,
        caption: post.caption,
        audio: sound ? { audioId: sound.audioId, ...volumes } : undefined,
        // The customer's own tick (0102); unticked sends no label at all.
        aiGenerated: post.aiLabel,
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
    } else if (state.publishId && (await confirmTiktokByStatus(db, row.postId, state.publishId))) {
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
 * not die on one bad row. TikTok's half follows (decision 0115): its accounts'
 * tokens and profiles, then the delivered posts the webhook may have missed.
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
  const tiktok = await checkTiktokAccounts(db, log);
  const tiktokPosted = await pollDeliveredTiktokPosts(db, log);
  const orphaned = await failOrphanedPosts(db);
  log.info(
    { checked: accounts.length, refreshed, expired, tiktok, tiktokPosted, orphaned },
    "social token check digest",
  );
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
  // Meta documents "an alphanumeric confirmation code": a UUID's 32 hex digits, no hyphens.
  const confirmationCode = randomUUID().replace(/-/g, "");
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
        // A row the customer disconnected earlier keeps its own date.
        disconnectedAt: sql`coalesce(${socialAccounts.disconnectedAt}, now())`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(socialAccounts.fbUserId, opts.fbUserId),
          // Disconnected rows too: ניתוק erases tokens but keeps the name and
          // picture for post history, and Meta's request is for all of it.
          inArray(socialAccounts.status, ["connected", "expired", "disconnected"]),
        ),
      )
      .returning({ id: socialAccounts.id });
    let cancelled = 0;
    if (accounts.length > 0) {
      const rows = await tx
        .update(scheduledPosts)
        .set(cancelledNow())
        .where(
          and(
            inArray(
              scheduledPosts.socialAccountId,
              accounts.map((a) => a.id),
            ),
            cancellablePost,
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

// ---------------------------------------------------------------------------
// TikTok (PR 4, decision 0115): the connection, its tokens, the inbox delivery,
// the webhook, and the daily half of the token check
// ---------------------------------------------------------------------------

/**
 * Login Kit's result, upserted in place like Instagram's: a reconnect of the
 * same open_id restores its live row (new tokens, status connected). Unlike
 * Instagram's, every connect moves `connected_at` to now: the webhook's
 * authorization.removed guard compares against it, so a removal TikTok retries
 * after the owner reconnected never undoes the reconnect. user.info.basic
 * carries no username; the display name and avatar are what the screens show.
 */
export async function upsertTiktokConnection(
  db: Db,
  opts: { userId: string; tokens: TiktokTokens; profile: TiktokProfile },
): Promise<SocialAccountView> {
  const identity = {
    userId: opts.userId,
    platform: "tiktok" as const,
    externalId: opts.tokens.openId,
  };
  const aad = socialTokenAad(identity);
  const values = {
    displayName: opts.profile.displayName ?? null,
    pictureUrl: opts.profile.avatarUrl ?? null,
    accessTokenEnc: sealSecret(opts.tokens.accessToken, aad),
    accessTokenExpiresAt: opts.tokens.accessExpiresAt,
    refreshTokenEnc: sealSecret(opts.tokens.refreshToken, aad),
    refreshExpiresAt: opts.tokens.refreshExpiresAt,
  };
  const live = (
    await db
      .select({ id: socialAccounts.id })
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
  const now = new Date();
  const row = live
    ? (
        await db
          .update(socialAccounts)
          .set({
            ...values,
            status: "connected",
            lastError: null,
            disconnectedAt: null,
            connectedAt: now,
            updatedAt: now,
          })
          .where(eq(socialAccounts.id, live.id))
          .returning()
      )[0]!
    : (
        await db
          .insert(socialAccounts)
          .values({ ...identity, ...values, connectedAt: now })
          .returning()
      )[0]!;
  return toView(row, 0, now.getTime());
}

type TiktokTokenOutcome = { token: string } | { lapsed: string };

/**
 * A TikTok access token good for ten more minutes, refreshed under a row lock
 * when it is not. TikTok may hand back a different refresh token on every
 * refresh ("must use the newly-returned token"), so two refreshes racing on one
 * row would leave one of them holding a dead token: the lock serialises them,
 * and the second re-reads after the first committed and finds a fresh token.
 * A lapse — `invalid_grant` (expired, revoked, or issued to another client: the
 * sandbox → production swap), a missing token, a row no longer connected —
 * marks the account expired and says why; any other failure throws (transient
 * for the queue, which retries the run).
 */
async function tiktokToken(db: Db, accountId: string): Promise<TiktokTokenOutcome> {
  const outcome = await db.transaction(async (tx): Promise<TiktokTokenOutcome> => {
    const [account] = await tx
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.id, accountId))
      .for("update");
    if (!account || account.status !== "connected") {
      return { lapsed: `account ${accountId} is ${account?.status ?? "missing"}` };
    }
    const aad = socialTokenAad(account);
    if (
      account.accessTokenEnc &&
      account.accessTokenExpiresAt &&
      account.accessTokenExpiresAt.getTime() - Date.now() > TIKTOK_REFRESH_MARGIN_MS
    ) {
      return { token: openSecret(account.accessTokenEnc, aad) };
    }
    if (!account.refreshTokenEnc) return { lapsed: "no refresh token on the account" };
    let tokens: TiktokTokens;
    try {
      tokens = await getTiktokProvider().refresh(openSecret(account.refreshTokenEnc, aad));
    } catch (err) {
      if (isTiktokTokenLapse(err)) return { lapsed: (err as Error).message };
      // Any other refusal of the token endpoint (invalid_client, a key and secret
      // that do not match) is our configuration, not TikTok refusing a video:
      // internal_error, never platform_refused.
      if (err instanceof TiktokApiError) {
        throw new PermanentError(`tiktok token refresh refused: ${err.message}`);
      }
      throw err;
    }
    await tx
      .update(socialAccounts)
      .set({
        accessTokenEnc: sealSecret(tokens.accessToken, aad),
        accessTokenExpiresAt: tokens.accessExpiresAt,
        refreshTokenEnc: sealSecret(tokens.refreshToken, aad),
        refreshExpiresAt: tokens.refreshExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(socialAccounts.id, account.id));
    return { token: tokens.accessToken };
  });
  if ("lapsed" in outcome) await markAccountExpired(db, accountId, outcome.lapsed);
  return outcome;
}

/**
 * The address TikTok pulls from: the signed render URL with its host swapped
 * for the verified custom domain (TIKTOK_PULL_ORIGIN) — the signature is
 * host-independent. A file:// URL (tests, a local storage) is left as it is.
 */
export function tiktokPullUrl(signedUrl: string): string {
  let url: URL;
  try {
    url = new URL(signedUrl);
  } catch {
    return signedUrl;
  }
  if (url.protocol !== "https:") return signedUrl;
  return new URL(`${url.pathname}${url.search}`, TIKTOK_PULL_ORIGIN).toString();
}

/**
 * TikTok's documented embed-player address for a post id — the post page's
 * "צפייה בפוסט" (a stopgap the founder approved; the sandbox's public post of
 * 2026-10-17 has one, so whether the player opens it is his look, docs/09 t7).
 */
export function tiktokPermalink(platformPostId: string): string {
  return `https://www.tiktok.com/player/v1/${platformPostId}`;
}

/** publishing → delivered: TikTok put the video in the owner's inbox. */
async function markTiktokDelivered(db: Db, postId: string): Promise<boolean> {
  const rows = await db
    .update(scheduledPosts)
    .set({
      status: "delivered",
      deliveredAt: new Date(),
      deferredUntil: null,
      updatedAt: new Date(),
    })
    .where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.status, "publishing")))
    .returning({ id: scheduledPosts.id });
  return rows.length > 0;
}

/**
 * publishing | delivered → posted: TikTok said the owner posted it. The one
 * writer the job, the webhook, the daily poll and the nets share — Instagram's
 * markPosted is guarded on publishing alone, which a delivered row never is.
 */
async function markTiktokPosted(db: Db, postId: string, platformPostId?: string): Promise<boolean> {
  const rows = await db
    .update(scheduledPosts)
    .set({
      status: "posted",
      postedAt: new Date(),
      deferredUntil: null,
      updatedAt: new Date(),
      ...(platformPostId
        ? { providerMediaId: platformPostId, permalink: tiktokPermalink(platformPostId) }
        : {}),
    })
    .where(
      and(
        eq(scheduledPosts.id, postId),
        inArray(scheduledPosts.status, ["publishing", "delivered"]),
      ),
    )
    .returning({ id: scheduledPosts.id });
  return rows.length > 0;
}

/**
 * The TikTok half of publish_post: one inbox upload by PULL_FROM_URL, then
 * status reads a minute apart, each its own run (a reschedule), so the lane is
 * free between them. The publish id is checkpointed BEFORE anything else, and a
 * run that finds one never initiates again: every init is a video in the
 * owner's inbox and a pending share. A webhook may move the row first
 * (delivered, posted); every run re-reads it and ends quietly when it has.
 */
async function publishTiktok(
  ctx: JobContext,
  job: Job,
  post: PostRow,
  account: AccountRow,
): Promise<JobResult> {
  const { db } = ctx;
  const postId = post.id;
  const state = { ...(job.state as PublishState) };
  const auth = await tiktokToken(db, account.id);
  if ("lapsed" in auth) throw new PostFailure("connection_expired", auth.lapsed);
  const tiktok = getTiktokProvider();

  if (!state.publishId) {
    if (post.deferredUntil) {
      // Waiting out TikTok's cap left the post cancellable; take it back before
      // the init, so a cancel that landed in the wait wins and nothing reaches TikTok.
      const [claimed] = await db
        .update(scheduledPosts)
        .set({ deferredUntil: null, updatedAt: new Date() })
        .where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.status, "publishing")))
        .returning({ id: scheduledPosts.id });
      if (!claimed) return { kind: "done" };
    }
    const render = (
      await db.select().from(videoRenders).where(eq(videoRenders.id, post.videoRenderId)).limit(1)
    )[0];
    if (!render?.filePath)
      throw new PostFailure("file_missing", `render ${post.videoRenderId} has no file`);
    const videoUrl = tiktokPullUrl(
      await getStorage().signedUrl(render.filePath, TIKTOK_PULL_URL_TTL_SECONDS),
    );
    let publishId: string;
    try {
      ({ publishId } = await tiktok.initInboxPull(auth.token, videoUrl));
    } catch (err) {
      if (!isTiktokPendingCap(err)) throw err;
      // Five videos already wait in the owner's TikTok: wait hourly, up to a day.
      const since = state.deferredSince ?? Date.now();
      if (Date.now() - since >= QUOTA_DEFER_MAX_MS) {
        throw new PostFailure("quota_exhausted", "tiktok pending shares full for a day");
      }
      await db
        .update(scheduledPosts)
        .set({ deferredUntil: new Date(Date.now() + QUOTA_DEFER_DELAY_MS), updatedAt: new Date() })
        .where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.status, "publishing")));
      ctx.log.info({ postId }, "publish deferred: tiktok pending shares full");
      return {
        kind: "reschedule",
        delayMs: QUOTA_DEFER_DELAY_MS,
        state: { ...state, deferredSince: since },
      };
    }
    // BEFORE anything else: a retry polls this upload instead of making another.
    state.publishId = publishId;
    state.polls = 0;
    delete state.deferredSince;
    await ctx.checkpoint({ ...state });
  }
  // The row learns the upload's id — again on a resumed run when the write after
  // the checkpoint was lost: the webhook, the daily poll and the removal find the
  // post by it.
  if (post.providerContainerId !== state.publishId) {
    await db
      .update(scheduledPosts)
      .set({ providerContainerId: state.publishId, deferredUntil: null, updatedAt: new Date() })
      .where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.status, "publishing")));
  }

  const [current] = await db
    .select({ status: scheduledPosts.status })
    .from(scheduledPosts)
    .where(eq(scheduledPosts.id, postId))
    .limit(1);
  if (current?.status !== "publishing") return { kind: "done" };

  const status = await tiktok.publishStatus(auth.token, state.publishId);
  switch (status.code) {
    case "PROCESSING_UPLOAD":
    case "PROCESSING_DOWNLOAD": {
      const polls = (state.polls ?? 0) + 1;
      if (polls >= TIKTOK_MAX_POLLS) {
        throw new PostFailure(
          "platform_timeout",
          `tiktok upload ${state.publishId} still processing after ${polls} polls`,
        );
      }
      return { kind: "reschedule", delayMs: CONTAINER_POLL_DELAY_MS, state: { ...state, polls } };
    }
    case "SEND_TO_USER_INBOX":
      if (await markTiktokDelivered(db, postId)) {
        ctx.log.info({ postId, source: "poll" }, "tiktok post delivered to the inbox");
      }
      return { kind: "done" };
    case "PUBLISH_COMPLETE":
      if (await markTiktokPosted(db, postId, status.postId)) {
        ctx.log.info({ postId, source: "poll" }, "tiktok post posted by its owner");
      }
      return { kind: "done" };
    case "FAILED": {
      const reason = status.failReason ?? "unknown";
      const detail = `tiktok upload ${state.publishId} FAILED: ${reason}`;
      if (reason === "auth_removed") throw new PostFailure("connection_expired", detail);
      if ((reason === "internal" || reason === "video_pull_failed") && !state.reinitiated) {
        // TikTok marks `internal` retryable, and a pull can fail on a blip:
        // one fresh upload, never two.
        const fresh: PublishState = { reinitiated: true };
        await ctx.checkpoint({ ...fresh });
        // The failed upload's id goes: until the fresh one lands the post holds
        // nothing at TikTok, so a cap wait stays cancellable and a removal fails it.
        await db
          .update(scheduledPosts)
          .set({ providerContainerId: null, updatedAt: new Date() })
          .where(and(eq(scheduledPosts.id, postId), eq(scheduledPosts.status, "publishing")));
        ctx.log.warn({ postId, reason }, "tiktok upload failed; initiating once more");
        return { kind: "reschedule", delayMs: 0, state: { ...fresh } };
      }
      throw new PostFailure(
        reason === "internal" ? "platform_timeout" : "platform_refused",
        detail,
      );
    }
  }
}

/**
 * A net's question to TikTok about an upload it accepted: in the inbox or
 * posted → the row follows and true; anything else, or no way to ask → false,
 * and the caller decides. Never throws.
 */
async function confirmTiktokByStatus(db: Db, postId: string, publishId: string): Promise<boolean> {
  try {
    const [post] = await db
      .select({ accountId: scheduledPosts.socialAccountId })
      .from(scheduledPosts)
      .where(eq(scheduledPosts.id, postId))
      .limit(1);
    if (!post) return false;
    const auth = await tiktokToken(db, post.accountId);
    if ("lapsed" in auth) return false;
    const status = await getTiktokProvider().publishStatus(auth.token, publishId);
    if (status.code === "SEND_TO_USER_INBOX") return await markTiktokDelivered(db, postId);
    if (status.code === "PUBLISH_COMPLETE")
      return await markTiktokPosted(db, postId, status.postId);
    return false;
  } catch {
    return false;
  }
}

export interface TiktokEventResult {
  event: string;
  outcome: "applied" | "ignored";
  accounts?: number;
  failed?: number;
}

/**
 * One webhook delivery, its signature already verified by the route. TikTok
 * delivers at least once and retries for 72 h, so every write is guarded and
 * monotonic: a second delivery changes nothing. `content` is a JSON string
 * inside the JSON; a post id is read from the raw text (19 digits overflow a JS
 * number). Handled: post.publish.inbox_delivered, post.publish.complete,
 * post.publish.publicly_available and its reverse, authorization.removed.
 * Everything else is ignored — post.publish.failed too: the job's own poll owns
 * failure (it would otherwise race the job's one fresh upload), and the nets
 * cover a dead job.
 */
export async function processTiktokEvent(db: Db, rawBody: string): Promise<TiktokEventResult> {
  let envelope: {
    event?: unknown;
    create_time?: unknown;
    user_openid?: unknown;
    content?: unknown;
  };
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return { event: "?", outcome: "ignored" };
  }
  const event = typeof envelope.event === "string" ? envelope.event : "?";
  const contentText =
    typeof envelope.content === "string"
      ? envelope.content
      : JSON.stringify(envelope.content ?? {});
  let content: { publish_id?: unknown; reason?: unknown } = {};
  try {
    content = JSON.parse(contentText) ?? {};
  } catch {
    content = {};
  }
  const publishId = typeof content.publish_id === "string" ? content.publish_id : undefined;
  const platformPostId = rawIdField(rawBody, "post_id");
  const ignored = { event, outcome: "ignored" as const };
  const applied = { event, outcome: "applied" as const };

  const post = async () =>
    publishId
      ? (
          await db
            .select({ id: scheduledPosts.id })
            .from(scheduledPosts)
            .where(
              and(
                eq(scheduledPosts.platform, "tiktok"),
                eq(scheduledPosts.providerContainerId, publishId),
              ),
            )
            .limit(1)
        )[0]
      : undefined;

  switch (event) {
    case "post.publish.inbox_delivered": {
      const row = await post();
      return row && (await markTiktokDelivered(db, row.id)) ? applied : ignored;
    }
    case "post.publish.complete": {
      const row = await post();
      return row && (await markTiktokPosted(db, row.id)) ? applied : ignored;
    }
    case "post.publish.publicly_available": {
      const row = await post();
      if (!row || !platformPostId) return ignored;
      if (await markTiktokPosted(db, row.id, platformPostId)) return applied;
      // `complete` came first: the row is posted, and the link joins it now.
      const linked = await db
        .update(scheduledPosts)
        .set({
          providerMediaId: platformPostId,
          permalink: tiktokPermalink(platformPostId),
          updatedAt: new Date(),
        })
        .where(and(eq(scheduledPosts.id, row.id), eq(scheduledPosts.status, "posted")))
        .returning({ id: scheduledPosts.id });
      return linked.length > 0 ? applied : ignored;
    }
    case "post.publish.no_longer_publicaly_available": {
      // TikTok's own spelling. The link would open nothing, so it goes.
      const row = await post();
      if (!row || !platformPostId) return ignored;
      const cleared = await db
        .update(scheduledPosts)
        .set({ permalink: null, updatedAt: new Date() })
        .where(
          and(
            eq(scheduledPosts.id, row.id),
            eq(scheduledPosts.providerMediaId, platformPostId),
            isNotNull(scheduledPosts.permalink),
          ),
        )
        .returning({ id: scheduledPosts.id });
      return cleared.length > 0 ? applied : ignored;
    }
    case "authorization.removed": {
      const openId = typeof envelope.user_openid === "string" ? envelope.user_openid : undefined;
      if (!openId) return ignored;
      const at =
        typeof envelope.create_time === "number"
          ? new Date(envelope.create_time * 1000)
          : new Date();
      const result = await removeTiktokAuthorization(db, { openId, at, reason: content.reason });
      return { event, outcome: result.accounts > 0 ? "applied" : "ignored", ...result };
    }
    default:
      return ignored;
  }
}

/**
 * The owner removed Tavnit in TikTok (the token is already revoked when the
 * event arrives): every live row of that open_id connected before the event —
 * under any Tavnit account — becomes `disconnected` with its tokens erased, and
 * its posts still waiting fail now as connection_expired, so the notice and the
 * failure email reach the owner at once instead of on the day (decision 0115).
 * A row reconnected after the event keeps its connection.
 */
async function removeTiktokAuthorization(
  db: Db,
  opts: { openId: string; at: Date; reason: unknown },
): Promise<{ accounts: number; failed: number }> {
  const why = `authorization removed in TikTok (reason ${String(opts.reason ?? "?")})`;
  // One transaction: a fault failing a post rolls the disconnect back too, so
  // TikTok's retry replays both halves (failPost nests as a savepoint).
  return db.transaction(async (tx) => {
    const accounts = await tx
      .update(socialAccounts)
      .set({
        status: "disconnected",
        accessTokenEnc: null,
        refreshTokenEnc: null,
        userTokenEnc: null,
        accessTokenExpiresAt: null,
        lastError: why,
        disconnectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(socialAccounts.platform, "tiktok"),
          eq(socialAccounts.externalId, opts.openId),
          inArray(socialAccounts.status, ["connected", "expired"]),
          lte(socialAccounts.connectedAt, opts.at),
        ),
      )
      .returning({ id: socialAccounts.id });
    let failed = 0;
    if (accounts.length > 0) {
      // Waiting = nothing at TikTok yet: scheduled, or publishing with no upload.
      const waiting = await tx
        .select({ id: scheduledPosts.id })
        .from(scheduledPosts)
        .where(
          and(
            inArray(
              scheduledPosts.socialAccountId,
              accounts.map((a) => a.id),
            ),
            or(
              eq(scheduledPosts.status, "scheduled"),
              and(
                eq(scheduledPosts.status, "publishing"),
                isNull(scheduledPosts.providerContainerId),
              ),
            ),
          ),
        );
      for (const row of waiting) {
        if (await failPost(tx as Db, row.id, "connection_expired", why)) failed++;
      }
    }
    return { accounts: accounts.length, failed };
  });
}

/**
 * The daily check's TikTok half: per connected account, a fresh token (a
 * refresh keeps TikTok's rotation alive; a lapse marks it expired) and the
 * profile, whose avatar link expires. Errors are per account and swallowed.
 */
async function checkTiktokAccounts(
  db: Db,
  log: JobContext["log"],
): Promise<{ checked: number; refreshed: number; expired: number }> {
  const accounts = await db
    .select({ id: socialAccounts.id })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.status, "connected"), eq(socialAccounts.platform, "tiktok")));
  let refreshed = 0;
  let expired = 0;
  for (const account of accounts) {
    try {
      const auth = await tiktokToken(db, account.id);
      if ("lapsed" in auth) {
        expired++;
        continue;
      }
      const profile = await getTiktokProvider().userInfo(auth.token);
      await db
        .update(socialAccounts)
        .set({
          ...(profile.displayName ? { displayName: profile.displayName } : {}),
          ...(profile.avatarUrl ? { pictureUrl: profile.avatarUrl } : {}),
          updatedAt: new Date(),
        })
        .where(eq(socialAccounts.id, account.id));
      refreshed++;
    } catch (err) {
      if (isTiktokTokenLapse(err)) {
        await markAccountExpired(db, account.id, err instanceof Error ? err.message : String(err));
        expired++;
      } else {
        log.warn({ err, accountId: account.id }, "tiktok token check: call failed, left as is");
      }
    }
  }
  return { checked: accounts.length, refreshed, expired };
}

/**
 * The webhook's net: TikTok posts delivered within a week get one status read
 * each, and PUBLISH_COMPLETE moves the row to posted — logged `source: poll`, so
 * a live run can tell which path fired. Errors are per post and swallowed.
 */
async function pollDeliveredTiktokPosts(db: Db, log: JobContext["log"]): Promise<number> {
  const rows = await db
    .select({
      id: scheduledPosts.id,
      accountId: scheduledPosts.socialAccountId,
      publishId: scheduledPosts.providerContainerId,
    })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.platform, "tiktok"),
        eq(scheduledPosts.status, "delivered"),
        gte(
          scheduledPosts.deliveredAt,
          new Date(Date.now() - TIKTOK_DELIVERED_POLL_DAYS * 86_400_000),
        ),
        isNotNull(scheduledPosts.providerContainerId),
      ),
    );
  let posted = 0;
  for (const row of rows) {
    try {
      const auth = await tiktokToken(db, row.accountId);
      if ("lapsed" in auth) continue;
      const status = await getTiktokProvider().publishStatus(auth.token, row.publishId!);
      if (
        status.code === "PUBLISH_COMPLETE" &&
        (await markTiktokPosted(db, row.id, status.postId))
      ) {
        posted++;
        log.info({ postId: row.id, source: "poll" }, "tiktok post posted by its owner");
      }
    } catch (err) {
      log.warn({ err, postId: row.id }, "tiktok delivered poll: call failed, left as is");
    }
  }
  return posted;
}
