import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { enqueue } from "../src/jobs/queue";
import { runLane } from "../src/jobs/worker";
import { buildHandlers } from "../src/handlers";
import {
  disconnectSocialAccount,
  getInstagramConnectMode,
  getMetaDataDeletionStatus,
  getPostingAccess,
  listSocialAccounts,
  openAccountTokens,
  processMetaDataDeletion,
  schedulePosts,
  SocialSchedulingError,
  upsertInstagramConnections,
} from "../src/pipelines/social";
import { setMetaGraphProvider } from "../src/providers/meta-graph";
import { setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import {
  connectInstagram,
  FakeMeta,
  samplePage,
  seedOwnerAndBusiness,
  seedReleasedRender,
  socialTestEnv,
  tokenLapse,
} from "./helpers/social";
import { tempStorage } from "./helpers/storage";

/**
 * Connections (decision 0101): a Facebook round trip upserts every Instagram
 * account in place and seals both tokens; a view never carries one;
 * disconnect erases tokens and cancels pending posts; the daily check marks a
 * lapsed token expired and refreshes a good account's picture; Meta's deletion
 * callback erases by Facebook user; the switch hides everything from a
 * customer unless the founder names the account or opens it to everyone.
 */
describe("social accounts", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let restoreEnv: () => void;
  let storageRoot: string;
  let cleanupStorage: () => void;
  let userId: string;
  let businessId: string;
  let meta: FakeMeta;

  beforeAll(async () => {
    restoreEnv = socialTestEnv();
    ({ db, pg } = await createTestDb());
    const temp = tempStorage();
    storageRoot = temp.root;
    cleanupStorage = temp.cleanup;
    setStorage(temp.storage);
    ({ userId, businessId } = await seedOwnerAndBusiness(db));
  });

  beforeEach(() => {
    meta = new FakeMeta();
    setMetaGraphProvider(meta);
  });

  afterAll(async () => {
    setMetaGraphProvider(undefined);
    setStorage(undefined);
    cleanupStorage();
    restoreEnv();
    await pg.close();
  });

  async function rawAccount(id: string) {
    return (
      await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, id))
    )[0]!;
  }

  it("connects every Page with an Instagram account, seals both tokens, and a reconnect restores the row in place", async () => {
    const ids = await connectInstagram(db, userId, [
      samplePage("ig_a", "a"),
      samplePage("ig_b", "b"),
    ]);
    expect(ids).toHaveLength(2);
    const a = await rawAccount(ids[0]!);
    expect(a.status).toBe("connected");
    expect(a.pageId).toBe("page_ig_a");
    expect(a.fbUserId).toBe("fb_user_1");
    // Sealed, never the clear text.
    expect(a.accessTokenEnc).not.toContain("PAGE_TOKEN");
    expect(a.userTokenEnc).not.toContain("USER_TOKEN");
    expect(openAccountTokens(a)).toEqual({
      accessToken: "PAGE_TOKEN_ig_a",
      userToken: "USER_TOKEN",
    });

    // Expire it by hand, then reconnect with a new Page token: same row, renewed.
    await db
      .update(schema.socialAccounts)
      .set({ status: "expired", lastError: "190" })
      .where(eq(schema.socialAccounts.id, a.id));
    const again = await upsertInstagramConnections(db, {
      userId,
      fbUserId: "fb_user_1",
      userToken: "USER_TOKEN_2",
      userTokenExpiresAt: new Date(Date.now() + 86_400_000),
      pages: [{ ...samplePage("ig_a", "a"), pageToken: "PAGE_TOKEN_ig_a_v2" }],
    });
    expect(again[0]!.id).toBe(a.id);
    const restored = await rawAccount(a.id);
    expect(restored.status).toBe("connected");
    expect(restored.lastError).toBeNull();
    expect(openAccountTokens(restored).accessToken).toBe("PAGE_TOKEN_ig_a_v2");
    const all = await db
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.userId, userId));
    expect(all).toHaveLength(2);
  });

  it("lists the live accounts with their pending-post counts and no token anywhere in the view", async () => {
    const views = await listSocialAccounts(db, userId);
    expect(views.map((v) => v.externalId).sort()).toEqual(["ig_a", "ig_b"]);
    for (const view of views) {
      expect(JSON.stringify(view)).not.toMatch(/TOKEN/);
      expect(view.canSearchSounds).toBe(true);
      expect(view.pendingPosts).toBe(0);
    }
  });

  it("disconnect erases every token, keeps the row, cancels every post it can still call back — the number its confirm promised — and says how many", async () => {
    const { storage } = { storage: (await import("../src/storage")).getStorage() };
    const render = await seedReleasedRender(db, storage, storageRoot, { businessId });
    const [b] = (await listSocialAccounts(db, userId)).filter((v) => v.externalId === "ig_b");
    const schedule = async (hours: number) =>
      (
        await schedulePosts(db, {
          userId,
          videoRenderId: render.id,
          accountIds: [b!.id],
          scheduledAt: new Date(Date.now() + hours * 3_600_000),
          timezone: "Asia/Jerusalem",
          caption: "",
        })
      )[0]!;
    const posts = [await schedule(1)];
    // Waiting out Instagram's quota: publishing, nothing at Meta yet — cancellable.
    const deferred = await schedule(2);
    await db
      .update(schema.scheduledPosts)
      .set({ status: "publishing", deferredUntil: new Date(Date.now() + 3_600_000) })
      .where(eq(schema.scheduledPosts.id, deferred.id));
    // Already at Meta: a container exists, so it cannot be called back.
    const inFlight = await schedule(3);
    await db
      .update(schema.scheduledPosts)
      .set({ status: "publishing", providerContainerId: "container_x" })
      .where(eq(schema.scheduledPosts.id, inFlight.id));

    const [before] = (await listSocialAccounts(db, userId)).filter((v) => v.id === b!.id);
    expect(before!.pendingPosts).toBe(2);
    const result = await disconnectSocialAccount(db, { userId, accountId: b!.id });
    expect(result.cancelled).toBe(before!.pendingPosts);
    const statusOf = async (id: string) =>
      (
        await db
          .select({
            status: schema.scheduledPosts.status,
            deferredUntil: schema.scheduledPosts.deferredUntil,
          })
          .from(schema.scheduledPosts)
          .where(eq(schema.scheduledPosts.id, id))
      )[0]!;
    expect(await statusOf(deferred.id)).toEqual({ status: "cancelled", deferredUntil: null });
    expect((await statusOf(inFlight.id)).status).toBe("publishing");
    const row = await rawAccount(b!.id);
    expect(row.status).toBe("disconnected");
    expect(row.accessTokenEnc).toBeNull();
    expect(row.userTokenEnc).toBeNull();
    expect(row.disconnectedAt).not.toBeNull();
    const post = (
      await db
        .select()
        .from(schema.scheduledPosts)
        .where(eq(schema.scheduledPosts.id, posts[0]!.id))
    )[0]!;
    expect(post.status).toBe("cancelled");
    // The job stays; it will see the cancelled row and no-op (social-publish.test.ts).
    expect((await listSocialAccounts(db, userId)).map((v) => v.externalId)).toEqual(["ig_a"]);
    // A second disconnect, or someone else's account, is not found.
    await expect(disconnectSocialAccount(db, { userId, accountId: b!.id })).rejects.toThrow(
      SocialSchedulingError,
    );
  });

  it("the daily check marks a lapsed Page token expired and refreshes a good account's name and picture", async () => {
    const ids = await connectInstagram(db, userId, [
      samplePage("ig_c", "c"),
      samplePage("ig_d", "d"),
    ]);
    meta.profileByAccount["ig_c"] = tokenLapse();
    meta.profileByAccount["ig_d"] = {
      username: "fresh",
      name: "שם מעודכן",
      pictureUrl: "https://cdn/fresh.jpg",
    };

    await enqueue(db, { type: "check_social_tokens", idempotencyKey: "check_social_tokens:test" });
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });

    const c = await rawAccount(ids[0]!);
    expect(c.status).toBe("expired");
    expect(c.lastError).toMatch(/190/);
    const d = await rawAccount(ids[1]!);
    expect(d.status).toBe("connected");
    expect(d.username).toBe("fresh");
    expect(d.pictureUrl).toBe("https://cdn/fresh.jpg");
    const job = (
      await db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.idempotencyKey, "check_social_tokens:test"))
    )[0]!;
    expect(job.status).toBe("succeeded");
  });

  it("Meta's deletion callback erases every connection of that Facebook user, cancels their pending posts, and answers a status code", async () => {
    const storage = (await import("../src/storage")).getStorage();
    const render = await seedReleasedRender(db, storage, storageRoot, { businessId });
    const live = await listSocialAccounts(db, userId);
    const connected = live.filter((v) => v.status === "connected");
    expect(connected.length).toBeGreaterThan(0);
    await schedulePosts(db, {
      userId,
      videoRenderId: render.id,
      accountIds: [connected[0]!.id],
      scheduledAt: new Date(Date.now() + 3_600_000),
      timezone: "Asia/Jerusalem",
      caption: "",
    });

    // The account disconnected by the earlier test kept its name and picture
    // for post history; Meta's request is for those too.
    const disconnected = (
      await db
        .select()
        .from(schema.socialAccounts)
        .where(eq(schema.socialAccounts.status, "disconnected"))
    ).filter((r) => r.fbUserId === "fb_user_1");
    expect(disconnected).toHaveLength(1);
    expect(disconnected[0]!.username).not.toBeNull();

    const result = await processMetaDataDeletion(db, { fbUserId: "fb_user_1" });
    expect(result.accounts).toBe(live.length + disconnected.length);
    expect(result.cancelled).toBe(1);
    const rows = await db
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.fbUserId, "fb_user_1"));
    for (const row of rows) {
      expect(row.status).toBe("deleted");
      expect(row.accessTokenEnc).toBeNull();
      expect(row.userTokenEnc).toBeNull();
      expect(row.username).toBeNull();
      expect(row.displayName).toBeNull();
      expect(row.pictureUrl).toBeNull();
      expect(row.pageName).toBeNull();
    }
    // A row disconnected earlier keeps the date it was disconnected.
    const again = rows.find((r) => r.id === disconnected[0]!.id)!;
    expect(again.disconnectedAt!.getTime()).toBe(disconnected[0]!.disconnectedAt!.getTime());
    expect(await listSocialAccounts(db, userId)).toEqual([]);
    const status = await getMetaDataDeletionStatus(db, result.confirmationCode);
    expect(status).toMatchObject({ accounts: live.length + disconnected.length, cancelled: 1 });
    expect(await getMetaDataDeletionStatus(db, "nope")).toBeUndefined();
    // A second request for the same user finds nothing live and still answers.
    expect((await processMetaDataDeletion(db, { fbUserId: "fb_user_1" })).accounts).toBe(0);
  });

  it("the switch: admins always; a named account under `named`, an unnamed customer hidden; everyone; a malformed row hides", async () => {
    const setSwitch = (value: string) =>
      db.execute(
        sql`insert into app_config (key, value) values ('social_posting', ${value}::jsonb)
            on conflict (key) do update set value = excluded.value`,
      );
    const admin = await seedOwnerAndBusiness(db, { email: "admin@test.local", role: "admin" });
    const reviewer = await seedOwnerAndBusiness(db, { email: "reviewer@test.local" });

    // Absent row = admins only.
    expect(await getPostingAccess(db, userId)).toBe("hidden");
    expect(await getPostingAccess(db, reviewer.userId)).toBe("hidden");
    expect(await getPostingAccess(db, admin.userId)).toBe("allowed");

    await setSwitch(JSON.stringify({ access: "named", userIds: [reviewer.userId.toUpperCase()] }));
    expect(await getPostingAccess(db, reviewer.userId)).toBe("allowed");
    expect(await getPostingAccess(db, userId)).toBe("hidden");
    expect(await getPostingAccess(db, admin.userId)).toBe("allowed");

    await setSwitch('{"access":"everyone"}');
    expect(await getPostingAccess(db, userId)).toBe("allowed");
    expect(await getPostingAccess(db, reviewer.userId)).toBe("allowed");

    await setSwitch('{"access":"admins"}');
    expect(await getPostingAccess(db, userId)).toBe("hidden");
    expect(await getPostingAccess(db, reviewer.userId)).toBe("hidden");

    // A typo is not an error page: hidden for everyone but the admins.
    for (const bad of [
      '{"access":"named"}',
      '{"access":"evryone"}',
      '{"access":"named","userIds":["not-a-uuid"]}',
      '"on"',
    ]) {
      await setSwitch(bad);
      expect(await getPostingAccess(db, reviewer.userId)).toBe("hidden");
      expect(await getPostingAccess(db, admin.userId)).toBe("allowed");
    }
    await db.execute(sql`delete from app_config where key = 'social_posting'`);
  });

  it("the connect mode: absent is today's connect; \"onboarding\" turns Meta's one-window setup on; a typo is today's connect", async () => {
    const setMode = (value: string) =>
      db.execute(
        sql`insert into app_config (key, value) values ('instagram_connect', ${value}::jsonb)
            on conflict (key) do update set value = excluded.value`,
      );
    expect(await getInstagramConnectMode(db)).toBe("standard");
    await setMode('"onboarding"');
    expect(await getInstagramConnectMode(db)).toBe("onboarding");
    await setMode('"standard"');
    expect(await getInstagramConnectMode(db)).toBe("standard");
    for (const bad of ['"Onboarding"', '{"mode":"onboarding"}', "true", "null"]) {
      await setMode(bad);
      expect(await getInstagramConnectMode(db)).toBe("standard");
    }
    await db.execute(sql`delete from app_config where key = 'instagram_connect'`);
    expect(await getInstagramConnectMode(db)).toBe("standard");
  });
});
