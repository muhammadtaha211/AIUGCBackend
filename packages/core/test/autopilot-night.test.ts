import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { AUTOPILOT_NIGHT, listSkippedAutopilotSlots } from "../src/pipelines/autopilot";
import { sweepAutopilotEmails } from "../src/pipelines/autopilot-email";
import { resumeAutopilotAccount, saveAutopilotSetup } from "../src/pipelines/autopilot-setup";
import { disconnectSocialAccount, listScheduledPosts } from "../src/pipelines/social";
import {
  AUTOPILOT_EMAIL,
  resetFailureEmailPause,
  sweepPostFailureEmails,
} from "../src/pipelines/social-failure-email";
import { MetaGraphError, setMetaGraphProvider } from "../src/providers/meta-graph";
import { setEmailProvider, type EmailMessage } from "../src/providers/resend";
import { setStorage, type Storage } from "../src/storage";
import { ISRAEL_TIME_ZONE } from "../src/zoned-time";
import {
  accountInput,
  fakeHookLines,
  israel,
  lineScript,
  publishDue,
  runDay,
  seedWorld,
  SOUNDS,
  type World,
} from "./helpers/autopilot";
import { createTestDb } from "./helpers/pglite";
import { connectInstagram, FakeMeta, samplePage, socialTestEnv } from "./helpers/social";
import { tempStorage } from "./helpers/storage";

vi.mock("../src/pipelines/copy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/pipelines/copy")>()),
  generateHookLines: (db: Db, opts: { businessId: string; n?: number }) => fakeHookLines(db, opts),
}));

/**
 * The Instagram autopilot's night end to end (decision 0127), in the founder's
 * shape, on a stepped clock across 2026-10-25 — the day Israel's clock goes
 * back. The renderer, Meta, the hook-line writer and Resend are fakes;
 * everything else is the real tick, the real scheduling path, the real publish
 * job and the real email sweeps.
 */
const DAY = "2026-10-25";
const NEXT = "2026-10-26";

