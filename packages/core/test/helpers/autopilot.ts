import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "../../src/db";
import * as schema from "../../src/db/schema";
import { buildHandlers } from "../../src/handlers";
import { runLane } from "../../src/jobs/worker";
import { runAutopilotTick } from "../../src/pipelines/autopilot";
import {
  saveAutopilotSetup,
  type AutopilotAccountInput,
} from "../../src/pipelines/autopilot-setup";
import type { SoundSnapshot } from "../../src/pipelines/social";
import type { Storage } from "../../src/storage";
import { ISRAEL_TIME_ZONE, zonedWallTimeToInstant } from "../../src/zoned-time";
import { connectInstagram, samplePage, seedOwnerAndBusiness } from "./social";

/**
 * The autopilot's test world (decision 0127), in the founder's shape: one
 * admin, his business, four Instagram accounts, characters with hook clips,
 * two named demos with approved plans, a sound list. Every paid or heavy step
 * is a fake the tests drive by hand — the hook-line writer (vi.mock of copy.ts
 * in the test file, `fakeHookLines` below), the renderer (`finishRenders`), and
 * Meta (FakeMeta, set by the test).
 */

export interface Character {
  name: string;
  gender: "female" | "male";
  clips: number;
}

export interface AccountShape {
  username: string;
  igUserId: string;
  characters: Character[];
  perDay: number;
  times: string[];
}

/** His four accounts (FOUNDER-REPORTED 2026-10-24, the plan's approval). */
export const FOUNDER_SHAPE: AccountShape[] = [
  {
    username: "shir_acreates",
    igUserId: "17841400000000011",
    characters: [{ name: "טליה", gender: "female", clips: 4 }],
    perDay: 4,
    times: ["12:00", "14:00", "17:00", "21:00"],
  },
  {
    username: "omri.creates",
    igUserId: "17841400000000012",
    characters: [{ name: "עומרי", gender: "male", clips: 5 }],
    perDay: 4,
    times: ["12:00", "14:00", "17:00", "21:00"],
  },
  {
    username: "yael_creates",
    igUserId: "17841400000000013",
    characters: [{ name: "שירה", gender: "female", clips: 6 }],
    perDay: 4,
    times: ["12:00", "14:00", "17:00", "21:00"],
  },
  {
    username: "tavnit.ai",
    igUserId: "17841400000000014",
    characters: [
      { name: "נטלי", gender: "female", clips: 4 },
      { name: "נהוראי", gender: "male", clips: 4 },
      { name: "גלעד", gender: "male", clips: 4 },
    ],
    perDay: 3,
    times: ["12:00", "17:00", "21:00"],
  },
];

export const SOUNDS: SoundSnapshot[] = Array.from({ length: 6 }, (_, i) => ({
  audioId: `audio_${i + 1}`,
  kind: i % 2 === 0 ? "original_sound" : "music",
  title: `סאונד ${i + 1}`,
}));

export interface World {
  userId: string;
  businessId: string;
  /** igUserId → social_accounts.id */
  accounts: Map<string, string>;
  /** character name → persona id */
  personas: Map<string, string>;
  /** persona id → clip ids */
  clips: Map<string, string[]>;
  demos: { id: string; name: string; planId: string }[];
  shape: AccountShape[];
}

export async function seedWorld(
  db: Db,
  opts: { shape?: AccountShape[]; savedAt: Date; demos?: string[] },
): Promise<World> {
  const shape = opts.shape ?? FOUNDER_SHAPE;
  const { userId, businessId } = await seedOwnerAndBusiness(db, {
    email: "founder@test.local",
    role: "admin",
  });
  await db
    .update(schema.businesses)
    .set({ name: "Tavnit", questionnaire: { productName: "Tavnit" } })
    .where(eq(schema.businesses.id, businessId));

  const ids = await connectInstagram(
    db,
    userId,
    shape.map((a, i) => ({
      ...samplePage(a.igUserId, String(i + 1)),
      instagram: {
        id: a.igUserId,
        username: a.username,
        name: a.username,
        pictureUrl: "https://cdn/pic.jpg",
      },
    })),
  );
  const accounts = new Map(shape.map((a, i) => [a.igUserId, ids[i]!]));

  const personas = new Map<string, string>();
  const clips = new Map<string, string[]>();
  for (const character of shape.flatMap((a) => a.characters)) {
    const [persona] = await db
      .insert(schema.personas)
      .values({ name: character.name, gender: character.gender })
      .returning();
    personas.set(character.name, persona!.id);
    const own: string[] = [];
    for (let i = 0; i < character.clips; i++) {
      const [clip] = await db
        .insert(schema.hookClips)
        .values({
          filePath: `hooks/${persona!.id}/${i}.mp4`,
          durationMs: 3500,
          textSafeArea: { x: 90, y: 300, w: 900, h: 400 },
          personaId: persona!.id,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
        })
        .returning();
      own.push(clip!.id);
    }
    clips.set(persona!.id, own);
  }

  const demos = [];
  for (const [i, name] of (opts.demos ?? ["Service A", "Service B"]).entries()) {
    const [demo] = await db
      .insert(schema.demos)
      .values({
        businessId,
        name,
        status: "ready",
        normalizedPath: `demos/${businessId}/${i}/normalized.mp4`,
        durationMs: 30_000,
      })
      .returning();
    const [analysis] = await db
      .insert(schema.demoAnalyses)
      .values({ demoId: demo!.id, status: "ready", timeline: [] })
      .returning();
    const [plan] = await db
      .insert(schema.demoStepPlans)
      .values({
        demoId: demo!.id,
        analysisId: analysis!.id,
        status: "ready",
        steps: [],
        approvedAt: new Date(Date.UTC(2026, 9, 1)),
      })
      .returning();
    demos.push({ id: demo!.id, name, planId: plan!.id });
  }

  const world: World = { userId, businessId, accounts, personas, clips, demos, shape };
  await saveAutopilotSetup(
    db,
    userId,
    {
      businessId,
      sounds: SOUNDS,
      accounts: shape.map((a) => accountInput(world, a)),
    },
    opts.savedAt,
  );
  return world;
}

