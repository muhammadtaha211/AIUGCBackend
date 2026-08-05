import { NextResponse } from "next/server";
import { coreErrorResponse, requireUser } from "@/lib/api";
import { loadPersonaCatalog } from "@/lib/persona-catalog";

/**
 * The persona catalog for the picker (see lib/persona-catalog). The wizard
 * pages inline the same catalog into first paint; this route stays for the
 * client-side retry path and anything without a server shell.
 */
export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    return NextResponse.json({ personas: await loadPersonaCatalog() });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
