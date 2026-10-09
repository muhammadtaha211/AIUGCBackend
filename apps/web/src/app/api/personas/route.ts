import { NextResponse } from "next/server";
import { coreErrorResponse, requireUser } from "@/lib/api";
import { loadPersonaCatalog } from "@/lib/persona-catalog";

/**
 * The persona catalog for the picker (see lib/persona-catalog). The wizard
 * pages inline the same catalog into first paint; this route stays for the
 * client-side retry path and anything without a server shell.
 *
 * ?withSelfie=1 is the Service B catalog (selfie personas, selfie thumbnail,
 * personaImageId). ?withTextBlocks=1 is the Service C catalog (characters
 * with a usable גוש טקסט clip, decision 0099). Anything else — ?withHookClips=1,
 * the A picker's explicit spelling, or no flag — is the Service A catalog
 * (hook-matrix personas).
 */
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const flags = new URL(request.url).searchParams;
  const service = flags.has("withSelfie") ? "b" : flags.has("withTextBlocks") ? "c" : "a";

  try {
    return NextResponse.json({ personas: await loadPersonaCatalog(service) });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
