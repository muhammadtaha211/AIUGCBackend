import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST_FAILED } from "../src/alerts";
import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { runLane } from "../src/jobs/worker";
import {
  allowedPlatforms,
  cancelScheduledPost,
  failOrphanedPosts,
  getPlatformAccess,
  getPostingAccess,
  getScheduledPost,
  handleCheckSocialTokens,
  listScheduledPosts,
  listSocialAccounts,
  pendingPostsByRender,
  postingNotices,
  processTiktokEvent,
  QUOTA_DEFER_MAX_MS,
  schedulePosts,
  SocialSchedulingError,
  TIKTOK_MAX_POLLS,
  tiktokPermalink,
  tiktokPullUrl,
  updateScheduledPost,
  upsertTiktokConnection,
} from "../src/pipelines/social";
import { setMetaGraphProvider } from "../src/providers/meta-graph";
import { setTiktokProvider } from "../src/providers/tiktok";
import { openSecret, socialTokenAad } from "../src/secret-box";
import { getStorage, setStorage } from "../src/storage";
import { logger } from "../src/logger";
import { createTestDb } from "./helpers/pglite";
import {
  connectInstagram,
  connectTiktok,
  FakeMeta,
  FakeTiktok,
  sampleTiktokTokens,
  seedOwnerAndBusiness,
  seedReleasedRender,
  socialTestEnv,
  tiktokRefusal,
} from "./helpers/social";
import { tempStorage } from "./helpers/storage";

/**
 * TikTok inbox posting (PR 4, decision 0115) against a scripted TikTok: the
 * connection and its tokens (sealed, rotated under a lock, a lapse turns the
 * account expired), the independent switch, the TikTok row of a mixed batch
 * (no caption, no sound, no tick), the pending-share guard, the inbox delivery
 * (one upload per post across every crash and resume, a webhook before the
 * poll, the cap's wait and a cancel inside it, one fresh upload after a
 * retryable failure), the webhook's events, and the daily half.
 */
