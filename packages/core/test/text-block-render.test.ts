import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { runLane } from "../src/jobs/worker";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import { generateTextBlocks } from "../src/pipelines/copy";
import { createTextBlockRender } from "../src/pipelines/text-blocks";
import { setStorage, storageKey } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * Service C end to end in DRY_RUN (real DB + jobs + storage, the render
 * stubbed): createTextBlockRender is the choke point — admin-owned only in
 * phase 1, the burn check, the content-policy gate — and the render releases
 * like a Service A render, never into qc_pending, with the clip's ink read off
 * the row.
 */

let db: Db;
let pg: { close(): Promise<void> };
let storageRoot: string;
let cleanupStorage: () => void;
let adminBusinessId: string;
let customerBusinessId: string;
let clipId: string;
let blackClipId: string;
let inactiveClipId: string;
let scriptId: string;

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
  const questionnaire = {
    category: "app_or_digital" as const,
    product_name: "Tavnit",
    what_it_does: "מייצר סרטוני פרסום בעברית",
    advantages: ["סרטון תוך דקות"],
    target_audience: "בעלי עסקים",
    tone: "friendly" as const,
  };
  await setQuestionnaire(db, adminBusinessId, questionnaire);
  const customer = await createBusiness(db, {
    ownerEmail: "customer@example.com",
    name: "לקוח",
  });
  customerBusinessId = customer.id;
  await setQuestionnaire(db, customerBusinessId, questionnaire);

  clipId = await registerClip({ speakerGender: "female" });
  blackClipId = await registerClip({ speakerGender: "male", textColor: "black" });
  inactiveClipId = await registerClip({ speakerGender: "female", active: false });

  const batch = await generateTextBlocks(db, { businessId: adminBusinessId, clipId });
  scriptId = batch.texts[0]!.id;
});

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
    // No lipsync job, no debit: phase 1 charges nothing and HeyGen is never involved.
    expect(await db.select().from(schema.creditLedger)).toHaveLength(0);
  });

  it("refuses a business that is not admin-owned — phase 1 has no credit key", async () => {
    const batch = await generateTextBlocks(db, { businessId: customerBusinessId, clipId });
    await expect(
      createTextBlockRender(db, {
        businessId: customerBusinessId,
        clipId,
        scriptId: batch.texts[0]!.id,
      }),
    ).rejects.toThrow(/admin-only in phase 1/);
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

    // An edit is free of content rules, not of render rules: the dash the
    // generator is told never to write is refused here too.
    const [dashed] = await db
      .insert(schema.scripts)
      .values({
        businessId: adminBusinessId,
        kind: "text_block",
        text: "זה — זה",
        params: {},
        userEdited: true,
      })
      .returning();
    await expect(
      createTextBlockRender(db, { businessId: adminBusinessId, clipId, scriptId: dashed!.id }),
    ).rejects.toThrow(/קו מפריד ארוך/);
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
