import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { assertBudget } from "../budget";
import type { Db } from "../db";
import {
  appConfig,
  autopilotAccounts,
  autopilotSetups,
  autopilotSlots,
  demos,
  events,
  hookClips,
  personas,
  scheduledPosts,
  scripts,
  socialAccounts,
  users,
  videoRenders,
} from "../db/schema";
import type { Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { logger } from "../logger";
import { addDays, ISRAEL_TIME_ZONE, zonedDate, zonedWallTimeToInstant } from "../zoned-time";
import { generateHookLines } from "./copy";
import { isAdminOwned } from "./businesses";
import { latestApprovedStepPlan } from "./demo-step-plans";
import { createSet } from "./sets";
import {
  cancelScheduledPost,
  getPlatformAccess,
  schedulePosts,
  SocialSchedulingError,
  socialPostingSchema,
  type NextSoundAnswer,
  type SoundSnapshot,
} from "./social";

/**
 * The Instagram autopilot (decision 0127): after a one-time setup, every night
 * Tavnit makes the day's הוק + דמו videos for each connected Instagram account
 * and schedules them across the account's posting times through today's path
 * (`schedulePosts` → `publish_post`). Admin-only behind `app_config.autopilot`,
 * built so customers could use it later.
 *
 * One job does all of it: `autopilot_tick`, a singleton on the light lane every
 * 60 s (the reaper's shape). Each tick moves the slots one guarded step:
 *
 *   plan (once a day, after 03:00 Israel) → planned
 *   render, one at a time across every setup → rendering
 *   released → scheduled (a scheduled_posts row) | failed → retry, another
 *   version, or skipped
 *
 * and watches what went out: a refusal of the file or a lapsed connection
 * pauses the account, a day with nothing posted pauses it, and every pause is
 * one email (pipelines/autopilot-email.ts). The tick never throws: each setup,
 * account and slot is its own try, a known refusal maps to an outcome, and an
 * unknown fault three times skips the slot — a stuck tick would be the silent
 * stop decision 17 rules out. A night that never runs, or whose planning keeps
 * failing, writes no `autopilot_night` row, and the worker's Sentry check-in
 * misses.
 */

export const AUTOPILOT_SWITCH_KEY = "autopilot";
/** The events kind of "the night ran" — read by the worker's Sentry check-in, never an alert kind. */
export const AUTOPILOT_NIGHT = "autopilot_night";
/** Quiet, unique on both clock-change days, five hours before the earliest post. */
export const AUTOPILOT_NIGHT_TIME = "03:00";
export const AUTOPILOT_EARLIEST_TIME = "08:00";
export const AUTOPILOT_LATEST_TIME = "23:55";
export const AUTOPILOT_MAX_PER_DAY = 12;
/** A slot posts no later than this after its time, or it is skipped as late. */
export const AUTOPILOT_SLOT_DEADLINE_MS = 2 * 60 * 60 * 1000;
/** The planned version, the same again, then another version (decision 17). */
export const AUTOPILOT_MAX_RENDER_ATTEMPTS = 3;
/**
 * Hook-line writer runs per setup per night, failures included: the runaway
 * valve (CLAUDE.md, paid loops). A run is at most two Claude calls — the
 * writer regenerates once after an unrenderable character — so 8 at worst.
 */
export const AUTOPILOT_LINE_CALLS_PER_NIGHT = 4;
/** Fewer usable sounds than this sends the one "the list runs low" email. */
export const AUTOPILOT_LOW_SOUNDS = 3;
/** An unknown fault this many times on one slot skips it. */
export const AUTOPILOT_MAX_FAULTS = 3;
export const AUTOPILOT_TICK_MS = 60_000;

export const AUTOPILOT_PAUSE_CAUSES = [
  "connection",
  "no_sound",
  "no_clips",
  "file_refused",
  "nothing_posted",
] as const;
export type AutopilotPauseCause = (typeof AUTOPILOT_PAUSE_CAUSES)[number];

/** A saved sound: the picker's snapshot, plus when Meta refused it (server-owned). */
export type AutopilotSound = SoundSnapshot & { refusedAt?: string };

type SetupRow = typeof autopilotSetups.$inferSelect;
type AccountRow = typeof autopilotAccounts.$inferSelect;
type SlotRow = typeof autopilotSlots.$inferSelect;

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/**
 * Who reaches the autopilot: `app_config.autopilot` shaped like
 * `social_posting` (admins | named | everyone; no row = admins; a row that does
 * not parse hides non-admins), AND Instagram's own switch, so a platform its
 * switch hides leaves no trace here either. An admin always passes both.
 */
export async function getAutopilotAccess(db: Db, userId: string): Promise<boolean> {
  if (!(await getPlatformAccess(db, userId)).instagram) return false;
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (user?.role === "admin") return true;
  const [row] = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(eq(appConfig.key, AUTOPILOT_SWITCH_KEY))
    .limit(1);
  const parsed = socialPostingSchema.safeParse(row?.value ?? { access: "admins" });
  if (!parsed.success) return false;
  if (parsed.data.access === "everyone") return true;
  return (
    parsed.data.access === "named" &&
    parsed.data.userIds.some((id) => id.toLowerCase() === userId.toLowerCase())
  );
}

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

export function usableSounds(sounds: unknown): AutopilotSound[] {
  return (Array.isArray(sounds) ? (sounds as AutopilotSound[]) : []).filter((s) => !s.refusedAt);
}

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** The account's live row (one per user × Instagram id: `social_accounts_live_idx`). */
export async function liveInstagramRow(db: Db, userId: string, igUserId: string) {
  const [row] = await db
    .select({ id: socialAccounts.id, status: socialAccounts.status })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.userId, userId),
        eq(socialAccounts.platform, "instagram"),
        eq(socialAccounts.externalId, igUserId),
        inArray(socialAccounts.status, ["connected", "expired"]),
      ),
    )
    .limit(1);
  return row;
}

/** Active clips of the given characters, with a file (never the CLI's 'pending' placeholder). */
export async function activeClips(
  db: Db,
  personaIds: string[],
): Promise<{ id: string; personaId: string }[]> {
  if (personaIds.length === 0) return [];
  const rows = await db
    .select({ id: hookClips.id, personaId: hookClips.personaId })
    .from(hookClips)
    .where(
      and(
        inArray(hookClips.personaId, personaIds),
        eq(hookClips.active, true),
        sql`${hookClips.filePath} like '%/%'`,
      ),
    )
    .orderBy(asc(hookClips.createdAt), asc(hookClips.id));
  return rows.flatMap((r) => (r.personaId ? [{ id: r.id, personaId: r.personaId }] : []));
}

