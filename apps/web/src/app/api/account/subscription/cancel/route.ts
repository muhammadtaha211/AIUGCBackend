import { NextResponse } from "next/server";
import { cancelSubscription, getDb } from "@aiugc/core";
import { coreErrorResponse, requireUser } from "@/lib/api";

/** Cancel at period end, no refund. Replaces a pending plan change. */
export async function POST() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    await cancelSubscription(getDb(), { userId: auth.userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
