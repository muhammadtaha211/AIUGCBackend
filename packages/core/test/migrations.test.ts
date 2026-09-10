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
    // 0022: account-first GPU caps — the platform value is a runaway backstop
    // recorded in a migration, never a hand UPDATE.
    // 0027: the llm cap is pinned exactly, so the next hand-raise in the SQL
    // editor cannot drift from the migrations silently.
    // 0036 (2026-09-11) moved four of these five: the platform caps became a
    // runaway detector at 16x their per_account pair, and per_account.llm_tokens
    // was tightened 1_500_000 -> 500_000. The full seven-value assertion lives
    // in daily-caps.test.ts; this one stays partial because it is the
    // migrations-apply-cleanly test, not the caps test.
    expect(caps[0]?.value).toMatchObject({
      gpu_seconds: 32_000,
      per_account: { tts_chars: 25_000, gpu_seconds: 2_000, llm_tokens: 500_000 },
    });

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

  it("0013: demo description column + persona-swapped hook clip FKs", async () => {
    const { db, pg } = await createTestDb();

    const [user] = await db
      .insert(schema.users)
      .values({ email: "founder@test.local" })
      .returning();
    const [biz] = await db
      .insert(schema.businesses)
      .values({ ownerUserId: user!.id, name: "Test Biz" })
      .returning();
    const [demo] = await db
      .insert(schema.demos)
      .values({ businessId: biz!.id, description: "גלילה בתפריט" })
      .returning();
    expect(demo!.description).toBe("גלילה בתפריט");

    const [persona] = await db
      .insert(schema.personas)
      .values({ name: "נועה", voiceId: "voice_noa" })
      .returning();
    const [generic] = await db
      .insert(schema.hookClips)
      .values({
        filePath: "assets/h1.mp4",
        durationMs: 2000,
        textSafeArea: { x: 0, y: 0, w: 500, h: 500 },
      })
      .returning();
    expect(generic!.personaId).toBeNull();

    const [swapped] = await db
      .insert(schema.hookClips)
      .values({
        filePath: "assets/h2.mp4",
        durationMs: 2000,
        textSafeArea: { x: 0, y: 0, w: 500, h: 500 },
        personaId: persona!.id,
        sourceClipId: generic!.id,
      })
      .returning();
    expect(swapped!.personaId).toBe(persona!.id);
    expect(swapped!.sourceClipId).toBe(generic!.id);

    // Both FKs are real: a bogus persona or source clip is refused.
    await expect(
      db.insert(schema.hookClips).values({
        filePath: "assets/h3.mp4",
        durationMs: 2000,
        textSafeArea: { x: 0, y: 0, w: 500, h: 500 },
        personaId: "00000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      db.insert(schema.hookClips).values({
        filePath: "assets/h4.mp4",
        durationMs: 2000,
        textSafeArea: { x: 0, y: 0, w: 500, h: 500 },
        sourceClipId: "00000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toThrow(/foreign key/i);

    await pg.close();
  });

  it("0028: split-gate backfill flips only eligible rows, clears stale fail_reason, strips the misplaced key", async () => {
    // Build the PRE-0028 shape, then seed every row shape the migration
    // reasons about — production has none of the guard shapes, so they are
    // constructed here.
    const pg = new PGlite();
    for (const file of PORTABLE_MIGRATIONS.filter((f) => f < "0028")) {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }

    const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const user = uid(1);
    const biz = uid(2);
    const demo = (n: number) => uid(100 + n);
    const row = (n: number) => uid(200 + n);
    // unreadable 0, illegible 0.25 — passes both axes of the new gate.
    const passing = JSON.stringify([
      ...Array(3).fill({ legibility: "high" }),
      { legibility: "low" },
    ]);
    // unreadable 0.3 > 0.25 while illegible 0.3 clears even the old 0.4 gate —
    // fails only on the axis the split added.
    const unreadableHeavy = JSON.stringify([
      ...Array(3).fill({ legibility: "unreadable" }),
      ...Array(7).fill({ legibility: "high" }),
    ]);
    // illegible 0.8 > 0.75 — fails the overall axis.
    const illegibleHeavy = JSON.stringify([
      ...Array(8).fill({ legibility: "low" }),
      ...Array(2).fill({ legibility: "high" }),
    ]);

    await pg.exec(`
      INSERT INTO users (id, email) VALUES ('${user}', 'gate@test.local');
      INSERT INTO businesses (id, owner_user_id, name) VALUES ('${biz}', '${user}', 'B');
      INSERT INTO demos (id, business_id) VALUES
        ${[1, 2, 3, 4, 5, 6, 7].map((n) => `('${demo(n)}', '${biz}')`).join(", ")};
      INSERT INTO demo_analyses (id, demo_id, status, timeline, fail_reason, created_at) VALUES
        ('${row(1)}', '${demo(1)}', 'rejected', '${passing}', 'צלמו שוב', '2026-08-01T00:00:00Z'),
        ('${row(2)}', '${demo(2)}', 'rejected', NULL, 'צלמו שוב', '2026-08-01T00:00:00Z'),
        ('${row(3)}', '${demo(3)}', 'ready', '${passing}', NULL, '2026-08-01T00:00:00Z'),
        ('${row(4)}', '${demo(3)}', 'rejected', '${passing}', 'צלמו שוב', '2026-08-02T00:00:00Z'),
        ('${row(5)}', '${demo(4)}', 'ready', '${passing}', 'צלמו שוב', '2026-08-01T00:00:00Z'),
        ('${row(6)}', '${demo(5)}', 'rejected', '${passing}', 'צלמו שוב', '2026-08-01T00:00:00Z'),
        ('${row(7)}', '${demo(5)}', 'rejected', '${passing}', 'צלמו שוב', '2026-08-02T00:00:00Z'),
        ('${row(8)}', '${demo(6)}', 'rejected', '${unreadableHeavy}', 'צלמו שוב', '2026-08-01T00:00:00Z'),
        ('${row(9)}', '${demo(7)}', 'rejected', '${illegibleHeavy}', 'צלמו שוב', '2026-08-01T00:00:00Z');
      UPDATE app_config
        SET value = value || '{"a_analysis_legibility_threshold": 0.75}'::jsonb
        WHERE key = 'credit_costs';
    `);

    await pg.exec(readFileSync(join(MIGRATIONS_DIR, "0028_split_legibility_gate.sql"), "utf8"));

    const rows = await pg.query<{ id: string; status: string; fail_reason: string | null }>(
      "SELECT id, status, fail_reason FROM demo_analyses ORDER BY id",
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r]));
    // Eligible -> flipped, reason cleared, timeline untouched.
    expect(byId.get(row(1))).toMatchObject({ status: "ready", fail_reason: null });
    const kept = await pg.query<{ n: number }>(
      `SELECT jsonb_array_length(timeline) AS n FROM demo_analyses WHERE id = '${row(1)}'`,
    );
    expect(kept.rows[0]!.n).toBe(4);
    // Zero-cluster rejection (no timeline) untouched.
    expect(byId.get(row(2))).toMatchObject({ status: "rejected", fail_reason: "צלמו שוב" });
    // A rejected row whose demo already has a ready analysis is NOT flipped.
    expect(byId.get(row(3))).toMatchObject({ status: "ready", fail_reason: null });
    expect(byId.get(row(4))).toMatchObject({ status: "rejected", fail_reason: "צלמו שוב" });
    // A ready row with a stale fail_reason (the hand-flip shape) is cleared.
    expect(byId.get(row(5))).toMatchObject({ status: "ready", fail_reason: null });
    // Two eligible rows on one demo: only the newest flips.
    expect(byId.get(row(6))).toMatchObject({ status: "rejected", fail_reason: "צלמו שוב" });
    expect(byId.get(row(7))).toMatchObject({ status: "ready", fail_reason: null });
    // Fails the unreadable axis / the overall axis -> untouched.
    expect(byId.get(row(8))).toMatchObject({ status: "rejected", fail_reason: "צלמו שוב" });
    expect(byId.get(row(9))).toMatchObject({ status: "rejected", fail_reason: "צלמו שוב" });

    // Invariants: at most one ready analysis per demo, no ready row keeps a reason.
    const multiReady = await pg.query(
      "SELECT demo_id FROM demo_analyses WHERE status = 'ready' GROUP BY demo_id HAVING count(*) > 1",
    );
    expect(multiReady.rows).toEqual([]);
    const readyWithReason = await pg.query(
      "SELECT id FROM demo_analyses WHERE status = 'ready' AND fail_reason IS NOT NULL",
    );
    expect(readyWithReason.rows).toEqual([]);

    // The misplaced key is stripped from credit_costs; the real rates survive.
    const cfg = await pg.query<{ value: Record<string, unknown> }>(
      "SELECT value FROM app_config WHERE key = 'credit_costs'",
    );
    expect(cfg.rows[0]!.value).not.toHaveProperty("a_analysis_legibility_threshold");
    expect(cfg.rows[0]!.value).toMatchObject({ a_steps_credits: 5 });

    await pg.close();
  });

  it("0032: selfie lineage + one active opener clip per (image, effect), reveal inside the clip", async () => {
    const { db, pg } = await createTestDb();

    const [persona] = await db
      .insert(schema.personas)
      .values({ name: "נועה", voiceId: "voice_noa" })
      .returning();
    const [standing] = await db
      .insert(schema.personaImages)
      .values({ personaId: persona!.id, filePath: "assets/p1.jpg", kind: "background" })
      .returning();
    const [selfie] = await db
      .insert(schema.personaImages)
      .values({
        personaId: persona!.id,
        filePath: "assets/p1-selfie.jpg",
        kind: "selfie",
        sourceImageId: standing!.id,
      })
      .returning();
    expect(selfie!.sourceImageId).toBe(standing!.id);

    const clip = (over: Partial<typeof schema.openerClips.$inferInsert> = {}) => ({
      personaImageId: selfie!.id,
      effect: "hand_cover",
      label: "כף יד",
      filePath: "assets/o1.mp4",
      durationMs: 1200,
      revealAtMs: 900,
      textSafeArea: { x: 0, y: 0, w: 500, h: 500 },
      ...over,
    });

    await db.insert(schema.openerClips).values(clip());
    // A different effect on the same image is fine.
    await db.insert(schema.openerClips).values(clip({ effect: "finger_snap" }));
    // A second ACTIVE clip for the same pair is not.
    await expect(db.insert(schema.openerClips).values(clip())).rejects.toThrow(/duplicate key/i);
    // The index is partial: a superseded clip stays as active=false and the
    // pair can be re-registered.
    await db.insert(schema.openerClips).values(clip({ active: false }));

    // reveal_at_ms must land inside the clip.
    await expect(
      db.insert(schema.openerClips).values(clip({ effect: "late", revealAtMs: 1201 })),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      db.insert(schema.openerClips).values(clip({ effect: "negative", revealAtMs: -1 })),
    ).rejects.toThrow(/check constraint/i);
    // The boundaries themselves are legal.
    await db.insert(schema.openerClips).values(clip({ effect: "at_zero", revealAtMs: 0 }));
    await db.insert(schema.openerClips).values(clip({ effect: "at_end", revealAtMs: 1200 }));

    await pg.close();
  });

  it("0034: expressiveness medium + the generic motion prompt are seeded; a later flip survives a re-run", async () => {
    const { pg } = await createTestDb();

    const read = async (key: string) =>
      (await pg.query<{ value: unknown }>("SELECT value FROM app_config WHERE key = $1", [key]))
        .rows[0]?.value;
    // Founder decision 0022 lives here, not in the SQL editor (the 0031 rule).
    expect(await read("lipsync_expressiveness")).toBe("medium");
    expect(await read("lipsync_motion_prompt")).toBe(
      "Speaks naturally to the camera with a warm, relaxed expression, small natural head movements, steady eye contact",
    );

    // Both statements are guarded: a deliberate later change is never undone.
    await pg.query(
      `UPDATE app_config SET value = '"low"'::jsonb WHERE key = 'lipsync_expressiveness'`,
    );
    await pg.query(
      `UPDATE app_config SET value = '"a later founder pick"'::jsonb WHERE key = 'lipsync_motion_prompt'`,
    );
    await pg.exec(
      readFileSync(join(MIGRATIONS_DIR, "0034_lipsync_expressiveness_medium.sql"), "utf8"),
    );
    expect(await read("lipsync_expressiveness")).toBe("low");
    expect(await read("lipsync_motion_prompt")).toBe("a later founder pick");

    await pg.close();
  });

  it("0035: feedback exists with RLS enabled, no policy, and a nullable business", async () => {
    const { db, pg } = await createTestDb();

    // RLS on with zero policies is the server-only model (0002's block), and
    // it rides in the portable file because the statement names no role — the
    // one thing decisions/0018 says a portable migration cannot do.
    const rls = await pg.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.feedback'::regclass",
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
    const policies = await pg.query("SELECT 1 FROM pg_policies WHERE tablename = 'feedback'");
    expect(policies.rows).toHaveLength(0);

    const [user] = await db
      .insert(schema.users)
      .values({ email: "feedback@test.local" })
      .returning();

    // business_id is nullable; user_id is not, and both FKs are enforced.
    await db.insert(schema.feedback).values({ userId: user!.id, message: "בלי עסק" });
    await expect(
      db.insert(schema.feedback).values({
        userId: user!.id,
        message: "עסק שלא קיים",
        businessId: "00000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      db.insert(schema.feedback).values({
        userId: "00000000-0000-0000-0000-000000000002",
        message: "משתמש שלא קיים",
      }),
    ).rejects.toThrow(/foreign key/i);

    expect(
      (await pg.query("SELECT 1 FROM pg_indexes WHERE indexname = 'feedback_created_idx'")).rows,
    ).toHaveLength(1);

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
