import { NextResponse } from "next/server";
import { getDb, resumeSubscription } from "@aiugc/core";
import { coreErrorResponse, requireUser } from "@/lib/api";

/** Undo a pending cancel. */
export async function POST() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    await resumeSubscription(getDb(), { userId: auth.userId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
