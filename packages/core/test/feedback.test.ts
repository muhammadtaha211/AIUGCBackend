import { describe, expect, it } from "vitest";
import {
  CONTACT_EMAIL_MAX_CHARS,
  CONTACT_NAME_MAX_CHARS,
  countContactMessagesByIpSince,
  countFeedbackSince,
  FEEDBACK_MAX_CHARS,
  listFeedback,
  submitContactMessage,
  submitFeedback,
} from "../src/pipelines/feedback";
import { createTestDb } from "./helpers/pglite";
import * as schema from "../src/db/schema";
import type { Db } from "../src/db";

async function seedUser(db: Db, email: string) {
  const [user] = await db.insert(schema.users).values({ email }).returning();
  return user!;
}

async function seedBusiness(db: Db, ownerUserId: string, name: string) {
  const [business] = await db.insert(schema.businesses).values({ ownerUserId, name }).returning();
  return business!;
}

describe("submitFeedback", () => {
  it("stores the trimmed message with its business and page", async () => {
    const { db, pg } = await createTestDb();
    const user = await seedUser(db, "customer@test.local");
    const business = await seedBusiness(db, user.id, "עסק א");

    const { id } = await submitFeedback(db, {
      userId: user.id,
      businessId: business.id,
      message: "  הכפתור לא עובד לי  ",
      page: "/home/b/new",
    });

    const [row] = await listFeedback(db, { limit: 10 });
    expect(row).toMatchObject({
      id,
      userId: user.id,
      userEmail: "customer@test.local",
      businessId: business.id,
      businessName: "עסק א",
      message: "הכפתור לא עובד לי",
      page: "/home/b/new",
    });

    await pg.close();
  });

  it("accepts a message with no business and no page", async () => {
    const { db, pg } = await createTestDb();
    const user = await seedUser(db, "nobiz@test.local");

    await submitFeedback(db, { userId: user.id, message: "שלום" });

    const [row] = await listFeedback(db, { limit: 10 });
    expect(row?.businessId).toBeNull();
    expect(row?.businessName).toBeNull();
    expect(row?.page).toBeNull();

    await pg.close();
  });

  it("rejects an empty or whitespace-only message, and one over the cap", async () => {
    const { db, pg } = await createTestDb();
    const user = await seedUser(db, "empty@test.local");

    await expect(submitFeedback(db, { userId: user.id, message: "" })).rejects.toThrow(/empty/);
    await expect(submitFeedback(db, { userId: user.id, message: "   \n\t " })).rejects.toThrow(
      /empty/,
    );
    await expect(
      submitFeedback(db, { userId: user.id, message: "א".repeat(FEEDBACK_MAX_CHARS + 1) }),
    ).rejects.toThrow(/longer than/);
    // Exactly at the cap is fine, and whitespace is trimmed before measuring.
    await submitFeedback(db, { userId: user.id, message: "א".repeat(FEEDBACK_MAX_CHARS) });
    await submitFeedback(db, {
      userId: user.id,
      message: `  ${"ב".repeat(FEEDBACK_MAX_CHARS)}  `,
    });

    expect(await listFeedback(db, { limit: 10 })).toHaveLength(2);

    await pg.close();
  });

  it("blank page strings are stored as null, not as empty text", async () => {
    const { db, pg } = await createTestDb();
    const user = await seedUser(db, "blankpage@test.local");

    await submitFeedback(db, { userId: user.id, message: "היי", page: "   " });

    expect((await listFeedback(db, { limit: 1 }))[0]?.page).toBeNull();

    await pg.close();
  });
});

