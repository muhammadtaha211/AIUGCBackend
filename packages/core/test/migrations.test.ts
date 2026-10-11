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

    // The free audio-preview attempt cap. 0038 (2026-09-13) took it 20 -> 50 on
    // an argument; 0040 (2026-09-16) took it straight back to 20 on the
    // founder's call that Service B is an occasional format and a good voice
    // needs 2-3 retries, not 50. This pins the END of that chain, so it also
    // proves 0040's guard (WHERE value = '50') actually fired on the 50 that
    // 0038 wrote — a rebuild has to land on 20 by construction, not by 0001's
    // seed happening to say 20. Pinned exactly and by identity, for the same
    // reason per_account.llm_tokens is: the value lives in a migration
    // precisely so a hand UPDATE in the SQL editor cannot move it silently.
    // toBe also catches a string '"20"', which tts.ts's z.number().int() would
    // reject at the next customer preview.
    const previewLimit = await db
      .select()
      .from(schema.appConfig)
      .where(eq(schema.appConfig.key, "audio_preview_daily_limit"));
    expect(previewLimit[0]?.value).toBe(20);

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

  it("0041: backfills user_id from each subscription's business owner, then drops business_id", async () => {
    // Same shape as the 0011 test above, and for the same reason: every other
    // test applies 0041 to an EMPTY subscriptions table, so nothing else ever
    // runs the backfill. Build the PRE-0041 shape, seed business-keyed rows,
    // then migrate.
    const pg = new PGlite();
    for (const file of PORTABLE_MIGRATIONS.filter((f) => f < "0041")) {
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
      INSERT INTO subscriptions (business_id, plan_code, status, current_period_start, current_period_end) VALUES
        ('${bizA}', 'starter', 'active',   now(), now()),
        ('${bizB}', 'pro',     'canceled', now(), now());
    `);

    await pg.exec(
      readFileSync(join(MIGRATIONS_DIR, "0041_subscriptions_keyed_on_user.sql"), "utf8"),
    );

    const rows = await pg.query<{ user_id: string; plan_code: string }>(
      "SELECT user_id, plan_code FROM subscriptions ORDER BY plan_code",
    );
    expect(rows.rows).toEqual([
      { user_id: userB, plan_code: "pro" },
      { user_id: userA, plan_code: "starter" },
    ]);

    // business_id is gone entirely, and so are 0001's per-business indexes.
    await expect(pg.query("SELECT business_id FROM subscriptions")).rejects.toThrow(
      /does not exist/i,
    );
    const indexes = await pg.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'subscriptions' ORDER BY indexname",
    );
    expect(indexes.rows.map((r) => r.indexname)).toEqual([
      "subscriptions_one_live_per_user",
      "subscriptions_pkey",
      "subscriptions_user_idx",
    ]);

    // The canceled row sits outside the partial index, so userB may subscribe
    // again; userA already holds a live one and may not.
    await pg.query(
      `INSERT INTO subscriptions (user_id, plan_code, status, current_period_start, current_period_end)
       VALUES ('${userB}', 'pro', 'active', now(), now())`,
    );
    await expect(
      pg.query(
        `INSERT INTO subscriptions (user_id, plan_code, status, current_period_start, current_period_end)
         VALUES ('${userA}', 'pro', 'suspended', now(), now())`,
      ),
    ).rejects.toThrow(/subscriptions_one_live_per_user/);

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

  it("0044-0047: Hebrew plan names, the sumit default, the scheduled column, terms_acceptances, anonymous feedback", async () => {
    const { db, pg } = await createTestDb();

    // 0044 (a): the guarded UPDATEs fired on 0001's Latin seed — a replay from
    // empty lands on the Hebrew by construction. Pinned by identity so a hand
    // edit in the SQL editor cannot drift from the migration silently.
    const plans = await db.select().from(schema.plans).orderBy(schema.plans.code);
    expect(plans.map((p) => [p.code, p.name])).toEqual([
      ["pro", "מתקדם"],
      ["starter", "התחלה"],
      ["studio", "פרימיום"],
    ]);
    // 0044 (b): the column default, read from the catalog rather than by
    // inserting a row — drizzle's own default would mask a missed ALTER.
    const gatewayDefault = await pg.query<{ column_default: string }>(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name = 'subscriptions' AND column_name = 'gateway'`,
    );
    expect(gatewayDefault.rows[0]?.column_default).toBe("'sumit'::text");

    // 0045: nullable, and the FK is real (the billing suite proves the refusal).
    const scheduled = await pg.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'subscriptions' AND column_name = 'scheduled_plan_code'`,
    );
    expect(scheduled.rows[0]?.is_nullable).toBe("YES");

    // 0046: 0035's server-only shape — RLS on, zero policies, one user index.
    const rls = await pg.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.terms_acceptances'::regclass",
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
    const policies = await pg.query(
      "SELECT 1 FROM pg_policies WHERE tablename = 'terms_acceptances'",
    );
    expect(policies.rows).toHaveLength(0);
    const indexes = await pg.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'terms_acceptances' ORDER BY indexname",
    );
    expect(indexes.rows.map((r) => r.indexname)).toEqual([
      "terms_acceptances_pkey",
      "terms_acceptances_user_idx",
    ]);
    await expect(
      db.insert(schema.termsAcceptances).values({
        userId: "00000000-0000-0000-0000-000000000003",
        termsVersion: "11.09.2026",
        context: "checkout",
      }),
    ).rejects.toThrow(/foreign key/i);

    // 0047: an anonymous row is accepted; the 0035 test above still proves a
    // bad user_id is refused, so the FK survived the DROP NOT NULL.
    const [anon] = await db
      .insert(schema.feedback)
      .values({
        message: "מהטופס הציבורי",
        contactName: "דנה",
        contactEmail: "dana@example.co.il",
        ip: "203.0.113.7",
      })
      .returning();
    expect(anon?.userId).toBeNull();
    expect(anon?.contactEmail).toBe("dana@example.co.il");

    await pg.close();
  });

  it("0048: checkout_intents — server-only RLS, the status CHECK, the unique payment id, three FKs", async () => {
    const { db, pg } = await createTestDb();

    const rls = await pg.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.checkout_intents'::regclass",
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
    expect(
      (await pg.query("SELECT 1 FROM pg_policies WHERE tablename = 'checkout_intents'")).rows,
    ).toHaveLength(0);
    const indexes = await pg.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'checkout_intents' ORDER BY indexname",
    );
    expect(indexes.rows.map((r) => r.indexname)).toEqual([
      "checkout_intents_pkey",
      "checkout_intents_sumit_payment_id_unique",
      "checkout_intents_user_status_idx",
    ]);
    const columns = await pg.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'checkout_intents'",
    );
    expect(columns.rows).toHaveLength(10);

    const [user] = await db.insert(schema.users).values({ email: "buyer@test.local" }).returning();
    const base = { userId: user!.id, planCode: "starter", priceAgorot: 15000 };

    // The CHECK: only the three statuses.
    await expect(
      db.insert(schema.checkoutIntents).values({ ...base, status: "bogus" }),
    ).rejects.toThrow(/checkout_intents_status_check/);
    // Three FKs.
    await expect(
      db
        .insert(schema.checkoutIntents)
        .values({ ...base, userId: "00000000-0000-0000-0000-000000000009" }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      db.insert(schema.checkoutIntents).values({ ...base, planCode: "platinum" }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      db.insert(schema.checkoutIntents).values({
        ...base,
        termsAcceptanceId: "00000000-0000-0000-0000-000000000009",
      }),
    ).rejects.toThrow(/foreign key/i);
    // One payment completes one intent; pending rows (NULL) may repeat.
    await db.insert(schema.checkoutIntents).values([{ ...base }, { ...base }]);
    await db
      .insert(schema.checkoutIntents)
      .values({ ...base, status: "completed", sumitPaymentId: "2376907759" });
    await expect(
      db
        .insert(schema.checkoutIntents)
        .values({ ...base, status: "completed", sumitPaymentId: "2376907759" }),
    ).rejects.toThrow(/checkout_intents_sumit_payment_id_unique/);

    await pg.close();
  });

  it("0049: hook_clips.text_color — existing clips backfill white, new ones default white, CHECK allows white|black only", async () => {
    // The pre-0049 shape with a clip already in it, because every other test
    // applies 0049 to an EMPTY hook_clips table and nothing else would ever
    // run the backfill — the production case (decision 0073).
    const pg = new PGlite();
    for (const file of PORTABLE_MIGRATIONS.filter((f) => f < "0049")) {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
    await pg.exec(`
      INSERT INTO hook_clips (file_path, duration_ms, text_safe_area)
      VALUES ('assets/bank/hook_clip/old/clip.mp4', 3000, '{"x":25,"y":1062,"w":1009,"h":179}');
    `);
    const migration = readFileSync(join(MIGRATIONS_DIR, "0049_hook_clips_text_color.sql"), "utf8");
    await pg.exec(migration);
    // Idempotent: a second apply is a no-op, not a duplicate-constraint error.
    await pg.exec(migration);

    const existing = await pg.query<{ text_color: string }>("SELECT text_color FROM hook_clips");
    expect(existing.rows).toEqual([{ text_color: "white" }]);
    await pg.close();

    const { db, pg: fresh } = await createTestDb();
    const base = { durationMs: 3000, textSafeArea: { x: 25, y: 1062, w: 1009, h: 179 } };
    const [unchosen] = await db
      .insert(schema.hookClips)
      .values({ ...base, filePath: "assets/a.mp4" })
      .returning();
    expect(unchosen!.textColor).toBe("white");
    const [black] = await db
      .insert(schema.hookClips)
      .values({ ...base, filePath: "assets/b.mp4", textColor: "black" })
      .returning();
    expect(black!.textColor).toBe("black");

    for (const bad of ["gray", "#000000", "White"]) {
      await expect(
        db.insert(schema.hookClips).values({ ...base, filePath: "assets/c.mp4", textColor: bad }),
      ).rejects.toThrow(/hook_clips_text_color_check/);
      await expect(
        db
          .update(schema.hookClips)
          .set({ textColor: bad })
          .where(eq(schema.hookClips.id, black!.id)),
      ).rejects.toThrow(/hook_clips_text_color_check/);
    }

    await fresh.close();
  });

  it("0050: demo_analysis_footage — server-only RLS, one row per analysis, the FK, idempotent", async () => {
    const { db, pg } = await createTestDb();
    // A second apply is a no-op, not a duplicate-table or duplicate-constraint error.
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, "0050_demo_analysis_footage.sql"), "utf8"));

    const rls = await pg.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.demo_analysis_footage'::regclass",
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
    expect(
      (await pg.query("SELECT 1 FROM pg_policies WHERE tablename = 'demo_analysis_footage'")).rows,
    ).toHaveLength(0);
    const columns = await pg.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'demo_analysis_footage'",
    );
    expect(columns.rows).toHaveLength(8);
    const constraints = await pg.query<{ conname: string }>(
      "SELECT conname FROM pg_constraint WHERE conrelid = 'public.demo_analysis_footage'::regclass ORDER BY conname",
    );
    expect(constraints.rows.map((r) => r.conname)).toEqual([
      "demo_analysis_footage_analysis_id_demo_analyses_id_fk",
      "demo_analysis_footage_pkey",
    ]);

    const base = {
      fps: 5,
      fileSha: "0".repeat(64),
      moments: [{ t: 0, startMs: 0, endMs: 200, read: true }],
    };
    // The FK: a footage row needs its analysis.
    await expect(
      db
        .insert(schema.demoAnalysisFootage)
        .values({ ...base, analysisId: "00000000-0000-0000-0000-000000000009" }),
    ).rejects.toThrow(/foreign key/i);

    const [user] = await db
      .insert(schema.users)
      .values({ email: "footage@test.local" })
      .returning();
    const [business] = await db
      .insert(schema.businesses)
      .values({ ownerUserId: user!.id, name: "עסק" })
      .returning();
    const [demo] = await db
      .insert(schema.demos)
      .values({ businessId: business!.id, status: "ready" })
      .returning();
    const [analysis] = await db
      .insert(schema.demoAnalyses)
      .values({ demoId: demo!.id, status: "pending" })
      .returning();

    // Instants are optional: NULL is "not computed".
    const [row] = await db
      .insert(schema.demoAnalysisFootage)
      .values({ ...base, analysisId: analysis!.id })
      .returning();
    expect(row).toMatchObject({ fps: 5, detector: null, instants: null, moments: base.moments });
    // One row per analysis.
    await expect(
      db.insert(schema.demoAnalysisFootage).values({ ...base, analysisId: analysis!.id }),
    ).rejects.toThrow(/demo_analysis_footage_pkey/);

    await pg.close();
  });

  it("0051: service_kind gains 'c' and script_kind gains 'text_block', last, idempotently", async () => {
    const { pg } = await createTestDb();
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, "0051_service_c_enums.sql"), "utf8"));

    const labels = async (type: string) =>
      (
        await pg.query<{ enumlabel: string }>(
          `SELECT enumlabel FROM pg_enum WHERE enumtypid = '${type}'::regtype ORDER BY enumsortorder`,
        )
      ).rows.map((r) => r.enumlabel);
    expect(await labels("public.service_kind")).toEqual(["a", "b", "c"]);
    expect(await labels("public.script_kind")).toEqual([
      "hook_line",
      "benefit_captions",
      "vo_script",
      "b_script",
      "text_block",
    ]);
    await pg.close();
  });

  it("0052: text_block_clips — server-only RLS, the two CHECKs, white by default, idempotent", async () => {
    // The structure as 0052 left it, so 0054's persona_id is not counted. Raw
    // SQL only: drizzle's .returning() would select the column 0054 adds.
    const pg = new PGlite();
    for (const file of PORTABLE_MIGRATIONS.filter((f) => f <= "0052_text_block_clips.sql")) {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, "0052_text_block_clips.sql"), "utf8"));

    const rls = await pg.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.text_block_clips'::regclass",
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
    expect(
      (await pg.query("SELECT 1 FROM pg_policies WHERE tablename = 'text_block_clips'")).rows,
    ).toHaveLength(0);
    expect(
      (
        await pg.query(
          "SELECT 1 FROM information_schema.columns WHERE table_name = 'text_block_clips'",
        )
      ).rows,
    ).toHaveLength(8);
    const constraints = await pg.query<{ conname: string }>(
      "SELECT conname FROM pg_constraint WHERE conrelid = 'public.text_block_clips'::regclass ORDER BY conname",
    );
    expect(constraints.rows.map((r) => r.conname)).toEqual([
      "text_block_clips_pkey",
      "text_block_clips_speaker_gender_check",
      "text_block_clips_text_color_check",
    ]);
    await pg.close();

    const { db, pg: fresh } = await createTestDb();
    const base = {
      filePath: "assets/bank/text_block_clip/x/clip.mp4",
      durationMs: 10_000,
      textSafeArea: { x: 80, y: 360, w: 820, h: 1040 },
    };
    const [row] = await db
      .insert(schema.textBlockClips)
      .values({ ...base, speakerGender: "female" })
      .returning();
    expect(row).toMatchObject({ textColor: "white", active: true, speakerGender: "female" });
    await expect(
      db.insert(schema.textBlockClips).values({ ...base, speakerGender: "other" }),
    ).rejects.toThrow(/text_block_clips_speaker_gender_check/);
    await expect(
      db
        .insert(schema.textBlockClips)
        .values({ ...base, speakerGender: "male", textColor: "gray" }),
    ).rejects.toThrow(/text_block_clips_text_color_check/);
    await fresh.close();
  });

  it("0053: credit_costs gains c_text_block_credits = 25 as a jsonb number, the other ten keys byte-equal, re-apply restates 25", async () => {
    // The pre-0053 row: on createTestDb() the key is already there, and the
    // point is what the UPDATE leaves alone.
    const pg = new PGlite();
    for (const file of PORTABLE_MIGRATIONS.filter((f) => f < "0053")) {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
    const read = async () =>
      (
        await pg.query<{ others: string; added: unknown; kind: string | null; keys: number }>(
          `SELECT (value - 'c_text_block_credits')::text AS others,
                  value -> 'c_text_block_credits' AS added,
                  jsonb_typeof(value -> 'c_text_block_credits') AS kind,
                  (SELECT count(*)::int FROM jsonb_object_keys(value)) AS keys
           FROM app_config WHERE key = 'credit_costs'`,
        )
      ).rows[0]!;
    const before = await read();
    expect(before).toMatchObject({ added: null, kind: null, keys: 10 });

    const migration = readFileSync(join(MIGRATIONS_DIR, "0053_text_block_credits.sql"), "utf8");
    await pg.exec(migration);
    // A bare number, never '"25"' — z.number() would refuse a string at the next quote.
    expect(await read()).toEqual({ others: before.others, added: 25, kind: "number", keys: 11 });

    // Unconditional, like 0039: a re-run restates the founder's value over a hand edit.
    await pg.query(
      `UPDATE app_config SET value = value || '{"c_text_block_credits": 30}'::jsonb WHERE key = 'credit_costs'`,
    );
    await pg.exec(migration);
    expect(await read()).toEqual({ others: before.others, added: 25, kind: "number", keys: 11 });

    await pg.close();
  });

  it("0054: text_block_clips.persona_id — an existing clip stays unassigned, the FK by name, idempotent", async () => {
    // The pre-0054 shape with a clip already in it — the production case:
    // every phase-1 clip predates the column (0049's reasoning).
    const pg = new PGlite();
    for (const file of PORTABLE_MIGRATIONS.filter((f) => f < "0054")) {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
    await pg.exec(`
      INSERT INTO text_block_clips (file_path, duration_ms, speaker_gender, text_safe_area)
      VALUES ('assets/bank/text_block_clip/old/clip.mp4', 10000, 'female', '{"x":80,"y":360,"w":820,"h":1040}');
    `);
    const migration = readFileSync(
      join(MIGRATIONS_DIR, "0054_text_block_clip_persona.sql"),
      "utf8",
    );
    await pg.exec(migration);
    // Idempotent: a second apply is a no-op, not a duplicate-column or duplicate-constraint error.
    await pg.exec(migration);

    const existing = await pg.query<{ persona_id: string | null }>(
      "SELECT persona_id FROM text_block_clips",
    );
    expect(existing.rows).toEqual([{ persona_id: null }]);
    expect(
      (
        await pg.query(
          "SELECT 1 FROM information_schema.columns WHERE table_name = 'text_block_clips'",
        )
      ).rows,
    ).toHaveLength(9);
    const fks = await pg.query<{ conname: string; contype: string }>(
      "SELECT conname, contype FROM pg_constraint WHERE conname = 'text_block_clips_persona_id_personas_id_fk'",
    );
    expect(fks.rows).toEqual([
      { conname: "text_block_clips_persona_id_personas_id_fk", contype: "f" },
    ]);

    // The FK is real: a bogus persona is refused, a real one is accepted.
    await expect(
      pg.query("UPDATE text_block_clips SET persona_id = '00000000-0000-0000-0000-000000000001'"),
    ).rejects.toThrow(/foreign key/i);
    const persona = await pg.query<{ id: string }>(
      "INSERT INTO personas (name, voice_id) VALUES ('נועה', 'voice_noa') RETURNING id",
    );
    await pg.query("UPDATE text_block_clips SET persona_id = $1", [persona.rows[0]!.id]);

    await pg.close();
  });

  it("0055: personas.voice_id drops NOT NULL — a voiceless persona inserts, idempotent", async () => {
    const pg = new PGlite();
    for (const file of PORTABLE_MIGRATIONS.filter((f) => f < "0055")) {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
    await expect(pg.query("INSERT INTO personas (name) VALUES ('בלי קול')")).rejects.toThrow(
      /voice_id/,
    );

    const migration = readFileSync(join(MIGRATIONS_DIR, "0055_persona_voice_optional.sql"), "utf8");
    await pg.exec(migration);
    // DROP NOT NULL on a nullable column is a no-op, so a second apply is too.
    await pg.exec(migration);

    const column = await pg.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'personas' AND column_name = 'voice_id'`,
    );
    expect(column.rows).toEqual([{ is_nullable: "YES" }]);
    const inserted = await pg.query<{ voice_id: string | null }>(
      "INSERT INTO personas (name) VALUES ('בלי קול') RETURNING voice_id",
    );
    expect(inserted.rows).toEqual([{ voice_id: null }]);

    await pg.close();
  });

  it("0056: scripts.shown_at — timestamptz, nullable, existing rows NULL, idempotent", async () => {
    // The pre-0056 shape with a script already in it, so "nothing is
    // backfilled" is tested on a row that predates the column.
    const pg = new PGlite();
    for (const file of PORTABLE_MIGRATIONS.filter((f) => f < "0056")) {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
    const user = "11111111-1111-4111-8111-111111111111";
    const biz = "33333333-3333-4333-8333-333333333333";
    await pg.exec(`
      INSERT INTO users (id, email) VALUES ('${user}', 'a@test.local');
      INSERT INTO businesses (id, owner_user_id, name) VALUES ('${biz}', '${user}', 'A');
      INSERT INTO scripts (business_id, kind, text) VALUES ('${biz}', 'text_block', 'טקסט ישן');
    `);
    const migration = readFileSync(join(MIGRATIONS_DIR, "0056_scripts_shown_at.sql"), "utf8");
    await pg.exec(migration);
    // Idempotent: a second apply is a no-op, not a duplicate-column error.
    await pg.exec(migration);

    const column = await pg.query<{ data_type: string; is_nullable: string }>(
      `SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_name = 'scripts' AND column_name = 'shown_at'`,
    );
    expect(column.rows).toEqual([{ data_type: "timestamp with time zone", is_nullable: "YES" }]);
    const existing = await pg.query<{ shown_at: Date | null }>("SELECT shown_at FROM scripts");
    expect(existing.rows).toEqual([{ shown_at: null }]);

    await pg.close();
  });

  it("0057: the three social enum types exist with their values in order, idempotently", async () => {
    const pg = new PGlite();
    for (const file of PORTABLE_MIGRATIONS.filter((f) => f < "0057")) {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
    const migration = readFileSync(join(MIGRATIONS_DIR, "0057_social_enums.sql"), "utf8");
    await pg.exec(migration);
    // The DO blocks swallow duplicate_object, so a second apply is a no-op.
    await pg.exec(migration);

    const types = await pg.query<{ typname: string; labels: string[] }>(
      `SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname IN ('social_platform', 'social_account_status', 'scheduled_post_status')
        GROUP BY t.typname ORDER BY t.typname`,
    );
    expect(types.rows).toEqual([
      {
        typname: "scheduled_post_status",
        labels: ["scheduled", "publishing", "posted", "failed", "cancelled"],
      },
      {
        typname: "social_account_status",
        labels: ["connected", "expired", "disconnected", "deleted"],
      },
      { typname: "social_platform", labels: ["instagram", "tiktok"] },
    ]);

    await pg.close();
  });

  it("0058: social_accounts and scheduled_posts — server-only RLS, the four FKs, the partial indexes, idempotent", async () => {
    const pg = new PGlite();
    for (const file of PORTABLE_MIGRATIONS.filter((f) => f < "0058")) {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
    const migration = readFileSync(join(MIGRATIONS_DIR, "0058_social_tables.sql"), "utf8");
    await pg.exec(migration);
    await pg.exec(migration);

    const rls = await pg.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
        WHERE relname IN ('social_accounts', 'scheduled_posts') ORDER BY relname`,
    );
    expect(rls.rows).toEqual([
      { relname: "scheduled_posts", relrowsecurity: true },
      { relname: "social_accounts", relrowsecurity: true },
    ]);
    const policies = await pg.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_policies WHERE tablename IN ('social_accounts', 'scheduled_posts')",
    );
    expect(policies.rows).toEqual([{ n: "0" }]);
    const indexes = await pg.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename IN ('social_accounts', 'scheduled_posts') ORDER BY indexname`,
    );
    expect(indexes.rows.map((r) => r.indexname)).toEqual([
      "scheduled_posts_account_scheduled_idx",
      "scheduled_posts_pkey",
      "scheduled_posts_render_pending_idx",
      "scheduled_posts_user_time_idx",
      "social_accounts_fb_user_idx",
      "social_accounts_live_idx",
      "social_accounts_pkey",
    ]);
    const fks = await pg.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.scheduled_posts'::regclass AND contype = 'f' ORDER BY conname`,
    );
    expect(fks.rows.map((r) => r.conname)).toEqual([
      "scheduled_posts_business_id_businesses_id_fk",
      "scheduled_posts_social_account_id_social_accounts_id_fk",
      "scheduled_posts_user_id_users_id_fk",
      "scheduled_posts_video_render_id_video_renders_id_fk",
    ]);

    // The live-row uniqueness: a second connected row for the same account is
    // refused, a disconnected one lets a fresh row in.
    const user = "11111111-1111-4111-8111-111111111111";
    await pg.exec(`INSERT INTO users (id, email) VALUES ('${user}', 'a@test.local')`);
    await pg.exec(
      `INSERT INTO social_accounts (user_id, platform, external_id) VALUES ('${user}', 'instagram', 'ig1')`,
    );
    await expect(
      pg.query(
        `INSERT INTO social_accounts (user_id, platform, external_id) VALUES ('${user}', 'instagram', 'ig1')`,
      ),
    ).rejects.toThrow(/social_accounts_live_idx/);
    await pg.exec(`UPDATE social_accounts SET status = 'disconnected'`);
    await pg.exec(
      `INSERT INTO social_accounts (user_id, platform, external_id) VALUES ('${user}', 'instagram', 'ig1')`,
    );
    const count = await pg.query<{ n: string }>("SELECT count(*)::text AS n FROM social_accounts");
    expect(count.rows).toEqual([{ n: "2" }]);

    await pg.close();
  });

  it("0059: the alert index predicate gains post_failed, idempotently", async () => {
    const pg = new PGlite();
    for (const file of PORTABLE_MIGRATIONS.filter((f) => f < "0059")) {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }
    const before = await pg.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'events_unnotified_alerts_idx'",
    );
    expect(before.rows[0]!.indexdef).not.toContain("post_failed");

    const migration = readFileSync(
      join(MIGRATIONS_DIR, "0059_events_alert_index_post_failed.sql"),
      "utf8",
    );
    await pg.exec(migration);
    await pg.exec(migration);

    const after = await pg.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'events_unnotified_alerts_idx'",
    );
    expect(after.rows).toHaveLength(1);
    for (const kind of ["platform_budget_tripped", "auth_email_send_failed", "post_failed"]) {
      expect(after.rows[0]!.indexdef).toContain(kind);
    }

    await pg.close();
  });
});
