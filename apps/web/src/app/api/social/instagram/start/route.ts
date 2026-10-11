import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@aiugc/core";
import { requirePostingUser } from "@/lib/social";
import {
  encodeOAuthCookie,
  instagramDialogUrl,
  instagramRedirectUri,
  OAUTH_COOKIE,
  OAUTH_COOKIE_MAX_AGE_SECONDS,
  OAUTH_COOKIE_PATH,
  settingsOutcomePath,
  socialReturnPath,
} from "@/lib/social-oauth";

/**
 * GET /api/social/instagram/start?return=&add=1 — the pre-screen's "המשך".
 * Writes the state cookie and sends the browser to Facebook's login dialog
 * (decision 0101, PR 2). A DRY_RUN web skips Facebook and lands on the
 * callback with a stub code, so the whole flow walks without Meta.
 */
export async function GET(request: Request) {
  const auth = await requirePostingUser();
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const returnTo = socialReturnPath(url.searchParams.get("return"));
  const add = url.searchParams.get("add") === "1";
  const state = randomBytes(24).toString("base64url");
  const redirectUri = instagramRedirectUri(url.origin);
  const env = getEnv();

  let target: string;
  if (env.DRY_RUN) {
    target = `${redirectUri}?${new URLSearchParams({ code: "dry_run", state }).toString()}`;
  } else if (!env.META_APP_ID) {
    // A configuration fault, not the customer's: say the connect did not
    // happen and log the reason for the founder.
    console.error("instagram start: META_APP_ID is not set");
    return NextResponse.redirect(new URL(settingsOutcomePath("error", { returnTo }), url.origin));
  } else {
    target = instagramDialogUrl({
      appId: env.META_APP_ID,
      redirectUri,
      state,
      configId: env.META_LOGIN_CONFIG_ID || undefined,
      add,
    });
  }

  const response = NextResponse.redirect(target);
  response.cookies.set(OAUTH_COOKIE, encodeOAuthCookie({ state, userId: auth.userId, returnTo }), {
    httpOnly: true,
    // Lax: Facebook's redirect back is a top-level cross-site GET, which Lax sends.
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
