import { NextResponse } from "next/server";
import { approveAudio, getDb } from "@aiugc/core";
import { coreErrorResponse, requireAudio, requireUser } from "@/lib/api";

/** The mandatory audio gate: video is never rendered on unapproved audio. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireAudio(db, id, auth.userId);
    if ("response" in found) return found.response;

    await approveAudio(db, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