/** The characters a setup may use: active, with a gender (a hook line is first person, and Hebrew first person is gendered). */
export async function usablePersonas(
  db: Db,
  ids: string[],
): Promise<Map<string, { id: string; name: string; gender: "female" | "male" }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: personas.id, name: personas.name, gender: personas.gender })
    .from(personas)
    .where(and(inArray(personas.id, ids), eq(personas.active, true)));
  return new Map(
    rows.flatMap((r) =>
      r.gender === "female" || r.gender === "male"
        ? [[r.id, { id: r.id, name: r.name, gender: r.gender }] as const]
        : [],
    ),
  );
}

/**
 * Whether a demo can render a הוק + דמו video now, and if not why — what the
 * setup shows beside it (decision 10's default): ready, with its newest
 * APPROVED plan (an unapproved fork or a regenerate above it does not hide it).
 */
export type DemoReadiness =
  | { ok: true; stepPlanId: string }
  | { ok: false; reason: "ingesting" | "rejected" | "no_approved_plan" };

export async function demoReadiness(
  db: Db,
  demo: { id: string; status: string; normalizedPath: string | null },
): Promise<DemoReadiness> {
  if (demo.status === "rejected") return { ok: false, reason: "rejected" };
  if (demo.status !== "ready" || !demo.normalizedPath) return { ok: false, reason: "ingesting" };
  const plan = await latestApprovedStepPlan(db, demo.id);
  return plan ? { ok: true, stepPlanId: plan.id } : { ok: false, reason: "no_approved_plan" };
}

/** The account's demos that can render now, each with the approved plan it renders. */
async function readyDemos(db: Db, businessId: string, ids: string[]): Promise<Map<string, string>> {
  const ready = new Map<string, string>();
  if (ids.length === 0) return ready;
  const rows = await db
    .select({ id: demos.id, status: demos.status, normalizedPath: demos.normalizedPath })
    .from(demos)
    .where(and(eq(demos.businessId, businessId), inArray(demos.id, ids)));
  for (const demo of rows) {
    const readiness = await demoReadiness(db, demo);
    if (readiness.ok) ready.set(demo.id, readiness.stepPlanId);
  }
  return ready;
}

interface Usage {
  n: number;
  last: string | null;
}

/** How often each clip / demo / sound went on this account's slots, and the last day. */
async function usageOn(
  db: Db,
  userId: string,
  igUserId: string,
  column: "hook_clip_id" | "demo_id" | "sound",
): Promise<Map<string, Usage>> {
  const key =
    column === "sound"
      ? sql`${autopilotSlots.sound}->>'audioId'`
      : column === "demo_id"
        ? sql`${autopilotSlots.demoId}::text`
        : sql`${autopilotSlots.hookClipId}::text`;
  const rows = await db
    .select({
      id: sql<string | null>`${key}`,
      n: sql<string>`count(*)`,
      last: sql<string | null>`max(${autopilotSlots.day})::text`,
    })
    .from(autopilotSlots)
    .where(
      and(
        eq(autopilotSlots.userId, userId),
        eq(autopilotSlots.igUserId, igUserId),
        sql`${autopilotSlots.status} not in ('skipped', 'cancelled')`,
      ),
    )
    .groupBy(key);
  return new Map(
    rows.flatMap((r) => (r.id ? [[r.id, { n: Number(r.n), last: r.last }] as const] : [])),
  );
}

