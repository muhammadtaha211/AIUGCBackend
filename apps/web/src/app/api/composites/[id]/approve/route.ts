import { NextResponse } from "next/server";
import { approveComposite, getDb } from "@aiugc/core";
import { coreErrorResponse, requireComposite, requireUser } from "@/lib/api";

/** The hard composite gate: lipsync refuses composites without approved_at. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireComposite(db, id, auth.userId);
    if ("response" in found) return found.response;

    await approveComposite(db, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
