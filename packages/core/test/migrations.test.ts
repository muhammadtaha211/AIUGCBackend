import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, MIGRATIONS_DIR, PORTABLE_MIGRATIONS } from "./helpers/pglite";
import * as schema from "../src/db/schema";

describe("migrations", () => {
  it("apply cleanly and seed plans + app_config", async () => {
    const { db, pg } = await createTestDb();

    const plans = await db.select().from(schema.plans);
    expect(plans.map((p) => p.code).sort()).toEqual(["pro", "starter", "studio"]);

    const caps = await db
      .select()
      .from(schema.appConfig)
      .where(eq(schema.appConfig.key, "daily_caps"));
    expect(caps[0]?.value).toMatchObject({ tts_chars: expect.any(Number) });

    await pg.close();
  });

  it("0003/0004: composites table, images usage kind, image config seeds", async () => {
    const { db, pg } = await createTestDb();

    const [user] = await db
      .insert(schema.users)
      .values({ email: "founder@test.local" })
      .returning();
    const [biz] = await db
      .insert(schema.businesses)
      .values({ ownerUserId: user!.id, name: "Test Biz" })
      .returning();
    const [persona] = await db
      .insert(schema.personas)
      .values({ name: "נועה", voiceId: "voice_noa" })
      .returning();

    const [composite] = await db
      .insert(schema.composites)
      .values({ businessId: biz!.id, personaId: persona!.id })
      .returning();
    expect(composite!.status).toBe("queued");
    expect(composite!.approvedAt).toBeNull();

    // The usage_kind enum accepts the new "images" value.
    await db.insert(schema.usageEvents).values({ provider: "fal", kind: "images", quantity: 1 });

    const caps = await db
      .select()
      .from(schema.appConfig)
      .where(eq(schema.appConfig.key, "daily_caps"));
    expect(caps[0]?.value).toMatchObject({ images: expect.any(Number) });

    const cost = await db
      .select()
      .from(schema.appConfig)
      .where(eq(schema.appConfig.key, "imagegen_cost_agorot"));
    expect(cost[0]?.value).toEqual(expect.any(Number));

    await pg.close();
  });

  it("0005/0006: persona_images replaces persona_clips, one default per persona", async () => {
    const { db, pg } = await createTestDb();

    const [persona] = await db
      .insert(schema.personas)
      .values({ name: "נועה", voiceId: "voice_noa" })
      .returning();

    const [first] = await db
      .insert(schema.personaImages)
      .values({ personaId: persona!.id, filePath: "assets/p1.jpg", isDefault: true })
      .returning();
    expect(first!.isDefault).toBe(true);

    // Non-default siblings are fine; a second default violates the partial index.
    await db
      .insert(schema.personaImages)
      .values({ personaId: persona!.id, filePath: "assets/p2.jpg" });
    await expect(
      db
        .insert(schema.personaImages)
        .values({ personaId: persona!.id, filePath: "assets/p3.jpg", isDefault: true }),
    ).rejects.toThrow(/duplicate key/i);

    // persona_clips is gone entirely.
    await expect(db.execute(sql`select 1 from persona_clips`)).rejects.toThrow(/does not exist/i);

    await pg.close();
  });

  it("0011: backfills user_id from each row's business owner", async () => {
    // Build the PRE-0011 shape, seed business-keyed ledger rows, then migrate.
    const pg = new PGlite();
    for (const file of PORTABLE_MIGRATIONS.filter((f) => f < "0011")) {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
    const userA = "11111111-1111-4111-8111-111111111111";
    const userB = "22222222-2222-4222-8222-222222222222";
    const bizA = "33333333-3333-4333-8333-333333333333";
    const bizB = "44444444-4444-4444-8444-444444444444";
    await pg.exec(`
      INSERT INTO users (id, email) VALUES
        ('${userA}', 'a@test.local'), ('${userB}', 'b@test.local');
      INSERT INTO businesses (id, owner_user_id, name) VALUES
        ('${bizA}', '${userA}', 'A'), ('${bizB}', '${userB}', 'B');
      INSERT INTO credit_ledger (business_id, delta, reason) VALUES
        ('${bizA}', 40, 'grant_period'),
        ('${bizA}', -1, 'debit_render'),
        ('${bizB}', 5, 'grant_manual');
    `);

    await pg.exec(readFileSync(join(MIGRATIONS_DIR, "0011_credit_ledger_user.sql"), "utf8"));

    const rows = await pg.query<{ user_id: string; business_id: string; delta: number }>(
      "SELECT user_id, business_id, delta FROM credit_ledger ORDER BY delta",
    );
    expect(rows.rows).toEqual([
      { user_id: userA, business_id: bizA, delta: -1 },
      { user_id: userB, business_id: bizB, delta: 5 },
      { user_id: userA, business_id: bizA, delta: 40 },
    ]);

    // The new shape: user_id is mandatory, business_id no longer is.
    await expect(
      pg.query(
        `INSERT INTO credit_ledger (business_id, delta, reason) VALUES ('${bizA}', 1, 'grant_manual')`,
      ),
    ).rejects.toThrow(/user_id/);
    await pg.query(
      `INSERT INTO credit_ledger (user_id, delta, reason) VALUES ('${userA}', 1, 'grant_manual')`,
    );

    await pg.close();
  });

  it("enforce the circular sets -> video_renders FK from 0001", async () => {
    const { db, pg } = await createTestDb();

    const [user] = await db
      .insert(schema.users)
      .values({ email: "founder@test.local" })
      .returning();
    const [biz] = await db
      .insert(schema.businesses)
      .values({ ownerUserId: user!.id, name: "Test Biz" })
      .returning();

    await expect(
      db.insert(schema.sets).values({
        businessId: biz!.id,
        grid: {},
        parentVariantId: "00000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toThrow(/foreign key/i);

    await pg.close();
  });
});
