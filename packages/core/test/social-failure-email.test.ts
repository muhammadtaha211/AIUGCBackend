import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { postingNotices } from "../src/pipelines/social";
import {
  FAILURE_EMAIL_DAILY_CEILING,
  failureEmailState,
  POST_FAILURE_EMAIL,
  resetFailureEmailPause,
  sweepPostFailureEmails,
} from "../src/pipelines/social-failure-email";
import {
  EmailSendError,
  getEmailProvider,
  setEmailProvider,
  type EmailMessage,
  type EmailProvider,
} from "../src/providers/resend";
import { createTestDb } from "./helpers/pglite";
import {
  connectInstagram,
  samplePage,
  seedOwnerAndBusiness,
  socialTestEnv,
} from "./helpers/social";

/**
 * The failure email (decision 0107): one cause, one email; 24 h of cooldown and
 * folding; a 2-minute quiet; only failures under 24 h old; 20 a UTC day; a send
 * that fails touches no post; no key, a dry run or a developer machine against
 * production sends nothing and writes nothing.
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

describe("the post-failure email", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let restoreEnv: () => void;
  let fake: FakeEmail;
  let adminId: string;
  let adminBusinessId: string;
  let adminAccountId: string;
  let adminRenderId: string;

  async function seedRender(businessId: string, service: "a" | "b" | "c" = "a"): Promise<string> {
    const [render] = await db
      .insert(schema.videoRenders)
      .values({ businessId, service, params: { format: "steps" }, status: "released" })
      .returning();
    return render!.id;
  }

  async function seedFailed(opts: {
    userId?: string;
    businessId?: string;
    accountId?: string;
    renderId?: string;
    kind?: string;
    failedAt: Date;
  }): Promise<string> {
    const [row] = await db
      .insert(schema.scheduledPosts)
      .values({
        userId: opts.userId ?? adminId,
        businessId: opts.businessId ?? adminBusinessId,
        videoRenderId: opts.renderId ?? adminRenderId,
        socialAccountId: opts.accountId ?? adminAccountId,
        platform: "instagram",
        scheduledAt: new Date(opts.failedAt.getTime() - MIN),
        timezone: "Asia/Jerusalem",
        caption: "כיתוב פרטי של הלקוח",
        status: "failed",
        failureKind: opts.kind ?? "connection_expired",
        failureDetail: "code 190 Session has expired",
        failedAt: opts.failedAt,
      })
      .returning();
    return row!.id;
  }

  async function emailRows() {
    return db.select().from(schema.events).where(eq(schema.events.kind, POST_FAILURE_EMAIL));
  }

  beforeAll(async () => {
    restoreEnv = socialTestEnv();
    ({ db, pg } = await createTestDb());
    ({ userId: adminId, businessId: adminBusinessId } = await seedOwnerAndBusiness(db, {
      email: "founder@test.local",
      role: "admin",
    }));
    adminAccountId = (await connectInstagram(db, adminId))[0]!;
    adminRenderId = await seedRender(adminBusinessId);
  });

  beforeEach(async () => {
    fake = new FakeEmail();
    setEmailProvider(fake);
    resetFailureEmailPause();
    await db.delete(schema.events);
    await db.delete(schema.scheduledPosts);
  });

  afterEach(() => setEmailProvider(undefined));

  afterAll(async () => {
    restoreEnv();
    await pg.close();
  });

  it("sends one email for posts that failed from one cause, naming each and never the caption or the diagnostic", async () => {
    const now = new Date();
    await seedFailed({ failedAt: new Date(now.getTime() - 10 * MIN) });
    await seedFailed({ failedAt: new Date(now.getTime() - 9 * MIN) });
    await seedFailed({ failedAt: new Date(now.getTime() - 8 * MIN) });

    const result = await sweepPostFailureEmails(db, { ...WORKER, now });
    expect(result).toMatchObject({ sent: 1, refused: 0 });
    expect(fake.sent).toHaveLength(1);
    const [email] = fake.sent;
    expect(email!.to).toBe("founder@test.local");
    expect(email!.subject).toBe("3 פרסומים שתוזמנו בתבנית נכשלו");
    expect(email!.text).toContain("החיבור לחשבון פג. התחברו מחדש בהגדרות ותזמנו שוב.");
    // The calendar is /calendar (app/(posting)), never under /home.
    expect(email!.text).toContain("https://tavnit.ai/calendar\n");
    expect(email!.html).toContain('href="https://tavnit.ai/calendar"');
    expect(email!.html).toContain("ללוח הפרסומים");
    expect(email!.text).toContain("כל הפרטים, ואפשרות לתזמן שוב, בלוח הפרסומים:");
    expect(email!.text).toContain("הלוח נפתח אחרי כניסה לחשבון בתבנית.");
    expect(email!.text.match(/^• /gm)).toHaveLength(3);
    for (const body of [email!.text, email!.html]) {
      expect(body).not.toContain("כיתוב פרטי של הלקוח");
      expect(body).not.toContain("Session has expired");
    }

    const rows = await emailRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorUserId).toBe(adminId);
    expect(rows[0]!.payload).toMatchObject({ failureKind: "connection_expired", outcome: "sent" });
    expect((rows[0]!.payload as { postIds: string[] }).postIds).toHaveLength(3);
    // Not an alert kind: the Sentry sweep never sees it.
    expect(rows[0]!.notifiedAt).toBeNull();

    // A second tick sends nothing more.
    await sweepPostFailureEmails(db, { ...WORKER, now: new Date(now.getTime() + MIN) });
    expect(fake.sent).toHaveLength(1);
  });

  it("a second cause sends its own email", async () => {
    const now = new Date();
    await seedFailed({ kind: "connection_expired", failedAt: new Date(now.getTime() - 10 * MIN) });
    await seedFailed({ kind: "platform_refused", failedAt: new Date(now.getTime() - 10 * MIN) });
    const result = await sweepPostFailureEmails(db, { ...WORKER, now });
    expect(result.sent).toBe(2);
    expect(fake.sent.map((e) => e.subject)).toEqual([
      "פרסום שתוזמן בתבנית נכשל",
      "פרסום שתוזמן בתבנית נכשל",
    ]);
    expect(fake.sent.some((e) => e.text.includes("אינסטגרם לא קיבלה את הסרטון."))).toBe(true);
  });

  it("waits until the newest failure of a cause is 2 minutes old", async () => {
    const now = new Date();
    await seedFailed({ failedAt: new Date(now.getTime() - 10 * MIN) });
    await seedFailed({ failedAt: new Date(now.getTime() - MIN) });
    await sweepPostFailureEmails(db, { ...WORKER, now });
    expect(fake.sent).toHaveLength(0);
    await sweepPostFailureEmails(db, { ...WORKER, now: new Date(now.getTime() + 61_000) });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.subject).toBe("2 פרסומים שתוזמנו בתבנית נכשלו");
  });

  it("folds a later failure of the same cause inside 24 h: no second email, and none once the 24 h are over", async () => {
    const t0 = new Date();
    await seedFailed({ failedAt: new Date(t0.getTime() - 5 * MIN) });
    await sweepPostFailureEmails(db, { ...WORKER, now: t0 });
    expect(fake.sent).toHaveLength(1);

    await seedFailed({ failedAt: new Date(t0.getTime() + HOUR) });
    await sweepPostFailureEmails(db, { ...WORKER, now: new Date(t0.getTime() + HOUR + 5 * MIN) });
    expect(fake.sent).toHaveLength(1);
    // The cooldown is over, the folded failure still under 24 h old: still not sent.
    await sweepPostFailureEmails(db, { ...WORKER, now: new Date(t0.getTime() + 24 * HOUR + MIN) });
    expect(fake.sent).toHaveLength(1);

    // A failure after the 24 h starts a new email.
    await seedFailed({ failedAt: new Date(t0.getTime() + 25 * HOUR) });
    await sweepPostFailureEmails(db, {
      ...WORKER,
      now: new Date(t0.getTime() + 25 * HOUR + 5 * MIN),
    });
    expect(fake.sent).toHaveLength(2);
    expect(fake.sent[1]!.subject).toBe("פרסום שתוזמן בתבנית נכשל");
  });

  it("never emails a failure more than 24 h old", async () => {
    const now = new Date();
    await seedFailed({ failedAt: new Date(now.getTime() - 25 * HOUR) });
    const result = await sweepPostFailureEmails(db, { ...WORKER, now });
    expect(result.sent).toBe(0);
    expect(fake.sent).toHaveLength(0);
    expect(await emailRows()).toHaveLength(0);
  });

  it("holds at 20 a UTC day, and the held failure goes out after midnight UTC while it is under 24 h old", async () => {
    // 21:00 UTC, so midnight is three hours away.
    const now = new Date(Date.UTC(2026, 9, 12, 21, 0, 0));
    await db.insert(schema.events).values(
      Array.from({ length: FAILURE_EMAIL_DAILY_CEILING }, () => ({
        kind: POST_FAILURE_EMAIL,
        actorUserId: adminId,
        payload: { failureKind: "file_missing", postIds: [], outcome: "sent" },
        createdAt: new Date(Date.UTC(2026, 9, 12, 1, 0, 0)),
      })),
    );
    await seedFailed({ kind: "platform_timeout", failedAt: new Date(now.getTime() - 10 * MIN) });

    const held = await sweepPostFailureEmails(db, { ...WORKER, now });
    expect(held).toMatchObject({ sent: 0, heldByCeiling: 1 });
    expect(fake.sent).toHaveLength(0);

    const afterMidnight = new Date(Date.UTC(2026, 9, 13, 0, 1, 0));
    const next = await sweepPostFailureEmails(db, { ...WORKER, now: afterMidnight });
    expect(next.sent).toBe(1);
    expect(fake.sent).toHaveLength(1);
  });

  it("the ceiling counts only what was sent today, and holds within one tick", async () => {
    const now = new Date(Date.UTC(2026, 9, 12, 12, 0, 0));
    // Yesterday's sends and today's refusals do not count.
    await db.insert(schema.events).values([
      ...Array.from({ length: 5 }, () => ({
        kind: POST_FAILURE_EMAIL,
        actorUserId: adminId,
        payload: { failureKind: "x", postIds: [], outcome: "sent" },
        createdAt: new Date(Date.UTC(2026, 9, 11, 23, 0, 0)),
      })),
      ...Array.from({ length: 5 }, () => ({
        kind: POST_FAILURE_EMAIL,
        actorUserId: adminId,
        payload: { failureKind: "y", postIds: [], outcome: "refused", error: "validation_error" },
        createdAt: new Date(Date.UTC(2026, 9, 12, 1, 0, 0)),
      })),
      ...Array.from({ length: FAILURE_EMAIL_DAILY_CEILING - 1 }, () => ({
        kind: POST_FAILURE_EMAIL,
        actorUserId: adminId,
        payload: { failureKind: "z", postIds: [], outcome: "sent" },
        createdAt: new Date(Date.UTC(2026, 9, 12, 2, 0, 0)),
      })),
    ]);
    // Three causes due, one slot left.
    for (const kind of ["platform_timeout", "file_missing", "internal_error"]) {
      await seedFailed({ kind, failedAt: new Date(now.getTime() - 10 * MIN) });
    }
    const result = await sweepPostFailureEmails(db, { ...WORKER, now });
    expect(result).toMatchObject({ sent: 1, heldByCeiling: 2 });
    expect(fake.sent).toHaveLength(1);
  });

  it("a send that fails leaves the post's outcome and the in-app notice exactly as they were", async () => {
    const now = new Date();
    const postId = await seedFailed({ failedAt: new Date(now.getTime() - 10 * MIN) });
    const before = (
      await db.select().from(schema.scheduledPosts).where(eq(schema.scheduledPosts.id, postId))
    )[0]!;
    const noticeBefore = await postingNotices(db, adminId);
    expect(noticeBefore.unacknowledgedFailures).toBe(1);

    for (const failure of [
      new EmailSendError("resend 503", 503, "service_unavailable", true, false),
      new EmailSendError("resend request failed: timeout", null, null, true, false),
      new EmailSendError("resend 422", 422, "validation_error", false, false),
      new Error("something unexpected"),
    ]) {
      resetFailureEmailPause();
      fake.failWith = failure;
      await sweepPostFailureEmails(db, { ...WORKER, now }).catch(() => undefined);
      const after = (
        await db.select().from(schema.scheduledPosts).where(eq(schema.scheduledPosts.id, postId))
      )[0]!;
      expect(after).toEqual(before);
      expect(await postingNotices(db, adminId)).toEqual(noticeBefore);
    }
  });

  it("a retryable failure writes nothing and retries after 5 minutes with the same idempotency key", async () => {
    const now = new Date();
    await seedFailed({ failedAt: new Date(now.getTime() - 10 * MIN) });
    const keys: string[] = [];
    const flaky: EmailProvider = {
      async send(message) {
        keys.push(message.idempotencyKey);
        if (keys.length === 1)
          throw new EmailSendError("resend 500", 500, "application_error", true, false);
        return { id: "ok" };
      },
    };
    setEmailProvider(flaky);
    await sweepPostFailureEmails(db, { ...WORKER, now });
    expect(await emailRows()).toHaveLength(0);
    // Paused: the next minute's tick does not call Resend.
    expect(
      (await sweepPostFailureEmails(db, { ...WORKER, now: new Date(now.getTime() + MIN) })).off,
    ).toBe("paused");
    expect(keys).toHaveLength(1);
    await sweepPostFailureEmails(db, { ...WORKER, now: new Date(now.getTime() + 5 * MIN) });
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(await emailRows()).toHaveLength(1);
  });

  it("a permanent refusal is logged once and never retried", async () => {
    const now = new Date();
    await seedFailed({ failedAt: new Date(now.getTime() - 10 * MIN) });
    fake.failWith = new EmailSendError("resend 422", 422, "validation_error", false, false);
    const result = await sweepPostFailureEmails(db, { ...WORKER, now });
    expect(result.refused).toBe(1);
    const rows = await emailRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ outcome: "refused", error: "validation_error" });
    fake.failWith = undefined;
    await sweepPostFailureEmails(db, { ...WORKER, now: new Date(now.getTime() + 10 * MIN) });
    expect(fake.sent).toHaveLength(0);
  });

  it("Resend's spent day pauses the sweep until 00:00 UTC", async () => {
    const now = new Date(Date.UTC(2026, 9, 12, 20, 0, 0));
    await seedFailed({ failedAt: new Date(now.getTime() - 10 * MIN) });
    fake.failWith = new EmailSendError("resend 429", 429, "daily_quota_exceeded", false, true);
    await sweepPostFailureEmails(db, { ...WORKER, now });
    fake.failWith = undefined;
    expect(
      (
        await sweepPostFailureEmails(db, {
          ...WORKER,
          now: new Date(Date.UTC(2026, 9, 12, 23, 59, 0)),
        })
      ).off,
    ).toBe("paused");
    expect(fake.sent).toHaveLength(0);
    await sweepPostFailureEmails(db, { ...WORKER, now: new Date(Date.UTC(2026, 9, 13, 0, 0, 30)) });
    expect(fake.sent).toHaveLength(1);
  });

  it("sends nothing to an account the switch hides", async () => {
    const { userId, businessId } = await seedOwnerAndBusiness(db, { email: "customer@test.local" });
    const [accountId] = await connectInstagram(db, userId, [samplePage("ig_customer", "c")]);
    const renderId = await seedRender(businessId, "c");
    const now = new Date();
    await seedFailed({
      userId,
      businessId,
      accountId,
      renderId,
      failedAt: new Date(now.getTime() - 10 * MIN),
    });

    // No social_posting row → admins only → the customer is hidden.
    await sweepPostFailureEmails(db, { ...WORKER, now });
    expect(fake.sent).toHaveLength(0);
    expect(await emailRows()).toHaveLength(0);

    // Named: the email goes out, in the customer's own service label.
    await db
      .insert(schema.appConfig)
      .values({ key: "social_posting", value: { access: "named", userIds: [userId] } });
    await sweepPostFailureEmails(db, { ...WORKER, now });
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.to).toBe("customer@test.local");
    expect(fake.sent[0]!.text).toContain("סרטון גוש טקסט של");
    await db.delete(schema.appConfig).where(eq(schema.appConfig.key, "social_posting"));
  });

  it("escapes what the customer named in the HTML", async () => {
    const now = new Date();
    await db
      .update(schema.businesses)
      .set({ name: "<b>עסק</b> & co" })
      .where(eq(schema.businesses.id, adminBusinessId));
    await seedFailed({ failedAt: new Date(now.getTime() - 10 * MIN) });
    await sweepPostFailureEmails(db, { ...WORKER, now });
    expect(fake.sent[0]!.html).toContain("&lt;b&gt;עסק&lt;/b&gt; &amp; co");
    expect(fake.sent[0]!.html).not.toContain("<b>עסק</b>");
    await db
      .update(schema.businesses)
      .set({ name: "עסק" })
      .where(eq(schema.businesses.id, adminBusinessId));
  });

  it("the reason speaks of several videos, or several accounts, when the email does", async () => {
    const now = new Date();
    const second = await seedRender(adminBusinessId, "b");
    await seedFailed({ kind: "platform_refused", failedAt: new Date(now.getTime() - 10 * MIN) });
    await seedFailed({
      kind: "platform_refused",
      renderId: second,
      failedAt: new Date(now.getTime() - 9 * MIN),
    });
    const [otherAccount] = await connectInstagram(db, adminId, [samplePage("ig_plural", "p")]);
    await seedFailed({ kind: "connection_expired", failedAt: new Date(now.getTime() - 10 * MIN) });
    await seedFailed({
      kind: "connection_expired",
      accountId: otherAccount,
      failedAt: new Date(now.getTime() - 9 * MIN),
    });
    await seedFailed({ kind: "file_missing", failedAt: new Date(now.getTime() - 10 * MIN) });

    await sweepPostFailureEmails(db, { ...WORKER, now });
    const byReason = (line: string) => fake.sent.find((email) => email.text.includes(line));
    expect(byReason("אינסטגרם לא קיבלה את הסרטונים. אפשר להוריד אותם ולפרסם ידנית.")).toBeDefined();
    expect(byReason("החיבור לחשבונות פג. התחברו מחדש בהגדרות ותזמנו שוב.")).toBeDefined();
    // A missing file has nothing to schedule again.
    const missing = byReason("קובץ הסרטון כבר לא שמור אצלנו.")!;
    expect(missing.text).toContain("כל הפרטים בלוח הפרסומים:");
    expect(missing.text).not.toContain("לתזמן שוב");
  });

  it("the idempotency key does not move as the burst grows, so a retry is deduplicated, not sent again", async () => {
    const now = new Date();
    const first = await seedFailed({ failedAt: new Date(now.getTime() - 10 * MIN) });
    const keys: string[] = [];
    let attempts = 0;
    setEmailProvider({
      async send(message) {
        keys.push(message.idempotencyKey);
        attempts += 1;
        // The first attempt may have landed at Resend; the answer never came.
        if (attempts === 1)
          throw new EmailSendError("resend request failed: timeout", null, null, true, false);
        return { id: "ok" };
      },
    });
    await sweepPostFailureEmails(db, { ...WORKER, now });
    // Another post of the same cause fails while the sweep is paused.
    await seedFailed({ failedAt: new Date(now.getTime() + 1 * MIN) });
    await sweepPostFailureEmails(db, { ...WORKER, now: new Date(now.getTime() + 6 * MIN) });
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[0]).toContain(first);
  });

  it("Resend's answer that the key was already used with another body counts as sent", async () => {
    const now = new Date();
    await seedFailed({ failedAt: new Date(now.getTime() - 10 * MIN) });
    fake.failWith = new EmailSendError(
      "resend 409 invalid_idempotent_request",
      409,
      "invalid_idempotent_request",
      false,
      false,
    );
    const result = await sweepPostFailureEmails(db, { ...WORKER, now });
    expect(result).toMatchObject({ sent: 1, refused: 0 });
    const rows = await emailRows();
    expect(rows[0]!.payload).toMatchObject({ outcome: "sent" });
  });

  it("a 401 or 403 is the account's fault: no row, an hour's pause, and the failure still goes out once fixed", async () => {
    const now = new Date();
    await seedFailed({ failedAt: new Date(now.getTime() - 10 * MIN) });
    fake.failWith = new EmailSendError(
      "resend 403 validation_error",
      403,
      "validation_error",
      false,
      false,
      true,
    );
    await sweepPostFailureEmails(db, { ...WORKER, now });
    expect(await emailRows()).toHaveLength(0);
    fake.failWith = undefined;
    expect(
      (await sweepPostFailureEmails(db, { ...WORKER, now: new Date(now.getTime() + 30 * MIN) }))
        .off,
    ).toBe("paused");
    await sweepPostFailureEmails(db, { ...WORKER, now: new Date(now.getTime() + 61 * MIN) });
    expect(fake.sent).toHaveLength(1);
  });

  it("the startup line and the sweep read one answer: on, no provider, or a developer machine", () => {
    const saved = { ...process.env };
    try {
      expect(failureEmailState("box-1")).toBe("on");
      process.env.DATABASE_URL = "postgresql://u@h:6543/postgres?ref=hyaqydcmwbnbaiqqufow";
      resetEnvCache();
      expect(failureEmailState("local")).toBe("local_worker");
      expect(failureEmailState("box-1:light")).toBe("on");
      setEmailProvider(undefined);
      delete process.env.RESEND_API_KEY;
      resetEnvCache();
      expect(failureEmailState("box-1")).toBe("no_provider");
    } finally {
      process.env = { ...saved };
      resetEnvCache();
    }
  });

  describe("off", () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
      resetEnvCache();
    });

    it("no key: no provider, no call, no row, no throw", async () => {
      setEmailProvider(undefined);
      delete process.env.RESEND_API_KEY;
      process.env.DRY_RUN = "0";
      resetEnvCache();
      expect(getEmailProvider()).toBeUndefined();
      process.env.RESEND_API_KEY = "  ";
      resetEnvCache();
      expect(getEmailProvider()).toBeUndefined();

      await seedFailed({ failedAt: new Date(Date.now() - 10 * MIN) });
      const result = await sweepPostFailureEmails(db, WORKER);
      expect(result).toEqual({ off: "no_provider", sent: 0, refused: 0, heldByCeiling: 0 });
      expect(await emailRows()).toHaveLength(0);
    });

    it("a dry run has no provider even with a key", async () => {
      setEmailProvider(undefined);
      process.env.RESEND_API_KEY = "re_test_not_a_real_key";
      process.env.DRY_RUN = "1";
      resetEnvCache();
      expect(getEmailProvider()).toBeUndefined();
      await seedFailed({ failedAt: new Date(Date.now() - 10 * MIN) });
      expect((await sweepPostFailureEmails(db, WORKER)).off).toBe("no_provider");
      expect(await emailRows()).toHaveLength(0);
    });

    it("a developer machine against production sends nothing", async () => {
      process.env.DATABASE_URL =
        "postgresql://u@aws-0.pooler.supabase.com:6543/postgres?ref=hyaqydcmwbnbaiqqufow";
      resetEnvCache();
      await seedFailed({ failedAt: new Date(Date.now() - 10 * MIN) });
      for (const workerId of ["local", "cli:light"]) {
        expect((await sweepPostFailureEmails(db, { workerId })).off).toBe("local_worker");
      }
      expect(fake.sent).toHaveLength(0);
      expect(await emailRows()).toHaveLength(0);
      // The box itself is not refused.
      expect((await sweepPostFailureEmails(db, { workerId: "box-1:light" })).sent).toBe(1);
    });
  });
});
