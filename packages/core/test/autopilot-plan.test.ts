import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { getAutopilotAccess } from "../src/pipelines/autopilot";
import {
  AutopilotSetupError,
  getAutopilotSetup,
  resumeAutopilotAccount,
  saveAutopilotSetup,
  type AutopilotAccountInput,
} from "../src/pipelines/autopilot-setup";
import { setMetaGraphProvider } from "../src/providers/meta-graph";
import { setStorage, type Storage } from "../src/storage";
import {
  accountInput,
  fakeHookLines,
  israel,
  lineScript,
  runDay,
  seedWorld,
  SOUNDS,
  type World,
} from "./helpers/autopilot";
import { createTestDb } from "./helpers/pglite";
import { FakeMeta, socialTestEnv } from "./helpers/social";
import { tempStorage } from "./helpers/storage";

/** Runs once inside the resume's checks: what another tab does meanwhile. */
const raceHook = vi.hoisted(() => ({ during: undefined as undefined | (() => Promise<unknown>) }));
vi.mock("../src/pipelines/autopilot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/pipelines/autopilot")>();
  return {
    ...actual,
    usablePersonas: async (...args: Parameters<typeof actual.usablePersonas>) => {
      const during = raceHook.during;
      raceHook.during = undefined;
      await during?.();
      return actual.usablePersonas(...args);
    },
  };
});

vi.mock("../src/pipelines/copy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/pipelines/copy")>()),
  generateHookLines: (db: Db, opts: { businessId: string; n?: number }) => fakeHookLines(db, opts),
}));

/**
 * The autopilot's plan across days and its setup's rules (decision 0127):
 * least-used rotation per account (12), a count that can never exceed the
 * clips (9), characters that never mix (7), who reaches it (3).
 */
const DAYS = ["2026-10-25", "2026-10-26", "2026-10-27"];
const YAEL = "17841400000000013"; // שירה: 6 clips, 4 a day
const SHIR = "17841400000000011"; // טליה: 4 clips, 4 a day
const OMRI = "17841400000000012"; // עומרי: 5 clips, 4 a day
const TAVNIT = "17841400000000014"; // נטלי, נהוראי, גלעד: 4 clips each, 3 a day

