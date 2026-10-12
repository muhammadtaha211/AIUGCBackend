import { NextResponse, type NextRequest } from "next/server";
import { getDb, getMetaGraphProvider, upsertInstagramConnections } from "@aiugc/core";
import { requirePostingUser } from "@/lib/social";
import {
  checkOAuthReturn,
  decodeOAuthCookie,
  instagramRedirectUri,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  settingsOutcomePath,
} from "@/lib/social-oauth";
import type { SocialOutcome } from "@/lib/social-ui";

/**
 * GET /api/social/instagram/callback — where Facebook's dialog sends the
 * browser back (decision 0101, PR 2). Checks the state against the cookie the
 * start route wrote, exchanges the code (short-lived → long-lived User token →
 * the Facebook user id → every Page with an Instagram professional account)
 * and upserts EVERY such account in one go, sealing the Page token and the
 * User token. Then the return address, or settings with the outcome — each
 * refusal and failure its own line and its own log line (0105), so the next
 * failure explains itself.
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
  const refused = (outcome: Exclude<SocialOutcome, "connected">) =>
    land(settingsOutcomePath(outcome, { returnTo }));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // Nothing on the query at all is what Meta's documented token return (the
  // address fragment, which never reaches a server) looks like from here.
  if (!code && !state && !error) {
    console.warn(
      "instagram callback: the return carried no code, state or error (a fragment return?)",
    );
    return refused("error");
  }
  // The user closed or refused the dialog: Facebook says so on the query
  // string. Nothing is exchanged, so the state is not needed to believe it —
  // which also means anyone's link reaches this log line, so its values are
  // quoted and capped (a newline must not forge a second entry).
  if (error) {
    const reason = url.searchParams.get("error_reason") ?? "no reason";
    console.warn(
      `instagram callback: dialog returned ${JSON.stringify(error.slice(0, 64))} (${JSON.stringify(reason.slice(0, 64))})`,
    );
    return refused(error === "access_denied" ? "cancelled" : "error");
  }
  // A state we did not issue, issued to another session, or issued too long
  // ago is never exchanged.
  const check = checkOAuthReturn(saved, { userId: auth.userId, state, now: Date.now() });
  if (!check.ok) {
    console.warn(`instagram callback: refused (${check.outcome}): ${check.reason}`);
    return refused(check.outcome);
  }
  if (!code) {
    console.warn("instagram callback: the return carried a state but no code");
    return refused("error");
  }

  try {
    const meta = getMetaGraphProvider();
    const shortLived = await meta.exchangeCode(code, instagramRedirectUri(url.origin));
    const longLived = await meta.exchangeLongLived(shortLived.accessToken);
    const fbUser = await meta.me(longLived.accessToken);
    const pages = await meta.pagesWithInstagram(longLived.accessToken);
    if (pages.length === 0) return refused("none");

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
    return refused("error");
  }
}