/** Least-used first (decision 12): fewest uses, then the longest unused, then the id. */
function byLeastUsed(usage: Map<string, Usage>) {
  return (a: string, b: string): number => {
    const ua = usage.get(a) ?? { n: 0, last: null };
    const ub = usage.get(b) ?? { n: 0, last: null };
    if (ua.n !== ub.n) return ua.n - ub.n;
    if (ua.last !== ub.last) {
      if (ua.last === null) return -1;
      if (ub.last === null) return 1;
      return ua.last < ub.last ? -1 : 1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  };
}

/** `count` picks in rotation, repeats allowed once every id has had a turn (demos, sounds). */
function rotate(ids: string[], usage: Map<string, Usage>, count: number, day: string): string[] {
  const live = new Map([...usage].map(([id, u]) => [id, { ...u }]));
  const picks: string[] = [];
  for (let i = 0; i < count && ids.length > 0; i++) {
    const id = [...ids].sort(byLeastUsed(live))[0]!;
    picks.push(id);
    const u = live.get(id) ?? { n: 0, last: null };
    live.set(id, { n: u.n + 1, last: day });
  }
  return picks;
}

/**
 * Clips already out on this account on `day`: held by a live slot of the day,
 * or on an autopilot post of the account still waiting or posted that Israel
 * day — a post of yesterday's that ran past midnight counts (decision 9).
 */
async function clipsUsedOn(db: Db, userId: string, igUserId: string, day: string) {
  const dayStart = zonedWallTimeToInstant(ISRAEL_TIME_ZONE, day, "00:00");
  const rows = await db
    .select({ clip: autopilotSlots.hookClipId })
    .from(autopilotSlots)
    .leftJoin(scheduledPosts, eq(scheduledPosts.id, autopilotSlots.scheduledPostId))
    .where(
      and(
        eq(autopilotSlots.userId, userId),
        eq(autopilotSlots.igUserId, igUserId),
        isNotNull(autopilotSlots.hookClipId),
        or(
          and(
            eq(autopilotSlots.day, day),
            sql`${autopilotSlots.status} not in ('skipped', 'cancelled')`,
          ),
          inArray(scheduledPosts.status, ["scheduled", "publishing"]),
          and(eq(scheduledPosts.status, "posted"), gte(scheduledPosts.postedAt, dayStart)),
        ),
      ),
    );
  return new Set(rows.flatMap((r) => (r.clip ? [r.clip] : [])));
}

/**
 * The hook lines a slot may take: the autopilot's own `hook_line` rows of the
 * business in the gender, that no slot or render ever used, and whose exact
 * text no used line has (an edit or a second batch can repeat a text). "A hook
 * line is never used twice."
 */
async function linePool(
  db: Db,
  businessId: string,
  gender: "female" | "male",
  limit: number,
): Promise<{ id: string; text: string }[]> {
  const rows = await db.execute(sql`
    select s.id, s.text from scripts s
    where s.business_id = ${businessId}
      and s.kind = 'hook_line'
      and s.params->'autopilot'->>'gender' = ${gender}
      and not exists (
        select 1 from scripts u
        where u.business_id = ${businessId} and u.kind = 'hook_line'
          and btrim(u.text) = btrim(s.text)
          and (
            exists (select 1 from autopilot_slots a where a.hook_line_script_id = u.id)
            or exists (
              select 1 from video_renders r
              where r.business_id = ${businessId} and r.params->>'hookLineScriptId' = u.id::text
            )
          )
      )
    order by s.created_at, s.id
    limit ${limit}
  `);
  const seen = new Set<string>();
  // The two drivers wrap a raw result differently (jobs/queue.ts rowsOf).
  const list = (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])) as {
    id: string;
    text: string;
  }[];
  return list.filter((r) => {
    const key = r.text.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Top the gender's pool up to `need` with the wizard's own generator (prompt
 * hook_lines, untouched) — before any transaction, so a slow model call holds
 * no lock. Each attempt is counted BEFORE it runs, so a failing call still
 * spends the night's valve; a refusal or a model fault ends the top-up and the
 * slots without a line are skipped `no_line`.
 */
async function topUpLines(
  db: Db,
  setup: SetupRow,
  gender: "female" | "male",
  personaId: string,
  need: number,
  day: string,
): Promise<void> {
  while ((await linePool(db, setup.businessId, gender, need)).length < need) {
    const [current] = await db
      .select({ day: autopilotSetups.lineCallsDay, calls: autopilotSetups.lineCalls })
      .from(autopilotSetups)
      .where(eq(autopilotSetups.userId, setup.userId));
    const calls = current?.day === day ? current.calls : 0;
    if (calls >= AUTOPILOT_LINE_CALLS_PER_NIGHT) return;
    await db
      .update(autopilotSetups)
      .set({ lineCallsDay: day, lineCalls: calls + 1, updatedAt: new Date() })
      .where(eq(autopilotSetups.userId, setup.userId));
    try {
      await assertBudget(db, "llm_tokens");
      const recent = await db
        .select({ text: scripts.text })
        .from(scripts)
        .where(
          and(
            eq(scripts.businessId, setup.businessId),
            eq(scripts.kind, "hook_line"),
            sql`${scripts.params}->'autopilot'->>'gender' = ${gender}`,
          ),
        )
        .orderBy(desc(scripts.createdAt))
        .limit(20);
      const rows = await generateHookLines(db, {
        businessId: setup.businessId,
        personaId,
        avoid: recent.map((r) => r.text),
      });
      if (rows.length === 0) return;
      const tag = JSON.stringify({ autopilot: { gender, day, batch: `${day}:${calls + 1}` } });
      await db
        .update(scripts)
        .set({ params: sql`${scripts.params} || ${tag}::jsonb` })
        .where(
          inArray(
            scripts.id,
            rows.map((r) => r.id),
          ),
        );
    } catch (err) {
      logger.warn({ err, userId: setup.userId, gender }, "autopilot: hook-line top-up failed");
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Pauses and cancels
// ---------------------------------------------------------------------------

/**
 * Pause one account. Only an account that is on and not already paused: the
 * first cause wins, so its email (keyed on paused_at) can never repeat. Its
 * open slots end `cancelled` and its autopilot posts that have not started are
 * cancelled — a pause stops posting (PLANNING DEFAULT, 0127).
 */
export async function pauseAutopilotAccount(
  db: Db,
  account: { userId: string; igUserId: string },
  cause: AutopilotPauseCause,
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .update(autopilotAccounts)
    .set({ pausedCause: cause, pausedAt: now, pauseEmailedAt: null, updatedAt: now })
    .where(
      and(
        eq(autopilotAccounts.userId, account.userId),
        eq(autopilotAccounts.igUserId, account.igUserId),
        eq(autopilotAccounts.enabled, true),
        isNull(autopilotAccounts.pausedCause),
      ),
    )
    .returning({ id: autopilotAccounts.id });
  if (!row) return false;
  await cancelOpenSlots(db, account.userId, account.igUserId, "paused", now);
  logger.warn({ userId: account.userId, igUserId: account.igUserId, cause }, "autopilot: paused");
  return true;
}

/**
 * What a pause and a switch-off share: nothing more of the account's goes out.
 * A post whose publishing started goes out anyway (SocialSchedulingError). Any
 * other failure is retried by every tick's pass over an account that is paused
 * or off (watchSetup); a switch-off also throws after the pass, so the save
 * that switched it off answers an error instead of a silent success.
 */
export async function cancelOpenSlots(
  db: Db,
  userId: string,
  igUserId: string,
  reason: "paused" | "off",
  now: Date,
): Promise<void> {
  await db
    .update(autopilotSlots)
    .set({ status: "cancelled", skipReason: reason, updatedAt: now })
    .where(
      and(
        eq(autopilotSlots.userId, userId),
        eq(autopilotSlots.igUserId, igUserId),
        inArray(autopilotSlots.status, ["planned", "rendering"]),
      ),
    );
  const scheduled = await db
    .select({ id: autopilotSlots.id, postId: autopilotSlots.scheduledPostId })
    .from(autopilotSlots)
    .innerJoin(scheduledPosts, eq(scheduledPosts.id, autopilotSlots.scheduledPostId))
    .where(
      and(
        eq(autopilotSlots.userId, userId),
        eq(autopilotSlots.igUserId, igUserId),
        eq(autopilotSlots.status, "scheduled"),
        inArray(scheduledPosts.status, ["scheduled", "publishing"]),
      ),
    );
  let failed = 0;
  for (const slot of scheduled) {
    try {
      await cancelScheduledPost(db, { userId, postId: slot.postId! });
    } catch (err) {
      if (!(err instanceof SocialSchedulingError)) {
        failed++;
        logger.warn({ err, slotId: slot.id }, "autopilot: cancel failed — retrying next tick");
      }
      continue;
    }
    await db
      .update(autopilotSlots)
      .set({ status: "cancelled", skipReason: reason, updatedAt: now })
      .where(eq(autopilotSlots.id, slot.id));
  }
  if (failed > 0 && reason === "off") {
    throw new Error(`autopilot: ${failed} post(s) of a switched-off account not cancelled yet`);
  }
}

async function skipSlot(db: Db, slotId: string, reason: string, now: Date): Promise<void> {
  await db
    .update(autopilotSlots)
    .set({ status: "skipped", skipReason: reason, updatedAt: now })
    .where(
      and(eq(autopilotSlots.id, slotId), inArray(autopilotSlots.status, ["planned", "rendering"])),
    );
}

/** An unknown fault on a slot: counted, and the third skips it — one bad slot never wedges the tick. */
async function recordFault(db: Db, slotId: string, err: unknown, now: Date): Promise<void> {
  logger.warn({ err, slotId }, "autopilot: slot step failed");
  const [row] = await db
    .update(autopilotSlots)
    .set({ faults: sql`${autopilotSlots.faults} + 1`, updatedAt: now })
    .where(eq(autopilotSlots.id, slotId))
    .returning({ faults: autopilotSlots.faults });
  if (row && row.faults >= AUTOPILOT_MAX_FAULTS) await skipSlot(db, slotId, "error", now);
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

export async function handleAutopilotTick(_job: Job, ctx: JobContext): Promise<JobResult> {
  try {
    await runAutopilotTick(ctx.db, new Date());
  } catch (err) {
    // The singleton's attempts never reset (jobs/schedule.ts): a throw here
    // would eventually kill it silently. Every step below has its own catch;
    // this one is for the reads around them.
    ctx.log.warn({ err }, "autopilot: tick failed — retrying next tick");
  }
  return { kind: "reschedule", delayMs: AUTOPILOT_TICK_MS };
}

/** One tick at `now`. Exported for the tests, which step a clock through a night. */
export async function runAutopilotTick(db: Db, now: Date): Promise<void> {
  const today = zonedDate(ISRAEL_TIME_ZONE, now);
  const planFrom = zonedWallTimeToInstant(ISRAEL_TIME_ZONE, today, AUTOPILOT_NIGHT_TIME);

  const setups: SetupRow[] = [];
  for (const setup of await db.select().from(autopilotSetups)) {
    if (await getAutopilotAccess(db, setup.userId)) setups.push(setup);
  }

  // 1. Plan today, once per account, after 03:00.
  if (now >= planFrom) {
    for (const setup of setups) {
      for (const account of await accountsOf(db, setup.userId)) {
        if (!isDue(account, today, planFrom)) continue;
        try {
          await planAccountDay(db, setup, account, today, planFrom, now);
        } catch (err) {
          logger.warn({ err, igUserId: account.igUserId }, "autopilot: planning failed");
        }
      }
    }
    await recordNightIfPlanned(db, setups, today, planFrom);
  }

  // 2–5. Renders: what finished, then the deadlines, then the next one.
  for (const slot of await openSlots(db, setups, "rendering")) {
    try {
      await advanceRendering(db, setups, slot, now);
    } catch (err) {
      await recordFault(db, slot.id, err, now);
    }
  }
  await db
    .update(autopilotSlots)
    .set({ status: "skipped", skipReason: "late", updatedAt: now })
    .where(
      and(
        inArray(autopilotSlots.status, ["planned", "rendering"]),
        lt(autopilotSlots.scheduledFor, new Date(now.getTime() - AUTOPILOT_SLOT_DEADLINE_MS)),
      ),
    );
  await startNextRender(db, setups, now);

  // 6–9. Watch what went out, judge the day, the sound list.
  for (const setup of setups) {
    try {
      await watchSetup(db, setup, today, now);
    } catch (err) {
      logger.warn({ err, userId: setup.userId }, "autopilot: watch failed");
    }
  }
}

async function accountsOf(db: Db, userId: string): Promise<AccountRow[]> {
  return db
    .select()
    .from(autopilotAccounts)
    .where(eq(autopilotAccounts.userId, userId))
    .orderBy(asc(autopilotAccounts.createdAt));
}

/**
 * Due for today's plan: on, not paused, not planned today, and on before
 * today's 03:00 — a setup saved, an account switched on or a pause resumed
 * during the day starts with the next night (and never pauses itself as
 * "nothing posted" on a day it could not plan). A box that was down at 03:00
 * still plans late for an account that was on.
 */
function isDue(account: AccountRow, today: string, planFrom: Date): boolean {
  return (
    account.enabled &&
    account.pausedCause === null &&
    (account.plannedDay === null || account.plannedDay < today) &&
    account.enabledAt !== null &&
    account.enabledAt < planFrom
  );
}

async function recordNightIfPlanned(
  db: Db,
  setups: SetupRow[],
  today: string,
  planFrom: Date,
): Promise<void> {
  for (const setup of setups) {
    for (const account of await accountsOf(db, setup.userId)) {
      if (isDue(account, today, planFrom)) return; // planning is still failing for one
    }
  }
  // Every night once planning has finished — with nothing due, or no setup at
  // all, too: the check-in means "the night ran", so an account off or paused
  // never trips Sentry (his ruling at plan approval, 2026-10-24).
  await db.execute(sql`
    insert into events (kind, payload)
    select ${AUTOPILOT_NIGHT}, jsonb_build_object('day', ${today}::text)
    where not exists (
      select 1 from events where kind = ${AUTOPILOT_NIGHT} and payload->>'day' = ${today}::text
    )
  `);
}

/** The night's plan for one account: pause checks, then lines, then one transaction of slots. */
async function planAccountDay(
  db: Db,
  setup: SetupRow,
  account: AccountRow,
  today: string,
  planFrom: Date,
  now: Date,
): Promise<void> {
  const ref = { userId: account.userId, igUserId: account.igUserId };
  const live = await liveInstagramRow(db, account.userId, account.igUserId);
  if (live?.status !== "connected") {
    await pauseAutopilotAccount(db, ref, "connection", now);
    return;
  }
  const sounds = usableSounds(setup.sounds);
  if (sounds.length === 0) {
    await pauseAutopilotAccount(db, ref, "no_sound", now);
    return;
  }
  const personaIds = idList(account.personaIds);
  const characters = await usablePersonas(db, personaIds);
  const clips = await activeClips(db, [...characters.keys()]);
  const clipCount = new Map<string, number>();
  for (const clip of clips) clipCount.set(clip.personaId, (clipCount.get(clip.personaId) ?? 0) + 1);
  // "A character with no active clips" pauses the account (decision 17) —
  // a character retired or left without a gender counts as one.
  if (personaIds.length === 0 || personaIds.some((id) => !clipCount.get(id))) {
    await pauseAutopilotAccount(db, ref, "no_clips", now);
    return;
  }

  // The count can never exceed the clips (decision 9): clamped here, refused by
  // the setup's save, and the clip-per-day index refuses a second use anyway.
  // A time whose deadline already passed (a box that was down at 03:00) is
  // left out before the count, so a late plan posts what it still can.
  const open = [...(account.postTimes as string[])]
    .sort()
    .map((time) => zonedWallTimeToInstant(ISRAEL_TIME_ZONE, today, time))
    .filter((at) => at.getTime() + AUTOPILOT_SLOT_DEADLINE_MS > now.getTime());
  const count = Math.min(account.aPerDay, open.length, clips.length);
  const slotTimes = open.slice(0, count);

  // Clips: least-used on this account, none already out today.
  const usedToday = await clipsUsedOn(db, account.userId, account.igUserId, today);
  const clipUsage = await usageOn(db, account.userId, account.igUserId, "hook_clip_id");
  // Ties go to the character used least so far today, so a page with three
  // characters gets all three (decision 7: the variety the official page is for).
  const candidates = clips.filter((c) => !usedToday.has(c.id));
  const leastUsed = byLeastUsed(clipUsage);
  const perCharacter = new Map<string, number>();
  const clipPicks: string[] = [];
  while (clipPicks.length < count && candidates.length > 0) {
    candidates.sort(
      (a, b) =>
        (clipUsage.get(a.id)?.n ?? 0) - (clipUsage.get(b.id)?.n ?? 0) ||
        (perCharacter.get(a.personaId) ?? 0) - (perCharacter.get(b.personaId) ?? 0) ||
        leastUsed(a.id, b.id),
    );
    const pick = candidates.shift()!;
    clipPicks.push(pick.id);
    perCharacter.set(pick.personaId, (perCharacter.get(pick.personaId) ?? 0) + 1);
  }
  const personaOf = new Map(clips.map((c) => [c.id, c.personaId]));

  // Demos: the account's, by rotation, only those that can render now.
  const ready = await readyDemos(db, setup.businessId, idList(account.demoIds));
  const demoPicks = rotate(
    [...ready.keys()],
    await usageOn(db, account.userId, account.igUserId, "demo_id"),
    clipPicks.length,
    today,
  );
  const soundPicks = rotate(
    sounds.map((s) => s.audioId),
    await usageOn(db, account.userId, account.igUserId, "sound"),
    clipPicks.length,
    today,
  );

  // Lines, before the transaction: the pool per gender, topped up if short.
  const need = { female: 0, male: 0 };
  for (const clipId of clipPicks) need[characters.get(personaOf.get(clipId)!)!.gender]++;
  const lines: Record<"female" | "male", { id: string; text: string }[]> = {
    female: [],
    male: [],
  };
  for (const gender of ["female", "male"] as const) {
    if (need[gender] === 0) continue;
    const speaker = [...characters.values()].find((c) => c.gender === gender)!;
    await topUpLines(db, setup, gender, speaker.id, need[gender], today);
    lines[gender] = await linePool(db, setup.businessId, gender, need[gender]);
  }

  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(autopilotAccounts)
      .where(eq(autopilotAccounts.id, account.id))
      .for("update");
    if (!locked || !isDue(locked, today, planFrom)) return;
    for (const [index, clipId] of clipPicks.entries()) {
      const personaId = personaOf.get(clipId)!;
      const gender = characters.get(personaId)!.gender;
      const line = lines[gender].shift();
      const demoId = demoPicks[index];
      const sound = sounds.find((s) => s.audioId === soundPicks[index]);
      const at = slotTimes[index]!;
      const skipReason = !demoId ? "no_demo" : !line ? "no_line" : null;
      await tx
        .insert(autopilotSlots)
        .values({
          userId: account.userId,
          igUserId: account.igUserId,
          socialAccountId: live.id,
          day: today,
          slotIndex: index,
          scheduledFor: at,
          personaId,
          hookClipId: clipId,
          demoId: demoId ?? null,
          stepPlanId: demoId ? ready.get(demoId)! : null,
          hookLineScriptId: line?.id ?? null,
          sound: sound ? stripRefused(sound) : null,
          status: skipReason ? "skipped" : "planned",
          skipReason,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
    await tx
      .update(autopilotAccounts)
      .set({ plannedDay: today, updatedAt: now })
      .where(eq(autopilotAccounts.id, account.id));
  });
}

function stripRefused(sound: AutopilotSound): SoundSnapshot {
  const { refusedAt: _refused, ...snapshot } = sound;
  return snapshot;
}

async function openSlots(db: Db, setups: SetupRow[], status: "planned" | "rendering") {
  if (setups.length === 0) return [];
  return db
    .select()
    .from(autopilotSlots)
    .where(
      and(
        eq(autopilotSlots.status, status),
        inArray(
          autopilotSlots.userId,
          setups.map((s) => s.userId),
        ),
      ),
    )
    .orderBy(asc(autopilotSlots.scheduledFor), asc(autopilotSlots.slotIndex));
}

/** On, not paused, connected — checked before every render and every schedule. */
async function accountReady(db: Db, slot: SlotRow, now: Date) {
  const [account] = await db
    .select()
    .from(autopilotAccounts)
    .where(
      and(eq(autopilotAccounts.userId, slot.userId), eq(autopilotAccounts.igUserId, slot.igUserId)),
    );
  if (!account?.enabled || account.pausedCause) return undefined;
  const live = await liveInstagramRow(db, slot.userId, slot.igUserId);
  if (live?.status !== "connected") {
    await pauseAutopilotAccount(db, slot, "connection", now);
    return undefined;
  }
  return live;
}

/** A rendering slot whose render ended: schedule it, or the next attempt. */
async function advanceRendering(
  db: Db,
  setups: SetupRow[],
  slot: SlotRow,
  now: Date,
): Promise<void> {
  if (!slot.videoRenderId) return;
  const [render] = await db
    .select({ status: videoRenders.status, filePath: videoRenders.filePath })
    .from(videoRenders)
    .where(eq(videoRenders.id, slot.videoRenderId));
  if (render?.status === "released" && render.filePath) {
    await scheduleSlot(db, setups, slot, now);
  } else if (!render || render.status === "failed" || render.status === "rejected") {
    await nextAttempt(db, setups, slot, now);
  }
}

/** Released → one post on the slot's one account (decision 8), with the slot's sound (13). */
async function scheduleSlot(db: Db, setups: SetupRow[], slot: SlotRow, now: Date): Promise<void> {
  if (slot.scheduledFor.getTime() + AUTOPILOT_SLOT_DEADLINE_MS <= now.getTime()) {
    await skipSlot(db, slot.id, "late", now);
    return;
  }
  const live = await accountReady(db, slot, now);
  if (!live) return;
  const setup = setups.find((s) => s.userId === slot.userId)!;
  // The slot's sound, unless Meta refused it since the plan: then the next.
  let sound = slot.sound as SoundSnapshot | null;
  const usable = usableSounds(setup.sounds);
  if (!sound || !usable.some((s) => s.audioId === sound!.audioId)) {
    sound = await nextUsableSound(db, setup, slot, []);
    if (!sound) {
      await pauseEveryAccount(db, setup.userId, "no_sound", now);
      return;
    }
  }
  try {
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: autopilotSlots.id })
        .from(autopilotSlots)
        .where(and(eq(autopilotSlots.id, slot.id), eq(autopilotSlots.status, "rendering")))
        .for("update");
      if (!locked) return;
      const [post] = await schedulePosts(
        tx as Db,
        {
          userId: slot.userId,
          videoRenderId: slot.videoRenderId!,
          accountIds: [live.id],
          scheduledAt: new Date(Math.max(slot.scheduledFor.getTime(), now.getTime())),
          timezone: ISRAEL_TIME_ZONE,
          // No caption (decision 14), no AI label (15).
          caption: "",
          sound,
          aiLabel: false,
          platforms: ["instagram"],
        },
        now,
      );
      await tx
        .update(autopilotSlots)
        .set({
          status: "scheduled",
          scheduledPostId: post!.id,
          socialAccountId: live.id,
          sound,
          updatedAt: now,
        })
        .where(eq(autopilotSlots.id, slot.id));
    });
  } catch (err) {
    if (!(err instanceof SocialSchedulingError)) throw err;
    if (err.code === "account_not_connected" || err.code === "not_found") {
      await pauseAutopilotAccount(db, slot, "connection", now);
    } else {
      await skipSlot(db, slot.id, err.code, now);
    }
  }
}

/**
 * A failed render (decision 17): attempt 2 is the same version again; attempt
 * 3 is another version — a clip no live slot of the day holds if there is one
 * (else the same clip), a new line, and another demo when there are two —
 * then the slot is skipped.
 */
async function nextAttempt(db: Db, setups: SetupRow[], slot: SlotRow, now: Date): Promise<void> {
  if (slot.renderAttempts >= AUTOPILOT_MAX_RENDER_ATTEMPTS) {
    await skipSlot(db, slot.id, "render_failed", now);
    return;
  }
  if (!(await accountReady(db, slot, now))) return;
  const setup = setups.find((s) => s.userId === slot.userId)!;
  if (slot.renderAttempts < 2) {
    await renderSlot(db, setup, slot, {}, now);
    return;
  }
  const [account] = await db
    .select()
    .from(autopilotAccounts)
    .where(
      and(eq(autopilotAccounts.userId, slot.userId), eq(autopilotAccounts.igUserId, slot.igUserId)),
    );
  const characters = await usablePersonas(db, idList(account?.personaIds));
  const clips = await activeClips(db, [...characters.keys()]);
  const held = await clipsUsedOn(db, slot.userId, slot.igUserId, slot.day);
  const clipUsage = await usageOn(db, slot.userId, slot.igUserId, "hook_clip_id");
  const freeClip = clips
    .filter((c) => c.id !== slot.hookClipId && !held.has(c.id))
    .sort((a, b) => byLeastUsed(clipUsage)(a.id, b.id))[0];
  const clip = freeClip ?? clips.find((c) => c.id === slot.hookClipId);
  const persona = clip ? characters.get(clip.personaId) : undefined;
  // Another version needs a line no slot used: from the pool, topped up if it is
  // empty (the night's valve still bounds the calls).
  let [line] = persona ? await linePool(db, setup.businessId, persona.gender, 1) : [];
  if (persona && !line) {
    await topUpLines(db, setup, persona.gender, persona.id, 1, slot.day);
    [line] = await linePool(db, setup.businessId, persona.gender, 1);
  }
  if (!clip || !persona || !line) {
    await skipSlot(db, slot.id, !line ? "no_line" : "render_failed", now);
    return;
  }
  const ready = await readyDemos(db, setup.businessId, idList(account?.demoIds));
  const demoUsage = await usageOn(db, slot.userId, slot.igUserId, "demo_id");
  const otherDemo = [...ready.keys()]
    .filter((id) => id !== slot.demoId)
    .sort(byLeastUsed(demoUsage))[0];
  const demoId = otherDemo ?? (slot.demoId && ready.has(slot.demoId) ? slot.demoId : undefined);
  if (!demoId) {
    await skipSlot(db, slot.id, "no_demo", now);
    return;
  }
  await renderSlot(
    db,
    setup,
    slot,
    {
      hookClipId: clip.id,
      personaId: persona.id,
      hookLineScriptId: line.id,
      demoId,
      stepPlanId: ready.get(demoId)!,
    },
    now,
  );
}

type Version = Partial<
  Pick<SlotRow, "hookClipId" | "personaId" | "hookLineScriptId" | "demoId" | "stepPlanId">
>;

/**
 * One render for a slot: a 1×1 steps set (decision 8: every post its own
 * render), in the SAME transaction as the slot's move to `rendering` — createSet's
 * own transaction nests as a savepoint, so a crash leaves both or neither. The
 * business is admin-owned, so no debit and no classifier call (sets.ts).
 * Placement is the clip's own safe area, as the wizard defaults. A createSet
 * refusal counts as a failed attempt.
 */
async function renderSlot(
  db: Db,
  setup: SetupRow,
  slot: SlotRow,
  version: Version,
  now: Date,
): Promise<void> {
  if (!(await isAdminOwned(db, setup.businessId))) {
    await skipSlot(db, slot.id, "not_admin_owned", now);
    return;
  }
  const next = { ...slot, ...version };
  try {
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ attempts: autopilotSlots.renderAttempts, status: autopilotSlots.status })
        .from(autopilotSlots)
        .where(eq(autopilotSlots.id, slot.id))
        .for("update");
      if (!locked || locked.attempts !== slot.renderAttempts || locked.status !== slot.status)
        return;
      const { renders } = await createSet(tx as Db, {
        businessId: setup.businessId,
        demoId: next.demoId!,
        grid: {
          hookClipIds: [next.hookClipId!],
          hookLineScriptIds: [next.hookLineScriptId!],
          mode: "silent",
          format: "steps",
          stepPlanId: next.stepPlanId!,
        },
      });
      await tx
        .update(autopilotSlots)
        .set({
          ...version,
          status: "rendering",
          videoRenderId: renders[0]!.id,
          renderAttempts: slot.renderAttempts + 1,
          updatedAt: now,
        })
        .where(eq(autopilotSlots.id, slot.id));
    });
  } catch (err) {
    logger.warn({ err, slotId: slot.id }, "autopilot: could not start a render");
    const [row] = await db
      .update(autopilotSlots)
      .set({ renderAttempts: sql`${autopilotSlots.renderAttempts} + 1`, updatedAt: now })
      .where(eq(autopilotSlots.id, slot.id))
      .returning({ attempts: autopilotSlots.renderAttempts });
    if (row && row.attempts >= AUTOPILOT_MAX_RENDER_ATTEMPTS) {
      await skipSlot(db, slot.id, "render_failed", now);
    }
  }
}

