import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import {
  autopilotAccounts,
  autopilotSetups,
  businesses,
  demos,
  personas,
  socialAccounts,
} from "../db/schema";
import {
  activeClips,
  AUTOPILOT_EARLIEST_TIME,
  AUTOPILOT_LATEST_TIME,
  AUTOPILOT_MAX_PER_DAY,
  cancelOpenSlots,
  demoReadiness,
  usableSounds,
  type AutopilotPauseCause,
  type AutopilotSound,
  type DemoReadiness,
} from "./autopilot";
import type { SoundSnapshot } from "./social";

/**
 * The autopilot's one-time setup (decision 6): one card per connected
 * Instagram account — on/off, its characters, videos a day, the demos it
 * rotates, its posting times — and one saved sound list. The web's
 * `/autopilot` page reads `getAutopilotSetup` and writes `saveAutopilotSetup`;
 * both sit behind `getAutopilotAccess` in the route.
 *
 * The save never writes what the night owns: a pause, `enabled_at`,
 * `planned_day`, or a sound's `refusedAt` (sounds merge by audio id). A page
 * loaded before a pause can therefore never lift it; only `resumeAutopilotAccount`
 * does, naming the pause it lifts.
 */

export type AutopilotSetupErrorCode =
  | "not_found"
  | "business_not_owned"
  | "account_not_owned"
  | "bad_time"
  | "too_many"
  | "count_over_times"
  | "count_over_clips"
  | "character_on_two_accounts"
  | "character_unusable"
  | "demo_not_owned"
  | "nothing_to_post"
  | "character_no_clips"
  | "no_usable_sound"
  | "stale_pause";

export class AutopilotSetupError extends Error {
  constructor(
    readonly code: AutopilotSetupErrorCode,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export interface AutopilotAccountInput {
  igUserId: string;
  enabled: boolean;
  aPerDay: number;
  postTimes: string[];
  personaIds: string[];
  demoIds: string[];
}

export interface AutopilotSetupInput {
  businessId: string;
  sounds: SoundSnapshot[];
  accounts: AutopilotAccountInput[];
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" on a 5-minute step between 08:00 and 23:55 — the night has five hours of slack. */
export function validPostTime(time: string): boolean {
  const m = TIME.exec(time);
  if (!m) return false;
  if (Number(m[2]) % 5 !== 0) return false;
  return time >= AUTOPILOT_EARLIEST_TIME && time <= AUTOPILOT_LATEST_TIME;
}

export interface AutopilotSetupView {
  businessId: string | null;
  businesses: { id: string; name: string }[];
  sounds: AutopilotSound[];
  /** The live Instagram account to search sounds through (a good User token), if any. */
  soundAccountId: string | null;
  accounts: {
    igUserId: string;
    accountId: string;
    username: string | null;
    displayName: string | null;
    pictureUrl: string | null;
    connected: boolean;
    enabled: boolean;
    aPerDay: number;
    postTimes: string[];
    personaIds: string[];
    demoIds: string[];
    pausedCause: AutopilotPauseCause | null;
    pausedAt: string | null;
  }[];
  characters: { id: string; name: string; activeClips: number }[];
  /** Named first, unnamed below, each group newest first (his ask, 2026-10-24). */
  demos: { id: string; name: string | null; createdAt: string; readiness: DemoReadiness }[];
}

export async function getAutopilotSetup(
  db: Db,
  userId: string,
  opts: { businessId?: string } = {},
): Promise<AutopilotSetupView> {
  const [setup] = await db.select().from(autopilotSetups).where(eq(autopilotSetups.userId, userId));
  const owned = await db
    .select({ id: businesses.id, name: businesses.name })
    .from(businesses)
    .where(eq(businesses.ownerUserId, userId))
    .orderBy(businesses.createdAt);
  const businessId =
    (opts.businessId && owned.some((b) => b.id === opts.businessId) ? opts.businessId : null) ??
    setup?.businessId ??
    owned[0]?.id ??
    null;

  const live = await db
    .select()
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.userId, userId),
        eq(socialAccounts.platform, "instagram"),
        inArray(socialAccounts.status, ["connected", "expired"]),
      ),
    )
    .orderBy(socialAccounts.connectedAt);
  const saved = await db
    .select()
    .from(autopilotAccounts)
    .where(eq(autopilotAccounts.userId, userId));

