import { z } from "zod";
import { FACEBOOK_OAUTH_DIALOG, INSTAGRAM_SCOPES, type InstagramConnectMode } from "@aiugc/core";
import { safeNextPath } from "./onboarding";
import type { SocialOutcome } from "./social-ui";

/**
 * The Facebook round trip behind "חיבור חשבון" (decision 0101, PR 2): the
 * state cookie, the dialog URL and the return address. Pure apart from the
 * core constants, so the tests reach every branch without a request.
 *
 * The cookie is HttpOnly and scoped to the two routes, carries a random state
 * the callback must see echoed back (Facebook login CSRF), the Tavnit account
 * that started it (a session switched mid-flow is refused), where to land
 * afterwards and when it was issued. The window gets thirty minutes (decision
 * 0105: converting, creating a Page and linking it all happen inside it, and
 * ten minutes was too short for an "Edit settings" walk); the browser keeps the
 * cookie a day, so a late return still reads as late rather than as foreign.
 */

export const OAUTH_COOKIE = "aiugc.social_oauth";
export const OAUTH_COOKIE_PATH = "/api/social/instagram";
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;
export const OAUTH_WINDOW_MS = 30 * 60_000;
export const INSTAGRAM_CALLBACK_PATH = "/api/social/instagram/callback";

/**
 * TikTok's round trip (decision 0115) uses the same cookie shape under its own
 * name and path, so a TikTok connect and an Instagram one never spend each
 * other's state. Its redirect URI is TikTok's console constant
 * (TIKTOK_REDIRECT_URI in core), never the request's origin: TikTok matches it
 * byte for byte, so only tavnit.ai completes a live connect.
 */
export const TIKTOK_OAUTH_COOKIE = "aiugc.tiktok_oauth";
export const TIKTOK_OAUTH_COOKIE_PATH = "/api/social/tiktok";
export const TIKTOK_CALLBACK_PATH = "/api/social/tiktok/callback";

const cookieSchema = z.object({
  state: z.string().min(16),
  userId: z.string().uuid(),
  returnTo: z.string().nullable(),
  issuedAt: z.number().int(),
});
export type OAuthCookie = z.infer<typeof cookieSchema>;

export function encodeOAuthCookie(value: OAuthCookie): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** null for anything that is not a cookie this module wrote. */
export function decodeOAuthCookie(raw: string | undefined): OAuthCookie | null {
  if (!raw) return null;
  try {
    const parsed = cookieSchema.safeParse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
    if (!parsed.success) return null;
    // Re-checked on the way out: the cookie is ours, but the rule lives here.
    return { ...parsed.data, returnTo: socialReturnPath(parsed.data.returnTo ?? undefined) };
  } catch {
    return null;
  }
}

/**
 * Where to land after connecting: a same-origin path under /home, or the
 * schedule flow and the calendar (PR 3, outside /home for their real 404 —
 * app/(posting)/layout.tsx) — `safeNextPath`'s rule without its Sumit
 * exception, so the parameter can never turn the round trip into an open
 * redirect.
 */
export function socialReturnPath(value: string | string[] | undefined | null): string | null {
  const safe = safeNextPath(value ?? undefined);
  if (safe && safe.startsWith("/home")) return safe;
  return typeof value === "string" && POSTING_RETURN.test(value) ? value : null;
}

