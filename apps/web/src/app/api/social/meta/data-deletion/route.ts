import { NextResponse } from "next/server";
import {
  getDb,
  processMetaDataDeletion,
  SignedRequestError,
  verifyMetaSignedRequest,
} from "@aiugc/core";

/**
 * POST /api/social/meta/data-deletion — Meta's User Data Deletion callback
 * (decision 0101, PR 2). Meta calls it, not a customer, so it is the one
 * social route outside the switch and without a session. It fires when a user
 * removes Tavnit in their Facebook settings and asks for their data to go.
 *
 * Refused (400, nothing touched) unless the `signed_request` verifies against
 * the app secret. Otherwise every connection that Facebook user made loses its
 * tokens and identifying fields, its scheduled posts are cancelled, and the
 * answer is the `{url, confirmation_code}` Meta documents — the url being the
 * public status page.
 */
export async function POST(request: Request) {
  let signedRequest: string | null = null;
  try {
    const form = await request.formData();
    const value = form.get("signed_request");
    signedRequest = typeof value === "string" ? value : null;
  } catch {
    signedRequest = null;
  }
  if (!signedRequest) {
    return NextResponse.json({ error: "signed_request is required" }, { status: 400 });
  }

  let fbUserId: string;
  try {
    fbUserId = verifyMetaSignedRequest(signedRequest).userId;
  } catch (err) {
    if (err instanceof SignedRequestError) {
      console.warn(`meta data deletion refused: ${err.message}`);
      return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
    }
    // The app secret is missing: our fault, and Meta should retry later.
    console.error(`meta data deletion failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const { confirmationCode } = await processMetaDataDeletion(getDb(), { fbUserId });
  const origin = new URL(request.url).origin;
  return NextResponse.json({
    url: `${origin}/social/deletion/${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}