describe("listFeedback", () => {
  it("returns newest first, honours limit, and pages with `before`", async () => {
    const { db, pg } = await createTestDb();
    const user = await seedUser(db, "pager@test.local");

    // Explicit timestamps: three rows written in one test can share a clock
    // tick, and this asserts the ordering, not the insert speed.
    const at = (minute: number) => new Date(Date.UTC(2026, 8, 8, 10, minute));
    for (const [minute, message] of [
      [0, "ראשון"],
      [1, "שני"],
      [2, "שלישי"],
    ] as const) {
      await db.insert(schema.feedback).values({ userId: user.id, message, createdAt: at(minute) });
    }

    const newest = await listFeedback(db, { limit: 10 });
    expect(newest.map((row) => row.message)).toEqual(["שלישי", "שני", "ראשון"]);

    expect((await listFeedback(db, { limit: 2 })).map((row) => row.message)).toEqual([
      "שלישי",
      "שני",
    ]);

    // The cursor is strict: the row AT `before` is not repeated.
    expect(
      (await listFeedback(db, { limit: 10, before: at(2) })).map((row) => row.message),
    ).toEqual(["שני", "ראשון"]);
    expect(await listFeedback(db, { limit: 10, before: at(0) })).toEqual([]);

    await pg.close();
  });

  it("keeps a message whose business row exists alongside one with none", async () => {
    const { db, pg } = await createTestDb();
    const user = await seedUser(db, "mixed@test.local");
    const business = await seedBusiness(db, user.id, "עסק ב");

    await db.insert(schema.feedback).values([
      { userId: user.id, message: "עם עסק", businessId: business.id, createdAt: new Date(1) },
      { userId: user.id, message: "בלי עסק", createdAt: new Date(2) },
    ]);

    // The left join is the point: an inner join would drop "בלי עסק".
    expect((await listFeedback(db, { limit: 10 })).map((row) => row.businessName)).toEqual([
      null,
      "עסק ב",
    ]);

    await pg.close();
  });
});

describe("countFeedbackSince", () => {
  it("counts only this user's rows inside the window", async () => {
    const { db, pg } = await createTestDb();
    const mine = await seedUser(db, "mine@test.local");
    const theirs = await seedUser(db, "theirs@test.local");

    const hoursAgo = (hours: number) => new Date(Date.UTC(2026, 8, 8, 12) - hours * 3_600_000);
    const since = hoursAgo(24);

    await db.insert(schema.feedback).values([
      { userId: mine.id, message: "בתוך החלון", createdAt: hoursAgo(1) },
      { userId: mine.id, message: "גם בתוך", createdAt: hoursAgo(23) },
      { userId: mine.id, message: "בדיוק על הגבול", createdAt: since },
      { userId: mine.id, message: "מחוץ לחלון", createdAt: hoursAgo(25) },
      { userId: theirs.id, message: "של מישהו אחר", createdAt: hoursAgo(1) },
    ]);

    // gte: the boundary row counts.
    expect(await countFeedbackSince(db, mine.id, since)).toBe(3);
    expect(await countFeedbackSince(db, theirs.id, since)).toBe(1);

    await pg.close();
  });

  it("is zero for a user who has never written", async () => {
    const { db, pg } = await createTestDb();
    const user = await seedUser(db, "silent@test.local");

    expect(await countFeedbackSince(db, user.id, new Date(0))).toBe(0);

    await pg.close();
  });
});