describe("TikTok inbox posting", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let restoreEnv: () => void;
  let storageRoot: string;
  let cleanupStorage: () => void;
  let userId: string;
  let businessId: string;
  let tiktok: FakeTiktok;
  let openSeq = 0;

  beforeAll(async () => {
    restoreEnv = socialTestEnv();
    ({ db, pg } = await createTestDb());
    const temp = tempStorage();
    storageRoot = temp.root;
    cleanupStorage = temp.cleanup;
    setStorage(temp.storage);
    setMetaGraphProvider(new FakeMeta());
    ({ userId, businessId } = await seedOwnerAndBusiness(db, {
      email: "admin@test.local",
      role: "admin",
    }));
  });

  beforeEach(() => {
    tiktok = new FakeTiktok();
    setTiktokProvider(tiktok);
  });

  afterAll(async () => {
    setTiktokProvider(undefined);
    setMetaGraphProvider(undefined);
    setStorage(undefined);
    cleanupStorage();
    restoreEnv();
    await pg.close();
  });

  async function lanePass(): Promise<void> {
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
  }

  async function makeRunnable(): Promise<void> {
    await db.execute(
      sql`update jobs set run_at = now() - interval '1 second' where status = 'queued'`,
    );
  }

  /** A fresh TikTok account per test, so caps and webhooks never cross tests. */
  async function freshAccount(opts: { accessExpiresAt?: Date } = {}) {
    openSeq++;
    const openId = `tt_open_${openSeq}`;
    const accountId = await connectTiktok(db, userId, openId, opts);
    return { openId, accountId };
  }

  async function scheduleTiktok(accountIds: string[], at = new Date()) {
    const render = await seedReleasedRender(db, getStorage(), storageRoot, { businessId });
    const posts = await schedulePosts(db, {
      userId,
      videoRenderId: render.id,
      accountIds,
      scheduledAt: at,
      timezone: "Asia/Jerusalem",
      caption: "כיתוב לאינסטגרם",
      sound: null,
      aiLabel: true,
    });
    await makeRunnable();
    return { posts, render };
  }

  async function postRow(id: string) {
    return (
      await db.select().from(schema.scheduledPosts).where(eq(schema.scheduledPosts.id, id))
    )[0]!;
  }

  async function accountRow(id: string) {
    return (
      await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, id))
    )[0]!;
  }

  async function jobRow(postId: string) {
    return (
      await db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.idempotencyKey, `post:${postId}`))
    )[0]!;
  }

  function event(name: string, content: string, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
      client_key: "ck",
      event: name,
      // A second of headroom: the removal guard compares with connected_at, kept to the millisecond.
      create_time: Math.floor(Date.now() / 1000) + 2,
      user_openid: "o",
      content,
      ...extra,
    });
  }

  // -------------------------------------------------------------------------
  // The connection
  // -------------------------------------------------------------------------

  it("connects: tokens sealed with both expiries, the view carries none, a reconnect restores the row in place and moves connected_at", async () => {
    const { openId, accountId } = await freshAccount();
    const row = await accountRow(accountId);
    expect(row.platform).toBe("tiktok");
    expect(row.externalId).toBe(openId);
    expect(row.accessTokenEnc).not.toContain("ACCESS_");
    expect(openSecret(row.accessTokenEnc!, socialTokenAad(row))).toBe(`ACCESS_${openId}`);
    expect(openSecret(row.refreshTokenEnc!, socialTokenAad(row))).toBe(`REFRESH_${openId}`);
    expect(row.accessTokenExpiresAt).toBeInstanceOf(Date);
    expect(row.refreshExpiresAt).toBeInstanceOf(Date);

    const views = await listSocialAccounts(db, userId, ["tiktok"]);
    const view = views.find((v) => v.id === accountId)!;
    expect(JSON.stringify(view)).not.toContain("ACCESS_");
    expect(view).toMatchObject({
      platform: "tiktok",
      displayName: "חשבון טיקטוק",
      canSearchSounds: false,
    });

    await db
      .update(schema.socialAccounts)
      .set({ status: "expired", connectedAt: new Date(Date.now() - 86_400_000) })
      .where(eq(schema.socialAccounts.id, accountId));
    const again = await upsertTiktokConnection(db, {
      userId,
      tokens: sampleTiktokTokens(openId, { access: "ACCESS_NEW" }),
      profile: { openId, displayName: "שם אחר" },
    });
    expect(again.id).toBe(accountId);
    const after = await accountRow(accountId);
    expect(after.status).toBe("connected");
    expect(openSecret(after.accessTokenEnc!, socialTokenAad(after))).toBe("ACCESS_NEW");
    expect(after.connectedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  // -------------------------------------------------------------------------
  // The switch
  // -------------------------------------------------------------------------

  it("the TikTok switch is independent of Instagram's: absent = admins only, named by user id, a bad row hides TikTok alone", async () => {
    const customer = await seedOwnerAndBusiness(db, { email: "customer-switch@test.local" });
    const set = async (key: string, value: unknown) =>
      db
        .insert(schema.appConfig)
        .values({ key, value })
        .onConflictDoUpdate({ target: schema.appConfig.key, set: { value } });
    const clear = async () =>
      db
        .delete(schema.appConfig)
        .where(sql`${schema.appConfig.key} in ('social_posting','tiktok_posting')`);

    await clear();
    expect(await getPlatformAccess(db, customer.userId)).toEqual({
      instagram: false,
      tiktok: false,
    });
    expect(await getPostingAccess(db, customer.userId)).toBe("hidden");
    expect(await getPlatformAccess(db, userId)).toEqual({ instagram: true, tiktok: true });

    await set("tiktok_posting", { access: "named", userIds: [customer.userId.toUpperCase()] });
    expect(await getPlatformAccess(db, customer.userId)).toEqual({
      instagram: false,
      tiktok: true,
    });
    expect(await getPostingAccess(db, customer.userId)).toBe("allowed");
    expect(allowedPlatforms({ instagram: false, tiktok: true })).toEqual(["tiktok"]);

    await set("social_posting", { access: "everyone" });
    await set("tiktok_posting", { access: "named", userIds: ["not-a-uuid"] });
    expect(await getPlatformAccess(db, customer.userId)).toEqual({
      instagram: true,
      tiktok: false,
    });
    await clear();
  });

  it("every read filters to the caller's platforms: accounts, calendar, the post by id, the notice, the player's count", async () => {
    const { accountId } = await freshAccount();
    const { posts, render } = await scheduleTiktok([accountId], new Date(Date.now() + 3_600_000));
    const post = posts[0]!;
    const from = new Date(Date.now() - 86_400_000);
    const to = new Date(Date.now() + 2 * 86_400_000);

    expect(
      (await listSocialAccounts(db, userId, ["instagram"])).some((a) => a.id === accountId),
    ).toBe(false);
    expect(
      (await listScheduledPosts(db, { userId, from, to, platforms: ["instagram"] })).length,
    ).toBe(0);
    expect(
      await getScheduledPost(db, { userId, postId: post.id, platforms: ["instagram"] }),
    ).toBeUndefined();
    expect(
      (await pendingPostsByRender(db, [render.id], ["instagram"])).get(render.id),
    ).toBeUndefined();
    expect((await pendingPostsByRender(db, [render.id], ["tiktok"])).get(render.id)).toBe(1);
    await expect(
      cancelScheduledPost(db, { userId, postId: post.id, platforms: ["instagram"] }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      schedulePosts(db, {
        userId,
        videoRenderId: render.id,
        accountIds: [accountId],
        scheduledAt: new Date(Date.now() + 3_600_000),
        timezone: "Asia/Jerusalem",
        caption: "",
        platforms: ["instagram"],
      }),
    ).rejects.toMatchObject({ code: "not_found" });

    await db
      .update(schema.socialAccounts)
      .set({ status: "expired" })
      .where(eq(schema.socialAccounts.id, accountId));
    expect((await postingNotices(db, userId, ["instagram"])).expiredAccounts).toEqual([]);
    expect(
      (await postingNotices(db, userId, ["tiktok"])).expiredAccounts.map((a) => a.id),
    ).toContain(accountId);
    await cancelScheduledPost(db, { userId, postId: post.id });
  });

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------

  it("a mixed batch: the Instagram row keeps caption, sound and tick; the TikTok row carries none of them", async () => {
    const [igAccount] = await connectInstagram(db, userId);
    const { accountId } = await freshAccount();
    const render = await seedReleasedRender(db, getStorage(), storageRoot, { businessId });
    const rows = await schedulePosts(db, {
      userId,
      videoRenderId: render.id,
      accountIds: [igAccount!, accountId],
      scheduledAt: new Date(Date.now() + 3_600_000),
      timezone: "Asia/Jerusalem",
      caption: "כיתוב",
      sound: { audioId: "a1", kind: "music", title: "t" },
      aiLabel: true,
    });
    const ig = rows.find((r) => r.platform === "instagram")!;
    const tt = rows.find((r) => r.platform === "tiktok")!;
    expect(ig).toMatchObject({ caption: "כיתוב", aiLabel: true });
    expect(ig.sound).not.toBeNull();
    expect(tt).toMatchObject({ caption: "", sound: null, aiLabel: false });

    // An edit of the TikTok row changes the time only.
    const moved = await updateScheduledPost(db, {
      userId,
      postId: tt.id,
      scheduledAt: new Date(Date.now() + 7_200_000),
      caption: "נסיון",
      aiLabel: true,
    });
    expect(moved).toMatchObject({ caption: "", aiLabel: false });
    await expect(
      updateScheduledPost(db, {
        userId,
        postId: tt.id,
        sound: { audioId: "a", kind: "music", title: "t" },
      }),
    ).rejects.toMatchObject({ code: "sound_without_instagram" });
    for (const row of rows) await cancelScheduledPost(db, { userId, postId: row.id });
  });

  it("refuses a sixth TikTok post within a day either side; posted drafts do not count", async () => {
    const { accountId } = await freshAccount();
    const at = new Date(Date.now() + 6 * 3_600_000);
    const made = [];
    for (let i = 0; i < 5; i++) made.push((await scheduleTiktok([accountId], at)).posts[0]!);
    const sixth = scheduleTiktok([accountId], new Date(at.getTime() + 20 * 3_600_000));
    await expect(sixth).rejects.toBeInstanceOf(SocialSchedulingError);
    await expect(sixth).rejects.toMatchObject({ code: "tiktok_pending_cap" });

    // A delivered one still counts; a posted one does not.
    await db
      .update(schema.scheduledPosts)
      .set({ status: "delivered" })
      .where(eq(schema.scheduledPosts.id, made[0]!.id));
    await expect(scheduleTiktok([accountId], at)).rejects.toMatchObject({
      code: "tiktok_pending_cap",
    });
    await db
      .update(schema.scheduledPosts)
      .set({ status: "posted" })
      .where(eq(schema.scheduledPosts.id, made[0]!.id));
    const ok = await scheduleTiktok([accountId], at);
    expect(ok.posts).toHaveLength(1);
    await db
      .update(schema.scheduledPosts)
      .set({ status: "cancelled" })
      .where(eq(schema.scheduledPosts.socialAccountId, accountId));
  });

  // -------------------------------------------------------------------------
  // The inbox delivery
  // -------------------------------------------------------------------------

  it("delivers: one PULL upload, the publish id checkpointed and kept, polls as re-runs, then delivered", async () => {
    const { accountId } = await freshAccount();
    const { posts } = await scheduleTiktok([accountId]);
    const post = posts[0]!;
    tiktok.statuses = [{ code: "PROCESSING_DOWNLOAD" }, { code: "SEND_TO_USER_INBOX" }];

    await lanePass();
    expect(tiktok.calls.initInboxPull).toBe(1);
    expect(tiktok.pulls[0]!.accessToken).toBe(`ACCESS_tt_open_${openSeq}`);
    let row = await postRow(post.id);
    expect(row.status).toBe("publishing");
    expect(row.providerContainerId).toBe(`${tiktok.idPrefix}1`);
    const job = await jobRow(post.id);
    expect(job.status).toBe("queued");
    expect(job.state).toMatchObject({ publishId: `${tiktok.idPrefix}1`, polls: 1 });

    await makeRunnable();
    await lanePass();
    row = await postRow(post.id);
    expect(row.status).toBe("delivered");
    expect(row.deliveredAt).toBeInstanceOf(Date);
    expect(tiktok.calls.initInboxPull).toBe(1);
    expect((await jobRow(post.id)).status).toBe("succeeded");
  });

  it("a webhook that lands before the poll wins; the job's next run ends quietly with no second upload", async () => {
    const { accountId } = await freshAccount();
    const { posts } = await scheduleTiktok([accountId]);
    const post = posts[0]!;
    tiktok.statuses = [{ code: "PROCESSING_UPLOAD" }];
    await lanePass();
    const publishId = (await postRow(post.id)).providerContainerId!;

    const result = await processTiktokEvent(
      db,
      event(
        "post.publish.inbox_delivered",
        JSON.stringify({ publish_id: publishId, publish_type: "INBOX_SHARE" }),
      ),
    );
    expect(result).toEqual({ event: "post.publish.inbox_delivered", outcome: "applied" });
    // A second delivery of the same event changes nothing.
    expect(
      (
        await processTiktokEvent(
          db,
          event("post.publish.inbox_delivered", JSON.stringify({ publish_id: publishId })),
        )
      ).outcome,
    ).toBe("ignored");

    const polls = tiktok.calls.publishStatus;
    await makeRunnable();
    await lanePass();
    expect((await postRow(post.id)).status).toBe("delivered");
    expect(tiktok.calls.initInboxPull).toBe(1);
    expect(tiktok.calls.publishStatus).toBe(polls);
  });

  it("a crash after the upload, before the row write, resumes on the checkpointed publish id — never a second upload", async () => {
    const { accountId } = await freshAccount();
    const { posts } = await scheduleTiktok([accountId]);
    const post = posts[0]!;
    // The run dies on its first status read, after the checkpoint.
    tiktok.throwOnceOn.publishStatus = new Error("box lost the network");
    await lanePass();
    expect(tiktok.calls.initInboxPull).toBe(1);
    await makeRunnable();
    await lanePass();
    expect(tiktok.calls.initInboxPull).toBe(1);
    expect((await postRow(post.id)).status).toBe("delivered");
  });

  it("the owner posting first reads PUBLISH_COMPLETE: posted, with the exact post id and the player link", async () => {
    const { accountId } = await freshAccount();
    const { posts } = await scheduleTiktok([accountId]);
    tiktok.statuses = [{ code: "PUBLISH_COMPLETE", postId: "7300000000000000777" }];
    await lanePass();
    const row = await postRow(posts[0]!.id);
    expect(row.status).toBe("posted");
    expect(row.providerMediaId).toBe("7300000000000000777");
    expect(row.permalink).toBe(tiktokPermalink("7300000000000000777"));
  });

  it("five drafts waiting at TikTok: waits hourly (cancellable), and a cancel inside the wait reaches TikTok never", async () => {
    const { accountId } = await freshAccount();
    const { posts } = await scheduleTiktok([accountId]);
    const post = posts[0]!;
    tiktok.throwOn.initInboxPull = tiktokRefusal("spam_risk_too_many_pending_share", 403);
    await lanePass();
    let row = await postRow(post.id);
    expect(row.status).toBe("publishing");
    expect(row.deferredUntil).toBeInstanceOf(Date);
    expect((await jobRow(post.id)).state).toMatchObject({ deferredSince: expect.any(Number) });

    await cancelScheduledPost(db, { userId, postId: post.id });
    delete tiktok.throwOn.initInboxPull;
    const inits = tiktok.calls.initInboxPull;
    await makeRunnable();
    await lanePass();
    expect(tiktok.calls.initInboxPull).toBe(inits);
    row = await postRow(post.id);
    expect(row.status).toBe("cancelled");
  });

  it("the wait gives up after a day as quota_exhausted, with the founder's alert", async () => {
    const { accountId } = await freshAccount();
    const { posts } = await scheduleTiktok([accountId]);
    const post = posts[0]!;
    tiktok.throwOn.initInboxPull = tiktokRefusal("spam_risk_too_many_pending_share", 403);
    await lanePass();
    await db
      .update(schema.jobs)
      .set({ state: { deferredSince: Date.now() - QUOTA_DEFER_MAX_MS - 1 } })
      .where(eq(schema.jobs.idempotencyKey, `post:${post.id}`));
    await makeRunnable();
    await lanePass();
    const row = await postRow(post.id);
    expect(row.status).toBe("failed");
    expect(row.failureKind).toBe("quota_exhausted");
    const alerts = await db
      .select()
      .from(schema.events)
      .where(
        sql`${schema.events.kind} = ${POST_FAILED} and ${schema.events.payload}->>'postId' = ${post.id}`,
      );
    expect(alerts[0]?.payload).toMatchObject({
      platform: "tiktok",
      failureKind: "quota_exhausted",
    });
  });

  it("FAILED internal gets one fresh upload, never two; then platform_timeout", async () => {
    const { accountId } = await freshAccount();
    const { posts } = await scheduleTiktok([accountId]);
    tiktok.statuses = [{ code: "FAILED", failReason: "internal" }];
    // The fresh upload is a reschedule with no delay, so it may run inside the same pass.
    await lanePass();
    await makeRunnable();
    await lanePass();
    await makeRunnable();
    await lanePass();
    expect(tiktok.calls.initInboxPull).toBe(2);
    const row = await postRow(posts[0]!.id);
    expect(row.status).toBe("failed");
    expect(row.failureKind).toBe("platform_timeout");
  });

  it("FAILED file_format_check_failed is a refusal at once; FAILED auth_removed is a lapsed connection", async () => {
    const a = await freshAccount();
    const one = await scheduleTiktok([a.accountId]);
    tiktok.statuses = [{ code: "FAILED", failReason: "file_format_check_failed" }];
    await lanePass();
    expect((await postRow(one.posts[0]!.id)).failureKind).toBe("platform_refused");
    expect(tiktok.calls.initInboxPull).toBe(1);

    tiktok = new FakeTiktok();
    setTiktokProvider(tiktok);
    const b = await freshAccount();
    const two = await scheduleTiktok([b.accountId]);
    tiktok.statuses = [{ code: "FAILED", failReason: "auth_removed" }];
    await lanePass();
    expect((await postRow(two.posts[0]!.id)).failureKind).toBe("connection_expired");
    expect((await accountRow(b.accountId)).status).toBe("expired");
  });

  it(`still processing after ${TIKTOK_MAX_POLLS} polls is platform_timeout`, async () => {
    const { accountId } = await freshAccount();
    const { posts } = await scheduleTiktok([accountId]);
    tiktok.statuses = [{ code: "PROCESSING_DOWNLOAD" }];
    await lanePass();
    await db
      .update(schema.jobs)
      .set({ state: { publishId: `${tiktok.idPrefix}1`, polls: TIKTOK_MAX_POLLS - 1 } })
      .where(eq(schema.jobs.idempotencyKey, `post:${posts[0]!.id}`));
    await makeRunnable();
    await lanePass();
    expect((await postRow(posts[0]!.id)).failureKind).toBe("platform_timeout");
  });

  it("an access token near its end is refreshed once under the lock; the rotated refresh token is the one kept", async () => {
    const { accountId, openId } = await freshAccount({
      accessExpiresAt: new Date(Date.now() + 60_000),
    });
    const { posts } = await scheduleTiktok([accountId]);
    tiktok.statuses = [{ code: "PROCESSING_UPLOAD" }, { code: "SEND_TO_USER_INBOX" }];
    await lanePass();
    expect(tiktok.calls.refresh).toBe(1);
    expect(tiktok.refreshedWith).toEqual([`REFRESH_${openId}`]);
    expect(tiktok.pulls[0]!.accessToken).toBe("ACCESS_R1");
    const row = await accountRow(accountId);
    expect(openSecret(row.refreshTokenEnc!, socialTokenAad(row))).toBe("REFRESH_R1");

    await makeRunnable();
    await lanePass();
    // The fresh token lasts a day: no second refresh, and the poll used it.
    expect(tiktok.calls.refresh).toBe(1);
    expect(tiktok.statusTokens.at(-1)).toBe("ACCESS_R1");
    expect((await postRow(posts[0]!.id)).status).toBe("delivered");
  });

  it("a refresh refused as invalid_grant (the sandbox → production swap) expires the account and fails the post as connection_expired", async () => {
    const { accountId } = await freshAccount({ accessExpiresAt: new Date(Date.now() - 1000) });
    const { posts } = await scheduleTiktok([accountId]);
    tiktok.throwOn.refresh = tiktokRefusal("invalid_grant", 400);
    await lanePass();
    expect(tiktok.calls.initInboxPull).toBe(0);
    expect((await accountRow(accountId)).status).toBe("expired");
    expect((await postRow(posts[0]!.id)).failureKind).toBe("connection_expired");
  });

  it("swaps an https signed URL's host for the verified custom domain and leaves a file:// URL alone", () => {
    expect(
      tiktokPullUrl(
        "https://hyaqydcmwbnbaiqqufow.supabase.co/storage/v1/object/sign/renders/b/video/r/final.mp4?token=abc",
      ),
    ).toBe("https://auth.tavnit.ai/storage/v1/object/sign/renders/b/video/r/final.mp4?token=abc");
    expect(tiktokPullUrl("file:///tmp/x.mp4")).toBe("file:///tmp/x.mp4");
  });

  // -------------------------------------------------------------------------
  // The webhook
  // -------------------------------------------------------------------------

  it("complete posts a delivered draft; publicly_available adds the exact 19-digit id and the link; its reverse clears the link", async () => {
    const { accountId } = await freshAccount();
    const { posts } = await scheduleTiktok([accountId]);
    await lanePass();
    const post = posts[0]!;
    const publishId = (await postRow(post.id)).providerContainerId!;
    expect((await postRow(post.id)).status).toBe("delivered");

    await processTiktokEvent(
      db,
      event("post.publish.complete", JSON.stringify({ publish_id: publishId })),
    );
    expect((await postRow(post.id)).status).toBe("posted");

    // TikTok's int64 as a bare number inside the content string.
    const content = `{"publish_id":"${publishId}","post_id":7300000000000000123,"publish_type":"INBOX_SHARE"}`;
    expect(
      (await processTiktokEvent(db, event("post.publish.publicly_available", content))).outcome,
    ).toBe("applied");
    let row = await postRow(post.id);
    expect(row.providerMediaId).toBe("7300000000000000123");
    expect(row.permalink).toBe("https://www.tiktok.com/player/v1/7300000000000000123");

    await processTiktokEvent(db, event("post.publish.no_longer_publicaly_available", content));
    row = await postRow(post.id);
    expect(row.permalink).toBeNull();
    expect(row.status).toBe("posted");
  });

  it("ignores post.publish.failed (the job owns failure), other products' events, unknown publish ids and junk", async () => {
    const { accountId } = await freshAccount();
    const { posts } = await scheduleTiktok([accountId]);
    tiktok.statuses = [{ code: "PROCESSING_UPLOAD" }];
    await lanePass();
    const publishId = (await postRow(posts[0]!.id)).providerContainerId!;
    for (const body of [
      event("post.publish.failed", JSON.stringify({ publish_id: publishId, reason: "internal" })),
      event("video.publish.completed", JSON.stringify({ share_id: "video.1" })),
      event("post.publish.complete", JSON.stringify({ publish_id: "v_inbox_unknown" })),
      "not json",
    ]) {
      expect((await processTiktokEvent(db, body)).outcome).toBe("ignored");
    }
    expect((await postRow(posts[0]!.id)).status).toBe("publishing");
  });

  it("authorization.removed: the account is disconnected with its tokens erased, its waiting post fails now, a delivered draft is left alone", async () => {
    const { accountId, openId } = await freshAccount();
    const delivered = (await scheduleTiktok([accountId])).posts[0]!;
    await lanePass();
    expect((await postRow(delivered.id)).status).toBe("delivered");
    const waiting = (await scheduleTiktok([accountId], new Date(Date.now() + 3_600_000))).posts[0]!;

    const result = await processTiktokEvent(
      db,
      event("authorization.removed", JSON.stringify({ reason: 1 }), { user_openid: openId }),
    );
    expect(result).toMatchObject({ outcome: "applied", accounts: 1, failed: 1 });
    const account = await accountRow(accountId);
    expect(account).toMatchObject({
      status: "disconnected",
      accessTokenEnc: null,
      refreshTokenEnc: null,
      accessTokenExpiresAt: null,
    });
    expect((await postRow(waiting.id)).failureKind).toBe("connection_expired");
    expect((await postRow(delivered.id)).status).toBe("delivered");
    // The waiting post's job, when it runs, finds a failed row and does nothing.
    const inits = tiktok.calls.initInboxPull;
    await makeRunnable();
    await lanePass();
    expect(tiktok.calls.initInboxPull).toBe(inits);
  });

  it("a removal TikTok retries after the owner reconnected never undoes the reconnect", async () => {
    const { accountId, openId } = await freshAccount();
    // Connected a day ago; the owner removed Tavnit two minutes ago and reconnected just now.
    await db
      .update(schema.socialAccounts)
      .set({ connectedAt: new Date(Date.now() - 86_400_000) })
      .where(eq(schema.socialAccounts.id, accountId));
    const removedAt = Math.floor(Date.now() / 1000) - 120;
    await connectTiktok(db, userId, openId);
    const result = await processTiktokEvent(
      db,
      event("authorization.removed", JSON.stringify({ reason: 1 }), {
        user_openid: openId,
        create_time: removedAt,
      }),
    );
    expect(result.outcome).toBe("ignored");
    expect((await accountRow(accountId)).status).toBe("connected");
  });

  // -------------------------------------------------------------------------
  // The daily half and the nets
  // -------------------------------------------------------------------------

  it("the daily check refreshes a TikTok profile, expires a lapsed account, and the delivered poll posts a finished draft", async () => {
    const good = await freshAccount();
    const lapsed = await freshAccount({ accessExpiresAt: new Date(Date.now() - 1000) });
    const draft = (await scheduleTiktok([good.accountId])).posts[0]!;
    await lanePass();
    expect((await postRow(draft.id)).status).toBe("delivered");

    tiktok.throwOn.refresh = tiktokRefusal("invalid_grant");
    tiktok.statuses = [{ code: "PUBLISH_COMPLETE" }];
    const info = logger.child({});
    await handleCheckSocialTokens({} as never, {
      db,
      log: info,
      checkpoint: async () => {},
    });
    expect((await accountRow(good.accountId)).displayName).toBe("שם טיקטוק חדש");
    expect((await accountRow(lapsed.accountId)).status).toBe("expired");
    expect((await postRow(draft.id)).status).toBe("posted");
  });

  it("the orphan net asks TikTok before failing a dead job's post: an upload sitting in the inbox becomes delivered", async () => {
    const { accountId } = await freshAccount();
    const { posts } = await scheduleTiktok([accountId]);
    tiktok.statuses = [{ code: "PROCESSING_UPLOAD" }];
    await lanePass();
    await db
      .update(schema.jobs)
      .set({ status: "dead" })
      .where(eq(schema.jobs.idempotencyKey, `post:${posts[0]!.id}`));
    tiktok.statuses = [{ code: "SEND_TO_USER_INBOX" }];
    expect(await failOrphanedPosts(db)).toBeGreaterThanOrEqual(1);
    expect((await postRow(posts[0]!.id)).status).toBe("delivered");
  });
});
