import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@aiugc/core";
import { coreErrorResponse, requireUser } from "@/lib/api";

/**
 * Who this browser is, for analytics only (vault 0104). lib/analytics-client.ts
 * asks when a session cookie is present: an admin account sends nothing at all,
 * and a customer is identified to PostHog by its user id and nothing else. 401
 * when signed out, which the client reads as an anonymous visitor.
 */
export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const [row] = await getDb()
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, auth.userId))
      .limit(1);
    return NextResponse.json(
      row?.role === "admin" ? { admin: true } : { admin: false, id: auth.userId },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return coreErrorResponse(err);
  }
}
