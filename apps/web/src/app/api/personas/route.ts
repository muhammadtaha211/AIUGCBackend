import { NextResponse } from "next/server";
import { coreErrorResponse, requireUser } from "@/lib/api";
import { loadPersonaCatalog } from "@/lib/persona-catalog";

/**
 * The persona catalog for the picker (see lib/persona-catalog). The wizard
 * pages inline the same catalog into first paint; this route stays for the
 * client-side retry path and anything without a server shell.
 *
 * ?withSelfie=1 is the Service B catalog (selfie personas, selfie thumbnail,
 * personaImageId). Anything else — ?withHookClips=1, the A picker's explicit
 * spelling, or no flag — is the Service A catalog (hook-matrix personas).
 */
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const service = new URL(request.url).searchParams.has("withSelfie") ? "b" : "a";

  try {
    return NextResponse.json({ personas: await loadPersonaCatalog(service) });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
