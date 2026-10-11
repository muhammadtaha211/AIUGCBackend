import { z } from "zod";
import { FACEBOOK_OAUTH_DIALOG, INSTAGRAM_SCOPES } from "@aiugc/core";
import { safeNextPath } from "./onboarding";

/**
 * The Facebook round trip behind "חיבור חשבון" (decision 0101, PR 2): the
 * state cookie, the dialog URL and the return address. Pure apart from the
 * core constants, so the tests reach every branch without a request.
 *
 * The cookie is HttpOnly and scoped to the two routes, carries a random state
 * the callback must see echoed back (Facebook login CSRF), the Tavnit account
 * that started it (a session switched mid-flow is refused) and where to land
 * afterwards. Ten minutes: the window is open for one approval, not a session.
 */

export const OAUTH_COOKIE = "aiugc.social_oauth";
export const OAUTH_COOKIE_PATH = "/api/social/instagram";
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 600;
export const INSTAGRAM_CALLBACK_PATH = "/api/social/instagram/callback";

const cookieSchema = z.object({
  state: z.string().min(16),
  userId: z.string().uuid(),
  returnTo: z.string().nullable(),
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
 * Where to land after connecting: a same-origin path under /home only
 * (`safeNextPath`'s rule without its Sumit exception), so the parameter can
 * never turn the round trip into an open redirect.
 */
export function socialReturnPath(value: string | string[] | undefined | null): string | null {
  const safe = safeNextPath(value ?? undefined);
  return safe && safe.startsWith("/home") ? safe : null;
}

/** The redirect URI Facebook must have on its allowlist, byte for byte. */
export function instagramRedirectUri(origin: string): string {
  return `${origin}${INSTAGRAM_CALLBACK_PATH}`;
}

/**
 * Facebook's login dialog. A `config_id` (Facebook Login for Business) replaces
 * the scope list when the app dashboard issued one; otherwise the five
 * permissions the use case bundles. "הוספת חשבון" sends `auth_type=rerequest`
 * so Facebook asks again instead of passing an app the user already approved
 * straight through.
 */
export function instagramDialogUrl(opts: {
  appId: string;
  redirectUri: string;
  state: string;
  configId?: string;
  add: boolean;
}): string {
  const url = new URL(FACEBOOK_OAUTH_DIALOG);
  url.searchParams.set("client_id", opts.appId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("response_type", "code");
  if (opts.configId) url.searchParams.set("config_id", opts.configId);
  else url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  if (opts.add) url.searchParams.set("auth_type", "rerequest");
  return url.toString();
}

/** Where the callback sends the browser: the return address on success, else settings with the outcome. */
export function settingsOutcomePath(
  outcome: "connected" | "none" | "error",
  opts: { returnTo: string | null; count?: number; accountId?: string },
): string {
  if (outcome === "connected" && opts.returnTo) return opts.returnTo;
  const params = new URLSearchParams({ social: outcome });
  if (outcome === "connected" && opts.count !== undefined) params.set("n", String(opts.count));
  if (outcome === "connected" && opts.accountId) params.set("id", opts.accountId);
  // A failed round trip keeps the return address, so the retry still lands there.
  if (outcome !== "connected" && opts.returnTo) params.set("return", opts.returnTo);
  return `/home/settings?${params.toString()}#connections`;
}