/**
 * One autopilot render on the heavy lane at a time, across every setup: a
 * customer's render never waits behind more than one (decision 11). The
 * earliest planned slot of an account that is on, not paused and connected.
 */
async function startNextRender(db: Db, setups: SetupRow[], now: Date): Promise<void> {
  const [busy] = await db
    .select({ id: autopilotSlots.id })
    .from(autopilotSlots)
    .where(eq(autopilotSlots.status, "rendering"))
    .limit(1);
  if (busy) return;
  for (const slot of await openSlots(db, setups, "planned")) {
    try {
      if (!(await accountReady(db, slot, now))) continue;
      await renderSlot(
        db,
        setups.find((s) => s.userId === slot.userId)!,
        slot,
        {},
        now,
      );
      return;
    } catch (err) {
      await recordFault(db, slot.id, err, now);
    }
  }
}

// ---------------------------------------------------------------------------
// Watching what went out
// ---------------------------------------------------------------------------

async function pauseEveryAccount(
  db: Db,
  userId: string,
  cause: AutopilotPauseCause,
  now: Date,
): Promise<void> {
  for (const account of await accountsOf(db, userId)) {
    if (account.enabled && !account.pausedCause)
      await pauseAutopilotAccount(db, account, cause, now);
  }
}

async function watchSetup(db: Db, setup: SetupRow, today: string, now: Date): Promise<void> {
  const yesterday = addDays(today, -1);
  for (const account of await accountsOf(db, setup.userId)) {
    // Paused or switched off: nothing of its goes out. The cancel ran when it
    // stopped; it runs again every tick, for a post whose cancel failed then.
    if (account.pausedCause || !account.enabled) {
      try {
        const reason = account.pausedCause ? "paused" : "off";
        await cancelOpenSlots(db, account.userId, account.igUserId, reason, now);
      } catch (err) {
        logger.warn({ err, igUserId: account.igUserId }, "autopilot: re-cancel failed");
      }
      continue;
    }
    try {
      // A connection that lapsed on a day it is posting.
      if (account.plannedDay === today) {
        const live = await liveInstagramRow(db, account.userId, account.igUserId);
        if (live?.status !== "connected") {
          await pauseAutopilotAccount(db, account, "connection", now);
          continue;
        }
      }
      const rows = await db
        .select({
          slotId: autopilotSlots.id,
          createdAt: autopilotSlots.createdAt,
          refused: autopilotSlots.refusedSounds,
          postStatus: scheduledPosts.status,
          failureKind: scheduledPosts.failureKind,
        })
        .from(autopilotSlots)
        .innerJoin(scheduledPosts, eq(scheduledPosts.id, autopilotSlots.scheduledPostId))
        .where(
          and(
            eq(autopilotSlots.userId, account.userId),
            eq(autopilotSlots.igUserId, account.igUserId),
            gte(autopilotSlots.day, yesterday),
          ),
        );
      for (const row of rows) {
        const refused = (row.refused as { audioId: string }[]) ?? [];
        if (row.postStatus === "posted" && refused.length > 0) {
          // An ambiguous refusal followed by a post with another sound: it was the sound.
          await markSoundsRefused(
            db,
            setup.userId,
            refused.map((r) => r.audioId),
            now,
          );
          await db
            .update(autopilotSlots)
            .set({ refusedSounds: [], updatedAt: now })
            .where(eq(autopilotSlots.id, row.slotId));
        }
      }
      const since = account.enabledAt;
      const failed = rows.filter(
        (r) => r.postStatus === "failed" && since !== null && r.createdAt > since,
      );
      if (failed.some((r) => r.failureKind === "platform_refused")) {
        await pauseAutopilotAccount(db, account, "file_refused", now);
        continue;
      }
      if (failed.some((r) => r.failureKind === "connection_expired")) {
        await pauseAutopilotAccount(db, account, "connection", now);
        continue;
      }
      for (const day of [yesterday, today]) {
        if (await nothingPosted(db, account, day)) {
          await pauseAutopilotAccount(db, account, "nothing_posted", now);
          break;
        }
      }
    } catch (err) {
      logger.warn({ err, igUserId: account.igUserId }, "autopilot: watch failed for an account");
    }
  }

  const [fresh] = await db
    .select()
    .from(autopilotSetups)
    .where(eq(autopilotSetups.userId, setup.userId));
  if (!fresh) return;
  const usable = usableSounds(fresh.sounds).length;
  const accounts = await accountsOf(db, setup.userId);
  const anyOn = accounts.some((a) => a.enabled && !a.pausedCause);
  if (usable === 0 && anyOn) await pauseEveryAccount(db, setup.userId, "no_sound", now);
  if (usable < AUTOPILOT_LOW_SOUNDS && anyOn) {
    if (!fresh.lowSoundsAt) {
      await db
        .update(autopilotSetups)
        .set({ lowSoundsAt: now, lowSoundsEmailedAt: null, updatedAt: now })
        .where(eq(autopilotSetups.userId, setup.userId));
    }
  } else if (usable >= AUTOPILOT_LOW_SOUNDS && fresh.lowSoundsAt) {
    await db
      .update(autopilotSetups)
      .set({ lowSoundsAt: null, lowSoundsEmailedAt: null, updatedAt: now })
      .where(eq(autopilotSetups.userId, setup.userId));
  }
}

