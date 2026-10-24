import { and, asc, eq, isNotNull, isNull, lte } from "drizzle-orm";
import type { Db } from "../db";
import { autopilotAccounts, autopilotSetups, events, socialAccounts, users } from "../db/schema";
import { autopilotLowSoundsEmail, autopilotPauseEmail } from "../social-copy";
import { getAutopilotAccess, type AutopilotPauseCause } from "./autopilot";
import {
  AUTOPILOT_EMAIL,
  emailSweepGate,
  emailsSentToday,
  FAILURE_EMAIL_DAILY_CEILING,
  FAILURE_EMAIL_QUIET_MS,
  sendPostEmail,
  type FailureEmailSweepResult,
} from "./social-failure-email";

/**
 * The autopilot's emails (decision 17: only when it needs a decision from
 * him): one per pause — the accounts paused together folded into one — and one
 * per episode of a sound list running low. The third sweep on the failure
 * email's machinery (pipelines/social-failure-email.ts): the same gate, the
 * same Resend ladder, the same 20-a-UTC-day ceiling counted over all three
 * kinds; a held email goes out after 00:00 UTC. Autopilot posts never get the
 * per-post failure email; a stop reaches him here, once.
 *
 * Deduplicated on the rows themselves (`pause_emailed_at`,
 * `low_sounds_emailed_at`), written after the send; the Idempotency-Key
 * covers a crash between the two. The log is `events` of kind
 * `autopilot_email` — the ceiling's count, never an alert.
 */
export async function sweepAutopilotEmails(
  db: Db,
  opts: { workerId: string; now?: Date },
): Promise<FailureEmailSweepResult> {
  const now = opts.now ?? new Date();
  const result: FailureEmailSweepResult = { sent: 0, refused: 0, heldByCeiling: 0 };
  const gate = emailSweepGate(opts.workerId, now);
  if ("off" in gate) return { ...result, off: gate.off };
  const { provider } = gate;
  let remaining = FAILURE_EMAIL_DAILY_CEILING - (await emailsSentToday(db, now));
  const settled = new Date(now.getTime() - FAILURE_EMAIL_QUIET_MS);

  const paused = await db
    .select({
      userId: autopilotAccounts.userId,
      igUserId: autopilotAccounts.igUserId,
      cause: autopilotAccounts.pausedCause,
      pausedAt: autopilotAccounts.pausedAt,
      email: users.email,
    })
    .from(autopilotAccounts)
    .innerJoin(users, eq(users.id, autopilotAccounts.userId))
    .where(
      and(
        isNotNull(autopilotAccounts.pausedCause),
        isNull(autopilotAccounts.pauseEmailedAt),
        lte(autopilotAccounts.pausedAt, settled),
      ),
    )
    .orderBy(asc(autopilotAccounts.pausedAt));
  const byUser = new Map<string, typeof paused>();
  for (const row of paused) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);

  for (const [userId, rows] of byUser) {
    if (!(await getAutopilotAccess(db, userId))) continue;
    if (remaining <= 0) {
      result.heldByCeiling += 1;
      continue;
    }
    const names = await accountNames(db, userId);
    const message = autopilotPauseEmail({
      accounts: rows.map((r) => ({
        accountName: names.get(r.igUserId) ?? "",
        cause: r.cause as AutopilotPauseCause,
      })),
    });
    const outcome = await sendPostEmail({
      provider,
      now,
      to: rows[0]!.email,
      message,
      idempotencyKey: `autopilot-pause/${userId}/${rows[0]!.pausedAt!.getTime()}`,
      label: "autopilot email",
      log: (logged) =>
        logEmail(db, now, userId, {
          type: "pause",
          accounts: rows.map((r) => ({ igUserId: r.igUserId, cause: r.cause })),
          ...logged,
        }),
    });
    if (outcome === "stop") return result;
    for (const row of rows) {
      await db
        .update(autopilotAccounts)
        .set({ pauseEmailedAt: now })
        .where(
          and(
            eq(autopilotAccounts.userId, userId),
            eq(autopilotAccounts.igUserId, row.igUserId),
            eq(autopilotAccounts.pausedAt, row.pausedAt!),
          ),
        );
    }
    if (outcome === "sent") {
      result.sent += 1;
      remaining -= 1;
    } else result.refused += 1;
  }

  const low = await db
    .select({
      userId: autopilotSetups.userId,
      lowSoundsAt: autopilotSetups.lowSoundsAt,
      sounds: autopilotSetups.sounds,
      email: users.email,
    })
    .from(autopilotSetups)
    .innerJoin(users, eq(users.id, autopilotSetups.userId))
    .where(
      and(
        isNotNull(autopilotSetups.lowSoundsAt),
        isNull(autopilotSetups.lowSoundsEmailedAt),
        lte(autopilotSetups.lowSoundsAt, settled),
      ),
    );
  for (const row of low) {
    if (!(await getAutopilotAccess(db, row.userId))) continue;
    if (remaining <= 0) {
      result.heldByCeiling += 1;
      continue;
    }
    const usable = (row.sounds as { refusedAt?: string }[]).filter((s) => !s.refusedAt).length;
    const outcome = await sendPostEmail({
      provider,
      now,
      to: row.email,
      message: autopilotLowSoundsEmail({ usable }),
      idempotencyKey: `autopilot-sounds/${row.userId}/${row.lowSoundsAt!.getTime()}`,
      label: "autopilot email",
      log: (logged) => logEmail(db, now, row.userId, { type: "low_sounds", usable, ...logged }),
    });
    if (outcome === "stop") return result;
    await db
      .update(autopilotSetups)
      .set({ lowSoundsEmailedAt: now })
      .where(
        and(
          eq(autopilotSetups.userId, row.userId),
          eq(autopilotSetups.lowSoundsAt, row.lowSoundsAt!),
        ),
      );
    if (outcome === "sent") {
      result.sent += 1;
      remaining -= 1;
    } else result.refused += 1;
  }
  return result;
}

async function accountNames(db: Db, userId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({
      externalId: socialAccounts.externalId,
      username: socialAccounts.username,
      displayName: socialAccounts.displayName,
    })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.userId, userId), eq(socialAccounts.platform, "instagram")));
  return new Map(
    rows.map((r) => [r.externalId, r.username ? `@${r.username}` : (r.displayName ?? "")]),
  );
}

async function logEmail(
  db: Db,
  now: Date,
  userId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(events).values({
    kind: AUTOPILOT_EMAIL,
    actorUserId: userId,
    payload,
    createdAt: now,
  });
}
