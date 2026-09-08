import { z } from "zod";

/**
 * The in-app "צור קשר" HTTP contract, and the numbers the form renders. Pure —
 * zod is the only import, so the client form can read the cap straight from
 * here rather than being handed it as a prop.
 *
 * FEEDBACK_MAX_CHARS is deliberately a second copy of core's constant instead
 * of an import: core's main entry is server-only and this file is bundled into
 * a client component. feedback.test.ts asserts the two never drift.
 */

/** Matches core's FEEDBACK_MAX_CHARS — the textarea's maxLength and the zod bound. */
export const FEEDBACK_MAX_CHARS = 2000;

/**
 * Soft cap — a count-then-insert, so two simultaneous submits can both land.
 * It exists to stop a stuck submit button (or a bored user) filling the table,
 * not to ration support. 20 is far above any honest day's use.
 */
export const FEEDBACK_DAILY_CAP = 20;
export const FEEDBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

// "בעוד יממה", not "מחר": the window is a rolling 24h from the 20th message,
// so a burst at 23:00 does not clear at midnight.
export const FEEDBACK_CAP_ERROR = "שלחתם היום הרבה הודעות. נחזור אליכם, ואפשר לכתוב שוב בעוד יממה.";

/**
 * `page` is context for the founder, not a route to trust — it is stored and
 * rendered as text and never navigated to, so a length bound is the whole
 * validation it needs.
 */
export const feedbackRequestSchema = z.object({
  message: z.string().trim().min(1).max(FEEDBACK_MAX_CHARS),
  businessId: z.string().uuid().optional(),
  page: z.string().max(200).optional(),
});
