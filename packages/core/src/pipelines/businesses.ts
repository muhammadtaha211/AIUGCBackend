import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db";
import { businesses, users } from "../db/schema";

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
  await db
    .update(businesses)
    .set({ questionnaire, questionnaireUpdatedAt: new Date() })
    .where(eq(businesses.id, businessId));
  return questionnaire;
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
