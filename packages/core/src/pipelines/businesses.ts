import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db";
import { businesses, users } from "../db/schema";

/** Enough for every moment of a 3-minute demo to get an answer; past that the
 *  prompts bloat and something else is wrong. */
export const MAX_DEMO_NOTES = 20;

/** The "caption once" asset — every piece of generated copy derives from this. */
export const questionnaireSchema = z.object({
  category: z.enum(["app_or_digital", "physical_product", "local_service", "other"]),
  product_name: z.string().min(1),
  what_it_does: z.string().min(1),
  // Optional: the Hebrew noun a customer would use for the thing — אתר,
  // אפליקציה, קרם, קורס, קליניקה. `category` is four coarse buckets, so without
  // this the b_script model has no word for the product before the reveal and
  // reaches for משהו / הדבר הזה. Absent is fine — the prompt derives a noun.
  product_kind: z.string().optional(),
  advantages: z.array(z.string().min(1)).min(1).max(8),
  target_audience: z.string().min(1),
  // Ad style key only — Hebrew labels live in the UI layer.
  tone: z.enum(["friendly", "direct", "professional"]),
  link: z.string().optional(),
  // Optional: what makes people say "wow" about the product. Step-plan quality
  // is bounded by how well the model knows what matters in the footage.
  wow: z.string().optional(),
  // The customer's answers to the plan pass's unexplainedMoments, appended by
  // addDemoNote. Part of the questionnaire on purpose: both passes read the
  // questionnaire, and findOffScreenWords already treats any questionnaire
  // string as label vocabulary — an explained moment becomes usable copy that
  // is never marked as off-screen.
  demo_notes: z.array(z.string().min(1)).max(MAX_DEMO_NOTES).optional(),
});

export type Questionnaire = z.infer<typeof questionnaireSchema>;

/**
 * Addresses are stored and compared lowercased.
 *
 * `users_email_unique` is a plain btree, so Postgres treats `Founder@X.com` and
 * `founder@x.com` as two different addresses and will happily hold both. That
 * is the silent half of the auth collision: two rows for one person, the
 * business owned by whichever uuid got there first, and RLS
 * (`owner_user_id = auth.uid()`) then hides it — the customer signs in and sees
 * an empty onboarding wizard forever, with no error anywhere.
 *
 * The durable fix is a `lower(email)` unique index, which is a migration. Until
 * one is wanted, every write here normalises and every read compares
 * case-insensitively — so a row written in any casing by any other writer (the
 * `handle_new_user` trigger mirrors `auth.users.email` verbatim and is not ours
 * to change) is still found rather than duplicated.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The two drivers wrap raw results differently (see jobs/queue.ts). */
function firstRow(result: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(result)) return result[0] as Record<string, unknown> | undefined;
  return (result as { rows?: Record<string, unknown>[] }).rows?.[0];
}

/**
 * True when this database has Supabase Auth at all. PGlite and plain Postgres
 * do not: `0002_supabase_rls.sql` is excluded from the portable migration list
 * precisely because it references the `auth` schema. Where there is no
 * `auth.users` there is no signup that could ever collide, so the guard below
 * has nothing to protect and must not fire — otherwise every test that calls
 * `createBusiness` would fail for a hazard that cannot exist there.
 */
async function hasSupabaseAuth(db: Db): Promise<boolean> {
  const row = firstRow(
    await db.execute(sql`select to_regclass('auth.users') is not null as present`),
  );
  return Boolean(row?.present);
}

async function authAccountExists(db: Db, normalizedEmail: string): Promise<boolean> {
  const row = firstRow(
    await db.execute(
      sql`select 1 as hit from auth.users where lower(email) = ${normalizedEmail} limit 1`,
    ),
  );
  return row !== undefined;
}

function orphanUserMessage(email: string): string {
  return [
    `refusing to create a users row for "${email}": no Supabase Auth account exists for that address.`,
    ``,
    `Creating one now would permanently block that address from ever signing up.`,
    `The handle_new_user trigger inserts (auth uid, email) on signup and would hit`,
    `users_email_unique against this row, so the signup rolls back with the generic`,
    `"Database error saving new user" and nothing is written.`,
    ``,
    `What to do instead:`,
    `  - owner will sign in   -> have them sign up in the app first, then re-run`,
    `                            this command with the same address`,
    `  - owner never signs in -> re-run with --no-signin`,
    `                            (samples, DFY, cold outreach: no auth account is`,
    `                             ever created for this address)`,
  ].join("\n");
}

export type EnsureUserOpts = {
  /**
   * Allow creating a `public.users` row for an address with no Supabase Auth
   * account. Only for owners who will never sign in — `aiugc business create
   * --no-signin`. The web path never needs it: it always runs for the address
   * that just authenticated.
   */
  allowWithoutAuthAccount?: boolean;
};

