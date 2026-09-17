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

/* ---------- the PUBLIC /contact form ---------- */

/** Matches core's CONTACT_NAME_MAX_CHARS / CONTACT_EMAIL_MAX_CHARS — contact.test.ts is the drift guard. */
export const CONTACT_NAME_MAX_CHARS = 80;
export const CONTACT_EMAIL_MAX_CHARS = 254;

/**
 * Lower than the in-app cap and keyed on the address, not a user: /contact is
 * reachable by anyone, so 5 a day from one address is already far more than an
 * honest visitor sends, and the ceiling has to sit where an abuser feels it.
 */
export const CONTACT_DAILY_CAP_PER_IP = 5;
export const CONTACT_WINDOW_MS = 24 * 60 * 60 * 1000;

export const CONTACT_CAP_ERROR =
  "כבר קיבלנו מכם כמה פניות היום. נחזור אליכם, ואפשר לכתוב שוב בעוד יממה.";

/**
 * The honeypot field's name. It is rendered as a real input, hidden from
 * people and from screen readers and taken out of the tab order; a browser
 * leaves it empty and a form-filling bot does not. A request that carries
 * anything in it is answered 200 with no row written — a bot told it failed
 * learns to stop falling for it.
 *
 * Named after something a bot wants to fill. `website` rather than `honeypot`,
 * for the same reason the trap is not labelled.
 */
export const CONTACT_HONEYPOT_FIELD = "website";

export const contactRequestSchema = z.object({
  name: z.string().trim().min(1).max(CONTACT_NAME_MAX_CHARS),
  // `.email()` and a length bound, nothing more: an address is a thing to
  // reply to by hand, not a thing this service sends to, so the only failures
  // worth catching are the ones a person can see and fix in the form.
  email: z.string().trim().min(1).max(CONTACT_EMAIL_MAX_CHARS).email(),
  message: z.string().trim().min(1).max(FEEDBACK_MAX_CHARS),
  /** The honeypot. Optional and unbounded in meaning — only emptiness matters. */
  [CONTACT_HONEYPOT_FIELD]: z.string().max(200).optional(),
});
