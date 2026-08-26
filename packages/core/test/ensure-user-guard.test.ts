import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db";
import { users } from "../src/db/schema";
import { createBusiness, ensureUser, normalizeEmail } from "../src/pipelines/businesses";
import { createTestDb } from "./helpers/pglite";

/**
 * Two defects, one root cause: `aiugc business create` invents a uuid for an
 * address a real person may later authenticate as.
 *
 * - Same casing  -> the handle_new_user trigger hits users_email_unique and the
 *                   signup rolls back. Loud, and the address is blocked forever.
 * - Mixed casing -> no unique violation at all. Signup succeeds, two rows exist
 *                   for one person, and RLS hides the business. Silent.
 *
 * The silent one is what these tests exist to keep dead.
 */

let db: Db;

/** PGlite has no auth schema (0002 is excluded from PORTABLE_MIGRATIONS), so
 *  tests that need the guard to engage build the minimum it looks at. */
async function createAuthSchema(): Promise<void> {
  await db.execute(sql`create schema if not exists auth`);
  await db.execute(sql`create table if not exists auth.users (id uuid primary key, email text)`);
}

async function addAuthAccount(email: string): Promise<void> {
  await db.execute(sql`insert into auth.users (id, email) values (gen_random_uuid(), ${email})`);
}

async function userRows(): Promise<(typeof users.$inferSelect)[]> {
  return db.select().from(users);
}

beforeEach(async () => {
  ({ db } = await createTestDb());
});

describe("ensureUser: no Supabase Auth in this database", () => {
  it("creates freely — there is no signup that could ever collide", async () => {
    const row = await ensureUser(db, "anyone@example.com");
    expect(row.email).toBe("anyone@example.com");
    expect(await userRows()).toHaveLength(1);
  });

  it("keeps createBusiness working for every existing test that calls it", async () => {
    const business = await createBusiness(db, { ownerEmail: "owner@example.com", name: "עסק" });
    expect(business.ownerUserId).toBeTruthy();
  });
});

describe("ensureUser: guard against inventing an identity", () => {
  beforeEach(createAuthSchema);

  it("refuses an address with no auth account, and says what to do", async () => {
    await expect(ensureUser(db, "founder@tavnit.ai")).rejects.toThrow(
      /refusing to create a users row/,
    );
    // The message has to be actionable at 2am, not just correct.
    await expect(ensureUser(db, "founder@tavnit.ai")).rejects.toThrow(/--no-signin/);
    expect(await userRows()).toHaveLength(0);
  });

  it("allows it when the caller says the owner will never sign in", async () => {
    const row = await ensureUser(db, "sample@tavnit.ai", "customer", {
      allowWithoutAuthAccount: true,
    });
    expect(row.email).toBe("sample@tavnit.ai");
  });

  it("threads the flag through createBusiness", async () => {
    await expect(
      createBusiness(db, { ownerEmail: "blocked@tavnit.ai", name: "עסק" }),
    ).rejects.toThrow(/refusing to create a users row/);

    const business = await createBusiness(db, {
      ownerEmail: "sample@tavnit.ai",
      name: "עסק",
      allowWithoutAuthAccount: true,
    });
    expect(business.id).toBeTruthy();
  });

  it("allows an address that already has an auth account", async () => {
    await addAuthAccount("real@tavnit.ai");
    const row = await ensureUser(db, "real@tavnit.ai");
    expect(row.email).toBe("real@tavnit.ai");
  });

  it("matches the auth account case-insensitively", async () => {
    await addAuthAccount("Real@Tavnit.ai");
    const row = await ensureUser(db, "real@tavnit.ai");
    expect(row.email).toBe("real@tavnit.ai");
  });
});

describe("email casing: one person is always one row", () => {
  // The test worth keeping. users_email_unique is a plain btree and cannot
  // enforce this itself; if someone drops the normalisation, this goes red.
  it("cannot produce two rows for one address written in different cases", async () => {
    // As the handle_new_user trigger would write it — verbatim, mixed case.
    await db.insert(users).values({ email: "Founder@Example.com" });

    const found = await ensureUser(db, "founder@example.com");

    expect(await userRows()).toHaveLength(1);
    expect(found.email).toBe("Founder@Example.com");
  });

  it("finds a lowercased row when asked in mixed case", async () => {
    const created = await ensureUser(db, "founder@example.com");
    const found = await ensureUser(db, "FOUNDER@EXAMPLE.COM");

    expect(found.id).toBe(created.id);
    expect(await userRows()).toHaveLength(1);
  });

  it("stores new addresses lowercased and trimmed", async () => {
    const row = await ensureUser(db, "  Mixed@Case.COM  ");
    expect(row.email).toBe("mixed@case.com");
  });

  it("gives one business owner, not two, across casings", async () => {
    const first = await createBusiness(db, { ownerEmail: "Owner@Example.com", name: "עסק א" });
    const second = await createBusiness(db, { ownerEmail: "owner@example.com", name: "עסק ב" });

    expect(second.ownerUserId).toBe(first.ownerUserId);
    expect(await userRows()).toHaveLength(1);
  });

  it("normalizeEmail is the one definition of normalised", () => {
    expect(normalizeEmail("  Founder@Example.COM ")).toBe("founder@example.com");
  });
});
