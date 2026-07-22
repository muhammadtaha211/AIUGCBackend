import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { runLane } from "../src/jobs/worker";
import { addHookClip, addPersona, addPersonaClip, addStructure } from "../src/pipelines/bank";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import { approveComposite, createComposite } from "../src/pipelines/composites";
import {
  assertWithinWordBudget,
  generateBenefitCaptions,
  generateBScript,
  generateHookLines,
  generateVoScript,
  updateScriptText,
} from "../src/pipelines/copy";
import { creditBalance } from "../src/pipelines/credits";
import { createDemo } from "../src/pipelines/demos";
import { listQcQueue, releaseRender } from "../src/pipelines/qc";
import { createBRender, createSet, moreLikeThis, starVariant } from "../src/pipelines/sets";
import { approveAudio, requestAudio } from "../src/pipelines/tts";
import { setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * The founder workflow end-to-end in DRY_RUN (all external providers stubbed,
 * real DB + jobs + storage): exactly what `aiugc ...` runs for outreach samples.
 */

let db: Db;
let pg: { close(): Promise<void> };
let storageRoot: string;
let cleanupStorage: () => void;
const eq = sql;
void eq;

/** Drain the queue, fast-forwarding rescheduled (polling) jobs. */
async function drainAll(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
    const queued = await db
      .select()
      .from(dbSchema.jobs)
      .where(sql`${dbSchema.jobs.status} = 'queued'`);
    if (queued.length === 0) return;
    await db.execute(
      sql`update jobs set run_at = now() - interval '1 second' where status = 'queued'`,
    );
  }
  throw new Error("queue did not drain");
}

function tempFile(name: string, content = "fake video bytes"): string {
  const dir = path.join(tmpdir(), "aiugc-e2e-inputs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
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
});

afterAll(async () => {
  setStorage(undefined);
  cleanupStorage();
  await pg.close();
});