/**
 * "A day with nothing posted" (decision 17), judged on the slots the account
 * made since it was last switched on: at least one, every one finished, none
 * cancelled (a pause or his own switch-off already covered that day), none
 * posted. A post he cancelled or that still waits is not a verdict.
 */
async function nothingPosted(db: Db, account: AccountRow, day: string): Promise<boolean> {
  if (!account.enabledAt) return false;
  const rows = await db
    .select({ status: autopilotSlots.status, postStatus: scheduledPosts.status })
    .from(autopilotSlots)
    .leftJoin(scheduledPosts, eq(scheduledPosts.id, autopilotSlots.scheduledPostId))
    .where(
      and(
        eq(autopilotSlots.userId, account.userId),
        eq(autopilotSlots.igUserId, account.igUserId),
        eq(autopilotSlots.day, day),
        gt(autopilotSlots.createdAt, account.enabledAt),
      ),
    );
  if (rows.length === 0) return false;
  return rows.every(
    (r) => r.status === "skipped" || (r.status === "scheduled" && r.postStatus === "failed"),
  );
}

async function markSoundsRefused(
  db: Db,
  userId: string,
  audioIds: string[],
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [setup] = await tx
      .select({ sounds: autopilotSetups.sounds })
      .from(autopilotSetups)
      .where(eq(autopilotSetups.userId, userId))
      .for("update");
    if (!setup) return;
    const sounds = (setup.sounds as AutopilotSound[]).map((s) =>
      audioIds.includes(s.audioId) && !s.refusedAt ? { ...s, refusedAt: now.toISOString() } : s,
    );
    await tx
      .update(autopilotSetups)
      .set({ sounds, updatedAt: now })
      .where(eq(autopilotSetups.userId, userId));
  });
}

