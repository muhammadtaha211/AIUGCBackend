import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
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