describe("the autopilot's night", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let restoreEnv: () => void;
  let storage: Storage;
  let root: string;
  let cleanup: () => void;
  let meta: FakeMeta;
  let world: World;
  let sent: EmailMessage[];

  beforeEach(async () => {
    restoreEnv = socialTestEnv();
    ({ db, pg } = await createTestDb());
    const temp = tempStorage();
    storage = temp.storage;
    root = temp.root;
    cleanup = temp.cleanup;
    setStorage(storage);
    meta = new FakeMeta();
    setMetaGraphProvider(meta);
    sent = [];
    setEmailProvider({
      send: async (message) => {
        sent.push(message);
        return { id: `email_${sent.length}` };
      },
    });
    resetFailureEmailPause();
    lineScript.fail = false;
    lineScript.duplicateText = undefined;
    lineScript.calls = 0;
    world = await seedWorld(db, { savedAt: israel("2026-10-24", "12:00") });
  });

  afterEach(async () => {
    setMetaGraphProvider(undefined);
    setEmailProvider(undefined);
    setStorage(undefined);
    cleanup();
    restoreEnv();
    await pg.close();
  });

  const day = (d = DAY) => runDay(db, storage, root, d);

  async function dayPosts(d = DAY) {
    return listScheduledPosts(db, {
      userId: world.userId,
      from: israel(d, "00:00"),
      to: israel(d, "23:59"),
    });
  }

  async function slots(igUserId?: string) {
    const rows = await db.select().from(schema.autopilotSlots);
    return igUserId ? rows.filter((s) => s.igUserId === igUserId) : rows;
  }

  async function accountRow(igUserId: string) {
    return (
      await db
        .select()
        .from(schema.autopilotAccounts)
        .where(eq(schema.autopilotAccounts.igUserId, igUserId))
    )[0]!;
  }

  /** The email sweep, a while after `at` (pauses settle for 2 minutes first). */
  async function emails(at: Date) {
    return sweepAutopilotEmails(db, {
      workerId: "hetzner",
      now: new Date(at.getTime() + 5 * 60_000),
    });
  }

  async function autopilotEmailRows() {
    return db.select().from(schema.events).where(eq(schema.events.kind, AUTOPILOT_EMAIL));
  }

  /**
   * A plpgsql trigger that refuses one write, once — a crash at exactly that
   * point. The "once" is a sequence: nextval survives the rollback the raise causes.
   */
  async function crashOnce(name: string, condition: string): Promise<void> {
    await db.execute(sql.raw(`create sequence crash_${name}_seq`));
    await db.execute(
      sql.raw(`
      create or replace function crash_${name}() returns trigger language plpgsql as $body$
      begin
        if (${condition}) then
          if nextval('crash_${name}_seq') = 1 then
            raise exception 'crash: ${name}';
          end if;
        end if;
        return new;
      end $body$;`),
    );
  }

  const SHIR = "17841400000000011";
  const OMRI = "17841400000000012";
  const YAEL = "17841400000000013";
  const TAVNIT = "17841400000000014";

  it("makes and posts every account's videos: own characters, own renders, a sound, no caption, no label, at his times", async () => {
    await day();
    const posts = await dayPosts();
    expect(posts).toHaveLength(world.shape.reduce((n, a) => n + a.perDay, 0));

    const allSlots = await slots();
    const clipOwner = new Map(
      [...world.clips].flatMap(([persona, clips]) => clips.map((c) => [c, persona] as const)),
    );
    const renders = new Set<string>();
    for (const item of posts) {
      expect(item.post.status).toBe("posted");
      expect(item.post.caption).toBe("");
      expect(item.post.aiLabel).toBe(false);
      expect(item.autopilot).toBe(true);
      expect(item.post.sound).not.toBeNull();
      renders.add(item.render.id);
    }
    // No file to two accounts (decision 8): every post its own render.
    expect(renders.size).toBe(posts.length);
    // Meta got no caption and no AI label.
    for (const container of meta.containers) {
      expect(container.caption).toBe("");
      expect(container.aiGenerated).toBe(false);
      expect(container.audio?.audioId).toMatch(/^audio_/);
    }

    for (const account of world.shape) {
      const own = allSlots.filter((s) => s.igUserId === account.igUserId);
      expect(own).toHaveLength(account.perDay);
      const allowed = new Set(account.characters.map((c) => world.personas.get(c.name)!));
      for (const slot of own) {
        // A character page only ever gets its own character; the official page only its three.
        expect(allowed.has(clipOwner.get(slot.hookClipId!)!)).toBe(true);
        expect(allowed.has(slot.personaId!)).toBe(true);
      }
      // No hook clip twice in a day on one account.
      expect(new Set(own.map((s) => s.hookClipId)).size).toBe(own.length);
      // His times, in Israel time, on the day the clock goes back.
      const times = own
        .map((s) => s.scheduledFor.getTime())
        .sort((a, b) => a - b)
        .map((t) => new Date(t).toISOString());
      expect(times).toEqual(account.times.map((t) => israel(DAY, t).toISOString()));
    }
    // The official page gets every one of its three characters (variety, decision 7).
    const official = allSlots.filter((s) => s.igUserId === TAVNIT);
    expect(new Set(official.map((s) => s.personaId)).size).toBe(3);
    expect(israel(DAY, "12:00").toISOString()).toBe("2026-10-25T10:00:00.000Z");
    // A hook line is never used twice.
    const lines = allSlots.map((s) => s.hookLineScriptId);
    expect(new Set(lines).size).toBe(lines.length);
    // The night ran, once.
    const nights = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.kind, AUTOPILOT_NIGHT));
    expect(nights.map((n) => (n.payload as { day: string }).day)).toEqual([DAY]);
    // Nothing to tell him.
    expect((await emails(israel(DAY, "23:59"))).sent).toBe(0);

    if (process.env.AUTOPILOT_TABLE) await printTable(db, world, posts);
  });

  it("runs a night twice with no duplicates", async () => {
    await day();
    await day();
    expect(await slots()).toHaveLength(15);
    expect(await dayPosts()).toHaveLength(15);
    const renders = await db.select().from(schema.videoRenders);
    expect(renders).toHaveLength(15);
    expect(meta.calls.publish).toBe(15);
  });

  it("resumes a crash between a render and its slot: one render and one post per slot", async () => {
    await crashOnce("render", `new.status = 'rendering'`);
    await db.execute(
      sql.raw(
        `create trigger crash_render before update on autopilot_slots for each row execute function crash_render()`,
      ),
    );
    await day();
    const all = await slots();
    const renders = await db.select().from(schema.videoRenders);
    // The crashed transaction left no render behind it.
    expect(renders).toHaveLength(all.length);
    expect(new Set(all.map((s) => s.videoRenderId)).size).toBe(all.length);
    expect(await dayPosts()).toHaveLength(15);
  });

  it("resumes a crash between a post and its slot: no orphan post", async () => {
    await crashOnce("schedule", `new.status = 'scheduled'`);
    await db.execute(
      sql.raw(
        `create trigger crash_schedule before update on autopilot_slots for each row execute function crash_schedule()`,
      ),
    );
    await day();
    const posts = await db.select().from(schema.scheduledPosts);
    expect(posts).toHaveLength(15);
    const all = await slots();
    expect(new Set(all.map((s) => s.scheduledPostId)).size).toBe(15);
    for (const post of posts) expect(all.some((s) => s.scheduledPostId === post.id)).toBe(true);
  });

  it("resumes a crash between two accounts' planning: each planned once, the night marked after", async () => {
    await crashOnce("plan", `new.ig_user_id = '${OMRI}'`);
    await db.execute(
      sql.raw(
        `create trigger crash_plan before insert on autopilot_slots for each row execute function crash_plan()`,
      ),
    );
    await runDay(db, storage, root, DAY, { from: "03:00", to: "03:00" });
    expect(await slots(OMRI)).toHaveLength(0);
    expect(await slots(SHIR)).toHaveLength(4);
    const nightsAfterCrash = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.kind, AUTOPILOT_NIGHT));
    expect(nightsAfterCrash).toHaveLength(0);
    await day();
    for (const account of world.shape) {
      expect(await slots(account.igUserId)).toHaveLength(account.perDay);
    }
    const nights = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.kind, AUTOPILOT_NIGHT));
    expect(nights).toHaveLength(1);
  });

  it("moves a refused sound to the next one and marks it refused", async () => {
    meta.statuses = [
      { code: "ERROR", detail: "The audio track is not available" },
      { code: "FINISHED" },
    ];
    await day();
    const posts = await dayPosts();
    expect(posts.every((p) => p.post.status === "posted")).toBe(true);
    // One more container than posts: the refused one.
    expect(meta.calls.createReelContainer).toBe(posts.length + 1);
    // Meta named the audio: that sound is marked refused in the list at once.
    const [setup] = await db.select().from(schema.autopilotSetups);
    const refused = (setup!.sounds as { audioId: string; refusedAt?: string }[]).filter(
      (s) => s.refusedAt,
    );
    expect(refused).toHaveLength(1);
    // Exactly one post went out with another sound than its slot planned: the refused one's.
    const all = await slots();
    const moved = posts.filter((p) => {
      const slot = all.find((s) => s.scheduledPostId === p.post.id)!;
      return (
        (slot.sound as { audioId: string }).audioId !==
        (p.post.sound as { audioId: string }).audioId
      );
    });
    expect(moved).toHaveLength(1);
    const slot = all.find((s) => s.scheduledPostId === moved[0]!.post.id)!;
    expect((slot.sound as { audioId: string }).audioId).toBe(refused[0]!.audioId);
    // Handled quietly: no email.
    expect((await emails(israel(DAY, "23:59"))).sent).toBe(0);
  });

  it("never posts without a sound: a removed sound is put back; none left fails and pauses", async () => {
    await runDay(db, storage, root, DAY, { to: "09:00" });
    const [first, second] = (await slots(YAEL)).sort(
      (a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime(),
    );
    await db
      .update(schema.scheduledPosts)
      .set({ sound: null })
      .where(eq(schema.scheduledPosts.id, first!.scheduledPostId!));
    await runDay(db, storage, root, DAY, { from: "12:00", to: "12:00" });
    const [put] = await db
      .select()
      .from(schema.scheduledPosts)
      .where(eq(schema.scheduledPosts.id, first!.scheduledPostId!));
    expect(put!.status).toBe("posted");
    expect(put!.sound).not.toBeNull();

    // Every sound refused, and the next post's sound removed: it fails, the accounts pause.
    await db
      .update(schema.autopilotSetups)
      .set({ sounds: SOUNDS.map((s) => ({ ...s, refusedAt: "2026-10-25T09:00:00.000Z" })) });
    await db
      .update(schema.scheduledPosts)
      .set({ sound: null })
      .where(eq(schema.scheduledPosts.id, second!.scheduledPostId!));
    // The publish lane first, before a tick notices the empty list.
    await publishDue(db, israel(DAY, "14:00"));
    const [failed] = await db
      .select()
      .from(schema.scheduledPosts)
      .where(eq(schema.scheduledPosts.id, second!.scheduledPostId!));
    expect(failed!.status).toBe("failed");
    expect(failed!.failureKind).toBe("sound_unavailable");
    expect(meta.containers.every((c) => c.audio !== undefined)).toBe(true);
    await runDay(db, storage, root, DAY, { from: "14:10", to: "14:10" });
    expect((await accountRow(YAEL)).pausedCause).toBe("no_sound");
  });

  it("pauses a lapsed connection, cancels what waits, and emails once", async () => {
    await runDay(db, storage, root, DAY, { to: "12:30" });
    await db
      .update(schema.socialAccounts)
      .set({ status: "expired" })
      .where(eq(schema.socialAccounts.id, world.accounts.get(SHIR)!));
    await runDay(db, storage, root, DAY, { from: "12:40", to: "23:59" });
    const account = await accountRow(SHIR);
    expect(account.pausedCause).toBe("connection");
    const left = await slots(SHIR);
    expect(left.filter((s) => s.status === "cancelled")).toHaveLength(3);
    expect((await emails(israel(DAY, "23:59"))).sent).toBe(1);
    expect(sent[0]!.subject).toContain("shir_acreates");
    expect(sent[0]!.text).toContain("החיבור לחשבון באינסטגרם פג");
    // Once.
    expect((await emails(israel(NEXT, "08:00"))).sent).toBe(0);
    // The other accounts posted all of theirs.
    const posted = (await dayPosts()).filter((p) => p.post.status === "posted");
    expect(posted).toHaveLength(1 + 4 + 4 + 3);
    // No per-post failure email for an autopilot post.
    expect(
      (await sweepPostFailureEmails(db, { workerId: "hetzner", now: israel(NEXT, "08:00") })).sent,
    ).toBe(0);
  });

  it("pauses when Meta refuses the file itself, after trying other sounds, and emails once", async () => {
    meta.throwOn.createReelContainer = () =>
      new MetaGraphError(400, { message: "Invalid parameter", code: 100, error_subcode: 2207026 });
    await runDay(db, storage, root, DAY, { to: "12:20" });
    for (const ig of [SHIR, OMRI, YAEL, TAVNIT]) {
      expect((await accountRow(ig)).pausedCause).toBe("file_refused");
    }
    // Three sounds tried per post (two swaps), then the account stops: no fourth try.
    expect(meta.calls.createReelContainer).toBe(4 * 3);
    expect((await emails(israel(DAY, "12:20"))).sent).toBe(1);
    expect(sent[0]!.subject).toContain("4");
    // The failed posts get no per-post failure email: the pause email is the one.
    const failures = await sweepPostFailureEmails(db, {
      workerId: "hetzner",
      now: israel(DAY, "13:00"),
    });
    expect(failures.sent).toBe(0);
    expect((await emails(israel(DAY, "18:00"))).sent).toBe(0);
  });

  it("keeps a resume after a refused-file pause: the post that caused it does not pause it again", async () => {
    meta.throwOn.createReelContainer = () =>
      new MetaGraphError(400, { message: "Invalid parameter", code: 100, error_subcode: 2207026 });
    await runDay(db, storage, root, DAY, { to: "12:20" });
    const paused = await accountRow(SHIR);
    expect(paused.pausedCause).toBe("file_refused");
    expect((await emails(israel(DAY, "12:20"))).sent).toBe(1);
    // He fixes it and resumes at 13:00; Meta takes files again.
    delete meta.throwOn.createReelContainer;
    await resumeAutopilotAccount(
      db,
      world.userId,
      SHIR,
      paused.pausedAt!.toISOString(),
      israel(DAY, "13:00"),
    );
    await runDay(db, storage, root, DAY, { from: "13:00", to: "23:59" });
    expect((await accountRow(SHIR)).pausedCause).toBeNull();
    const rows = (await autopilotEmailRows()).filter((r) =>
      ((r.payload as { accounts?: { igUserId: string }[] }).accounts ?? []).some(
        (a) => a.igUserId === SHIR,
      ),
    );
    expect(rows).toHaveLength(1);
    // And it plans again from the next night.
    await runDay(db, storage, root, NEXT, { to: "05:00" });
    expect((await slots(SHIR)).filter((s) => s.day === NEXT)).toHaveLength(4);
  });

  it("plans late without booking passed times: a box down until 12:30 posts the rest, and pauses nothing", async () => {
    await runDay(db, storage, root, DAY, { from: "12:30", to: "23:59" });
    const all = await slots();
    expect(all.some((s) => s.skipReason === "late")).toBe(false);
    // 12:00 is still inside its two hours at 12:30: it posts late. Nothing is left out but what passed.
    expect((await dayPosts()).filter((p) => p.post.status === "posted")).toHaveLength(15);
    // A late night is not a day with nothing posted.
    for (const ig of [SHIR, OMRI, YAEL, TAVNIT])
      expect((await accountRow(ig)).pausedCause).toBeNull();
  });

  it("pauses a day with nothing posted, and emails once", async () => {
    await runDay(db, storage, root, DAY, { fail: () => true });
    for (const account of world.shape) {
      const own = await slots(account.igUserId);
      expect(own.every((s) => s.status === "skipped" && s.skipReason === "render_failed")).toBe(
        true,
      );
      expect((await accountRow(account.igUserId)).pausedCause).toBe("nothing_posted");
    }
    const first = await emails(israel(DAY, "23:59"));
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const rows = await autopilotEmailRows();
    const told = rows.flatMap(
      (r) => (r.payload as { accounts?: { igUserId: string }[] }).accounts ?? [],
    );
    expect(told.map((a) => a.igUserId).sort()).toEqual([SHIR, OMRI, YAEL, TAVNIT].sort());
    expect((await emails(israel(NEXT, "09:00"))).sent).toBe(0);
    // Paused: the next night plans nothing for them.
    await runDay(db, storage, root, NEXT, { to: "06:00" });
    expect((await slots()).filter((s) => s.day === NEXT)).toHaveLength(0);
  });

  it("pauses an account whose character has no active clips, at planning, and emails once", async () => {
    const galed = world.personas.get("גלעד")!;
    await db
      .update(schema.hookClips)
      .set({ active: false })
      .where(eq(schema.hookClips.personaId, galed));
    await day();
    expect((await accountRow(TAVNIT)).pausedCause).toBe("no_clips");
    expect(await slots(TAVNIT)).toHaveLength(0);
    expect((await dayPosts()).filter((p) => p.post.status === "posted")).toHaveLength(12);
    expect((await emails(israel(DAY, "23:59"))).sent).toBe(1);
    expect(sent[0]!.text).toContain("אין קטעי הוק פעילים");
  });

  it("sends nothing for an account he switched off, and a same-day resume is not paused again", async () => {
    await runDay(db, storage, root, DAY, { to: "09:00" });
    // Off by hand at 09:00: its posts are cancelled, and nothing is told.
    const shape = world.shape.map((a) =>
      accountInput(world, a, a.igUserId === OMRI ? { enabled: false } : {}),
    );
    await saveAutopilotSetup(
      db,
      world.userId,
      { businessId: world.businessId, sounds: SOUNDS, accounts: shape },
      israel(DAY, "09:00"),
    );
    // A connection pause on another at 10:00, resumed at 10:30.
    await db
      .update(schema.socialAccounts)
      .set({ status: "expired" })
      .where(eq(schema.socialAccounts.id, world.accounts.get(SHIR)!));
    await runDay(db, storage, root, DAY, { from: "10:00", to: "10:10" });
    const paused = await accountRow(SHIR);
    expect(paused.pausedCause).toBe("connection");
    // The worker sweeps every minute: the pause email goes out before he resumes.
    expect((await emails(israel(DAY, "10:10"))).sent).toBe(1);
    await db
      .update(schema.socialAccounts)
      .set({ status: "connected" })
      .where(eq(schema.socialAccounts.id, world.accounts.get(SHIR)!));
    await resumeAutopilotAccount(
      db,
      world.userId,
      SHIR,
      paused.pausedAt!.toISOString(),
      israel(DAY, "10:30"),
    );
    await runDay(db, storage, root, DAY, { from: "10:40", to: "23:59" });

    expect((await accountRow(OMRI)).pausedCause).toBeNull();
    expect((await slots(OMRI)).every((s) => s.status === "cancelled")).toBe(true);
    expect((await accountRow(SHIR)).pausedCause).toBeNull();
    await emails(israel(DAY, "23:59"));
    const rows = await autopilotEmailRows();
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as { accounts: { igUserId: string }[] }).accounts).toEqual([
      { igUserId: SHIR, cause: "connection" },
    ]);
    // The resumed account starts again with the next night.
    await runDay(db, storage, root, NEXT, { to: "04:00" });
    expect((await slots(SHIR)).filter((s) => s.day === NEXT)).toHaveLength(4);
  });

  it("plans nothing on the day the setup is saved after 03:00, and plans at the next night", async () => {
    // A fresh setup saved at 20:00 on the day: every account switched on now.
    await db.delete(schema.autopilotAccounts);
    await saveAutopilotSetup(
      db,
      world.userId,
      {
        businessId: world.businessId,
        sounds: SOUNDS,
        accounts: world.shape.map((a) => accountInput(world, a)),
      },
      israel(DAY, "20:00"),
    );
    await runDay(db, storage, root, DAY, { from: "20:00", to: "23:59" });
    expect(await slots()).toHaveLength(0);
    expect((await emails(israel(DAY, "23:59"))).sent).toBe(0);
    await runDay(db, storage, root, NEXT, { to: "05:00" });
    expect((await slots()).filter((s) => s.day === NEXT)).toHaveLength(15);
  });

  it("shows a skipped slot on the calendar and emails nothing for it", async () => {
    // One slot's renders fail three times; everything else goes out.
    let target: string | undefined;
    await runDay(db, storage, root, DAY, {
      fail: async (renderId) => {
        const [slot] = await db
          .select()
          .from(schema.autopilotSlots)
          .where(eq(schema.autopilotSlots.videoRenderId, renderId));
        target ??= slot?.id;
        return slot?.id === target;
      },
    });
    const skipped = await listSkippedAutopilotSlots(db, {
      userId: world.userId,
      from: israel(DAY, "00:00"),
      to: israel(DAY, "23:59"),
    });
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toBe("render_failed");
    expect((await dayPosts()).filter((p) => p.post.status === "posted")).toHaveLength(14);
    expect((await emails(israel(DAY, "23:59"))).sent).toBe(0);
  });

  it("skips a render that never finishes at its deadline, and the next one renders", async () => {
    // The heavy lane is wedged until 14:05.
    await runDay(db, storage, root, DAY, { to: "14:05", renders: false });
    const noon = (await slots()).filter(
      (s) => s.scheduledFor.getTime() === israel(DAY, "12:00").getTime(),
    );
    expect(noon.every((s) => s.status === "skipped" && s.skipReason === "late")).toBe(true);
    await runDay(db, storage, root, DAY, { from: "14:10", to: "23:59" });
    const posted = (await dayPosts()).filter((p) => p.post.status === "posted");
    expect(posted).toHaveLength(15 - noon.length);
  });

  it("keeps the clip on a third attempt when every clip is out that day", async () => {
    // shir_acreates: טליה has 4 clips and posts 4 a day — no spare clip.
    let target: string | undefined;
    let failures = 0;
    await runDay(db, storage, root, DAY, {
      fail: async (renderId) => {
        const [slot] = await db
          .select()
          .from(schema.autopilotSlots)
          .where(eq(schema.autopilotSlots.videoRenderId, renderId));
        if (!slot || slot.igUserId !== SHIR) return false;
        target ??= slot.id;
        if (slot.id !== target || failures >= 2) return false;
        failures++;
        return true;
      },
    });
    const [slot] = await db
      .select()
      .from(schema.autopilotSlots)
      .where(eq(schema.autopilotSlots.id, target!));
    expect(slot!.renderAttempts).toBe(3);
    expect(slot!.status).toBe("scheduled");
    const renders = await db
      .select()
      .from(schema.videoRenders)
      .where(sql`${schema.videoRenders.params}->>'hookClipId' = ${slot!.hookClipId}`);
    expect(renders).toHaveLength(3);
    // A new line on the third attempt, the same clip.
    expect(
      new Set(renders.map((r) => (r.params as { hookLineScriptId: string }).hookLineScriptId)).size,
    ).toBe(2);
    expect((await dayPosts()).filter((p) => p.post.status === "posted")).toHaveLength(15);
  });

  it("posts to the new connection after a disconnect and reconnect mid-night", async () => {
    await runDay(db, storage, root, DAY, { to: "03:05" });
    expect(await slots(SHIR)).toHaveLength(4);
    await disconnectSocialAccount(db, {
      userId: world.userId,
      accountId: world.accounts.get(SHIR)!,
    });
    const [fresh] = await connectInstagram(db, world.userId, [
      {
        ...samplePage(SHIR, "1"),
        instagram: {
          id: SHIR,
          username: "shir_acreates",
          name: "shir",
          pictureUrl: "https://cdn/p.jpg",
        },
      },
    ]);
    expect(fresh).not.toBe(world.accounts.get(SHIR));
    await runDay(db, storage, root, DAY, { from: "03:15", to: "23:59" });
    const own = (await dayPosts()).filter((p) => p.account.username === "shir_acreates");
    expect(own).toHaveLength(4);
    expect(own.every((p) => p.account.id === fresh && p.post.status === "posted")).toBe(true);
  });

  it("skips slots with no hook line when the writer fails, within the night's cap, and goes on", async () => {
    lineScript.fail = true;
    await day();
    const all = await slots();
    expect(all.every((s) => s.status === "skipped" && s.skipReason === "no_line")).toBe(true);
    const [setup] = await db.select().from(schema.autopilotSetups);
    expect(setup!.lineCalls).toBeLessThanOrEqual(4);
    expect(lineScript.calls).toBeLessThanOrEqual(4);
    // The night still ran (planning finished); every account had nothing posted.
    const nights = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.kind, AUTOPILOT_NIGHT));
    expect(nights).toHaveLength(1);
    expect((await accountRow(SHIR)).pausedCause).toBe("nothing_posted");
  });

  it("schedules nothing for an account that is off, or for an owner the switch hides", async () => {
    await saveAutopilotSetup(
      db,
      world.userId,
      {
        businessId: world.businessId,
        sounds: SOUNDS,
        accounts: world.shape.map((a) =>
          accountInput(world, a, a.igUserId === YAEL ? { enabled: false } : {}),
        ),
      },
      israel("2026-10-24", "13:00"),
    );
    await day();
    expect(await slots(YAEL)).toHaveLength(0);
    expect(await slots(OMRI)).toHaveLength(4);

    // A customer with a setup, hidden by the switch (no row = admins only): nothing.
    const [customer] = await db
      .insert(schema.users)
      .values({ email: "customer@test.local" })
      .returning();
    const [business] = await db
      .insert(schema.businesses)
      .values({ ownerUserId: customer!.id, name: "לקוח" })
      .returning();
    await connectInstagram(db, customer!.id, [samplePage("17841400000000099", "c")]);
    await db.insert(schema.autopilotSetups).values({
      userId: customer!.id,
      businessId: business!.id,
      sounds: SOUNDS,
    });
    await db.insert(schema.autopilotAccounts).values({
      userId: customer!.id,
      igUserId: "17841400000000099",
      enabled: true,
      aPerDay: 1,
      postTimes: ["12:00"],
      personaIds: [world.personas.get("טליה")!],
      demoIds: [],
      enabledAt: israel("2026-10-24", "10:00"),
    });
    await runDay(db, storage, root, NEXT, { to: "05:00" });
    expect(
      await db
        .select()
        .from(schema.autopilotSlots)
        .where(eq(schema.autopilotSlots.userId, customer!.id)),
    ).toHaveLength(0);
  });
});

