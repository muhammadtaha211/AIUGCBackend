import { NextResponse } from "next/server";
import { coreErrorResponse, requireUser } from "@/lib/api";
import { loadPersonaCatalog } from "@/lib/persona-catalog";

/**
 * The persona catalog for the picker (see lib/persona-catalog). The wizard
 * pages inline the same catalog into first paint; this route stays for the
 * client-side retry path and anything without a server shell.
 */
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  // ?withHookClips=1: the Service A picker — only personas with a column in the hook matrix.
  const withHookClips = new URL(request.url).searchParams.has("withHookClips");

  try {
    return NextResponse.json({ personas: await loadPersonaCatalog({ withHookClips }) });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
