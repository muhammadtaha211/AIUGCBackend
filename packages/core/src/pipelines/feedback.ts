import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "../db";
import { businesses, feedback, users } from "../db/schema";

/**
 * In-app "צור קשר": a signed-in customer writes one message at /home/feedback,
 * the founder reads it at /feedback in the admin console. That tab is the whole
 * delivery mechanism — no email, no Slack, no notification, and no handled/
 * resolved state to keep in sync.
 */

/** Matches the textarea's maxLength and the route's zod bound. */
export const FEEDBACK_MAX_CHARS = 2000;

export async function submitFeedback(
  db: Db,
  opts: { userId: string; businessId?: string | null; message: string; page?: string | null },
): Promise<{ id: string; createdAt: Date }> {
  // Trim here rather than at the boundary: whitespace-only is the failure the
  // customer can actually produce, and it must fail the same way from any
  // caller, not only the one route that also runs zod.
  const message = opts.message.trim();
  if (message.length === 0) throw new Error("feedback message is empty");
  if (message.length > FEEDBACK_MAX_CHARS) {
    throw new Error(`feedback message is longer than ${FEEDBACK_MAX_CHARS} characters`);
  }

  const inserted = await db
    .insert(feedback)
    .values({
      userId: opts.userId,
      businessId: opts.businessId ?? null,
      message,
      page: opts.page?.trim() || null,
    })
    .returning({ id: feedback.id, createdAt: feedback.createdAt });
  return inserted[0]!;
}

export type FeedbackEntry = {
  id: string;
  /** Both null on an anonymous /contact row (0047). */
  userId: string | null;
  userEmail: string | null;
  businessId: string | null;
  businessName: string | null;
  message: string;
  page: string | null;
  createdAt: Date;
};

/**
 * Newest first. `before` is a created_at cursor — the admin page's "load more"
 * passes the last row's timestamp back. Strictly less-than, so the boundary row
 * is never repeated.
 *
 * The precision this loses, stated rather than hidden: Postgres stores
 * microseconds and a JS Date holds milliseconds, so a cursor round-tripped
 * through the "load more" URL is truncated down. A row written in the SAME
 * MILLISECOND as the page boundary but slightly earlier falls on neither page.
 * Two people writing feedback inside one millisecond, with the 100-row boundary
 * landing between them, is not a case worth a composite (created_at, id) cursor
 * for a founder-read inbox — but it is the cost, and it is a skip, not a
 * duplicate.
 */
export async function listFeedback(
  db: Db,
  opts: { limit: number; before?: Date },
): Promise<FeedbackEntry[]> {
  const rows = await db
    .select({
      id: feedback.id,
      userId: feedback.userId,
      userEmail: users.email,
      businessId: feedback.businessId,
      businessName: businesses.name,
      message: feedback.message,
      page: feedback.page,
      createdAt: feedback.createdAt,
    })
    .from(feedback)
    // LEFT since 0047: user_id is nullable too now, and an inner join would
    // silently drop every anonymous /contact row from the inbox.
    .leftJoin(users, eq(users.id, feedback.userId))
    // LEFT: business_id is nullable, and an inner join would silently drop
    // every message written before the user had a business.
    .leftJoin(businesses, eq(businesses.id, feedback.businessId))
    .where(opts.before ? lt(feedback.createdAt, opts.before) : undefined)
    .orderBy(desc(feedback.createdAt))
    .limit(opts.limit);
  return rows;
}

/**
 * How many messages this user has sent since `since` — the input to the web
 * route's soft daily cap. Soft on purpose: it is a count-then-insert, so two
 * simultaneous submissions can both pass. The cap exists to stop a stuck
 * submit button filling the table, not to enforce a quota.
 */
export async function countFeedbackSince(db: Db, userId: string, since: Date): Promise<number> {
  const rows = await db
    .select({ count: sql<string>`count(*)` })
    .from(feedback)
    .where(and(eq(feedback.userId, userId), gte(feedback.createdAt, since)));
  return Number(rows[0]?.count ?? 0);
}
