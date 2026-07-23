import { NextResponse } from "next/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createComposite, getDb, getStorage } from "@aiugc/core";
import { coreErrorResponse, jsonError, requireComposite, requireUser } from "@/lib/api";

/**
 * Another attempt from the SAME stored product photo (no re-upload): download
 * it and run the core create path again — a fresh composite row + job.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireComposite(db, id, auth.userId);
    if ("response" in found) return found.response;
    const { composite } = found;
    if (!composite.productImagePath) {
      return jsonError(400, "לא נמצאה תמונת מוצר — העלו תמונה חדשה.");
    }

    const dir = mkdtempSync(path.join(tmpdir(), "aiugc-upload-"));
    try {
      const localFile = path.join(dir, path.basename(composite.productImagePath));
      await getStorage().download(composite.productImagePath, localFile);
      const regenerated = await createComposite(db, {
        businessId: composite.businessId,
        personaId: composite.personaId,
        productImageFile: localFile,
      });
      return NextResponse.json({ compositeId: regenerated.id });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    return coreErrorResponse(err);
  }
}