/** The least-used usable sound on this slot's account that it has not been refused already. */
async function nextUsableSound(
  db: Db,
  setup: SetupRow,
  slot: SlotRow,
  exclude: string[],
): Promise<SoundSnapshot | null> {
  const [fresh] = await db
    .select({ sounds: autopilotSetups.sounds })
    .from(autopilotSetups)
    .where(eq(autopilotSetups.userId, setup.userId));
  const refused = ((slot.refusedSounds as { audioId: string }[]) ?? []).map((r) => r.audioId);
  const candidates = usableSounds(fresh?.sounds).filter(
    (s) => !refused.includes(s.audioId) && !exclude.includes(s.audioId),
  );
  if (candidates.length === 0) return null;
  const usage = await usageOn(db, slot.userId, slot.igUserId, "sound");
  const [pick] = candidates.map((s) => s.audioId).sort(byLeastUsed(usage));
  return stripRefused(candidates.find((s) => s.audioId === pick)!);
}

// ---------------------------------------------------------------------------
// The publish job's hook (social.ts) — a refused sound moves to the next one
// ---------------------------------------------------------------------------

/**
 * `publish_post` asks this whenever a post would go out without a sound or
 * Meta refused one. Not an autopilot post → `{ autopilot: false }`, and the job
 * does exactly what it does today. An autopilot post → the next usable sound
 * on its account (or null: none left), and the refused one recorded on the
 * slot — marked refused in the list at once when Meta's text names the audio,
 * else once another sound posts (the watch step).
 */
