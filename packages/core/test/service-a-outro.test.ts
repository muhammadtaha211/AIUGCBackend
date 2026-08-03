import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chunkWords, type WordTiming } from "../src/captions";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { runLane } from "../src/jobs/worker";
import { addHookClip, addPersona, addPersonaImage } from "../src/pipelines/bank";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import { generateHookLines, generateVoScript, updateScriptText } from "../src/pipelines/copy";
import { createDemo } from "../src/pipelines/demos";
import { createSet, type VariantParams } from "../src/pipelines/sets";
import { requestAudio } from "../src/pipelines/tts";
import { getStorage, setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * Service A conditional ending, end to end in DRY_RUN: the approved VO's exact
 * duration against the demo decides — per variant, at createSet — between
 * today's behavior (none), a freeze ending, and a lip-synced avatar ending
 * that chains lipsync -> render_video.
 */

let db: Db;
let pg: { close(): Promise<void> };
let storageRoot: string;
let cleanupStorage: () => void;

let businessId: string;
let demoId: string; // DRY_RUN ingest fakes a 20s vertical demo
let hookClipId: string;
let hookLineId: string;
let personaId: string;

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
  const dir = path.join(tmpdir(), "aiugc-outro-inputs");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

/**
 * An approved audio render with an exact duration: one word every 500ms
 * (350ms word + 150ms gap), so snapToWordGap has real gaps to land in.
 */
async function fabricateApprovedAudio(scriptId: string, durationMs: number) {
  const words: WordTiming[] = [];
  for (let t = 0; t + 350 <= durationMs - 100; t += 500) {
    words.push({ word: `מילה${t}`, startMs: t, endMs: t + 350 });
  }
  const filePath = await getStorage().put(
    "renders",
    `${businessId}/audio/fabricated-${durationMs}/audio.mp3`,
    Buffer.from("fake approved vo"),
  );
  const rows = await db
    .insert(dbSchema.audioRenders)
    .values({
      scriptId,
      voiceId: "voice_test",
      status: "ready",
      filePath,
      durationMs,
      wordTimestamps: chunkWords(words),
      approvedAt: new Date(),
    })
    .returning();
  return rows[0]!;
}

async function loadRender(id: string) {
  const rows = await db
    .select()
    .from(dbSchema.videoRenders)
    .where(sql`${dbSchema.videoRenders.id} = ${id}`);
  return rows[0]!;
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
    advantages: ["משלוח תוך 30 דקות", "תפריט מתחלף יומי"],
    target_audience: "משפחות עסוקות",
    tone: "friendly",
  });

  const demo = await createDemo(db, { businessId, filePath: tempFile("demo.mp4") });
  demoId = demo.id;
  await drainAll();

  hookClipId = (
    await addHookClip(db, {
      filePath: tempFile("hook.mp4"),
      durationMs: 2000,
      textSafeArea: { x: 100, y: 200, w: 880, h: 400 },
    })
  ).id;
  hookLineId = (await generateHookLines(db, { businessId, n: 1 }))[0]!.id;

  const persona = await addPersona(db, { name: "נועה", voiceId: "voice_noa" });
  personaId = persona.id;
  await addPersonaImage(db, {
    personaId,
    filePath: tempFile("persona.jpg", "fake persona photo"),
  });
}, 120_000);

afterAll(async () => {
  setStorage(undefined);
  cleanupStorage();
  await pg.close();
});