  const characterRows = await db
    .select({ id: personas.id, name: personas.name, gender: personas.gender })
    .from(personas)
    .where(eq(personas.active, true))
    .orderBy(personas.createdAt);
  const withGender = characterRows.filter((p) => p.gender === "female" || p.gender === "male");
  const clips = await activeClips(
    db,
    withGender.map((p) => p.id),
  );

  const demoRows = businessId
    ? await db
        .select({
          id: demos.id,
          name: demos.name,
          status: demos.status,
          normalizedPath: demos.normalizedPath,
          createdAt: demos.createdAt,
        })
        .from(demos)
        .where(eq(demos.businessId, businessId))
        .orderBy(desc(demos.createdAt))
    : [];
  const demoViews = [];
  for (const demo of [...demoRows.filter((d) => d.name), ...demoRows.filter((d) => !d.name)]) {
    demoViews.push({
      id: demo.id,
      name: demo.name,
      createdAt: demo.createdAt.toISOString(),
      readiness: await demoReadiness(db, demo),
    });
  }

  const now = Date.now();
  const soundAccount = live.find(
    (a) =>
      a.status === "connected" &&
      a.userTokenEnc !== null &&
      (a.userTokenExpiresAt === null || a.userTokenExpiresAt.getTime() > now),
  );

  const shown = new Set(withGender.map((p) => p.id));
  return {
    businessId,
    businesses: owned,
    sounds: (setup?.sounds as AutopilotSound[] | undefined) ?? [],
    soundAccountId: soundAccount?.id ?? null,
    accounts: live.map((a) => {
      const s = saved.find((row) => row.igUserId === a.externalId);
      return {
        igUserId: a.externalId,
        accountId: a.id,
        username: a.username,
        displayName: a.displayName,
        pictureUrl: a.pictureUrl,
        connected: a.status === "connected",
        enabled: s?.enabled ?? false,
        aPerDay: s?.aPerDay ?? 0,
        postTimes: (s?.postTimes as string[] | undefined) ?? [],
        // A character since retired or left without a gender is not offered back.
        personaIds: ((s?.personaIds as string[] | undefined) ?? []).filter((id) => shown.has(id)),
        // Nothing is preselected (his ask, 2026-10-24): an account's demos are his picks only.
        demoIds: (s?.demoIds as string[] | undefined) ?? [],
        pausedCause: (s?.pausedCause as AutopilotPauseCause | null | undefined) ?? null,
        pausedAt: s?.pausedAt?.toISOString() ?? null,
      };
    }),
    characters: withGender.map((p) => ({
      id: p.id,
      name: p.name,
      activeClips: clips.filter((c) => c.personaId === p.id).length,
    })),
    demos: demoViews,
  };
}

/**
 * Save the whole setup. Refuses (each one a test): a business or an account
 * not the caller's; a time off the 5-minute grid or outside 08:00–23:55, or
 * repeated; a count above the account's times or its characters' active clips
 * (decision 9, answered with the maximum); a character on two accounts (7:
 * the pages never mix); switching an account on with nothing to post or no
 * usable sound saved.
 */
