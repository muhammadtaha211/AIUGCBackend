import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { runLane } from "../src/jobs/worker";
import { addPersona } from "../src/pipelines/bank";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import { generateTextBlocks } from "../src/pipelines/copy";
import { creditBalance, grantCredits, InsufficientCreditsError } from "../src/pipelines/credits";
import { handleReapDeadRenders } from "../src/pipelines/janitor";
import { RENDER_RETRIES_EXHAUSTED_MESSAGE } from "../src/pipelines/renders";
import { quoteTextBlockRender } from "../src/pipelines/sets";
import { createTextBlockRender } from "../src/pipelines/text-blocks";
import { getStorage, setStorage, storageKey } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * Service C end to end in DRY_RUN (real DB + jobs + storage, the render
 * stubbed): createTextBlockRender is the choke point — the clip's character,
 * the burn check, the content-policy gate, and since phase 2 the third debit
 * site (decision 0099: 25 credits, refunded on failure like A and B) — and the
 * render releases like a Service A render, never into qc_pending, with the
 * clip's ink read off the row.
 */

let db: Db;
let pg: { close(): Promise<void> };
let storageRoot: string;
let cleanupStorage: () => void;
let adminBusinessId: string;
let customerBusinessId: string;
let customerOwnerId: string;
let customerScriptId: string;
let femalePersonaId: string;
let clipId: string;
let blackClipId: string;
let inactiveClipId: string;
let unassignedClipId: string;
let retiredClipId: string;
let scriptId: string;

const QUESTIONNAIRE = {
  category: "app_or_digital" as const,
  product_name: "Tavnit",
  what_it_does: "מייצר סרטוני פרסום בעברית",
  advantages: ["סרטון תוך דקות"],
  target_audience: "בעלי עסקים",
  tone: "friendly" as const,
};

/** The price phase 2 shipped (0053, c_text_block_credits). */
const C_CREDITS = 25;

const RECT = { x: 80, y: 360, w: 820, h: 1040 };

async function drainAll(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
    const queued = await db
      .select()
      .from(schema.jobs)
      .where(sql`${schema.jobs.status} = 'queued'`);
    if (queued.length === 0) return;
    await db.execute(
      sql`update jobs set run_at = now() - interval '1 second' where status = 'queued'`,
    );
  }
  throw new Error("queue did not drain");
}

