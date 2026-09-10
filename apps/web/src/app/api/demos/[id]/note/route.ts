import { NextResponse } from "next/server";
import { addDemoNote, getDb } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, requireDemo, requireUser } from "@/lib/api";
import { demoNoteRequestSchema } from "@/lib/service-a";

/**
 * Answer an unexplained moment from the plan pass. The answer lands in
 * questionnaire.demo_notes, where BOTH passes read it on the next run — and
 * where the anti-fabrication rule already allows label words from it, so an
 * explained moment becomes usable copy on regenerate.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireDemo(db, id, auth.userId);
    if ("response" in found) return found.response;

    const body = demoNoteRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const demoNotes = await addDemoNote(db, found.demo.businessId, body.data.text);
    return NextResponse.json({ ok: true, demoNotes });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
