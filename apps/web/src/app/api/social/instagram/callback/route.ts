import { NextResponse, type NextRequest } from "next/server";
import { getDb, getMetaGraphProvider, upsertInstagramConnections } from "@aiugc/core";
import { requirePostingUser } from "@/lib/social";
import {
  decodeOAuthCookie,
  instagramRedirectUri,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  settingsOutcomePath,
} from "@/lib/social-oauth";

/**
 * GET /api/social/instagram/callback — where Facebook's dialog sends the
 * browser back (decision 0101, PR 2). Checks the state against the cookie the
 * start route wrote, exchanges the code (short-lived → long-lived User token →
 * the Facebook user id → every Page with an Instagram professional account)
 * and upserts EVERY such account in one go, sealing the Page token and the
 * User token. Then the return address, or settings with the outcome.
 *
 * Never logs the code or a token: Meta's errors are logged by message only,
 * and the wrapper already keeps the token out of every URL it logs.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePostingUser();
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const saved = decodeOAuthCookie(request.cookies.get(OAUTH_COOKIE)?.value);
  const returnTo = saved?.returnTo ?? null;

  const land = (path: string) => {
    const response = NextResponse.redirect(new URL(path, url.origin));
    // One approval per cookie: whatever happened, the state is spent.
    response.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return response;
  };
  const failed = () => land(settingsOutcomePath("error", { returnTo }));

  // A state we did not issue, or issued to another session, is never exchanged.
  const state = url.searchParams.get("state");
  if (!saved || saved.userId !== auth.userId || !state || state !== saved.state) {
    console.warn("instagram callback: state missing or mismatched");
    return failed();
  }
  // The user closed or refused the dialog: Facebook says so on the query string.
  if (url.searchParams.has("error")) {
    console.warn(
      `instagram callback: dialog returned ${url.searchParams.get("error")} (${url.searchParams.get("error_reason") ?? "no reason"})`,
    );
    return failed();
  }
  const code = url.searchParams.get("code");
  if (!code) return failed();

  try {
    const meta = getMetaGraphProvider();
    const shortLived = await meta.exchangeCode(code, instagramRedirectUri(url.origin));
    const longLived = await meta.exchangeLongLived(shortLived.accessToken);
    const fbUser = await meta.me(longLived.accessToken);
    const pages = await meta.pagesWithInstagram(longLived.accessToken);
    if (pages.length === 0) return land(settingsOutcomePath("none", { returnTo }));

    const accounts = await upsertInstagramConnections(getDb(), {
      userId: auth.userId,
      fbUserId: fbUser.id,
      userToken: longLived.accessToken,
      userTokenExpiresAt: longLived.expiresInSeconds
        ? new Date(Date.now() + longLived.expiresInSeconds * 1000)
        : null,
      pages,
    });
    return land(
      settingsOutcomePath("connected", {
        returnTo,
        count: accounts.length,
        accountId: accounts.length === 1 ? accounts[0]!.id : undefined,
      }),
    );
  } catch (err) {
    console.error(
      `instagram callback failed: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    );
    return failed();
  }
}
