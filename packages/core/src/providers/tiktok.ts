import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "../config";
import { PermanentError, TransientError } from "../jobs/errors";
import { logger } from "../logger";

/**
 * TikTok for Developers (PR 4, decision 0115): Login Kit for Web, the token
 * exchange and refresh, user info, the Content Posting API's INBOX upload by
 * PULL_FROM_URL, its status fetch, and the webhook signature. Inbox only — no
 * direct-post endpoint is wrapped here, by decision (TikTok offers no way to
 * attach a sound by API; the owner adds it in the app). No cost, so no
 * usage_events row, like Meta.
 *
 * Every call made with a token carries it in the Authorization header; the
 * OAuth endpoint takes the client secret and the code or refresh token in a
 * form body. `request()` logs method, path and status only — never a body,
 * never a token, never the signed video URL's query (a bearer token for the
 * file; `withoutQuery`).
 *
 * The doc facts this encodes were read live on 2026-10-16 (developers.tiktok.com:
 * login-kit-web, oauth-user-access-token-management, oauth-error-handling,
 * tiktok-api-v2-get-user-info, content-posting-api-reference-upload-video,
 * content-posting-api-reference-get-video-status, content-posting-api-media-transfer-guide,
 * webhooks-verification): no PKCE for web; access tokens live 24 h and refresh
 * tokens 365 d, and a refresh "may" return a different refresh token that must
 * be used from then on; the OAuth endpoint answers errors as a FLAT
 * {error, error_description, log_id} (no HTTP status stated), and
 * `invalid_grant` covers a refresh token "issued to another client" — which is
 * what a sandbox token meets after the production pair replaces it; the
 * Content Posting endpoints answer {data, error: {code, message, log_id}} with
 * code "ok" on success; the inbox init takes only `source_info`; a pull URL
 * must be https on a verified domain and must not redirect.
 */

export const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_API_BASE = "https://open.tiktokapis.com";
/** Exactly what the TikTok console holds (decision 0115): never derived from a request. */
export const TIKTOK_REDIRECT_URI = "https://tavnit.ai/api/social/tiktok/callback";
/** The two scopes the console holds: the profile, and inbox drafts. */
export const TIKTOK_SCOPES = ["user.info.basic", "video.upload"] as const;
/**
 * The host TikTok pulls a render from: the Supabase project's custom domain
 * (0063), a subdomain of the tavnit.ai domain property verified in TikTok's
 * console. MEASURED 2026-10-16: a signed render URL fetched through it answers
 * 200 video/mp4 with no redirect, exactly as on the supabase.co host.
 */
export const TIKTOK_PULL_ORIGIN = "https://auth.tavnit.ai";

/** One HTTP round trip; the job queue owns retries (TransientError → backoff). */
export const TIKTOK_REQUEST_TIMEOUT_MS = 20_000;

export interface TiktokTokens {
  openId: string;
  /** The scopes the owner granted — TikTok lets them switch one off. */
  scopes: string[];
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface TiktokProfile {
  openId: string;
  displayName?: string;
  avatarUrl?: string;
}

export type TiktokPublishStatusCode =
  | "PROCESSING_UPLOAD"
  | "PROCESSING_DOWNLOAD"
  | "SEND_TO_USER_INBOX"
  | "PUBLISH_COMPLETE"
  | "FAILED";

export interface TiktokPublishStatus {
  code: TiktokPublishStatusCode;
  /** Set when code is FAILED (TikTok's fail_reason). */
  failReason?: string;
  /** The first public post id, as digits (a 19-digit id exceeds a JS number). */
  postId?: string;
}

export interface TiktokProvider {
  exchangeCode(code: string): Promise<TiktokTokens>;
  refresh(refreshToken: string): Promise<TiktokTokens>;
  userInfo(accessToken: string): Promise<TiktokProfile>;
  /** The inbox upload by PULL_FROM_URL: TikTok fetches the file itself, within an hour. */
  initInboxPull(accessToken: string, videoUrl: string): Promise<{ publishId: string }>;
  publishStatus(accessToken: string, publishId: string): Promise<TiktokPublishStatus>;
}

/**
 * A TikTok refusal: permanent for the queue, typed so the pipeline can tell a
 * lapsed connection from a refused post. The message carries TikTok's code and
 * text, never a token.
 */
export class TiktokApiError extends PermanentError {
  readonly httpStatus: number;
  readonly code: string;
  readonly logId?: string;

