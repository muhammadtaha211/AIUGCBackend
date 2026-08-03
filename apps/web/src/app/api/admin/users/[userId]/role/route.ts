import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, NOT_FOUND, requireAdmin } from "@/lib/api";
import { canChangeRole, roleChangeSchema } from "@/lib/admin";
import { isUuid } from "@/lib/service-b";

/** Role change customer<->admin, with the one hard guard: never your own role. */
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const db = getDb();
  const auth = await requireAdmin(db);
  if ("response" in auth) return auth.response;

  try {
    if (!isUuid(userId)) return jsonError(404, NOT_FOUND);
    if (!canChangeRole(auth.userId, userId)) {
      return jsonError(400, "אי אפשר לשנות את התפקיד של עצמך.");
    }

    const body = roleChangeSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const userRows = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!userRows[0]) return jsonError(404, NOT_FOUND);

    await db.update(schema.users).set({ role: body.data.role }).where(eq(schema.users.id, userId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