function tempFile(name: string): string {
  const dir = path.join(tmpdir(), "aiugc-text-block-inputs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, "fake video bytes");
  return file;
}

/** The admin register route's write, as the route does it (no core add function). */
async function registerClip(opts: {
  speakerGender: "female" | "male";
  personaId?: string;
  textColor?: "white" | "black";
  active?: boolean;
}): Promise<string> {
  const uploadId = crypto.randomUUID();
  const storage = (await import("../src/storage")).getStorage();
  const filePath = await storage.put(
    "assets",
    storageKey({ entity: "text_block_clip", id: uploadId, filename: "clip.mp4" }),
    tempFile(`${uploadId}.mp4`),
  );
  const [row] = await db
    .insert(schema.textBlockClips)
    .values({
      filePath,
      durationMs: 10_000,
      speakerGender: opts.speakerGender,
      personaId: opts.personaId,
      textSafeArea: RECT,
      textColor: opts.textColor,
      active: opts.active ?? true,
    })
    .returning();
  return row!.id;
}

beforeAll(async () => {
  process.env.DRY_RUN = "1";
  resetEnvCache();
  const testDb = await createTestDb();
  db = testDb.db;
  pg = testDb.pg;
  const ts = tempStorage();
  setStorage(ts.storage);
  storageRoot = ts.root;
  cleanupStorage = ts.cleanup;

  const admin = await createBusiness(db, {
    ownerEmail: "founder@example.com",
    name: "תבנית",
    ownerRole: "admin",
  });
  adminBusinessId = admin.id;
  await setQuestionnaire(db, adminBusinessId, QUESTIONNAIRE);
  const customer = await createBusiness(db, {
    ownerEmail: "customer@example.com",
    name: "לקוח",
  });
  customerBusinessId = customer.id;
  customerOwnerId = customer.ownerUserId;
  await setQuestionnaire(db, customerBusinessId, QUESTIONNAIRE);

  // Every clip a customer may use belongs to an active character (0099 §3).
  femalePersonaId = (await addPersona(db, { name: "נועה", gender: "female" })).id;
  const malePersonaId = (await addPersona(db, { name: "דני", gender: "male" })).id;
  const retiredPersonaId = (await addPersona(db, { name: "רותם", gender: "female" })).id;
  await db
    .update(schema.personas)
    .set({ active: false })
    .where(eq(schema.personas.id, retiredPersonaId));

  clipId = await registerClip({ speakerGender: "female", personaId: femalePersonaId });
  blackClipId = await registerClip({
    speakerGender: "male",
    personaId: malePersonaId,
    textColor: "black",
  });
  inactiveClipId = await registerClip({
    speakerGender: "female",
    personaId: femalePersonaId,
    active: false,
  });
  unassignedClipId = await registerClip({ speakerGender: "female" });
  retiredClipId = await registerClip({ speakerGender: "female", personaId: retiredPersonaId });

  const batch = await generateTextBlocks(db, { businessId: adminBusinessId, clipId });
  scriptId = batch.texts[0]!.id;
  const customerBatch = await generateTextBlocks(db, { businessId: customerBusinessId, clipId });
  customerScriptId = customerBatch.texts[0]!.id;
});

/** The ledger rows that point at one render. */
async function ledgerFor(videoRenderId: string) {
  return db.select().from(schema.creditLedger).where(eq(schema.creditLedger.refId, videoRenderId));
}

afterAll(async () => {
  await pg.close();
  cleanupStorage();
});

describe("createTextBlockRender", () => {
  it("inserts a service c render with the text pinned on params and queues render:<id>", async () => {
    const render = await createTextBlockRender(db, {
      businessId: adminBusinessId,
      clipId,
      scriptId,
    });
    expect(render.service).toBe("c");
    expect(render.status).toBe("queued");
    expect(render.watermarked).toBe(false);
    expect(render.setId).toBeNull();
    const script = (
      await db.select().from(schema.scripts).where(eq(schema.scripts.id, scriptId))
    )[0]!;
    expect(render.params).toEqual({
      textBlockClipId: clipId,
      scriptId,
      text: script.text,
      textSafeArea: RECT,
    });
    const job = (
      await db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.idempotencyKey, `render:${render.id}`))
    )[0];
    expect(job).toMatchObject({ type: "render_video", status: "queued" });
    // No lipsync job, and no debit: the founder's own business is never
    // charged (the bypass credits share), and HeyGen is never involved.
    expect(await db.select().from(schema.creditLedger)).toHaveLength(0);
  });

  it("a funded customer on a character's clip is quoted and debited 25, with the placed box pinned on params", async () => {
    await grantCredits(db, { userId: customerOwnerId, credits: C_CREDITS, note: "test" });
    const before = await creditBalance(db, customerOwnerId);
    const quote = await quoteTextBlockRender(db, customerBusinessId);
    expect(quote).toMatchObject({ chargeable: true, creditsPerRender: C_CREDITS, balance: before });

    const placed = { x: 120, y: 500, w: 700, h: 800 };
    const render = await createTextBlockRender(db, {
      businessId: customerBusinessId,
      clipId,
      scriptId: customerScriptId,
      textSafeArea: placed,
    });

    expect(render.params).toMatchObject({ textBlockClipId: clipId, textSafeArea: placed });
    const ledger = await ledgerFor(render.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      reason: "debit_render",
      delta: -C_CREDITS,
      refId: render.id,
      businessId: customerBusinessId,
      userId: customerOwnerId,
    });
    expect(await creditBalance(db, customerOwnerId)).toBe(before - C_CREDITS);
  });

  it("a customer who places no box burns the clip's own area", async () => {
    await grantCredits(db, { userId: customerOwnerId, credits: C_CREDITS, note: "test" });
    const render = await createTextBlockRender(db, {
      businessId: customerBusinessId,
      clipId,
      scriptId: customerScriptId,
    });
    expect(render.params).toMatchObject({ textSafeArea: RECT });
    expect(await ledgerFor(render.id)).toHaveLength(1);
  });

  it("refuses a box outside the frame before any row or debit", async () => {
    await grantCredits(db, { userId: customerOwnerId, credits: C_CREDITS, note: "test" });
    const renders = (await db.select().from(schema.videoRenders)).length;
    const balance = await creditBalance(db, customerOwnerId);

    await expect(
      createTextBlockRender(db, {
        businessId: customerBusinessId,
        clipId,
        scriptId: customerScriptId,
        textSafeArea: { x: 600, y: 360, w: 820, h: 1040 },
      }),
    ).rejects.toBeInstanceOf(ZodError);

    expect(await db.select().from(schema.videoRenders)).toHaveLength(renders);
    expect(await creditBalance(db, customerOwnerId)).toBe(balance);
  });

  it("a customer at 0 credits is refused with InsufficientCreditsError: no render row, no ledger row", async () => {
    const broke = await createBusiness(db, {
      ownerEmail: "broke@example.com",
      name: "בלי קרדיטים",
    });
    await setQuestionnaire(db, broke.id, QUESTIONNAIRE);
    const batch = await generateTextBlocks(db, { businessId: broke.id, clipId });

    const err = await createTextBlockRender(db, {
      businessId: broke.id,
      clipId,
      scriptId: batch.texts[0]!.id,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InsufficientCreditsError);
    expect(err).toMatchObject({ needed: C_CREDITS, balance: 0 });
    expect(
      await db
        .select()
        .from(schema.videoRenders)
        .where(eq(schema.videoRenders.businessId, broke.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.userId, broke.ownerUserId)),
    ).toHaveLength(0);
  });

  it("refuses, for a customer, a clip with no character and one whose character is inactive; the founder's business may use an unassigned clip, uncharged", async () => {
    await grantCredits(db, { userId: customerOwnerId, credits: C_CREDITS, note: "test" });
    for (const id of [unassignedClipId, retiredClipId]) {
      await expect(
        createTextBlockRender(db, {
          businessId: customerBusinessId,
          clipId: id,
          scriptId: customerScriptId,
        }),
      ).rejects.toThrow(/belongs to no active character/);
    }

    const render = await createTextBlockRender(db, {
      businessId: adminBusinessId,
      clipId: unassignedClipId,
      scriptId,
    });
    expect(render.service).toBe("c");
    expect(await ledgerFor(render.id)).toHaveLength(0);
  });

  it("refuses an inactive clip, a foreign script, a non-text-block script, and an unburnable edit", async () => {
    await expect(
      createTextBlockRender(db, { businessId: adminBusinessId, clipId: inactiveClipId, scriptId }),
    ).rejects.toThrow(/is not active/);

    const customerBatch = await generateTextBlocks(db, { businessId: customerBusinessId, clipId });
    await expect(
      createTextBlockRender(db, {
        businessId: adminBusinessId,
        clipId,
        scriptId: customerBatch.texts[0]!.id,
      }),
    ).rejects.toThrow(/different business/);

    const [hookLine] = await db
      .insert(schema.scripts)
      .values({ businessId: adminBusinessId, kind: "hook_line", text: "שלום", params: {} })
      .returning();
    await expect(
      createTextBlockRender(db, { businessId: adminBusinessId, clipId, scriptId: hookLine!.id }),
    ).rejects.toThrow(/not a text block/);

    // An edit is free of content rules, not of render rules: a glyph that
    // cannot burn is refused here too.
    const [emoji] = await db
      .insert(schema.scripts)
      .values({
        businessId: adminBusinessId,
        kind: "text_block",
        text: "זה 🔥 זה",
        params: {},
        userEdited: true,
      })
      .returning();
    await expect(
      createTextBlockRender(db, { businessId: adminBusinessId, clipId, scriptId: emoji!.id }),
    ).rejects.toThrow(/U\+1F525/);
  });

  it("renders an edited text with an em or en dash: the dash rule is the generator's, never the edit's (0091, amended)", async () => {
    const [dashed] = await db
      .insert(schema.scripts)
      .values({
        businessId: adminBusinessId,
        kind: "text_block",
        text: "אין לי מושג — אבל שאפו – באמת",
        params: {},
        userEdited: true,
      })
      .returning();
    const render = await createTextBlockRender(db, {
      businessId: adminBusinessId,
      clipId,
      scriptId: dashed!.id,
    });
    expect(render.service).toBe("c");
    expect((render.params as { text: string }).text).toBe("אין לי מושג — אבל שאפו – באמת");
  });

  it("refuses a text written for one speaker gender over the other gender's clip", async () => {
    // scriptId was generated over the female clip; blackClipId is the male one.
    await expect(
      createTextBlockRender(db, { businessId: adminBusinessId, clipId: blackClipId, scriptId }),
    ).rejects.toThrow(/written for a female speaker; the clip's speaker is male/);
  });
});