describe("the autopilot's plan", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let restoreEnv: () => void;
  let storage: Storage;
  let root: string;
  let cleanup: () => void;
  let world: World;

  beforeEach(async () => {
    restoreEnv = socialTestEnv();
    ({ db, pg } = await createTestDb());
    const temp = tempStorage();
    storage = temp.storage;
    root = temp.root;
    cleanup = temp.cleanup;
    setStorage(storage);
    setMetaGraphProvider(new FakeMeta());
    lineScript.fail = false;
    lineScript.duplicateText = undefined;
    lineScript.calls = 0;
    world = await seedWorld(db, { savedAt: israel("2026-10-24", "12:00") });
  });

  afterEach(async () => {
    setMetaGraphProvider(undefined);
    setStorage(undefined);
    cleanup();
    restoreEnv();
    await pg.close();
  });

  async function slotsOf(igUserId: string) {
    return (
      await db
        .select()
        .from(schema.autopilotSlots)
        .where(eq(schema.autopilotSlots.igUserId, igUserId))
    ).sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
  }

  function counts(values: (string | null)[]): number[] {
    const m = new Map<string, number>();
    for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.values()].sort();
  }

  it("rotates clips, demos and sounds least-used first across days, and never repeats a hook line", async () => {
    for (const [i, day] of DAYS.entries()) {
      if (i === 1) {
        // The writer repeats a text already used: it must not be used again.
        const [used] = await db
          .select({ text: schema.scripts.text })
          .from(schema.scripts)
          .innerJoin(
            schema.autopilotSlots,
            eq(schema.autopilotSlots.hookLineScriptId, schema.scripts.id),
          )
          .limit(1);
        lineScript.duplicateText = used!.text;
      }
      // A whole day, so every post is out before the next night plans.
      await runDay(db, storage, root, day, { stepMinutes: 15 });
    }
    const own = await slotsOf(YAEL);
    expect(own).toHaveLength(12);
    // שירה's 6 clips, 4 a day for 3 days: every clip exactly twice, never twice in a day.
    expect(counts(own.map((s) => s.hookClipId))).toEqual([2, 2, 2, 2, 2, 2]);
    for (const day of DAYS) {
      const today = own.filter((s) => s.day === day);
      expect(new Set(today.map((s) => s.hookClipId)).size).toBe(4);
    }
    // Day 2 starts with the two clips day 1 left unused.
    const day1 = new Set(own.filter((s) => s.day === DAYS[0]).map((s) => s.hookClipId));
    const day2 = own.filter((s) => s.day === DAYS[1]).map((s) => s.hookClipId);
    expect(day2.filter((c) => !day1.has(c))).toHaveLength(2);
    // Two demos: each 6 times. Six sounds: each twice.
    expect(counts(own.map((s) => s.demoId))).toEqual([6, 6]);
    expect(counts(own.map((s) => (s.sound as { audioId: string }).audioId))).toEqual([
      2, 2, 2, 2, 2, 2,
    ]);
    // No hook line twice, by id or by text, across every account and day.
    const all = await db.select().from(schema.autopilotSlots);
    const ids = all.map((s) => s.hookLineScriptId);
    expect(new Set(ids).size).toBe(ids.length);
    const texts = await db
      .select({ text: schema.scripts.text })
      .from(schema.scripts)
      .innerJoin(
        schema.autopilotSlots,
        eq(schema.autopilotSlots.hookLineScriptId, schema.scripts.id),
      );
    expect(new Set(texts.map((t) => t.text.trim())).size).toBe(texts.length);
    // Only the autopilot's own tagged lines, each in its character's gender.
    const tagged = await db
      .select({ params: schema.scripts.params, personaId: schema.autopilotSlots.personaId })
      .from(schema.scripts)
      .innerJoin(
        schema.autopilotSlots,
        eq(schema.autopilotSlots.hookLineScriptId, schema.scripts.id),
      );
    const gender = new Map<string, string>();
    for (const account of world.shape) {
      for (const c of account.characters) gender.set(world.personas.get(c.name)!, c.gender);
    }
    for (const row of tagged) {
      const tag = (row.params as { autopilot?: { gender: string } }).autopilot;
      expect(tag?.gender).toBe(gender.get(row.personaId!));
    }
  });

  it("can never take a count above the clips: refused when saved, clamped at night", async () => {
    const shir = world.shape.find((a) => a.igUserId === SHIR)!;
    const save = (overrides: Parameters<typeof accountInput>[2]) =>
      saveAutopilotSetup(
        db,
        world.userId,
        {
          businessId: world.businessId,
          sounds: SOUNDS,
          accounts: [accountInput(world, shir, overrides)],
        },
        israel("2026-10-24", "13:00"),
      );
    await expect(
      save({ aPerDay: 5, postTimes: ["09:00", "10:00", "11:00", "12:00", "13:00"] }),
    ).rejects.toMatchObject({ code: "count_over_clips", detail: { max: 4 } });
    await expect(save({ aPerDay: 3, postTimes: ["09:00", "10:00"] })).rejects.toMatchObject({
      code: "count_over_times",
      detail: { max: 2 },
    });
    // Two of טליה's clips retired after the save: the night plans two.
    const talia = world.personas.get("טליה")!;
    const clips = world.clips.get(talia)!;
    await db
      .update(schema.hookClips)
      .set({ active: false })
      .where(eq(schema.hookClips.id, clips[0]!));
    await db
      .update(schema.hookClips)
      .set({ active: false })
      .where(eq(schema.hookClips.id, clips[1]!));
    await runDay(db, storage, root, DAYS[0]!, { to: "05:00" });
    const own = await slotsOf(SHIR);
    expect(own).toHaveLength(2);
    expect(own.map((s) => s.hookClipId).sort()).toEqual([clips[2], clips[3]].sort());
  });

  it("never mixes characters: one character on two accounts is refused", async () => {
    const [a, b] = world.shape;
    await expect(
      saveAutopilotSetup(db, world.userId, {
        businessId: world.businessId,
        sounds: SOUNDS,
        accounts: [
          accountInput(world, a!),
          accountInput(world, b!, { personaIds: [world.personas.get("טליה")!] }),
        ],
      }),
    ).rejects.toMatchObject({ code: "character_on_two_accounts" });
  });

  it("refuses times off the grid or outside the day, and switching on with nothing to post or no sound", async () => {
    const [a] = world.shape;
    const save = (input: Partial<Parameters<typeof saveAutopilotSetup>[2]>, o = {}) =>
      saveAutopilotSetup(db, world.userId, {
        businessId: world.businessId,
        sounds: SOUNDS,
        accounts: [accountInput(world, a!, o)],
        ...input,
      });
    for (const time of ["07:55", "12:03", "24:00", "23:56"]) {
      await expect(save({}, { postTimes: ["12:00", time], aPerDay: 1 })).rejects.toBeInstanceOf(
        AutopilotSetupError,
      );
    }
    await expect(save({}, { postTimes: ["12:00", "12:00"], aPerDay: 1 })).rejects.toMatchObject({
      code: "bad_time",
    });
    await expect(save({}, { demoIds: [] })).rejects.toMatchObject({ code: "nothing_to_post" });
    await expect(save({ sounds: [] })).rejects.toMatchObject({ code: "no_usable_sound" });
    await expect(
      save({ businessId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toMatchObject({ code: "business_not_owned" });
  });

  it("keeps the night's own fields through a stale save: a refused sound stays refused, a pause stays", async () => {
    await db.update(schema.autopilotSetups).set({
      sounds: SOUNDS.map((s, i) => (i === 0 ? { ...s, refusedAt: "2026-10-25T10:00:00.000Z" } : s)),
    });
    await db
      .update(schema.autopilotAccounts)
      .set({ pausedCause: "connection", pausedAt: new Date("2026-10-25T10:00:00Z") })
      .where(eq(schema.autopilotAccounts.igUserId, SHIR));
    // A page loaded before both, saved now: the same sounds, the same accounts, all on.
    await saveAutopilotSetup(db, world.userId, {
      businessId: world.businessId,
      sounds: SOUNDS,
      accounts: world.shape.map((acc) => accountInput(world, acc)),
    });
    const [setup] = await db.select().from(schema.autopilotSetups);
    expect((setup!.sounds as { refusedAt?: string }[])[0]!.refusedAt).toBe(
      "2026-10-25T10:00:00.000Z",
    );
    const [paused] = await db
      .select()
      .from(schema.autopilotAccounts)
      .where(eq(schema.autopilotAccounts.igUserId, SHIR));
    expect(paused!.pausedCause).toBe("connection");
  });

  it("moves a character off an account not on the page, and never offers back a retired one", async () => {
    // shir_acreates disconnects: its card leaves the page, its saved row stays.
    await db
      .update(schema.socialAccounts)
      .set({ status: "disconnected" })
      .where(eq(schema.socialAccounts.id, world.accounts.get(SHIR)!));
    const talia = world.personas.get("טליה")!;
    await saveAutopilotSetup(
      db,
      world.userId,
      {
        businessId: world.businessId,
        sounds: SOUNDS,
        accounts: world.shape
          .filter((acc) => acc.igUserId !== SHIR)
          .map((acc) =>
            accountInput(
              world,
              acc,
              acc.igUserId === OMRI ? { personaIds: [world.personas.get("עומרי")!, talia] } : {},
            ),
          ),
      },
      israel("2026-10-24", "13:00"),
    );
    const [hidden] = await db
      .select()
      .from(schema.autopilotAccounts)
      .where(eq(schema.autopilotAccounts.igUserId, SHIR));
    // The pages never share a character, even with one card off the page.
    expect(hidden!.personaIds).toEqual([]);

    // A character retired since: not offered back, and the page saves as it is.
    await db
      .update(schema.personas)
      .set({ active: false })
      .where(eq(schema.personas.id, world.personas.get("נטלי")!));
    const view = await getAutopilotSetup(db, world.userId);
    const tavnit = view.accounts.find((acc) => acc.igUserId === TAVNIT)!;
    expect(tavnit.personaIds).toEqual([world.personas.get("נהוראי"), world.personas.get("גלעד")]);
    await saveAutopilotSetup(
      db,
      world.userId,
      {
        businessId: view.businessId!,
        sounds: view.sounds,
        accounts: view.accounts.map((acc) => ({
          igUserId: acc.igUserId,
          enabled: acc.enabled,
          aPerDay: acc.aPerDay,
          postTimes: acc.postTimes,
          personaIds: acc.personaIds,
          demoIds: acc.demoIds,
        })),
      },
      israel("2026-10-24", "14:00"),
    );
  });

  it("saves the page around a paused card that cannot run, and refuses that card's resume", async () => {
    const shira = world.personas.get("שירה")!;
    const pausedAt = new Date("2026-10-25T10:00:00Z");
    await db
      .update(schema.hookClips)
      .set({ active: false })
      .where(eq(schema.hookClips.personaId, shira));
    await db
      .update(schema.autopilotAccounts)
      .set({ pausedCause: "no_clips", pausedAt })
      .where(eq(schema.autopilotAccounts.igUserId, YAEL));
    // The page clamps yael_creates' count to its clips (none) and saves an edit on another card.
    const times = ["12:00", "14:00", "17:00", "20:00", "21:00"];
    await saveAutopilotSetup(
      db,
      world.userId,
      {
        businessId: world.businessId,
        sounds: SOUNDS,
        accounts: world.shape.map((acc) =>
          accountInput(
            world,
            acc,
            acc.igUserId === YAEL
              ? { aPerDay: 0 }
              : acc.igUserId === OMRI
                ? { postTimes: times }
                : {},
          ),
        ),
      },
      israel("2026-10-25", "13:00"),
    );
    const [omri] = await db
      .select()
      .from(schema.autopilotAccounts)
      .where(eq(schema.autopilotAccounts.igUserId, OMRI));
    expect(omri!.postTimes).toEqual(times);
    // The card itself still cannot run: its resume says so.
    await expect(
      resumeAutopilotAccount(
        db,
        world.userId,
        YAEL,
        pausedAt.toISOString(),
        israel("2026-10-25", "13:05"),
      ),
    ).rejects.toMatchObject({ code: "nothing_to_post" });
  });

  it("lets a save from another tab win over a resume it raced: the resume is stale, the save stands", async () => {
    const omriChar = world.personas.get("עומרי")!;
    const pausedAt = new Date("2026-10-25T10:00:00Z");
    const pause = () =>
      db
        .update(schema.autopilotAccounts)
        .set({ pausedCause: "nothing_posted", pausedAt, enabled: true })
        .where(eq(schema.autopilotAccounts.igUserId, OMRI));
    const otherTab = (overrides: Partial<AutopilotAccountInput>) => () =>
      saveAutopilotSetup(
        db,
        world.userId,
        {
          businessId: world.businessId,
          sounds: SOUNDS,
          accounts: world.shape.map((acc) =>
            accountInput(
              world,
              acc,
              acc.igUserId === OMRI
                ? overrides
                : acc.igUserId === YAEL && overrides.personaIds
                  ? { personaIds: [world.personas.get("שירה")!, omriChar] }
                  : {},
            ),
          ),
        },
        israel("2026-10-25", "13:00"),
      );
    const resume = () =>
      resumeAutopilotAccount(
        db,
        world.userId,
        OMRI,
        pausedAt.toISOString(),
        israel("2026-10-25", "13:00"),
      );

    // The other tab moves עומרי to yael_creates while the resume checks.
    await pause();
    raceHook.during = otherTab({ personaIds: [], aPerDay: 0 });
    await expect(resume()).rejects.toMatchObject({ code: "stale_pause" });
    const rows = await db.select().from(schema.autopilotAccounts);
    expect(
      rows.filter((r) => (r.personaIds as string[]).includes(omriChar)).map((r) => r.igUserId),
    ).toEqual([YAEL]);

    // The other tab switches omri.creates off while the resume checks: it stays off.
    await db
      .update(schema.autopilotAccounts)
      .set({ personaIds: [omriChar], aPerDay: 4 })
      .where(eq(schema.autopilotAccounts.igUserId, OMRI));
    await db
      .update(schema.autopilotAccounts)
      .set({ personaIds: [world.personas.get("שירה")!] })
      .where(eq(schema.autopilotAccounts.igUserId, YAEL));
    await pause();
    raceHook.during = otherTab({ enabled: false });
    await expect(resume()).rejects.toMatchObject({ code: "stale_pause" });
    const [omri] = await db
      .select()
      .from(schema.autopilotAccounts)
      .where(eq(schema.autopilotAccounts.igUserId, OMRI));
    expect(omri!.enabled).toBe(false);
  });

  it("lists named demos first, unnamed below, each newest first, and preselects none", async () => {
    // A newer unnamed demo, and a new account card that was never saved.
    await db.insert(schema.demos).values({
      businessId: world.businessId,
      status: "ready",
      normalizedPath: "demos/x/n.mp4",
      createdAt: new Date("2026-10-30T00:00:00Z"),
    });
    await db.delete(schema.autopilotAccounts);
    const view = await getAutopilotSetup(db, world.userId);
    expect(view.demos.map((d) => d.name)).toEqual(["Service B", "Service A", null]);
    expect(view.demos[2]!.readiness).toEqual({ ok: false, reason: "no_approved_plan" });
    expect(view.accounts.every((a) => a.demoIds.length === 0 && !a.enabled)).toBe(true);
    expect(view.characters.find((c) => c.name === "שירה")!.activeClips).toBe(6);
  });

  it("lets only admins in with no switch row; a named account in; a hidden Instagram keeps it out", async () => {
    const [customer] = await db.insert(schema.users).values({ email: "c@test.local" }).returning();
    expect(await getAutopilotAccess(db, world.userId)).toBe(true);
    expect(await getAutopilotAccess(db, customer!.id)).toBe(false);
    await db
      .insert(schema.appConfig)
      .values({ key: "autopilot", value: { access: "named", userIds: [customer!.id] } });
    // Named for the autopilot, but Instagram's own switch still hides them.
    expect(await getAutopilotAccess(db, customer!.id)).toBe(false);
    await db
      .insert(schema.appConfig)
      .values({ key: "social_posting", value: { access: "named", userIds: [customer!.id] } });
    expect(await getAutopilotAccess(db, customer!.id)).toBe(true);
    // A row that does not parse hides non-admins, never the admin.
    await db
      .update(schema.appConfig)
      .set({ value: { access: "evryone" } })
      .where(eq(schema.appConfig.key, "autopilot"));
    expect(await getAutopilotAccess(db, customer!.id)).toBe(false);
    expect(await getAutopilotAccess(db, world.userId)).toBe(true);
  });
});