export async function saveAutopilotSetup(
  db: Db,
  userId: string,
  input: AutopilotSetupInput,
  now: Date = new Date(),
): Promise<void> {
  const [business] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.id, input.businessId), eq(businesses.ownerUserId, userId)));
  if (!business) throw new AutopilotSetupError("business_not_owned");

  const live = await db
    .select({ externalId: socialAccounts.externalId })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.userId, userId),
        eq(socialAccounts.platform, "instagram"),
        inArray(socialAccounts.status, ["connected", "expired"]),
      ),
    );
  const liveIds = new Set(live.map((a) => a.externalId));

  const [existing] = await db
    .select()
    .from(autopilotSetups)
    .where(eq(autopilotSetups.userId, userId));
  const sounds = mergeSounds(input.sounds, existing?.sounds);

  const usedPersona = new Map<string, string>();
  const allPersonaIds = [...new Set(input.accounts.flatMap((a) => a.personaIds))];
  const usable = allPersonaIds.length
    ? await db
        .select({ id: personas.id, gender: personas.gender })
        .from(personas)
        .where(and(inArray(personas.id, allPersonaIds), eq(personas.active, true)))
    : [];
  const usableIds = new Set(
    usable.filter((p) => p.gender === "female" || p.gender === "male").map((p) => p.id),
  );
  const ownDemos = new Set(
    (
      await db.select({ id: demos.id }).from(demos).where(eq(demos.businessId, input.businessId))
    ).map((d) => d.id),
  );

  for (const account of input.accounts) {
    if (!liveIds.has(account.igUserId)) throw new AutopilotSetupError("account_not_owned");
    const times = [...new Set(account.postTimes)];
    if (times.length !== account.postTimes.length || !times.every(validPostTime)) {
      throw new AutopilotSetupError("bad_time", { igUserId: account.igUserId });
    }
    if (times.length > AUTOPILOT_MAX_PER_DAY || account.aPerDay > AUTOPILOT_MAX_PER_DAY) {
      throw new AutopilotSetupError("too_many", { igUserId: account.igUserId });
    }
    for (const personaId of account.personaIds) {
      if (!usableIds.has(personaId)) {
        throw new AutopilotSetupError("character_unusable", {
          igUserId: account.igUserId,
          personaId,
        });
      }
      const other = usedPersona.get(personaId);
      if (other && other !== account.igUserId) {
        throw new AutopilotSetupError("character_on_two_accounts", { personaId });
      }
      usedPersona.set(personaId, account.igUserId);
    }
    if (account.demoIds.some((id) => !ownDemos.has(id))) {
      throw new AutopilotSetupError("demo_not_owned", { igUserId: account.igUserId });
    }
    if (account.aPerDay > times.length) {
      throw new AutopilotSetupError("count_over_times", {
        igUserId: account.igUserId,
        max: times.length,
      });
    }
    const clips = await activeClips(db, account.personaIds);
    if (account.aPerDay > clips.length) {
      throw new AutopilotSetupError("count_over_clips", {
        igUserId: account.igUserId,
        max: clips.length,
      });
    }
    if (account.enabled) {
      if (account.aPerDay < 1 || account.personaIds.length === 0 || account.demoIds.length === 0) {
        throw new AutopilotSetupError("nothing_to_post", { igUserId: account.igUserId });
      }
      const bare = account.personaIds.find((id) => !clips.some((c) => c.personaId === id));
      if (bare) {
        throw new AutopilotSetupError("character_no_clips", {
          igUserId: account.igUserId,
          personaId: bare,
        });
      }
      if (usableSounds(sounds).length === 0) {
        throw new AutopilotSetupError("no_usable_sound", { igUserId: account.igUserId });
      }
    }
  }

  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ sounds: autopilotSetups.sounds })
      .from(autopilotSetups)
      .where(eq(autopilotSetups.userId, userId))
      .for("update");
    const merged = mergeSounds(input.sounds, locked?.sounds);
    if (input.accounts.some((a) => a.enabled) && usableSounds(merged).length === 0) {
      throw new AutopilotSetupError("no_usable_sound");
    }
    await tx
      .insert(autopilotSetups)
      .values({
        userId,
        businessId: input.businessId,
        sounds: merged,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: autopilotSetups.userId,
        set: { businessId: input.businessId, sounds: merged, updatedAt: now },
      });
    const onPage = new Set(input.accounts.map((a) => a.igUserId));
    const taken = new Set(input.accounts.flatMap((a) => a.personaIds));
    const others = await tx
      .select()
      .from(autopilotAccounts)
      .where(eq(autopilotAccounts.userId, userId))
      .for("update");
    for (const other of others) {
      if (onPage.has(other.igUserId)) continue;
      const kept = idsOf(other.personaIds).filter((id) => !taken.has(id));
      if (kept.length !== idsOf(other.personaIds).length) {
        await tx
          .update(autopilotAccounts)
          .set({ personaIds: kept, updatedAt: now })
          .where(eq(autopilotAccounts.id, other.id));
      }
    }
    for (const account of input.accounts) {
      const [before] = await tx
        .select()
        .from(autopilotAccounts)
        .where(
          and(
            eq(autopilotAccounts.userId, userId),
            eq(autopilotAccounts.igUserId, account.igUserId),
          ),
        )
        .for("update");
      const switchedOn = account.enabled && !before?.enabled;
      const switchedOff = !account.enabled && before?.enabled === true;
      const values = {
        enabled: account.enabled,
        aPerDay: account.aPerDay,
        postTimes: [...account.postTimes].sort(),
        personaIds: account.personaIds,
        demoIds: account.demoIds,
        updatedAt: now,
        // Switched on now: it starts with the next 03:00, never today.
        ...(switchedOn ? { enabledAt: now } : {}),
        // Switched off by hand: a pause no longer matters, and the next switch-on starts clean.
        ...(switchedOff ? { pausedCause: null, pausedAt: null, pauseEmailedAt: null } : {}),
      };
      if (before) {
        await tx.update(autopilotAccounts).set(values).where(eq(autopilotAccounts.id, before.id));
      } else {
        await tx
          .insert(autopilotAccounts)
          .values({ userId, igUserId: account.igUserId, ...values, createdAt: now });
      }
    }
  });

  // Switched off by hand: nothing more of the account's goes out, and no email.
  const after = await db
    .select()
    .from(autopilotAccounts)
    .where(eq(autopilotAccounts.userId, userId));
  for (const account of input.accounts) {
    const row = after.find((a) => a.igUserId === account.igUserId);
    if (row && !row.enabled) await cancelOpenSlots(db, userId, account.igUserId, "off", now);
  }
}