export async function autopilotNextSound(
  db: Db,
  post: { id: string; sound: unknown },
  refusal: { audioNamed: boolean } | null,
): Promise<NextSoundAnswer> {
  const [slot] = await db
    .select()
    .from(autopilotSlots)
    .where(eq(autopilotSlots.scheduledPostId, post.id))
    .limit(1);
  if (!slot) return { autopilot: false };
  const [setup] = await db
    .select()
    .from(autopilotSetups)
    .where(eq(autopilotSetups.userId, slot.userId));
  if (!setup) return { autopilot: true, sound: null };
  const current = post.sound as SoundSnapshot | null;
  let refused = (slot.refusedSounds as { audioId: string; named: boolean }[]) ?? [];
  if (refusal && current) {
    refused = [...refused, { audioId: current.audioId, named: refusal.audioNamed }];
    await db
      .update(autopilotSlots)
      .set({ refusedSounds: refused, updatedAt: new Date() })
      .where(eq(autopilotSlots.id, slot.id));
    if (refusal.audioNamed) await markSoundsRefused(db, slot.userId, [current.audioId], new Date());
  }
  const sound = await nextUsableSound(db, setup, { ...slot, refusedSounds: refused }, [
    ...(current ? [current.audioId] : []),
  ]);
  return { autopilot: true, sound };
}

