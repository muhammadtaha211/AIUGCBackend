import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv, tiktokAuthorizeUrl } from "@aiugc/core";
import { requirePlatformUser } from "@/lib/social";
import {
  encodeOAuthCookie,
  OAUTH_COOKIE_MAX_AGE_SECONDS,
  settingsOutcomePath,
  socialReturnPath,
  TIKTOK_CALLBACK_PATH,
  TIKTOK_OAUTH_COOKIE,
  TIKTOK_OAUTH_COOKIE_PATH,
} from "@/lib/social-oauth";

/**
 * GET /api/social/tiktok/start?return= — the TikTok card's "חיבור חשבון"
 * (decision 0115). Writes the state cookie and sends the browser to TikTok's
 * Login Kit with the console's exact redirect, user.info.basic and
 * video.upload. No PKCE: TikTok's web flow has none; the state is the CSRF
 * check, and no token ever reaches the browser. A DRY_RUN web skips TikTok and
 * lands on its OWN origin's callback with a stub code, so the flow walks
 * locally without TikTok — the console's redirect is tavnit.ai alone.
 */
export async function GET(request: Request) {
  const auth = await requirePlatformUser("tiktok");
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const returnTo = socialReturnPath(url.searchParams.get("return"));
  const state = randomBytes(24).toString("base64url");
  const env = getEnv();

  let target: string;
  if (env.DRY_RUN) {
    target = new URL(
      `${TIKTOK_CALLBACK_PATH}?${new URLSearchParams({ code: "dry_run", state }).toString()}`,
      url.origin,
    ).toString();
  } else if (!env.TIKTOK_CLIENT_KEY) {
    // A configuration fault, not the customer's: say the connect did not
    // happen and log the reason for the founder.
    console.error("tiktok start: TIKTOK_CLIENT_KEY is not set");
    return NextResponse.redirect(
      new URL(settingsOutcomePath("error", { returnTo, platform: "tiktok" }), url.origin),
    );
  } else {
    target = tiktokAuthorizeUrl({ clientKey: env.TIKTOK_CLIENT_KEY, state });
  }

  const response = NextResponse.redirect(target);
  const cookie = encodeOAuthCookie({ state, userId: auth.userId, returnTo, issuedAt: Date.now() });
  response.cookies.set(TIKTOK_OAUTH_COOKIE, cookie, {
    httpOnly: true,
    // Lax: TikTok's redirect back is a top-level cross-site GET, which Lax sends.
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: TIKTOK_OAUTH_COOKIE_PATH,
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
