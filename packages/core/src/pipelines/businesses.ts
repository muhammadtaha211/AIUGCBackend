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
  // questionnaire, and findPlanViolations already allows label words from any
  // questionnaire string — an explained moment becomes usable copy.
  demo_notes: z.array(z.string().min(1)).max(MAX_DEMO_NOTES).optional(),
});

export type Questionnaire = z.infer<typeof questionnaireSchema>;

export async function ensureUser(
  db: Db,
  email: string,
  role: "customer" | "admin" = "customer",
): Promise<typeof users.$inferSelect> {
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) return existing[0];
  const inserted = await db.insert(users).values({ email, role }).returning();
  return inserted[0]!;
}

export async function createBusiness(
  db: Db,
  opts: { ownerEmail: string; name: string; ownerRole?: "customer" | "admin" },
): Promise<typeof businesses.$inferSelect> {
  const owner = await ensureUser(db, opts.ownerEmail, opts.ownerRole ?? "customer");
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
export async function addDemoNote(
  db: Db,
  businessId: string,
  text: string,
): Promise<string[]> {
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
      and(
        eq(businesses.id, businessId),
        sql`jsonb_array_length(${notesExpr}) < ${MAX_DEMO_NOTES}`,
      ),
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
