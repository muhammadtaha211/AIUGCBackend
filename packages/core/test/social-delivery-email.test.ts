import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { runLane } from "../src/jobs/worker";
import { processTiktokEvent, schedulePosts } from "../src/pipelines/social";
import {
  DELIVERY_EMAIL_FRESH_MS,
  sweepPostDeliveryEmails,
} from "../src/pipelines/social-delivery-email";
import {
  FAILURE_EMAIL_DAILY_CEILING,
  POST_DELIVERY_EMAIL,
  POST_FAILURE_EMAIL,
  resetFailureEmailPause,
  sweepPostFailureEmails,
} from "../src/pipelines/social-failure-email";
import {
  EmailSendError,
  setEmailProvider,
  type EmailMessage,
  type EmailProvider,
} from "../src/providers/resend";
import { setTiktokProvider } from "../src/providers/tiktok";
import {
  deliveryEmail,
  TIKTOK_INBOX_PATH,
  TIKTOK_PATH_INBOX,
  TIKTOK_PATH_NOTIFICATION,
  TIKTOK_PATH_SYSTEM,
} from "../src/social-copy";
import { getStorage, setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import {
  connectInstagram,
  connectTiktok,
  FakeMeta,
  FakeTiktok,
  seedOwnerAndBusiness,
  seedReleasedRender,
  socialTestEnv,
} from "./helpers/social";
import { tempStorage } from "./helpers/storage";
import { setMetaGraphProvider } from "../src/providers/meta-graph";

/**
 * The TikTok delivery email (decision 0116): one email when a video reaches the
 * owner's TikTok inbox, whatever moved the post (the webhook or the job's poll),
 * never twice for one post; folded per sweep; the failure email's gate, pause,
 * switch logic and daily ceiling.
 */

class FakeEmail implements EmailProvider {
  sent: EmailMessage[] = [];
  failWith: EmailSendError | Error | undefined;
  async send(message: EmailMessage): Promise<{ id: string }> {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
    return { id: `email_${this.sent.length}` };
  }
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const WORKER = { workerId: "box-1" };

describe("the TikTok delivery email", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let restoreEnv: () => void;
  let storageRoot: string;
  let cleanupStorage: () => void;
  let fake: FakeEmail;
  let tiktok: FakeTiktok;
  let adminId: string;
  let adminBusinessId: string;
  let openSeq = 0;

  beforeAll(async () => {
    restoreEnv = socialTestEnv();
    ({ db, pg } = await createTestDb());
    const temp = tempStorage();
    storageRoot = temp.root;
    cleanupStorage = temp.cleanup;
    setStorage(temp.storage);
    setMetaGraphProvider(new FakeMeta());
    ({ userId: adminId, businessId: adminBusinessId } = await seedOwnerAndBusiness(db, {
      email: "founder@test.local",
      role: "admin",
    }));
  });

  beforeEach(async () => {
    fake = new FakeEmail();
    setEmailProvider(fake);
    tiktok = new FakeTiktok();
    setTiktokProvider(tiktok);
    resetFailureEmailPause();
    await db.delete(schema.events);
    await db.delete(schema.scheduledPosts);
    await db
      .delete(schema.appConfig)
      .where(sql`${schema.appConfig.key} in ('social_posting','tiktok_posting')`);
  });

  afterEach(() => {
    setEmailProvider(undefined);
  });

  afterAll(async () => {
    setTiktokProvider(undefined);
    setMetaGraphProvider(undefined);
    setStorage(undefined);
    cleanupStorage();
    restoreEnv();
    await pg.close();
  });

  async function freshAccount(forUser = adminId): Promise<string> {
    openSeq++;
    return connectTiktok(db, forUser, `tt_delivery_${openSeq}`);
  }

  async function seedRender(businessId = adminBusinessId): Promise<string> {
    const [render] = await db
      .insert(schema.videoRenders)
      .values({ businessId, service: "a", params: { format: "steps" }, status: "released" })
      .returning();
    return render!.id;
  }

  /** A TikTok post already in the inbox — what the sweep reads, without running the job. */
  async function seedDelivered(opts: {
    deliveredAt: Date;
    userId?: string;
    businessId?: string;
    accountId?: string;
    renderId?: string;
    status?: "delivered" | "posted" | "failed" | "cancelled" | "scheduled";
    platform?: "instagram" | "tiktok";
  }): Promise<string> {
    const userId = opts.userId ?? adminId;
    const businessId = opts.businessId ?? adminBusinessId;
    const [row] = await db
      .insert(schema.scheduledPosts)
      .values({
        userId,
        businessId,
        videoRenderId: opts.renderId ?? (await seedRender(businessId)),
        socialAccountId: opts.accountId ?? (await freshAccount(userId)),
        platform: opts.platform ?? "tiktok",
        scheduledAt: new Date(opts.deliveredAt.getTime() - 20_000),
        timezone: "Asia/Jerusalem",
        caption: "",
        status: opts.status ?? "delivered",
        deliveredAt: opts.deliveredAt,
      })
      .returning();
    return row!.id;
  }

  async function deliveryRows() {
    return db.select().from(schema.events).where(eq(schema.events.kind, POST_DELIVERY_EMAIL));
  }

  async function lanePass(): Promise<void> {
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
  }

  async function makeRunnable(): Promise<void> {
    await db.execute(
      sql`update jobs set run_at = now() - interval '1 second' where status = 'queued'`,
    );
  }

  /** Schedules one TikTok post now through the real path and returns its id. */
  async function scheduleThroughTheJob(accountId: string): Promise<string> {
    const render = await seedReleasedRender(db, getStorage(), storageRoot, {
      businessId: adminBusinessId,
    });
    const posts = await schedulePosts(db, {
      userId: adminId,
      videoRenderId: render.id,
      accountIds: [accountId],
      scheduledAt: new Date(),
      timezone: "Asia/Jerusalem",
      caption: "",
      sound: null,
      aiLabel: false,
    });
    await makeRunnable();
    return posts[0]!.id;
  }

  function inboxDelivered(publishId: string): string {
    return JSON.stringify({
      client_key: "ck",
      event: "post.publish.inbox_delivered",
      create_time: Math.floor(Date.now() / 1000) + 2,
      user_openid: "o",
      content: JSON.stringify({ publish_id: publishId, publish_type: "INBOX_SHARE" }),
    });
  }

  const after = (ms: number) => new Date(Date.now() + ms);

  // -------------------------------------------------------------------------
  // Once per post, whatever moved it
  // -------------------------------------------------------------------------

  it("webhook first, then the job's poll: one email for the post, and no second sweep sends again", async () => {
    const accountId = await freshAccount();
    const postId = await scheduleThroughTheJob(accountId);
    tiktok.statuses = [{ code: "PROCESSING_UPLOAD" }];
    await lanePass();
    const publishId = (
      await db.select().from(schema.scheduledPosts).where(eq(schema.scheduledPosts.id, postId))
    )[0]!.providerContainerId!;

    expect(
      (await processTiktokEvent(db, inboxDelivered(publishId))).outcome,
      "the webhook moves the post",
    ).toBe("applied");
    // The job's next run finds it delivered and ends; its poll never moves it again.
    tiktok.statuses = [{ code: "SEND_TO_USER_INBOX" }];
    await makeRunnable();
    await lanePass();

    const result = await sweepPostDeliveryEmails(db, { ...WORKER, now: after(3 * MIN) });
    expect(result).toMatchObject({ sent: 1, refused: 0 });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.text).toContain(`https://tavnit.ai/calendar/${postId}`);
    await sweepPostDeliveryEmails(db, { ...WORKER, now: after(5 * MIN) });
    expect(fake.sent).toHaveLength(1);
  });

  it("the job's poll first, then the webhook: one email for the post", async () => {
    const accountId = await freshAccount();
    const postId = await scheduleThroughTheJob(accountId);
    tiktok.statuses = [{ code: "SEND_TO_USER_INBOX" }];
    await lanePass();
    const row = (
      await db.select().from(schema.scheduledPosts).where(eq(schema.scheduledPosts.id, postId))
    )[0]!;
    expect(row.status).toBe("delivered");

    // TikTok's webhook for the same delivery arrives after the poll already moved it.
    expect(
      (await processTiktokEvent(db, inboxDelivered(row.providerContainerId!))).outcome,
      "the webhook finds nothing left to do",
    ).toBe("ignored");

    await sweepPostDeliveryEmails(db, { ...WORKER, now: after(3 * MIN) });
    await sweepPostDeliveryEmails(db, { ...WORKER, now: after(4 * MIN) });
    expect(fake.sent).toHaveLength(1);
    const rows = await deliveryRows();
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as { postIds: string[] }).postIds).toEqual([postId]);
  });

  it("a video the owner already posted gets no reminder", async () => {
    const now = new Date();
    await seedDelivered({ deliveredAt: new Date(now.getTime() - 10 * MIN), status: "posted" });
    expect(await sweepPostDeliveryEmails(db, { ...WORKER, now })).toMatchObject({ sent: 0 });
    expect(fake.sent).toHaveLength(0);
    expect(await deliveryRows()).toHaveLength(0);
  });

  it("only a delivered TikTok video under 24 h old is due: failed, cancelled, scheduled, Instagram and old ones are not", async () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 10 * MIN);
    await seedDelivered({ deliveredAt: recent, status: "failed" });
    await seedDelivered({ deliveredAt: recent, status: "cancelled" });
    await seedDelivered({ deliveredAt: recent, status: "scheduled" });
    const igAccount = (await connectInstagram(db, adminId))[0]!;
    await seedDelivered({ deliveredAt: recent, platform: "instagram", accountId: igAccount });
    await seedDelivered({ deliveredAt: new Date(now.getTime() - DELIVERY_EMAIL_FRESH_MS - MIN) });
    await sweepPostDeliveryEmails(db, { ...WORKER, now });
    expect(fake.sent).toHaveLength(0);
    expect(await deliveryRows()).toHaveLength(0);
  });

  it("a later video gets its own email that names only itself", async () => {
    const t0 = new Date();
    const first = await seedDelivered({ deliveredAt: new Date(t0.getTime() - 10 * MIN) });
    await sweepPostDeliveryEmails(db, { ...WORKER, now: t0 });
    expect(fake.sent).toHaveLength(1);

    const second = await seedDelivered({ deliveredAt: new Date(t0.getTime() + HOUR) });
    await sweepPostDeliveryEmails(db, { ...WORKER, now: new Date(t0.getTime() + HOUR + 5 * MIN) });
    expect(fake.sent).toHaveLength(2);
    expect(fake.sent[1]!.text).toContain(`/calendar/${second}`);
    expect(fake.sent[1]!.text).not.toContain(first);
    expect(fake.sent[1]!.subject).toBe("הסרטון שלכם מחכה לכם בטיקטוק");
  });

  // -------------------------------------------------------------------------
  // The fold and the settle time
  // -------------------------------------------------------------------------

  it("folds the videos delivered together, across accounts, into one email, oldest first, linking to the calendar", async () => {
    const now = new Date();
    const second = await seedDelivered({ deliveredAt: new Date(now.getTime() - 5 * MIN) });
    const first = await seedDelivered({ deliveredAt: new Date(now.getTime() - 9 * MIN) });
    const third = await seedDelivered({ deliveredAt: new Date(now.getTime() - 3 * MIN) });

    const result = await sweepPostDeliveryEmails(db, { ...WORKER, now });
    expect(result).toMatchObject({ sent: 1, refused: 0, heldByCeiling: 0 });
    expect(fake.sent).toHaveLength(1);
    const [email] = fake.sent;
    expect(email!.subject).toBe("3 סרטונים מחכים לכם בטיקטוק");
    expect(email!.text.match(/^• /gm)).toHaveLength(3);
    expect(email!.text).toContain("https://tavnit.ai/calendar\n");
    expect(email!.text).not.toContain("/calendar/");
    const rows = await deliveryRows();
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as { postIds: string[] }).postIds).toEqual([first, second, third]);
    expect(rows[0]!.payload).toMatchObject({ platform: "tiktok", outcome: "sent" });
    expect(rows[0]!.actorUserId).toBe(adminId);
    // Not an alert kind: the Sentry sweep never sees it.
    expect(rows[0]!.notifiedAt).toBeNull();
  });

  it("waits until the newest video of a batch was delivered 2 minutes ago, then the old and the new go together", async () => {
    const now = new Date();
    await seedDelivered({ deliveredAt: new Date(now.getTime() - 10 * MIN) });
    await seedDelivered({ deliveredAt: new Date(now.getTime() - MIN) });
    await sweepPostDeliveryEmails(db, { ...WORKER, now });
    expect(fake.sent).toHaveLength(0);
    await sweepPostDeliveryEmails(db, { ...WORKER, now: new Date(now.getTime() + 61_000) });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.subject).toBe("2 סרטונים מחכים לכם בטיקטוק");
  });

  it("one account's batch never waits for another's, and each gets its own email", async () => {
    const now = new Date();
    const other = await seedOwnerAndBusiness(db, { email: "other@test.local", role: "admin" });
    await seedDelivered({ deliveredAt: new Date(now.getTime() - 10 * MIN) });
    await seedDelivered({
      deliveredAt: new Date(now.getTime() - 10 * MIN),
      userId: other.userId,
      businessId: other.businessId,
    });
    await seedDelivered({
      deliveredAt: new Date(now.getTime() - 30_000),
      userId: other.userId,
      businessId: other.businessId,
    });
    await sweepPostDeliveryEmails(db, { ...WORKER, now });
    // The founder's settled; the other account's newest is 30 s old, so it waits.
    expect(fake.sent.map((e) => e.to)).toEqual(["founder@test.local"]);
  });

  // -------------------------------------------------------------------------
  // The switch, the gate, the ceiling, the pause
  // -------------------------------------------------------------------------

  it("a TikTok switch that no longer includes the account leaves no email and no row; Instagram's switch does not matter", async () => {
    const customer = await seedOwnerAndBusiness(db, { email: "customer@test.local" });
    const now = new Date();
    await seedDelivered({
      deliveredAt: new Date(now.getTime() - 10 * MIN),
      userId: customer.userId,
      businessId: customer.businessId,
    });
    const set = async (key: string, value: unknown) =>
      db
        .insert(schema.appConfig)
        .values({ key, value })
        .onConflictDoUpdate({ target: schema.appConfig.key, set: { value } });

    // Instagram open to everyone, TikTok to nobody in particular.
    await set("social_posting", { access: "everyone" });
    await sweepPostDeliveryEmails(db, { ...WORKER, now });
    expect(fake.sent).toHaveLength(0);
    expect(await deliveryRows()).toHaveLength(0);

    // TikTok names the account: the same video now goes out.
    await set("tiktok_posting", { access: "named", userIds: [customer.userId] });
    await sweepPostDeliveryEmails(db, { ...WORKER, now: new Date(now.getTime() + MIN) });
    expect(fake.sent.map((e) => e.to)).toEqual(["customer@test.local"]);
  });

  it("sends nothing and writes nothing without a Resend key", async () => {
    setEmailProvider(undefined);
    const saved = { key: process.env.RESEND_API_KEY, dry: process.env.DRY_RUN };
    delete process.env.RESEND_API_KEY;
    process.env.DRY_RUN = "0";
    resetEnvCache();
    try {
      const now = new Date();
      await seedDelivered({ deliveredAt: new Date(now.getTime() - 10 * MIN) });
      const result = await sweepPostDeliveryEmails(db, { ...WORKER, now });
      expect(result).toMatchObject({ off: "no_provider", sent: 0 });
      expect(await deliveryRows()).toHaveLength(0);
    } finally {
      if (saved.key !== undefined) process.env.RESEND_API_KEY = saved.key;
      process.env.DRY_RUN = saved.dry;
      resetEnvCache();
    }
  });

  it("counts against the failure email's daily ceiling, over both kinds, and goes out after UTC midnight", async () => {
    const now = new Date(Date.UTC(2026, 9, 17, 23, 30));
    const user = adminId;
    const at = (n: number) => new Date(now.getTime() - n * MIN);
    // Twelve failure emails and eight delivery emails already went out today.
    for (let i = 0; i < 12; i++) {
      await db.insert(schema.events).values({
        kind: POST_FAILURE_EMAIL,
        actorUserId: user,
        payload: {
          failureKind: "internal_error",
          platform: "tiktok",
          postIds: [],
          outcome: "sent",
        },
        createdAt: at(120 + i),
      });
    }
    for (let i = 0; i < FAILURE_EMAIL_DAILY_CEILING - 12; i++) {
      await db.insert(schema.events).values({
        kind: POST_DELIVERY_EMAIL,
        actorUserId: user,
        payload: { platform: "tiktok", postIds: [], outcome: "sent" },
        createdAt: at(100 + i),
      });
    }
    const held = await seedDelivered({ deliveredAt: at(10) });

    const blocked = await sweepPostDeliveryEmails(db, { ...WORKER, now });
    expect(blocked).toMatchObject({ sent: 0, heldByCeiling: 1 });
    expect(fake.sent).toHaveLength(0);

    // UTC midnight resets the day; the video is still unfinished and 55 minutes old.
    const midnight = new Date(Date.UTC(2026, 9, 18, 0, 25));
    const released = await sweepPostDeliveryEmails(db, { ...WORKER, now: midnight });
    expect(released).toMatchObject({ sent: 1, heldByCeiling: 0 });
    expect(fake.sent[0]!.text).toContain(held);
    // And what it sent spends the new day's ceiling, as a failure email would have.
    const [today] = await db
      .select({ n: sql<string>`count(*)` })
      .from(schema.events)
      .where(
        sql`${schema.events.kind} = ${POST_DELIVERY_EMAIL}
          and ${schema.events.payload}->>'outcome' = 'sent'
          and ${schema.events.createdAt} >= ${new Date(Date.UTC(2026, 9, 18))}`,
      );
    expect(Number(today!.n)).toBe(1);
  });

  it("a delivery email spends the ceiling a failure email then finds spent", async () => {
    const now = new Date();
    for (let i = 0; i < FAILURE_EMAIL_DAILY_CEILING - 1; i++) {
      await db.insert(schema.events).values({
        kind: POST_DELIVERY_EMAIL,
        actorUserId: adminId,
        payload: { platform: "tiktok", postIds: [], outcome: "sent" },
        createdAt: now,
      });
    }
    await seedDelivered({ deliveredAt: new Date(now.getTime() - 10 * MIN) });
    expect(await sweepPostDeliveryEmails(db, { ...WORKER, now })).toMatchObject({ sent: 1 });

    // The 20th is gone: a failure email for a failed post is now held.
    const render = await seedRender();
    await db.insert(schema.scheduledPosts).values({
      userId: adminId,
      businessId: adminBusinessId,
      videoRenderId: render,
      socialAccountId: await freshAccount(),
      platform: "tiktok",
      scheduledAt: new Date(now.getTime() - 20 * MIN),
      timezone: "Asia/Jerusalem",
      caption: "",
      status: "failed",
      failureKind: "platform_refused",
      failedAt: new Date(now.getTime() - 10 * MIN),
    });
    const failure = await sweepPostFailureEmails(db, { ...WORKER, now });
    expect(failure).toMatchObject({ sent: 0, heldByCeiling: 1 });
  });

  it("a refusal Resend will never take is logged and not retried; a 409 on the key counts as sent", async () => {
    const now = new Date();
    const postId = await seedDelivered({ deliveredAt: new Date(now.getTime() - 10 * MIN) });
    fake.failWith = new EmailSendError("resend 422", 422, "validation_error", false, false);
    expect(await sweepPostDeliveryEmails(db, { ...WORKER, now })).toMatchObject({
      sent: 0,
      refused: 1,
    });
    fake.failWith = undefined;
    await sweepPostDeliveryEmails(db, { ...WORKER, now: new Date(now.getTime() + 5 * MIN) });
    expect(fake.sent).toHaveLength(0);
    const rows = await deliveryRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ outcome: "refused", postIds: [postId] });

    await db.delete(schema.events);
    await db.delete(schema.scheduledPosts);
    await seedDelivered({ deliveredAt: new Date(now.getTime() - 10 * MIN) });
    fake.failWith = new EmailSendError(
      "resend 409 invalid_idempotent_request",
      409,
      "invalid_idempotent_request",
      false,
      false,
    );
    expect(await sweepPostDeliveryEmails(db, { ...WORKER, now })).toMatchObject({ sent: 1 });
    expect((await deliveryRows())[0]!.payload).toMatchObject({
      outcome: "sent",
      resendId: "idempotent-replay",
    });
  });

  it("a 401 or 403 pauses the sweep an hour and writes no row; the video goes out once fixed", async () => {
    const now = new Date();
    await seedDelivered({ deliveredAt: new Date(now.getTime() - 10 * MIN) });
    fake.failWith = new EmailSendError(
      "resend 403 validation_error",
      403,
      "validation_error",
      false,
      false,
      true,
    );
    await sweepPostDeliveryEmails(db, { ...WORKER, now });
    expect(await deliveryRows()).toHaveLength(0);
    fake.failWith = undefined;
    expect(
      (await sweepPostDeliveryEmails(db, { ...WORKER, now: new Date(now.getTime() + 30 * MIN) }))
        .off,
    ).toBe("paused");
    await sweepPostDeliveryEmails(db, { ...WORKER, now: new Date(now.getTime() + 61 * MIN) });
    expect(fake.sent).toHaveLength(1);
  });

  it("a pause the failure sweep sets holds the delivery sweep back in the same tick", async () => {
    const now = new Date();
    await seedDelivered({ deliveredAt: new Date(now.getTime() - 10 * MIN) });
    const render = await seedRender();
    await db.insert(schema.scheduledPosts).values({
      userId: adminId,
      businessId: adminBusinessId,
      videoRenderId: render,
      socialAccountId: await freshAccount(),
      platform: "tiktok",
      scheduledAt: new Date(now.getTime() - 20 * MIN),
      timezone: "Asia/Jerusalem",
      caption: "",
      status: "failed",
      failureKind: "platform_refused",
      failedAt: new Date(now.getTime() - 10 * MIN),
    });
    fake.failWith = new EmailSendError("resend 401", 401, "restricted_api_key", false, false, true);
    await sweepPostFailureEmails(db, { ...WORKER, now });
    expect((await sweepPostDeliveryEmails(db, { ...WORKER, now })).off).toBe("paused");
    expect(await deliveryRows()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // What the email says
  // -------------------------------------------------------------------------

  it("names the video, the account, the path inside TikTok and the page, never a caption or a diagnostic", async () => {
    const now = new Date();
    const postId = await seedDelivered({ deliveredAt: new Date(now.getTime() - 10 * MIN) });
    await sweepPostDeliveryEmails(db, { ...WORKER, now });
    const [email] = fake.sent;
    expect(email!.to).toBe("founder@test.local");
    expect(email!.subject).toBe("הסרטון שלכם מחכה לכם בטיקטוק");
    for (const body of [email!.text, email!.html]) {
      expect(body).toContain("הסרטון הזה הגיע לטיקטוק:");
      expect(body).toContain("סרטון הוק + דמו של");
      expect(body).toContain("חשבון טיקטוק");
      expect(body).toContain("בטיקטוק");
      expect(body).toContain(TIKTOK_PATH_INBOX);
      expect(body).toContain(TIKTOK_PATH_SYSTEM);
      expect(body).toContain(TIKTOK_PATH_NOTIFICATION);
      expect(body).toContain("Your content from Tavnit is ready");
      expect(body).toContain("סרטון שלא הושלם בטיקטוק חוסם שליחה של סרטונים חדשים");
      expect(body).not.toMatch(/טיוט|Drafts?/i);
    }
    expect(email!.text).toContain(`https://tavnit.ai/calendar/${postId}\n`);
    expect(email!.html).toContain(`href="https://tavnit.ai/calendar/${postId}"`);
    expect(email!.html).toContain("לפרסום");
    expect(email!.text).toContain("הדף נפתח אחרי כניסה לחשבון בתבנית.");
    expect(email!.text).toMatch(/^1\. /m);
    expect(email!.text).toMatch(/^3\. /m);
    expect(email!.html).toContain("<ol");
    // The key moves with the account and the oldest video, never with the burst.
    expect(await deliveryRows()).toHaveLength(1);
  });

  it("the same three phrases, joined by arrows, are the path every screen prints", () => {
    expect(TIKTOK_INBOX_PATH).toBe(
      [TIKTOK_PATH_INBOX, TIKTOK_PATH_SYSTEM, TIKTOK_PATH_NOTIFICATION].join(" ← "),
    );
    // Hebrew and English side by side: owners run TikTok in either language.
    expect(TIKTOK_PATH_INBOX).toMatch(/^תיבת דואר נכנס \(.*Inbox.*\)$/u);
    expect(TIKTOK_PATH_SYSTEM).toMatch(/^התראות מערכת \(.*System Notifications.*\)$/u);
    expect(TIKTOK_PATH_NOTIFICATION).toContain("“Your content from Tavnit is ready”");
  });

  it("lists ten and counts the rest; a name with markup is escaped in the HTML", () => {
    const posts = Array.from({ length: 12 }, (_, i) => ({
      postId: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`,
      renderId: `r${i}`,
      accountId: `a${i % 2}`,
      service: "a" as const,
      businessName: i === 0 ? "<b>עסק</b> & Co" : "עסק",
      accountName: "@yoga_studio",
      platform: "tiktok" as const,
      when: "יום שישי, 17 באוקטובר, 10:00",
    }));
    const email = deliveryEmail({ posts });
    expect(email.subject).toBe("12 סרטונים מחכים לכם בטיקטוק");
    expect(email.text.match(/^• /gm)).toHaveLength(10);
    expect(email.text).toContain("ועוד 2.");
    expect(email.text).toContain("כדי להשלים אותם, בטיקטוק פותחים:");
    expect(email.text).toContain("סרטונים שלא הושלמו בטיקטוק חוסמים שליחה של סרטונים חדשים");
    expect(email.html).toContain("&lt;b&gt;עסק&lt;/b&gt; &amp; Co");
    expect(email.html).not.toContain("<b>עסק</b>");
    expect(email.html).toContain('href="https://tavnit.ai/calendar"');
    expect(email.html).toContain("ללוח הפרסומים");
  });
});