export function accountInput(
  world: World,
  account: AccountShape,
  overrides: Partial<AutopilotAccountInput> = {},
): AutopilotAccountInput {
  return {
    igUserId: account.igUserId,
    enabled: true,
    aPerDay: account.perDay,
    postTimes: account.times,
    personaIds: account.characters.map((c) => world.personas.get(c.name)!),
    demoIds: world.demos.map((d) => d.id),
    ...overrides,
  };
}

let lineCounter = 0;
/** Unique Hebrew lines per call; `duplicateOf` repeats a used text once (the text dedupe). */
export const lineScript: { duplicateText?: string; fail?: boolean; calls: number } = { calls: 0 };

/** The fake behind vi.mock of copy.ts: inserts n hook_line rows like the real one. */
export async function fakeHookLines(
  db: Db,
  opts: { businessId: string; n?: number; personaId?: string },
): Promise<(typeof schema.scripts.$inferSelect)[]> {
  lineScript.calls++;
  if (lineScript.fail) throw new Error("claude is down");
  const n = opts.n ?? 10;
  const texts = Array.from({ length: n }, () => `משפט פתיחה ${++lineCounter}`);
  if (lineScript.duplicateText) {
    texts[0] = lineScript.duplicateText;
    lineScript.duplicateText = undefined;
  }
  return db
    .insert(schema.scripts)
    .values(
      texts.map((text) => ({
        businessId: opts.businessId,
        kind: "hook_line" as const,
        text,
        params: { angle: "test" },
        promptVersion: "hook_lines@fake",
      })),
    )
    .returning();
}

/**
 * The heavy lane, faked: every queued autopilot render ends — released with a
 * real file in the temp storage, or failed when `fail` says so.
 */
export async function finishRenders(
  db: Db,
  storage: Storage,
  root: string,
  fail: (renderId: string) => boolean | Promise<boolean> = () => false,
): Promise<void> {
  const rows = await db
    .select({ id: schema.videoRenders.id, businessId: schema.videoRenders.businessId })
    .from(schema.videoRenders)
    .where(inArray(schema.videoRenders.status, ["queued", "rendering"]));
  for (const row of rows) {
    if (await fail(row.id)) {
      await db
        .update(schema.videoRenders)
        .set({ status: "failed", error: "fake render failure" })
        .where(eq(schema.videoRenders.id, row.id));
      continue;
    }
    const local = path.join(root, "seed", `${row.id}.mp4`);
    mkdirSync(path.dirname(local), { recursive: true });
    writeFileSync(local, "fake mp4 bytes");
    const filePath = await storage.put(
      "renders",
      `${row.businessId}/video/${row.id}/final.mp4`,
      local,
    );
    await db
      .update(schema.videoRenders)
      .set({ status: "released", releasedAt: new Date(), filePath })
      .where(eq(schema.videoRenders.id, row.id));
  }
}

/** Publish every post due by `at` (the light lane, publish_post only). */
export async function publishDue(db: Db, at: Date): Promise<void> {
  for (let round = 0; round < 6; round++) {
    const due = await db
      .update(schema.jobs)
      .set({ runAt: sql`now() - interval '1 second'` })
      .where(
        and(
          eq(schema.jobs.type, "publish_post"),
          eq(schema.jobs.status, "queued"),
          lte(schema.jobs.runAt, at),
        ),
      )
      .returning({ id: schema.jobs.id });
    if (due.length === 0) return;
    await runLane(db, {
      workerId: "test",
      handlers: buildHandlers(),
      types: ["publish_post"],
      drainAndExit: true,
    });
  }
}

export function israel(day: string, time: string): Date {
  return zonedWallTimeToInstant(ISRAEL_TIME_ZONE, day, time);
}

/**
 * A night and its day on a stepped clock: the tick, the fake renderer, and the
 * publish lane after every step. `render` decides each render's fate.
 */
export async function runDay(
  db: Db,
  storage: Storage,
  root: string,
  day: string,
  opts: {
    from?: string;
    to?: string;
    stepMinutes?: number;
    fail?: (renderId: string) => boolean | Promise<boolean>;
    renders?: boolean;
    before?: (at: Date) => Promise<void>;
  } = {},
): Promise<void> {
  const start = israel(day, opts.from ?? "02:55").getTime();
  const end = israel(day, opts.to ?? "23:59").getTime();
  const step = (opts.stepMinutes ?? 10) * 60_000;
  for (let t = start; t <= end; t += step) {
    const at = new Date(t);
    await opts.before?.(at);
    await runAutopilotTick(db, at);
    if (opts.renders !== false) await finishRenders(db, storage, root, opts.fail);
    await publishDue(db, at);
  }
}