describe("founder workflow (dry-run, end to end)", () => {
  let businessId: string;
  let demoId: string;
  let hookClipId: string;
  let hookLineIds: string[];
  let captionScriptId: string;
  let releasedVariantId: string;

  it("business + questionnaire + demo ingest", { timeout: 60_000 }, async () => {
    const business = await createBusiness(db, {
      ownerEmail: "founder@example.com",
      name: "מסעדת הבית",
      ownerRole: "admin",
    });
    businessId = business.id;
    await setQuestionnaire(db, businessId, {
      category: "local_service",
      product_name: "מסעדת הבית",
      what_it_does: "אוכל ביתי במשלוח עד הבית",
      advantages: ["משלוח תוך 30 דקות", "תפריט מתחלף יומי", "מחיר קבוע"],
      target_audience: "משפחות עסוקות",
      tone: "friendly",
    });

    const demo = await createDemo(db, { businessId, filePath: tempFile("demo.mp4") });
    demoId = demo.id;
    await drainAll();

    const rows = await db.select().from(dbSchema.demos);
    expect(rows[0]!.status).toBe("ready");
    expect(rows[0]!.durationMs).toBe(20_000);
  });

  it("copy generation (hooks + captions)", { timeout: 60_000 }, async () => {
    const hooks = await generateHookLines(db, { businessId, n: 2 });
    hookLineIds = hooks.map((h) => h.id);
    expect(hooks).toHaveLength(2);
    expect(hooks[0]!.text.length).toBeGreaterThan(0);

    const captions = await generateBenefitCaptions(db, { businessId, demoId });
    captionScriptId = captions.id;
    expect((captions.params as { lines: string[] }).lines.length).toBeGreaterThanOrEqual(5);
  });

  it("silent set: hook clips x hook lines -> released renders", { timeout: 60_000 }, async () => {
    const clip = await addHookClip(db, {
      filePath: tempFile("hook.mp4"),
      durationMs: 2000,
      textSafeArea: { x: 100, y: 200, w: 880, h: 400 },
    });
    hookClipId = clip.id;

    const { renders } = await createSet(db, {
      businessId,
      demoId,
      grid: {
        hookClipIds: [hookClipId],
        hookLineScriptIds: hookLineIds,
        mode: "silent",
        captionScriptId,
      },
    });
    expect(renders).toHaveLength(2);
    await drainAll();

    const rows = await db.select().from(dbSchema.videoRenders);
    const released = rows.filter((r) => r.status === "released");
    expect(released).toHaveLength(2);
    expect(released[0]!.filePath).toMatch(/^renders\//);
    releasedVariantId = released[0]!.id;

    // Admin-owned business: no credits were debited, nothing watermarked.
    expect(await creditBalance(db, businessId)).toBe(0);
    expect(released.every((r) => !r.watermarked)).toBe(true);
  });

  it(
    "voiced flow: vo script -> tts -> approve gate -> voiced set",
    { timeout: 60_000 },
    async () => {
      const script = await generateVoScript(db, {
        businessId,
        demoId,
        selectedAdvantages: ["משלוח תוך 30 דקות"],
      });
      const audio = await requestAudio(db, { scriptId: script.id, voiceId: "voice_test" });
      await drainAll();

      const audioRow = (await db.select().from(dbSchema.audioRenders))[0]!;
      expect(audioRow.status).toBe("ready");
      expect(audioRow.alignmentSource).toBe("elevenlabs");
      const chunks = audioRow.wordTimestamps as { words: unknown[] }[];
      expect(chunks.length).toBeGreaterThan(0);

      // The hard gate: rendering before approval must fail.
      await expect(
        createSet(db, {
          businessId,
          demoId,
          grid: {
            hookClipIds: [hookClipId],
            hookLineScriptIds: [hookLineIds[0]!],
            mode: "voiced",
            audioRenderId: audio.id,
          },
        }),
      ).rejects.toThrow(/approved/);

      await approveAudio(db, audio.id);
      const { renders } = await createSet(db, {
        businessId,
        demoId,
        grid: {
          hookClipIds: [hookClipId],
          hookLineScriptIds: [hookLineIds[0]!],
          mode: "voiced",
          audioRenderId: audio.id,
        },
      });
      await drainAll();
      const row = (
        await db
          .select()
          .from(dbSchema.videoRenders)
          .where(sql`${dbSchema.videoRenders.id} = ${renders[0]!.id}`)
      )[0]!;
      expect(row.status).toBe("released");
    },
  );

  it("winner loop: star -> more-like-this is one insert", { timeout: 60_000 }, async () => {
    await starVariant(db, releasedVariantId);
    const { set } = await moreLikeThis(db, { variantId: releasedVariantId });
    expect(set.parentVariantId).toBe(releasedVariantId);

    const starEvents = await db
      .select()
      .from(dbSchema.events)
      .where(sql`${dbSchema.events.kind} = 'star'`);
    expect(starEvents).toHaveLength(1);
    await drainAll();
  });

  it(
    "service B: b-script -> tts -> lipsync poll -> QC gate -> release",
    { timeout: 60_000 },
    async () => {
      const persona = await addPersona(db, { name: "נועה", voiceId: "voice_noa" });
      const personaClip = await addPersonaClip(db, {
        personaId: persona.id,
        filePath: tempFile("persona.mp4"),
        durationMs: 30_000,
      });
      const structure = await addStructure(db, {
        title: "לא האמנתי עד שניסיתי",
        skeleton: { beats: ["hook", "story", "reveal", "cta"] },
      });

      const script = await generateBScript(db, {
        businessId,
        personaId: persona.id,
        structureId: structure.id,
        pointers: "לפתוח עם המשלוח המהיר ולסגור עם קריאה לפעולה",
        durationPreset: 15,
      });
      const params = script.params as {
        pointers?: string;
        durationPreset?: number;
        wordBudget?: number;
      };
      expect(params.pointers).toContain("המשלוח המהיר");
      expect(params.durationPreset).toBe(15);
      expect(params.wordBudget).toBeGreaterThan(0);

      // "Write it myself" / post-generation edit: new immutable row, user_edited.
      const edited = await updateScriptText(db, script.id, `${script.text} נסו עכשיו`);
      expect(edited.userEdited).toBe(true);
      // The validation helper rejects text over the word budget.
      expect(() =>
        assertWithinWordBudget("מילה ".repeat(params.wordBudget! + 1), params.wordBudget!),
      ).toThrow(/ארוך מדי/);

      const audio = await requestAudio(db, { scriptId: script.id }); // voice from persona
      await drainAll();
      await approveAudio(db, audio.id);

      const render = await createBRender(db, {
        businessId,
        audioRenderId: audio.id,
        personaClipId: personaClip.id,
      });
      await drainAll(); // lipsync submit -> poll -> render_video

      const queue = await listQcQueue(db);
      expect(queue.map((r) => r.id)).toContain(render.id);

      await releaseRender(db, render.id);
      const row = (
        await db
          .select()
          .from(dbSchema.videoRenders)
          .where(sql`${dbSchema.videoRenders.id} = ${render.id}`)
      )[0]!;
      expect(row.status).toBe("released");
      expect(row.releasedAt).not.toBeNull();

      // Karaoke caption chunks (from the approved audio) made it into the
      // render props — the DRY_RUN render echoes its props into the output.
      const renderedProps = readFileSync(path.join(storageRoot, row.filePath!), "utf8");
      expect(renderedProps).toContain('"kind":"service_b"');
      expect(renderedProps).toContain('"captions":[{"text":');

      // Lipsync submit was checkpointed with the provider job id (resumable).
      const lipsyncJobs = await db
        .select()
        .from(dbSchema.jobs)
        .where(sql`${dbSchema.jobs.type} = 'lipsync'`);
      expect((lipsyncJobs[0]!.state as { providerJobId?: string }).providerJobId).toBeTruthy();
    },
  );

  it(
    "service B composite: product photo -> persona-holding-product -> approve gate -> image-mode lipsync",
    { timeout: 60_000 },
    async () => {
      // Composites are physical-product only, so this leg gets its own business.
      const shop = await createBusiness(db, {
        ownerEmail: "founder@example.com",
        name: "קרם הפנים",
        ownerRole: "admin",
      });
      await setQuestionnaire(db, shop.id, {
        category: "physical_product",
        product_name: "קרם הפנים",
        what_it_does: "קרם לחות טבעי לעור רגיש",
        advantages: ["רכיבים טבעיים בלבד", "מתאים לעור רגיש"],
        target_audience: "נשים 25-45",
        tone: "friendly",
      });
      const persona = await addPersona(db, { name: "דנה", voiceId: "voice_dana" });
      await addPersonaClip(db, {
        personaId: persona.id,
        filePath: tempFile("persona2.mp4"),
        durationMs: 30_000,
      });

      // The category gate: a non-physical business is refused.
      await expect(
        createComposite(db, {
          businessId, // the local_service business from earlier legs
          personaId: persona.id,
          productImageFile: tempFile("product.jpg", "fake product photo"),
        }),
      ).rejects.toThrow(/physical/);

      const composite = await createComposite(db, {
        businessId: shop.id,
        personaId: persona.id,
        productImageFile: tempFile("product.jpg", "fake product photo"),
      });
      await drainAll(); // generate_composite: submit -> poll -> stored image

      const generated = (
        await db
          .select()
          .from(dbSchema.composites)
          .where(sql`${dbSchema.composites.id} = ${composite.id}`)
      )[0]!;
      expect(generated.status).toBe("ready");
      expect(generated.outputPath).toMatch(/^assets\//);
      // One usage row per generation, kind "images", cost from app_config.
      const imageUsage = await db
        .select()
        .from(dbSchema.usageEvents)
        .where(sql`${dbSchema.usageEvents.kind} = 'images'`);
      expect(imageUsage).toHaveLength(1);
      expect(imageUsage[0]!.costEstimateAgorot).toBeGreaterThan(0);

      // Script + approved audio for the render.
      const structure = await addStructure(db, {
        title: "המוצר שהפתיע אותי",
        skeleton: { beats: ["hook", "demo", "cta"] },
      });
      const script = await generateBScript(db, {
        businessId: shop.id,
        personaId: persona.id,
        structureId: structure.id,
      });
      const audio = await requestAudio(db, { scriptId: script.id });
      await drainAll();
      await approveAudio(db, audio.id);

      // The hard gate: an unapproved composite never reaches lipsync.
      await expect(
        createBRender(db, {
          businessId: shop.id,
          audioRenderId: audio.id,
          compositeId: composite.id,
        }),
      ).rejects.toThrow(/approved/);

      await approveComposite(db, composite.id);
      const render = await createBRender(db, {
        businessId: shop.id,
        audioRenderId: audio.id,
        compositeId: composite.id,
      });
      // No personaClipId at all — completing proves the image-mode lipsync path.
      await drainAll();

      const queue = await listQcQueue(db);
      expect(queue.map((r) => r.id)).toContain(render.id);
    },
  );
});