describe("the render job", () => {
  it(
    "releases straight away — never qc_pending — even with auto_release_b false, and burns the clip's ink off the row",
    { timeout: 60_000 },
    async () => {
      // 0031 seeds auto_release_b true (vault 0036). Flip it off here: a C
      // render releases through its own branch, never through B's flag.
      await db
        .update(schema.appConfig)
        .set({ value: false })
        .where(eq(schema.appConfig.key, "auto_release_b"));
      const flag = (
        await db.select().from(schema.appConfig).where(eq(schema.appConfig.key, "auto_release_b"))
      )[0];
      expect(flag?.value).toBe(false);

      const black = await generateTextBlocks(db, {
        businessId: adminBusinessId,
        clipId: blackClipId,
      });
      const render = await createTextBlockRender(db, {
        businessId: adminBusinessId,
        clipId: blackClipId,
        scriptId: black.texts[6]!.id, // the quiz: line breaks travel to the frame
      });
      await drainAll();

      const row = (
        await db.select().from(schema.videoRenders).where(eq(schema.videoRenders.id, render.id))
      )[0]!;
      expect(row.status).toBe("released");
      expect(row.releasedAt).not.toBeNull();
      expect(row.filePath).toMatch(
        new RegExp(`renders/${adminBusinessId}/video/${render.id}/final\\.mp4$`),
      );

      // The DRY_RUN render echoes the props it was handed: the clip, the text
      // with its newlines, the rect, and the black ink — kind first.
      const renderedProps = readFileSync(path.join(storageRoot, row.filePath!), "utf8");
      expect(renderedProps).toContain('"kind":"service_c"');
      expect(renderedProps).toContain(`"clipPath":`);
      expect(renderedProps).toContain(JSON.stringify(black.texts[6]!.text).slice(0, 60));
      // jsonb hands the rect back with its keys in Postgres order (length, then
      // alphabetical), which is the order the echo carries.
      expect(renderedProps).toContain('"textSafeArea":{"h":1040,"w":820,"x":80,"y":360}');
      expect(renderedProps).toContain('"textInk":{"fill":"black","outline":"255,255,255"}');
      expect(renderedProps).toContain('"watermark":false');
    },
  );

  it(
    "a funded render whose clip vanished after enqueue fails through the handler and refunds the 25 once",
    { timeout: 60_000 },
    async () => {
      await grantCredits(db, { userId: customerOwnerId, credits: C_CREDITS, note: "test" });
      const vanishing = await registerClip({ speakerGender: "female", personaId: femalePersonaId });
      const before = await creditBalance(db, customerOwnerId);
      const render = await createTextBlockRender(db, {
        businessId: customerBusinessId,
        clipId: vanishing,
        scriptId: customerScriptId,
      });
      expect(await creditBalance(db, customerOwnerId)).toBe(before - C_CREDITS);

      // The object disappears between confirm and render (deleted, janitored):
      // a missing object is a PermanentError, so the handler fails it at once.
      const clip = (
        await db.select().from(schema.textBlockClips).where(eq(schema.textBlockClips.id, vanishing))
      )[0]!;
      await getStorage().remove(clip.filePath);
      await drainAll();

      const row = (
        await db.select().from(schema.videoRenders).where(eq(schema.videoRenders.id, render.id))
      )[0]!;
      expect(row.status).toBe("failed");
      expect(row.error).toMatch(/קובץ המקור לא נמצא/);
      expect(row.refundedAt).not.toBeNull();
      const refunds = (await ledgerFor(render.id)).filter((r) => r.reason === "refund_failed");
      expect(refunds).toHaveLength(1);
      expect(refunds[0]!.delta).toBe(C_CREDITS);
      expect(await creditBalance(db, customerOwnerId)).toBe(before);
    },
  );

  it("a funded render whose job died with no code running is refunded by the reaper", async () => {
    await grantCredits(db, { userId: customerOwnerId, credits: C_CREDITS, note: "test" });
    const before = await creditBalance(db, customerOwnerId);
    const render = await createTextBlockRender(db, {
      businessId: customerBusinessId,
      clipId,
      scriptId: customerScriptId,
    });

    // A worker OOM/kill leaves exactly this shape: the job dead, the render
    // never told. The reaper sweep is the net (credits-wiring's refunds case).
    await db
      .update(schema.jobs)
      .set({ status: "dead", lastError: "boom" })
      .where(eq(schema.jobs.idempotencyKey, `render:${render.id}`));
    await handleReapDeadRenders(
      {} as never,
      { db, log: { info() {}, warn() {}, error() {} } } as never,
    );

    const row = (
      await db.select().from(schema.videoRenders).where(eq(schema.videoRenders.id, render.id))
    )[0]!;
    expect(row.status).toBe("failed");
    expect(row.error).toBe(RENDER_RETRIES_EXHAUSTED_MESSAGE);
    expect(row.refundedAt).not.toBeNull();
    const refunds = (await ledgerFor(render.id)).filter((r) => r.reason === "refund_failed");
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.delta).toBe(C_CREDITS);
    expect(await creditBalance(db, customerOwnerId)).toBe(before);
  });

  it("the normalize job for a text block clip is registered and is a no-op under DRY_RUN", async () => {
    const { requestTextBlockClipNormalize } = await import("../src/pipelines/bank");
    await requestTextBlockClipNormalize(db, clipId);
    const job = (
      await db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.idempotencyKey, `normalize_text_block_clip:${clipId}`))
    )[0]!;
    expect(job.type).toBe("normalize_text_block_clip");
    expect(buildHandlers()).toHaveProperty("normalize_text_block_clip");
    await drainAll();
    const done = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)))[0]!;
    expect(done.status).toBe("succeeded");
  });
});