/** /schedule/<id> or /calendar[/<id>], with a query or fragment, nothing else. */
const POSTING_RETURN =
  /^\/(?:schedule\/[0-9a-f-]{36}|calendar(?:\/[0-9a-f-]{36})?)(?:[?#][^\s]*)?$/i;

/**
 * Whether a return from Facebook belongs to the round trip this browser started
 * for this Tavnit account, and in time. `reason` is for the log, never shown.
 * Lateness is judged last: a stale cookie that is also someone else's is
 * foreign, not late.
 */
export function checkOAuthReturn(
  saved: OAuthCookie | null,
  opts: { userId: string; state: string | null; now: number },
): { ok: true } | { ok: false; outcome: "expired" | "mismatch"; reason: string } {
  if (!saved) return { ok: false, outcome: "mismatch", reason: "no state cookie in this browser" };
  if (saved.userId !== opts.userId) {
    return {
      ok: false,
      outcome: "mismatch",
      reason: "the cookie belongs to another Tavnit account",
    };
  }
  if (!opts.state) return { ok: false, outcome: "mismatch", reason: "the return carried no state" };
  if (opts.state !== saved.state) {
    return {
      ok: false,
      outcome: "mismatch",
      reason: "the return's state is not the cookie's (another connect started since?)",
    };
  }
  const age = opts.now - saved.issuedAt;
  if (age > OAUTH_WINDOW_MS) {
    return {
      ok: false,
      outcome: "expired",
      reason: `the window was opened ${Math.round(age / 60_000)} min ago`,
    };
  }
  return { ok: true };
}

/** The redirect URI Facebook must have on its allowlist, byte for byte. */
export function instagramRedirectUri(origin: string): string {
  return `${origin}${INSTAGRAM_CALLBACK_PATH}`;
}

/** Meta's Instagram onboarding channel, as its page spells the `extras` value. */
export const IG_ONBOARDING_EXTRAS = JSON.stringify({ setup: { channel: "IG_API_ONBOARDING" } });

/**
 * Facebook's login dialog. A `config_id` (Facebook Login for Business) replaces
 * the scope list when the app dashboard issued one; otherwise the five
 * permissions the use case bundles. "הוספת חשבון" sends `auth_type=rerequest`
 * so Facebook asks again instead of passing an app the user already approved
 * straight through.
 *
 * `mode: "onboarding"` (app_config.instagram_connect, decision 0105) asks for
 * Meta's one-window setup instead: the parameter set of its
 * business-login-for-instagram page (`display=page`, the `extras`, the scope
 * list; the page names no `config_id` and no `auth_type`) with ONE change — a
 * code in the query rather than the page's `response_type=token`, which puts
 * the tokens in the address fragment where page script can read them. Whether
 * Meta's window honours a code there is undocumented; the founder's live run
 * decides. `override_default_response_type`: FLfB issues User tokens by the
 * implicit grant by default, and Meta documents the override for the JS SDK only.
 */
export function instagramDialogUrl(opts: {
  appId: string;
  redirectUri: string;
  state: string;
  configId?: string;
  add: boolean;
  mode: InstagramConnectMode;
}): string {
  const url = new URL(FACEBOOK_OAUTH_DIALOG);
  url.searchParams.set("client_id", opts.appId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("response_type", "code");
  if (opts.mode === "onboarding") {
    url.searchParams.set("display", "page");
    url.searchParams.set("extras", IG_ONBOARDING_EXTRAS);
    url.searchParams.set("override_default_response_type", "true");
    url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
    return url.toString();
  }
  if (opts.configId) url.searchParams.set("config_id", opts.configId);
  else url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  if (opts.add) url.searchParams.set("auth_type", "rerequest");
  return url.toString();
}

/**
 * Where the callback sends the browser: the return address on success, else
 * settings with the outcome. Always with a fragment of its own: a redirect whose
 * address has none inherits the one the browser arrived with, and a Facebook
 * return in the fragment (Meta's documented token form) would ride on to a page
 * where scripts run.
 */
export function settingsOutcomePath(
  outcome: SocialOutcome,
  opts: {
    returnTo: string | null;
    count?: number;
    accountId?: string;
    /** TikTok's round trip says so, so settings words its line for TikTok. */
    platform?: "instagram" | "tiktok";
  },
): string {
  if (outcome === "connected" && opts.returnTo) {
    return opts.returnTo.includes("#") ? opts.returnTo : `${opts.returnTo}#`;
  }
  const params = new URLSearchParams({ social: outcome });
  if (opts.platform === "tiktok") params.set("p", "tiktok");
  if (outcome === "connected" && opts.count !== undefined) params.set("n", String(opts.count));
  if (outcome === "connected" && opts.accountId) params.set("id", opts.accountId);
  // A failed round trip keeps the return address, so the retry still lands there.
  if (outcome !== "connected" && opts.returnTo) params.set("return", opts.returnTo);
  return `/home/settings?${params.toString()}#connections`;
}
