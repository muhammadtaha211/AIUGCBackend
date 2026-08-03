import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, grantCredits, schema } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, NOT_FOUND, requireAdmin } from "@/lib/api";
import { grantSchema } from "@/lib/admin";

/** Manual credit grant: one append-only grant_manual ledger row, note required. */
export async function POST(request: Request) {
  const db = getDb();
  const auth = await requireAdmin(db);
  if ("response" in auth) return auth.response;

  try {
    const body = grantSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const businessRows = await db
      .select({ id: schema.businesses.id })
      .from(schema.businesses)
      .where(eq(schema.businesses.id, body.data.businessId))
      .limit(1);
    if (!businessRows[0]) return jsonError(404, NOT_FOUND);

    await grantCredits(db, body.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