/** The dry run's table (AUTOPILOT_TABLE=1): every post, as the founder would read it. */
async function printTable(
  db: Db,
  world: World,
  posts: Awaited<ReturnType<typeof listScheduledPosts>>,
): Promise<void> {
  const slotRows = await db.select().from(schema.autopilotSlots);
  const personaName = new Map([...world.personas].map(([name, id]) => [id, name]));
  const clipLabel = new Map(
    [...world.clips].flatMap(([persona, clips]) =>
      clips.map((c, i) => [c, `${personaName.get(persona)} #${i + 1}`] as const),
    ),
  );
  const demoName = new Map(world.demos.map((d) => [d.id, d.name]));
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: ISRAEL_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const rows = posts
    .map((item) => {
      const slot = slotRows.find((s) => s.scheduledPostId === item.post.id)!;
      return {
        account: `@${item.account.username}`,
        character: personaName.get(slot.personaId!),
        clip: clipLabel.get(slot.hookClipId!),
        demo: demoName.get(slot.demoId!),
        sound: (item.post.sound as { title: string }).title,
        time: time.format(item.post.scheduledAt),
        at: item.post.scheduledAt.getTime(),
      };
    })
    .sort((a, b) => a.account.localeCompare(b.account) || a.at - b.at)
    .map(({ at: _at, ...row }) => row);
  console.log(`\nDRY RUN ${DAY} (Israel time)\n${JSON.stringify(rows, null, 1)}`);
}
