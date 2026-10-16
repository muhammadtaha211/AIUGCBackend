import { NextResponse, type NextRequest } from "next/server";
import { getDb, getTiktokProvider, TIKTOK_SCOPES, upsertTiktokConnection } from "@aiugc/core";
import { requirePlatformUser } from "@/lib/social";
import {
  checkOAuthReturn,
  decodeOAuthCookie,
  settingsOutcomePath,
  TIKTOK_OAUTH_COOKIE,
  TIKTOK_OAUTH_COOKIE_PATH,
} from "@/lib/social-oauth";
import type { SocialOutcome } from "@/lib/social-ui";

/**
 * GET /api/social/tiktok/callback — where TikTok's Login Kit sends the browser
 * back (decision 0115): https://tavnit.ai/api/social/tiktok/callback, exactly
 * as the console holds it. Checks the state against the cookie the start route
 * wrote, exchanges the code server-side (the client secret and both tokens
 * never leave the server), refuses a grant without video.upload — TikTok lets
 * the owner switch a scope off — reads the profile and upserts the account,
 * sealing both tokens. Then the return address, or settings with the outcome,
 * each refusal its own line and its own log line.
 *
 * Never logs the code or a token: TikTok's errors are logged by message only.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformUser("tiktok");
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const saved = decodeOAuthCookie(request.cookies.get(TIKTOK_OAUTH_COOKIE)?.value);
  const returnTo = saved?.returnTo ?? null;

  const land = (path: string) => {
    const response = NextResponse.redirect(new URL(path, url.origin));
    // One approval per cookie: whatever happened, the state is spent.
    response.cookies.set(TIKTOK_OAUTH_COOKIE, "", { path: TIKTOK_OAUTH_COOKIE_PATH, maxAge: 0 });
    return response;
  };
  const refused = (outcome: Exclude<SocialOutcome, "connected">) =>
    land(settingsOutcomePath(outcome, { returnTo, platform: "tiktok" }));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (!code && !state && !error) {
    console.warn("tiktok callback: the return carried no code, state or error");
    return refused("error");
  }
  // TikTok says so on the query string; nothing is exchanged, so the state is
  // not needed to believe it — anyone's link reaches this log line, so its
  // values are quoted and capped.
  if (error) {
    const description = url.searchParams.get("error_description") ?? "no description";
    console.warn(
      `tiktok callback: login returned ${JSON.stringify(error.slice(0, 64))} (${JSON.stringify(description.slice(0, 120))})`,
    );
    return refused(error === "access_denied" ? "cancelled" : "error");
  }
  const check = checkOAuthReturn(saved, { userId: auth.userId, state, now: Date.now() });
  if (!check.ok) {
    console.warn(`tiktok callback: refused (${check.outcome}): ${check.reason}`);
    return refused(check.outcome);
  }
  if (!code) {
    console.warn("tiktok callback: the return carried a state but no code");
    return refused("error");
  }

  try {
    const tiktok = getTiktokProvider();
    // searchParams.get has already URL-decoded the code, as TikTok asks.
    const tokens = await tiktok.exchangeCode(code);
    const missing = TIKTOK_SCOPES.filter((scope) => !tokens.scopes.includes(scope));
    if (missing.length > 0) {
      console.warn(`tiktok callback: refused (scope): not granted ${missing.join(",")}`);
      return refused("scope");
    }
    const profile = await tiktok.userInfo(tokens.accessToken);
    const account = await upsertTiktokConnection(getDb(), {
      userId: auth.userId,
      tokens,
      profile,
    });
    return land(
      settingsOutcomePath("connected", {
        returnTo,
        count: 1,
        accountId: account.id,
        platform: "tiktok",
      }),
    );
  } catch (err) {
    console.error(
      `tiktok callback failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    );
    return refused("error");
  }
}