/** The page's sounds, deduplicated by audio id, each keeping the server's refusedAt. */
function mergeSounds(input: SoundSnapshot[], stored: unknown): AutopilotSound[] {
  const prior = Array.isArray(stored) ? (stored as AutopilotSound[]) : [];
  const seen = new Set<string>();
  const out: AutopilotSound[] = [];
  for (const sound of input) {
    if (seen.has(sound.audioId)) continue;
    seen.add(sound.audioId);
    const kept = prior.find((s) => s.audioId === sound.audioId);
    out.push(kept?.refusedAt ? { ...sound, refusedAt: kept.refusedAt } : { ...sound });
  }
  return out;
}

function idsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Lift a pause by hand (PLANNING DEFAULT, 0127: every cause resumes this way).
 * Names the pause it lifts, so a page loaded before a newer pause is a 409.
 * It starts with the next night.
 */
export async function resumeAutopilotAccount(
  db: Db,
  userId: string,
  igUserId: string,
  pausedAt: string,
  now: Date = new Date(),
): Promise<void> {
  const [row] = await db
    .select()
    .from(autopilotAccounts)
    .where(and(eq(autopilotAccounts.userId, userId), eq(autopilotAccounts.igUserId, igUserId)));
  if (!row) throw new AutopilotSetupError("not_found");
  if (!row.pausedAt || row.pausedAt.toISOString() !== pausedAt) {
    throw new AutopilotSetupError("stale_pause");
  }
  await db
    .update(autopilotAccounts)
    .set({
      pausedCause: null,
      pausedAt: null,
      pauseEmailedAt: null,
      enabled: true,
      enabledAt: now,
      updatedAt: now,
    })
    .where(eq(autopilotAccounts.id, row.id));
}