export async function ensureUser(
  db: Db,
  email: string,
  role: "customer" | "admin" = "customer",
  opts: EnsureUserOpts = {},
): Promise<typeof users.$inferSelect> {
  const normalized = normalizeEmail(email);
  const existing = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalized}`)
    .limit(1);
  if (existing[0]) return existing[0];

  // Only reached when we are about to invent an identity. The web path anchors
  // on users.id = auth.uid() before it ever gets here, so in practice this
  // guards the CLI.
  if (!opts.allowWithoutAuthAccount && (await hasSupabaseAuth(db))) {
    if (!(await authAccountExists(db, normalized))) throw new Error(orphanUserMessage(normalized));
  }

  const inserted = await db.insert(users).values({ email: normalized, role }).returning();
  return inserted[0]!;
}

export async function createBusiness(
  db: Db,
  opts: {
    ownerEmail: string;
    name: string;
    ownerRole?: "customer" | "admin";
    allowWithoutAuthAccount?: boolean;
  },
): Promise<typeof businesses.$inferSelect> {
  const owner = await ensureUser(db, opts.ownerEmail, opts.ownerRole ?? "customer", {
    allowWithoutAuthAccount: opts.allowWithoutAuthAccount,
  });
  const inserted = await db
    .insert(businesses)
    .values({ ownerUserId: owner.id, name: opts.name })
    .returning();
  return inserted[0]!;
}

export async function setQuestionnaire(
  db: Db,
  businessId: string,
  data: unknown,
): Promise<Questionnaire> {
  const questionnaire = questionnaireSchema.parse(data);
  // Questionnaire edits come from forms that never carry demo_notes — a
  // resubmit must not silently discard the customer's answered moments.
  // Sending demo_notes explicitly (even []) still replaces them.
  if (!questionnaire.demo_notes) {
    const existing = await db
      .select({ questionnaire: businesses.questionnaire })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    const prior = existing[0]?.questionnaire as { demo_notes?: string[] } | null;
    if (prior?.demo_notes?.length) questionnaire.demo_notes = prior.demo_notes;
  }
  await db
    .update(businesses)
    .set({ questionnaire, questionnaireUpdatedAt: new Date() })
    .where(eq(businesses.id, businessId));
  return questionnaire;
}

/**
 * Append one answered unexplained-moment to questionnaire.demo_notes (the
 * Phase 7 note endpoint's write path). Requires an existing questionnaire —
 * a note explains footage, and footage analysis already requires one.
 *
 * The append is a single jsonb UPDATE with the cap in the WHERE: two quick
 * answers must not clobber each other (a read-modify-write here loses the
 * first note last-write-wins), and touching only the demo_notes key means a
 * racing questionnaire edit is never reverted wholesale.
 */
export async function addDemoNote(db: Db, businessId: string, text: string): Promise<string[]> {
  const note = text.trim();
  if (!note) throw new Error("demo note is empty");
  await requireQuestionnaire(db, businessId); // 404/no-questionnaire error path

  const notesExpr = sql`coalesce(${businesses.questionnaire}->'demo_notes', '[]'::jsonb)`;
  const updated = await db
    .update(businesses)
    .set({
      questionnaire: sql`jsonb_set(${businesses.questionnaire}, '{demo_notes}', ${notesExpr} || ${JSON.stringify([note])}::jsonb)`,
      questionnaireUpdatedAt: new Date(),
    })
    .where(
      and(eq(businesses.id, businessId), sql`jsonb_array_length(${notesExpr}) < ${MAX_DEMO_NOTES}`),
    )
    .returning({ questionnaire: businesses.questionnaire });
  if (!updated[0]) {
    // The questionnaire existed a moment ago — the only WHERE miss is the cap.
    throw new Error(`demo notes limit reached (${MAX_DEMO_NOTES})`);
  }
  return (updated[0].questionnaire as { demo_notes?: string[] }).demo_notes ?? [];
}

export async function getBusiness(db: Db, businessId: string) {
  const rows = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!rows[0]) throw new Error(`business ${businessId} not found`);
  return rows[0];
}

export async function requireQuestionnaire(db: Db, businessId: string): Promise<Questionnaire> {
  const business = await getBusiness(db, businessId);
  if (!business.questionnaire) {
    throw new Error(`business ${businessId} has no questionnaire yet — fill it first`);
  }
  return questionnaireSchema.parse(business.questionnaire);
}

/** The founder's own businesses (owner role=admin) bypass credits and watermarks. */
export async function isAdminOwned(db: Db, businessId: string): Promise<boolean> {
  const business = await getBusiness(db, businessId);
  const owner = await db.select().from(users).where(eq(users.id, business.ownerUserId)).limit(1);
  return owner[0]?.role === "admin";
}