// ---------------------------------------------------------------------------
// The calendar and the Sentry check-in
// ---------------------------------------------------------------------------

/** Skipped slots in a range, for the calendar (decision 17: a skipped slot shows there). */
export async function listSkippedAutopilotSlots(
  db: Db,
  opts: { userId: string; from: Date; to: Date },
) {
  return db
    .select({
      id: autopilotSlots.id,
      scheduledFor: autopilotSlots.scheduledFor,
      reason: autopilotSlots.skipReason,
      accountId: socialAccounts.id,
      username: socialAccounts.username,
      displayName: socialAccounts.displayName,
      pictureUrl: socialAccounts.pictureUrl,
    })
    .from(autopilotSlots)
    .innerJoin(socialAccounts, eq(socialAccounts.id, autopilotSlots.socialAccountId))
    .where(
      and(
        eq(autopilotSlots.userId, opts.userId),
        eq(autopilotSlots.status, "skipped"),
        gte(autopilotSlots.scheduledFor, opts.from),
        lt(autopilotSlots.scheduledFor, opts.to),
      ),
    )
    .orderBy(asc(autopilotSlots.scheduledFor));
}

/** "The night ran" rows the worker has not checked in to Sentry yet (apps/worker, decision 0037). */
export async function pendingAutopilotNights(
  db: Db,
  limit = 10,
): Promise<{ id: string; day: string }[]> {
  const rows = await db
    .select({ id: events.id, day: sql<string>`${events.payload}->>'day'` })
    .from(events)
    .where(and(eq(events.kind, AUTOPILOT_NIGHT), isNull(events.notifiedAt)))
    .orderBy(asc(events.createdAt))
    .limit(limit);
  return rows;
}
