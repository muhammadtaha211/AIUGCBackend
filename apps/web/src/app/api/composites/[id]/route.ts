import { NextResponse } from "next/server";
import { getDb, getStorage } from "@aiugc/core";
import {
  coreErrorResponse,
  requireComposite,
  requireUser,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/api";

/** Poll a composite: status, signed preview when ready, Hebrew error on failed. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireComposite(db, id, auth.userId);
    if ("response" in found) return found.response;
    const { composite } = found;

    const body: { status: string; previewUrl?: string; error?: string } = {
      status: composite.status,
    };
    if (composite.status === "ready" && composite.outputPath) {
      body.previewUrl = await getStorage().signedUrl(composite.outputPath, SIGNED_URL_TTL_SECONDS);
    }
    if (composite.status === "failed") {
      body.error = "יצירת התמונה נכשלה — נסו שוב או בחרו דמות אחרת.";
    }
    return NextResponse.json(body);
  } catch (err) {
    return coreErrorResponse(err);
  }
}
