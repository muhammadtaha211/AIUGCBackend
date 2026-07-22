import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb } from "./helpers/pglite";
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