describe("submitContactMessage (the public /contact form)", () => {
  it("writes an anonymous row carrying the name, address and IP the visitor gave", async () => {
    const { db, pg } = await createTestDb();

    const { id } = await submitContactMessage(db, {
      name: "  דנה לוי  ",
      email: "  dana@business.co.il ",
      message: "  שאלה על המסלולים  ",
      ip: "203.0.113.7",
    });

    const [row] = await listFeedback(db, { limit: 10 });
    expect(row).toMatchObject({
      id,
      userId: null,
      userEmail: null,
      businessId: null,
      businessName: null,
      contactName: "דנה לוי",
      contactEmail: "dana@business.co.il",
      message: "שאלה על המסלולים",
      page: null,
    });

    await pg.close();
  });

  it("stores a null IP when none was forwarded, and when one is blank", async () => {
    const { db, pg } = await createTestDb();

    await submitContactMessage(db, { name: "דנה", email: "a@b.co", message: "היי" });
    await submitContactMessage(db, { name: "דנה", email: "a@b.co", message: "היי", ip: "   " });

    const rows = await db.select({ ip: schema.feedback.ip }).from(schema.feedback);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.ip === null)).toBe(true);

    await pg.close();
  });

  it("refuses an empty or over-long value in any field, before touching the table", async () => {
    const { db, pg } = await createTestDb();
    const ok = { name: "דנה", email: "a@b.co", message: "היי" };

    await expect(submitContactMessage(db, { ...ok, name: "  " })).rejects.toThrow(/name is empty/);
    await expect(submitContactMessage(db, { ...ok, email: " \n " })).rejects.toThrow(
      /email is empty/,
    );
    await expect(submitContactMessage(db, { ...ok, message: "" })).rejects.toThrow(
      /message is empty/,
    );
    await expect(
      submitContactMessage(db, { ...ok, name: "א".repeat(CONTACT_NAME_MAX_CHARS + 1) }),
    ).rejects.toThrow(/name is longer than/);
    await expect(
      submitContactMessage(db, { ...ok, email: `${"a".repeat(CONTACT_EMAIL_MAX_CHARS)}@b.co` }),
    ).rejects.toThrow(/email is longer than/);
    await expect(
      submitContactMessage(db, { ...ok, message: "א".repeat(FEEDBACK_MAX_CHARS + 1) }),
    ).rejects.toThrow(/message is longer than/);

    expect(await db.select().from(schema.feedback)).toHaveLength(0);

    await pg.close();
  });

  it("lands in the same inbox as the in-app messages, newest first", async () => {
    const { db, pg } = await createTestDb();
    const user = await seedUser(db, "customer@test.local");
    const at = (minute: number) => new Date(Date.UTC(2026, 8, 17, 10, minute));

    await db
      .insert(schema.feedback)
      .values({ userId: user.id, message: "מהאפליקציה", createdAt: at(0) });
    await db.insert(schema.feedback).values({
      message: "מהטופס",
      contactName: "דנה",
      contactEmail: "dana@business.co.il",
      ip: "203.0.113.7",
      createdAt: at(1),
    });

    const rows = await listFeedback(db, { limit: 10 });
    expect(rows.map((r) => r.message)).toEqual(["מהטופס", "מהאפליקציה"]);
    // The LEFT join is what keeps the anonymous row in the list at all.
    expect(rows[0]).toMatchObject({ userEmail: null, contactEmail: "dana@business.co.il" });
    expect(rows[1]).toMatchObject({ userEmail: "customer@test.local", contactEmail: null });

    await pg.close();
  });
});

describe("countContactMessagesByIpSince", () => {
  it("counts only anonymous rows from that address, inside the window", async () => {
    const { db, pg } = await createTestDb();
    const user = await seedUser(db, "customer@test.local");
    const since = new Date(Date.UTC(2026, 8, 17, 10, 0));
    const at = (minute: number) => new Date(Date.UTC(2026, 8, 17, 10, minute));

    // Two from the address inside the window.
    await db.insert(schema.feedback).values({ message: "א", ip: "203.0.113.7", createdAt: at(1) });
    await db.insert(schema.feedback).values({ message: "ב", ip: "203.0.113.7", createdAt: at(2) });
    // One from a different address.
    await db.insert(schema.feedback).values({ message: "ג", ip: "198.51.100.4", createdAt: at(3) });
    // One from the same address but BEFORE the window opened.
    await db.insert(schema.feedback).values({
      message: "ד",
      ip: "203.0.113.7",
      createdAt: new Date(Date.UTC(2026, 8, 16, 9, 0)),
    });
    // One from the same address written by a SIGNED-IN user — not a contact
    // message, so it must not eat the allowance on a shared office address.
    await db
      .insert(schema.feedback)
      .values({ userId: user.id, message: "ה", ip: "203.0.113.7", createdAt: at(4) });

    expect(await countContactMessagesByIpSince(db, "203.0.113.7", since)).toBe(2);
    expect(await countContactMessagesByIpSince(db, "198.51.100.4", since)).toBe(1);
    expect(await countContactMessagesByIpSince(db, "192.0.2.1", since)).toBe(0);

    await pg.close();
  });
});
