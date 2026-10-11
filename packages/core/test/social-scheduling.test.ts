import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import {
  acknowledgeFailedPosts,
  cancelScheduledPost,
  CAPTION_MAX_CHARS,
  getScheduledPost,
  INSTAGRAM_DAILY_POST_MARGIN,
  listScheduledPosts,
  pendingPostsByRender,
  POSTING_HORIZON_DAYS,
  postingHorizon,
  postingNotices,
  schedulePosts,
  SocialSchedulingError,
  updateScheduledPost,
} from "../src/pipelines/social";
import { getStorage, setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import {
  connectInstagram,
  samplePage,
  seedOwnerAndBusiness,
  seedReleasedRender,
  socialTestEnv,
} from "./helpers/social";
import { tempStorage } from "./helpers/storage";

/**
 * Scheduling (decision 0101): one transaction writes N rows and N jobs under
 * post:<id> with run_at = the instant; every guard refuses with a typed code;
 * an edit moves the job's run_at and is refused once posting started; a cancel
 * leaves the job to no-op; the horizon is the earlier of 30 days and the day
 * before retention deletes the file.
 */
describe("social scheduling", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let restoreEnv: () => void;
  let storageRoot: string;
  let cleanupStorage: () => void;
  let userId: string;
  let businessId: string;
  let accountId: string;
  let renderId: string;

  const hourAhead = () => new Date(Date.now() + 3_600_000);
  const base = () => ({
    userId,
    videoRenderId: renderId,
    accountIds: [accountId],
    scheduledAt: hourAhead(),
    timezone: "Asia/Jerusalem",
    caption: "כיתוב",
  });

  beforeAll(async () => {
    restoreEnv = socialTestEnv();
    ({ db, pg } = await createTestDb());
    const temp = tempStorage();
    storageRoot = temp.root;
    cleanupStorage = temp.cleanup;
    setStorage(temp.storage);
    ({ userId, businessId } = await seedOwnerAndBusiness(db));
    accountId = (await connectInstagram(db, userId))[0]!;
    renderId = (await seedReleasedRender(db, getStorage(), storageRoot, { businessId })).id;
  });

  afterAll(async () => {
    setStorage(undefined);
    cleanupStorage();
    restoreEnv();
    await pg.close();
  });

  async function code(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
      return "ok";
    } catch (err) {
      if (err instanceof SocialSchedulingError) return err.code;
      throw err;
    }
  }

  it("writes one row and one job per account, the job under post:<id> at the instant, the sound only on Instagram rows", async () => {
    const [second] = await connectInstagram(db, userId, [samplePage("ig_second", "2")]);
    const when = hourAhead();
    const rows = await schedulePosts(db, {
      ...base(),
      accountIds: [accountId, second!],
      scheduledAt: when,
      sound: { audioId: "a1", kind: "original_sound", title: "sound" },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe("scheduled");
      expect(row.scheduledAt.getTime()).toBe(when.getTime());
      expect(row.businessId).toBe(businessId);
      expect(row.sound).toEqual({ audioId: "a1", kind: "original_sound", title: "sound" });
      const job = (
        await db
          .select()
          .from(schema.jobs)
          .where(eq(schema.jobs.idempotencyKey, `post:${row.id}`))
      )[0]!;
      expect(job.type).toBe("publish_post");
      expect(job.status).toBe("queued");
      expect(job.runAt.getTime()).toBe(when.getTime());
      expect(job.payload).toEqual({ postId: row.id });
    }
    const pending = await pendingPostsByRender(db, [
      renderId,
      "00000000-0000-4000-8000-000000000000",
    ]);
    expect(pending.get(renderId)).toBe(2);
    expect(pending.size).toBe(1);
    for (const row of rows) await cancelScheduledPost(db, { userId, postId: row.id });
  });

  it("refuses the past, a non-released render, a missing file, foreign or disconnected accounts, a long caption, a bad zone, a sound with no Instagram account", async () => {
    expect(
      await code(schedulePosts(db, { ...base(), scheduledAt: new Date(Date.now() - 120_000) })),
    ).toBe("in_the_past");
    // A minute of grace: "עכשיו" lands a few seconds in the past by the time it arrives.
    expect(
      await code(schedulePosts(db, { ...base(), scheduledAt: new Date(Date.now() - 10_000) })),
    ).toBe("ok");
    expect(await code(schedulePosts(db, { ...base(), accountIds: [] }))).toBe("no_accounts");
    expect(
      await code(schedulePosts(db, { ...base(), caption: "א".repeat(CAPTION_MAX_CHARS + 1) })),
    ).toBe("caption_too_long");
    expect(await code(schedulePosts(db, { ...base(), timezone: "Mars/Olympus" }))).toBe(
      "bad_timezone",
    );

    const other = await seedOwnerAndBusiness(db, { email: "other@test.local" });
    const [otherAccount] = await connectInstagram(db, other.userId, [samplePage("ig_other", "o")]);
    expect(await code(schedulePosts(db, { ...base(), accountIds: [otherAccount!] }))).toBe(
      "not_found",
    );

    await db
      .update(schema.socialAccounts)
      .set({ status: "expired" })
      .where(eq(schema.socialAccounts.id, accountId));
    expect(await code(schedulePosts(db, base()))).toBe("account_not_connected");
    await db
      .update(schema.socialAccounts)
      .set({ status: "connected" })
      .where(eq(schema.socialAccounts.id, accountId));

    const [tiktokRow] = await db
      .insert(schema.socialAccounts)
      .values({ userId, platform: "tiktok", externalId: "tt1", accessTokenEnc: "x" })
      .returning();
    expect(
      await code(
        schedulePosts(db, {
          ...base(),
          accountIds: [tiktokRow!.id],
          sound: { audioId: "a", kind: "music", title: "t" },
        }),
      ),
    ).toBe("sound_without_instagram");

    const queued = await seedReleasedRender(db, getStorage(), storageRoot, { businessId });
    await db
      .update(schema.videoRenders)
      .set({ status: "queued" })
      .where(eq(schema.videoRenders.id, queued.id));
    expect(await code(schedulePosts(db, { ...base(), videoRenderId: queued.id }))).toBe(
      "render_not_released",
    );
    await db
      .update(schema.videoRenders)
      .set({ status: "released", filePath: null })
      .where(eq(schema.videoRenders.id, queued.id));
    expect(await code(schedulePosts(db, { ...base(), videoRenderId: queued.id }))).toBe(
      "file_missing",
    );
    expect(
      await code(
        schedulePosts(db, { ...base(), videoRenderId: "00000000-0000-4000-8000-000000000000" }),
      ),
    ).toBe("not_found");
  });

  it("the horizon is 30 days, or the day before retention deletes the file when that is sooner — read from app_config", async () => {
    const render = (
      await db.select().from(schema.videoRenders).where(eq(schema.videoRenders.id, renderId))
    )[0]!;
    const now = new Date();
    const policy = await postingHorizon(db, render, now);
    expect(policy.limitedBy).toBe("policy");
    expect(policy.maxScheduledAt.getTime()).toBe(now.getTime() + POSTING_HORIZON_DAYS * 86_400_000);
    expect(
      await code(
        schedulePosts(db, { ...base(), scheduledAt: new Date(now.getTime() + 31 * 86_400_000) }),
      ),
    ).toBe("beyond_horizon");

    // Retention of 4 days on a render released yesterday: the file lives three
    // more days, and the two-day margin leaves one schedulable day.
    await db.execute(
      sql`update app_config set value = jsonb_set(value, '{released_renders}', '4'::jsonb) where key = 'retention_days'`,
    );
    const yesterday = new Date(now.getTime() - 86_400_000);
    await db
      .update(schema.videoRenders)
      .set({ releasedAt: yesterday })
      .where(eq(schema.videoRenders.id, renderId));
    const retention = await postingHorizon(db, { ...render, releasedAt: yesterday }, now);
    expect(retention.limitedBy).toBe("retention");
    expect(retention.maxScheduledAt.getTime()).toBe(yesterday.getTime() + 2 * 86_400_000);
    expect(
      await code(
        schedulePosts(db, { ...base(), scheduledAt: new Date(now.getTime() + 3 * 86_400_000) }),
      ),
    ).toBe("beyond_retention");
    expect(
      await code(
        schedulePosts(db, { ...base(), scheduledAt: new Date(now.getTime() + 12 * 3_600_000) }),
      ),
    ).toBe("ok");
    await db.execute(
      sql`update app_config set value = jsonb_set(value, '{released_renders}', '90'::jsonb) where key = 'retention_days'`,
    );

    // A watermarked sample lives watermarked_samples days (14), not 90.
    const sample = await seedReleasedRender(db, getStorage(), storageRoot, { businessId });
    await db
      .update(schema.videoRenders)
      .set({ watermarked: true })
      .where(eq(schema.videoRenders.id, sample.id));
    const sampleHorizon = await postingHorizon(db, { ...sample, watermarked: true }, now);
    expect(sampleHorizon.limitedBy).toBe("retention");
    expect(sampleHorizon.maxScheduledAt.getTime()).toBe(
      sample.releasedAt!.getTime() + 12 * 86_400_000,
    );
    expect(
      await code(
        schedulePosts(db, {
          ...base(),
          videoRenderId: sample.id,
          scheduledAt: new Date(now.getTime() + 13 * 86_400_000),
        }),
      ),
    ).toBe("beyond_retention");
    await db
      .update(schema.videoRenders)
      .set({ releasedAt: now })
      .where(eq(schema.videoRenders.id, renderId));
  });

  it("caps Tavnit's own posts per Instagram account at 45 inside a rolling day", async () => {
    // A window of its own, far from the other tests' posts: exactly the margin
    // already posted there, so one more is one too many.
    const when = new Date(Date.now() + 10 * 86_400_000);
    await db.insert(schema.scheduledPosts).values(
      Array.from({ length: INSTAGRAM_DAILY_POST_MARGIN }, () => ({
        userId,
        businessId,
        videoRenderId: renderId,
        socialAccountId: accountId,
        platform: "instagram" as const,
        scheduledAt: when,
        timezone: "Asia/Jerusalem",
        status: "posted" as const,
      })),
    );
    expect(await code(schedulePosts(db, { ...base(), scheduledAt: when }))).toBe(
      "instagram_daily_cap",
    );
    // Two days away from the crowded window is fine.
    expect(
      await code(
        schedulePosts(db, { ...base(), scheduledAt: new Date(when.getTime() + 3 * 86_400_000) }),
      ),
    ).toBe("ok");
    await db.delete(schema.scheduledPosts).where(eq(schema.scheduledPosts.status, "posted"));
  });

  it("refuses another account's render — core checks ownership at the choke point, an admin may schedule any", async () => {
    const other = await seedOwnerAndBusiness(db, { email: "stranger@test.local" });
    const foreign = await seedReleasedRender(db, getStorage(), storageRoot, {
      businessId: other.businessId,
    });
    expect(await code(schedulePosts(db, { ...base(), videoRenderId: foreign.id }))).toBe(
      "not_found",
    );
    const admin = await seedOwnerAndBusiness(db, { email: "boss@test.local", role: "admin" });
    const [adminAccount] = await connectInstagram(db, admin.userId, [samplePage("ig_admin", "x")]);
    expect(
      await code(
        schedulePosts(db, {
          ...base(),
          userId: admin.userId,
          accountIds: [adminAccount!],
          videoRenderId: foreign.id,
        }),
      ),
    ).toBe("ok");
  });

  it("a time change meets the per-account cap, with the moving post left out of its own count", async () => {
    const crowded = new Date(Date.now() + 20 * 86_400_000);
    await db.insert(schema.scheduledPosts).values(
      Array.from({ length: INSTAGRAM_DAILY_POST_MARGIN - 1 }, () => ({
        userId,
        businessId,
        videoRenderId: renderId,
        socialAccountId: accountId,
        platform: "instagram" as const,
        scheduledAt: crowded,
        timezone: "Asia/Jerusalem",
        status: "posted" as const,
      })),
    );
    // 44 there already: one more fits, and moving that one within the day still fits.
    const [row] = await schedulePosts(db, { ...base(), scheduledAt: crowded });
    const nudged = await updateScheduledPost(db, {
      userId,
      postId: row!.id,
      scheduledAt: new Date(crowded.getTime() + 3_600_000),
    });
    expect(nudged.scheduledAt.getTime()).toBe(crowded.getTime() + 3_600_000);
    // A second post elsewhere cannot be moved into the full day.
    const [elsewhere] = await schedulePosts(db, {
      ...base(),
      scheduledAt: new Date(crowded.getTime() + 5 * 86_400_000),
    });
    expect(
      await code(updateScheduledPost(db, { userId, postId: elsewhere!.id, scheduledAt: crowded })),
    ).toBe("instagram_daily_cap");
    await cancelScheduledPost(db, { userId, postId: row!.id });
    await cancelScheduledPost(db, { userId, postId: elsewhere!.id });
    await db.delete(schema.scheduledPosts).where(eq(schema.scheduledPosts.status, "posted"));
  });

  it("an edit moves the job's run_at and the row together; caption and sound change alone; once started nothing changes", async () => {
    const [row] = await schedulePosts(db, base());
    const later = new Date(Date.now() + 5 * 3_600_000);
    const edited = await updateScheduledPost(db, {
      userId,
      postId: row!.id,
      scheduledAt: later,
      caption: "חדש",
      sound: { audioId: "b2", kind: "music", title: "m" },
    });
    expect(edited.scheduledAt.getTime()).toBe(later.getTime());
    expect(edited.caption).toBe("חדש");
    const job = (
      await db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.idempotencyKey, `post:${row!.id}`))
    )[0]!;
    expect(job.runAt.getTime()).toBe(later.getTime());
    expect(
      await code(
        updateScheduledPost(db, {
          userId,
          postId: row!.id,
          scheduledAt: new Date(Date.now() - 120_000),
        }),
      ),
    ).toBe("in_the_past");
    expect(
      await code(
        updateScheduledPost(db, {
          userId,
          postId: row!.id,
          caption: "א".repeat(CAPTION_MAX_CHARS + 1),
        }),
      ),
    ).toBe("caption_too_long");

    // The worker claimed the job (the instant before its first act): the job
    // row is no longer queued, so a time change is refused and rolled back.
    await db.update(schema.jobs).set({ status: "running" }).where(eq(schema.jobs.id, job.id));
    expect(
      await code(updateScheduledPost(db, { userId, postId: row!.id, scheduledAt: hourAhead() })),
    ).toBe("not_pending");
    const unchanged = (
      await db.select().from(schema.scheduledPosts).where(eq(schema.scheduledPosts.id, row!.id))
    )[0]!;
    expect(unchanged.scheduledAt.getTime()).toBe(later.getTime());
    await db.update(schema.jobs).set({ status: "queued" }).where(eq(schema.jobs.id, job.id));

    // Posting started: nothing changes, nothing cancels.
    await db
      .update(schema.scheduledPosts)
      .set({ status: "publishing" })
      .where(eq(schema.scheduledPosts.id, row!.id));
    expect(await code(updateScheduledPost(db, { userId, postId: row!.id, caption: "x" }))).toBe(
      "not_pending",
    );
    expect(await code(cancelScheduledPost(db, { userId, postId: row!.id }))).toBe("not_pending");
    expect(
      await code(
        cancelScheduledPost(db, {
          userId: "00000000-0000-4000-8000-000000000000",
          postId: row!.id,
        }),
      ),
    ).toBe("not_found");
    await db
      .update(schema.scheduledPosts)
      .set({ status: "scheduled" })
      .where(eq(schema.scheduledPosts.id, row!.id));
    const cancelled = await cancelScheduledPost(db, { userId, postId: row!.id });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  it("the calendar read joins the account and the render; the notices count unacknowledged failures and expired accounts with posts waiting", async () => {
    const [row] = await schedulePosts(db, base());
    const from = new Date(Date.now() - 86_400_000);
    const to = new Date(Date.now() + 2 * 86_400_000);
    const items = await listScheduledPosts(db, { userId, from, to });
    const mine = items.find((i) => i.post.id === row!.id)!;
    expect(mine.account).toMatchObject({ platform: "instagram", username: "user" });
    expect(mine.render).toMatchObject({ id: renderId, service: "a" });
    // The diagnostics stay behind the view, like tokens behind the account view.
    expect("failureDetail" in mine.post).toBe(false);
    expect("providerContainerId" in mine.post).toBe(false);
    expect("failureDetail" in (await getScheduledPost(db, { userId, postId: row!.id }))!).toBe(
      false,
    );

    await db
      .update(schema.scheduledPosts)
      .set({ status: "failed", failureKind: "platform_refused", failedAt: new Date() })
      .where(eq(schema.scheduledPosts.id, row!.id));
    expect((await postingNotices(db, userId)).unacknowledgedFailures).toBe(1);
    expect(await acknowledgeFailedPosts(db, userId)).toBe(1);
    expect((await postingNotices(db, userId)).unacknowledgedFailures).toBe(0);

    const [pending] = await schedulePosts(db, base());
    await db
      .update(schema.socialAccounts)
      .set({ status: "expired" })
      .where(eq(schema.socialAccounts.id, accountId));
    // Earlier tests left scheduled rows on this account too: the notice counts them all.
    const [scheduledNow] = await db
      .select({ n: sql<string>`count(*)` })
      .from(schema.scheduledPosts)
      .where(
        sql`${schema.scheduledPosts.socialAccountId} = ${accountId} and ${schema.scheduledPosts.status} = 'scheduled'`,
      );
    const notices = await postingNotices(db, userId);
    expect(notices.expiredAccounts).toEqual([
      { id: accountId, name: "חשבון", pendingPosts: Number(scheduledNow!.n) },
    ]);
    expect(Number(scheduledNow!.n)).toBeGreaterThanOrEqual(1);
    await db
      .update(schema.socialAccounts)
      .set({ status: "connected" })
      .where(eq(schema.socialAccounts.id, accountId));
    await cancelScheduledPost(db, { userId, postId: pending!.id });
  });
});