describe("service A conditional ending", () => {
  it("persona threads into the vo script and the voice derives from it", async () => {
    const script = await generateVoScript(db, {
      businessId,
      demoId,
      selectedAdvantages: ["משלוח תוך 30 דקות"],
      personaId,
    });
    expect(script.personaId).toBe(personaId);
    expect((script.params as { voiceId?: string }).voiceId).toBe("voice_noa");

    const audio = await requestAudio(db, { scriptId: script.id });
    expect(audio.voiceId).toBe("voice_noa");
    await drainAll();
  }, 60_000);

  it("a deliberately long VO passes TTS at natural length instead of failing", async () => {
    const script = await generateVoScript(db, {
      businessId,
      demoId,
      selectedAdvantages: [],
      voiceId: "voice_test",
    });
    // 50 words at DRY_RUN's 2.2 w/s ≈ 22.7s on a 20s demo — over the 5%
    // stretch, user-edited, so the old pipeline would have failed it.
    const edited = await updateScriptText(db, script.id, "מילה ".repeat(50).trim());
    const audio = await requestAudio(db, { scriptId: edited.id, voiceId: "voice_test" });
    await drainAll();

    const row = (
      await db
        .select()
        .from(dbSchema.audioRenders)
        .where(sql`${dbSchema.audioRenders.id} = ${audio.id}`)
    )[0]!;
    expect(row.status).toBe("ready");
    expect(row.durationMs).toBeGreaterThan(21_000);
    expect(row.stretchRatio).toBe(1);
  }, 60_000);

  it("VO within the demo: today's behavior, ending none, no lipsync", async () => {
    const script = await generateVoScript(db, {
      businessId,
      demoId,
      selectedAdvantages: [],
      personaId,
    });
    const audio = await fabricateApprovedAudio(script.id, 20_000);
    const { renders } = await createSet(db, {
      businessId,
      demoId,
      grid: {
        hookClipIds: [hookClipId],
        hookLineScriptIds: [hookLineId],
        mode: "voiced",
        audioRenderId: audio.id,
        personaId,
      },
    });

    const params = renders[0]!.params as VariantParams;
    expect(params.outroMode).toBe("none");
    expect(params.personaId).toBe(personaId);

    const lipsyncJobs = await db
      .select()
      .from(dbSchema.jobs)
      .where(sql`${dbSchema.jobs.type} = 'lipsync'`);
    expect(lipsyncJobs).toHaveLength(0);

    await drainAll();
    const row = await loadRender(renders[0]!.id);
    expect(row.status).toBe("released");
    const props = readFileSync(path.join(storageRoot, row.filePath!), "utf8");
    expect(props).toContain('"kind":"service_a"');
    expect(props).not.toContain('"outroMode"');
  }, 60_000);

  it("small remainder: freeze ending, still no lipsync", async () => {
    const script = await generateVoScript(db, {
      businessId,
      demoId,
      selectedAdvantages: [],
      personaId,
    });
    const audio = await fabricateApprovedAudio(script.id, 21_500);
    const { renders } = await createSet(db, {
      businessId,
      demoId,
      grid: {
        hookClipIds: [hookClipId],
        hookLineScriptIds: [hookLineId],
        mode: "voiced",
        audioRenderId: audio.id,
        personaId,
      },
    });

    expect((renders[0]!.params as VariantParams).outroMode).toBe("freeze");
    const lipsyncJobs = await db
      .select()
      .from(dbSchema.jobs)
      .where(sql`${dbSchema.jobs.type} = 'lipsync'`);
    expect(lipsyncJobs).toHaveLength(0);

    await drainAll();
    const row = await loadRender(renders[0]!.id);
    expect(row.status).toBe("released");
    const props = readFileSync(path.join(storageRoot, row.filePath!), "utf8");
    expect(props).toContain('"outroMode":"freeze"');
  }, 60_000);

  it("large remainder: avatar ending — slice, lipsync chain, released render", async () => {
    const script = await generateVoScript(db, {
      businessId,
      demoId,
      selectedAdvantages: [],
      personaId,
    });
    const audio = await fabricateApprovedAudio(script.id, 26_000);
    const { renders } = await createSet(db, {
      businessId,
      demoId,
      grid: {
        hookClipIds: [hookClipId],
        hookLineScriptIds: [hookLineId],
        mode: "voiced",
        audioRenderId: audio.id,
        personaId,
      },
    });

    const params = renders[0]!.params as VariantParams;
    expect(params.outroMode).toBe("avatar");
    // Snapped to the word gap nearest the 20s demo end, never mid-word.
    expect(params.voSliceMs).toBeGreaterThan(19_000);
    expect(params.voSliceMs).toBeLessThan(21_000);
    expect(params.voSliceMs).not.toBe(20_000);

    await drainAll(); // lipsync submit -> poll -> render_video

    const row = await loadRender(renders[0]!.id);
    expect(row.status).toBe("released");
    const rowParams = row.params as VariantParams;
    expect(rowParams.lipsyncPath).toMatch(/lipsync\.mp4$/);

    // The VO tail slice was stored for the GPU submit (contentTypeForKey key).
    const sliceFile = path.join(
      storageRoot,
      "renders",
      businessId,
      "audio",
      renders[0]!.id,
      "vo-outro.mp3",
    );
    expect(readFileSync(sliceFile, "utf8")).toContain("DRY_RUN");

    // GPU usage was recorded for the SLICE, not the whole VO.
    const gpuUsage = await db
      .select()
      .from(dbSchema.usageEvents)
      .where(sql`${dbSchema.usageEvents.kind} = 'gpu_seconds'`);
    expect(gpuUsage).toHaveLength(1);
    expect(gpuUsage[0]!.quantity).toBe(Math.ceil((26_000 - params.voSliceMs!) / 1000));

    const props = readFileSync(path.join(storageRoot, row.filePath!), "utf8");
    expect(props).toContain('"outroMode":"avatar"');
    expect(props).toContain('"avatarPath"');
    expect(props).toContain(`"voSliceMs":${params.voSliceMs}`);
  }, 60_000);

  it("an avatar-sized remainder without a persona is refused at createSet", async () => {
    const script = await generateVoScript(db, {
      businessId,
      demoId,
      selectedAdvantages: [],
      voiceId: "voice_test",
    });
    const audio = await fabricateApprovedAudio(script.id, 26_000);
    await expect(
      createSet(db, {
        businessId,
        demoId,
        grid: {
          hookClipIds: [hookClipId],
          hookLineScriptIds: [hookLineId],
          mode: "voiced",
          audioRenderId: audio.id,
        },
      }),
    ).rejects.toThrow(/personaId/);
  }, 60_000);
});
