import { NextResponse } from "next/server";
import {
  getDb,
  processTiktokEvent,
  TiktokSignatureError,
  verifyTiktokSignature,
} from "@aiugc/core";

/**
 * POST /api/social/tiktok/webhook — TikTok's webhook (decision 0115), the
 * callback the console holds: https://tavnit.ai/api/social/tiktok/webhook.
 * TikTok calls it, not a customer, so like Meta's deletion callback it sits
 * outside the switches and reads no session.
 *
 * The raw body is read before anything parses it: the signature
 * (`TikTok-Signature: t=…,s=…`, HMAC-SHA256 of "t.body" under the client
 * secret) is over those exact bytes. Unsigned or badly signed → 401, nothing
 * touched; the secret missing → 503 (ours to fix, and TikTok retries for 72 h).
 * A verified delivery is processed at once — a few guarded writes — and
 * answered 200, handled or not: TikTok asks for 200 straight away and delivers
 * at least once, so every write is idempotent. A processing fault → 500, so
 * TikTok sends it again.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    verifyTiktokSignature(request.headers.get("tiktok-signature"), rawBody);
  } catch (err) {
    if (err instanceof TiktokSignatureError) {
      console.warn(`tiktok webhook refused: ${err.message}`);
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
    console.error(`tiktok webhook failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  try {
    const result = await processTiktokEvent(getDb(), rawBody);
    console.info(`tiktok webhook: ${result.event} ${result.outcome} (source: webhook)`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      `tiktok webhook processing failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return NextResponse.json({ error: "retry" }, { status: 500 });
  }
}