  constructor(httpStatus: number, tiktok: { code: string; message?: string; logId?: string }) {
    super(`tiktok ${httpStatus} ${tiktok.code}: ${(tiktok.message ?? "").slice(0, 300)}`);
    this.httpStatus = httpStatus;
    this.code = tiktok.code;
    this.logId = tiktok.logId;
  }
}

/**
 * "The connection no longer works": the refresh token is invalid, expired,
 * revoked or was issued to another client (`invalid_grant`), the access token
 * is refused, or the owner took the upload scope away. A reconnect fixes each;
 * anything else is a refusal of the request, not of the connection.
 */
const TOKEN_LAPSE_CODES = new Set([
  "invalid_grant",
  "access_token_invalid",
  "scope_not_authorized",
]);

export function isTiktokTokenLapse(err: unknown): boolean {
  return err instanceof TiktokApiError && TOKEN_LAPSE_CODES.has(err.code);
}

/** The pending-share cap (≤5 per 24 h): a wait, not a refusal of the post. */
export function isTiktokPendingCap(err: unknown): boolean {
  return err instanceof TiktokApiError && err.code === "spam_risk_too_many_pending_share";
}

/** TikTok's "try again" family on either endpoint shape. */
const TRANSIENT_CODES = new Set([
  "rate_limit_exceeded",
  "internal_error",
  "server_error",
  "temporarily_unavailable",
]);

/** A signed URL's path is useful in a log; its token is not. */
function withoutQuery(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : `${url.slice(0, q)}?<signed>`;
}

/**
 * The digits of a numeric id named `field` in raw JSON text, quoted or bare,
 * read BEFORE JSON.parse: TikTok's post ids are int64 (list<int64> on the
 * status page), and a bare 19-digit number loses its last digits as a JS number.
 * Also matches inside a JSON string holding JSON (a webhook's `content`), where
 * every quote arrives escaped.
 */
export function rawIdField(text: string, field: string): string | undefined {
  const match = new RegExp(`\\\\?"${field}\\\\?"\\s*:\\s*\\[?\\s*\\\\?"?(\\d+)`).exec(text);
  return match?.[1];
}

/**
 * The authorize link (Login Kit for Web). Pure: the route passes the client key.
 * `disable_auto_auth=1` always shows TikTok's authorisation page, so the owner
 * sees which TikTok account they are about to connect.
 */
export function tiktokAuthorizeUrl(opts: { clientKey: string; state: string }): string {
  const url = new URL(TIKTOK_AUTHORIZE_URL);
  url.searchParams.set("client_key", opts.clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", TIKTOK_SCOPES.join(","));
  url.searchParams.set("redirect_uri", TIKTOK_REDIRECT_URI);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("disable_auto_auth", "1");
  return url.toString();
}

type TokenBody = {
  open_id?: string;
  scope?: string;
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
};

function toTokens(body: TokenBody, now: number): TiktokTokens {
  if (!body.access_token || !body.refresh_token || !body.open_id) {
    throw new TransientError("tiktok token response is missing a field");
  }
  return {
    openId: body.open_id,
    scopes: (body.scope ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    accessToken: body.access_token,
    accessExpiresAt: new Date(now + (body.expires_in ?? 86_400) * 1000),
    refreshToken: body.refresh_token,
    refreshExpiresAt: new Date(now + (body.refresh_expires_in ?? 31_536_000) * 1000),
  };
}

export class HttpTiktok implements TiktokProvider {
  // Permanent: a missing credential is a configuration fault no retry fixes.
  private clientKey(): string {
    const key = getEnv().TIKTOK_CLIENT_KEY;
    if (!key) throw new PermanentError("TIKTOK_CLIENT_KEY is not set");
    return key;
  }

  private clientSecret(): string {
    const secret = getEnv().TIKTOK_CLIENT_SECRET;
    if (!secret) throw new PermanentError("TIKTOK_CLIENT_SECRET is not set");
    return secret;
  }

  async exchangeCode(code: string) {
    const body = await this.oauth({
      client_key: this.clientKey(),
      client_secret: this.clientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: TIKTOK_REDIRECT_URI,
    });
    return toTokens(body, Date.now());
  }

  async refresh(refreshToken: string) {
    const body = await this.oauth({
      client_key: this.clientKey(),
      client_secret: this.clientSecret(),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    return toTokens(body, Date.now());
  }

  async userInfo(accessToken: string) {
    const { data } = await this.api<{
      user?: { open_id?: string; display_name?: string; avatar_url?: string };
    }>("GET", "/v2/user/info/?fields=open_id,display_name,avatar_url", accessToken);
    const user = data?.user ?? {};
    if (!user.open_id) throw new TransientError("tiktok user info has no open_id");
    return {
      openId: user.open_id,
      displayName: user.display_name || undefined,
      avatarUrl: user.avatar_url || undefined,
    };
  }

  async initInboxPull(accessToken: string, videoUrl: string) {
    logger.info({ videoUrl: withoutQuery(videoUrl) }, "tiktok inbox pull init");
    const { data, text } = await this.api<{ publish_id?: string }>(
      "POST",
      "/v2/post/publish/inbox/video/init/",
      accessToken,
      { source_info: { source: "PULL_FROM_URL", video_url: videoUrl } },
    );
    const publishId = data?.publish_id ?? rawIdField(text, "publish_id");
    if (!publishId) throw new TransientError("tiktok inbox init returned no publish_id");
    return { publishId };
  }

  async publishStatus(accessToken: string, publishId: string) {
    const { data, text } = await this.api<{ status?: string; fail_reason?: string }>(
      "POST",
      "/v2/post/publish/status/fetch/",
      accessToken,
      { publish_id: publishId },
    );
    const known: TiktokPublishStatusCode[] = [
      "PROCESSING_UPLOAD",
      "PROCESSING_DOWNLOAD",
      "SEND_TO_USER_INBOX",
      "PUBLISH_COMPLETE",
      "FAILED",
    ];
    const code = data?.status;
    if (!code || !known.includes(code as TiktokPublishStatusCode)) {
      // An unknown word is not a verdict; let the poll loop ask again.
      throw new TransientError(`tiktok publish ${publishId} reported status ${code ?? "?"}`);
    }
    return {
      code: code as TiktokPublishStatusCode,
      failReason: data?.fail_reason || undefined,
      postId: rawIdField(text, "publicaly_available_post_id"),
    };
  }

  /** /v2/oauth/token/: a form body; errors are a flat {error, error_description, log_id}. */
  private async oauth(form: Record<string, string>): Promise<TokenBody> {
    const path = "/v2/oauth/token/";
    const { status, json } = await this.fetchJson(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    const flat = (json ?? {}) as TokenBody & {
      error?: string;
      error_description?: string;
      log_id?: string;
      data?: TokenBody;
    };
    // Read by the body, whatever the HTTP status: TikTok states none for these.
    if (typeof flat.error === "string" && flat.error) {
      if (TRANSIENT_CODES.has(flat.error) || status >= 500 || status === 429) {
        throw new TransientError(`tiktok oauth ${status} ${flat.error}`);
      }
      throw new TiktokApiError(status, {
        code: flat.error,
        message: flat.error_description,
        logId: flat.log_id,
      });
    }
    if (status >= 500 || status === 429) throw new TransientError(`tiktok oauth ${status}`);
    if (status >= 400) throw new TiktokApiError(status, { code: `http_${status}` });
    if (json === null) throw new TransientError("tiktok oauth returned no JSON");
    return flat.data ?? flat;
  }

  /** The v2 API: JSON in, {data, error: {code, message, log_id}} out, code "ok" on success. */
  private async api<T>(
    method: "GET" | "POST",
    pathAndQuery: string,
    accessToken: string,
    body?: unknown,
  ): Promise<{ data: T | undefined; text: string }> {
    const path = pathAndQuery.split("?")[0]!;
    const { status, json, text } = await this.fetchJson(pathAndQuery, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json; charset=UTF-8" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = (json ?? {}) as {
      data?: T;
      error?: { code?: string; message?: string; log_id?: string; logid?: string };
    };
    const code = envelope.error?.code;
    if (status >= 200 && status < 300 && (code === undefined || code === "ok")) {
      if (json === null) throw new TransientError(`tiktok ${path} returned no JSON`);
      return { data: envelope.data, text };
    }
    if (status >= 500 || status === 429 || (code !== undefined && TRANSIENT_CODES.has(code))) {
      throw new TransientError(`tiktok ${status} ${code ?? "?"} on ${path}`);
    }
    throw new TiktokApiError(status, {
      code: code ?? `http_${status}`,
      message: envelope.error?.message,
      logId: envelope.error?.log_id ?? envelope.error?.logid,
    });
  }

  private async fetchJson(
    pathAndQuery: string,
    init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
  ): Promise<{ status: number; json: unknown; text: string }> {
    const path = pathAndQuery.split("?")[0]!;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIKTOK_REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${TIKTOK_API_BASE}${pathAndQuery}`, {
        ...init,
        signal: controller.signal,
      });
    } catch (err) {
      throw new TransientError(`tiktok request failed (${init.method} ${path}): ${String(err)}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    logger.info({ method: init.method, path, status: response.status }, "tiktok call");
    return { status: response.status, json, text };
  }
}

// ---------------------------------------------------------------------------
// The webhook signature (webhooks-verification, read 2026-10-16)
// ---------------------------------------------------------------------------

export class TiktokSignatureError extends Error {}

/**
 * How old a signed delivery may be. TikTok retries a delivery for up to 72 h
 * and does not say whether a retry is re-signed, so a tight window would turn
 * every retry away; every write the webhook makes is guarded and monotonic, so
 * a replay inside the window changes nothing (decision 0115).
 */
export const TIKTOK_SIGNATURE_MAX_AGE_SECONDS = 73 * 3600;
/** Clock skew allowed the other way. */
export const TIKTOK_SIGNATURE_MAX_SKEW_SECONDS = 5 * 60;

/**
 * `TikTok-Signature: t=<unix seconds>,s=<hex>`: the HMAC-SHA256 of
 * `"<t>.<raw body>"` under the client secret. Pure, so it is unit-tested with a
 * known secret; the env-reading wrapper below is what the route calls.
 */
export function parseTiktokSignature(opts: {
  header: string | null;
  rawBody: string;
  secret: string;
  nowSeconds: number;
}): { timestamp: number } {
  if (!opts.header) throw new TiktokSignatureError("no TikTok-Signature header");
  const parts = new Map<string, string>();
  for (const element of opts.header.split(",")) {
    const eq = element.indexOf("=");
    if (eq > 0) parts.set(element.slice(0, eq).trim(), element.slice(eq + 1).trim());
  }
  const t = parts.get("t") ?? "";
  const s = parts.get("s") ?? "";
  if (!/^\d+$/.test(t) || !/^[0-9a-fA-F]+$/.test(s)) {
    throw new TiktokSignatureError("TikTok-Signature is malformed");
  }
  const expected = createHmac("sha256", opts.secret).update(`${t}.${opts.rawBody}`).digest();
  const actual = Buffer.from(s, "hex");
  // The length check precedes timingSafeEqual on purpose (it throws on a mismatch).
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new TiktokSignatureError("TikTok-Signature does not verify");
  }
  const timestamp = Number(t);
  const age = opts.nowSeconds - timestamp;
  if (age > TIKTOK_SIGNATURE_MAX_AGE_SECONDS || -age > TIKTOK_SIGNATURE_MAX_SKEW_SECONDS) {
    throw new TiktokSignatureError(`TikTok-Signature timestamp is ${age}s old`);
  }
  return { timestamp };
}

/** The route-facing form: reads the client secret itself so the web never does. */
export function verifyTiktokSignature(
  header: string | null,
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): void {
  const secret = getEnv().TIKTOK_CLIENT_SECRET;
  if (!secret) throw new Error("TIKTOK_CLIENT_SECRET is not set");
  parseTiktokSignature({ header, rawBody, secret, nowSeconds });
}

/**
 * DRY_RUN: a deterministic stand-in so connect → schedule → deliver walks
 * without TikTok. One sample account; every inbox upload lands on its first poll.
 */
export class DryRunTiktok implements TiktokProvider {
  async exchangeCode() {
    return this.tokens();
  }
  async refresh() {
    return this.tokens();
  }
  async userInfo() {
    return { openId: "dry_tiktok_open_id", displayName: "חשבון טיקטוק לדוגמה" };
  }
  async initInboxPull() {
    return { publishId: `v_inbox_dry_${Date.now()}` };
  }
  async publishStatus() {
    return { code: "SEND_TO_USER_INBOX" as const };
  }
  private tokens(): TiktokTokens {
    const now = Date.now();
    return {
      openId: "dry_tiktok_open_id",
      scopes: [...TIKTOK_SCOPES],
      accessToken: "dry_tiktok_access_token",
      accessExpiresAt: new Date(now + 86_400_000),
      refreshToken: "dry_tiktok_refresh_token",
      refreshExpiresAt: new Date(now + 365 * 86_400_000),
    };
  }
}

let override: TiktokProvider | undefined;

/** Test hook (the `setMetaGraphProvider` shape). */
export function setTiktokProvider(provider: TiktokProvider | undefined): void {
  override = provider;
}

export function getTiktokProvider(): TiktokProvider {
  if (override) return override;
  return getEnv().DRY_RUN ? new DryRunTiktok() : new HttpTiktok();
}
