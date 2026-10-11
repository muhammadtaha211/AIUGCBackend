import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "../config";
import { PermanentError, TransientError } from "../jobs/errors";
import { logger } from "../logger";

/**
 * Meta's Graph API for the Instagram API with Facebook Login (decision 0101):
 * the code exchange, the Page → Instagram account lookup, the Audio API search,
 * the Reel container → status → publish chain, and the data-deletion signature.
 * Polling, not webhooks, like every other provider here. No cost, so no
 * usage_events row — the caps are for paid providers (docs/05-billing.md).
 *
 * Every call made WITH a token carries it in the Authorization header, never in
 * a URL, with `appsecret_proof` (the HMAC of the token under the app secret)
 * beside it, so the app's "Require App Secret" setting can stay on. The one
 * exception is Meta's documented `GET /oauth/access_token`, whose client_secret,
 * code and fb_exchange_token ride the query string — which is why `request()`
 * logs the path and status only and never the URL. Meta's own error text is
 * scrubbed of signed URLs before it is kept anywhere (its media-fetch refusals
 * echo the submitted video_url); a signed URL in our own log goes through
 * `withoutQuery` (the lipsync wrapper's pattern).
 *
 * Doc facts this encodes were read live on 2026-10-10 (the plan's §3): the
 * audio search is a ROOT edge taking `user_id` and `search_query`; the mix is
 * `audio_configuration={audio_id, audio_volume, video_volume}`; the AI label is
 * `is_ai_generated`; a container reports IN_PROGRESS | FINISHED | PUBLISHED |
 * ERROR | EXPIRED with the error subcode in `status`; containers expire after
 * 24 hours; `content_publishing_limit` reads the account's daily quota.
 */

export const GRAPH_VERSION = "v26.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const FACEBOOK_OAUTH_DIALOG = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

/** The permissions the "Manage messaging & content on Instagram" use case bundles. */
export const INSTAGRAM_SCOPES = [
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
  "pages_read_engagement",
  "pages_show_list",
] as const;

/** One HTTP round trip; the job queue owns retries (TransientError → backoff). */
export const META_REQUEST_TIMEOUT_MS = 20_000;

export type AudioKind = "original_sound" | "music";

export interface MetaAudioItem {
  audioId: string;
  kind: AudioKind;
  title: string;
  /** ig_username for an original sound, display_artist for music. */
  creator?: string;
  durationMs?: number;
  pictureUrl?: string;
  /** on_platform_audio_preview_link or download_url — whichever Meta returned. */
  previewUrl?: string;
}

export interface MetaInstagramProfile {
  id: string;
  username?: string;
  name?: string;
  pictureUrl?: string;
}

export interface MetaPageWithInstagram {
  pageId: string;
  pageName: string;
  /** The Page token: Meta documents no expiry for one derived from a long-lived User token. */
  pageToken: string;
  instagram: MetaInstagramProfile;
}

export type ContainerStatusCode = "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED";

export interface ContainerStatus {
  code: ContainerStatusCode;
  /** The container's `status` field — the error subcode when code is ERROR. */
  detail?: string;
}

export interface ReelContainerInput {
  igUserId: string;
  token: string;
  /** A signed URL minted at post time; Meta downloads it once. */
  videoUrl: string;
  caption: string;
  audio?: { audioId: string; audioVolume: number; videoVolume: number };
  aiGenerated: boolean;
  shareToFeed: boolean;
}

export interface MetaGraphProvider {
  exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string; expiresInSeconds?: number }>;
  exchangeLongLived(
    shortLivedToken: string,
  ): Promise<{ accessToken: string; expiresInSeconds?: number }>;
  /** The Facebook user behind a User token — the id the deletion callback names. */
  me(token: string): Promise<{ id: string }>;
  /** Every Page the user manages that carries an Instagram professional account. */
  pagesWithInstagram(token: string): Promise<MetaPageWithInstagram[]>;
  instagramUser(igUserId: string, token: string): Promise<MetaInstagramProfile>;
  searchAudio(opts: {
    igUserId: string;
    token: string;
    kind: AudioKind;
    query?: string;
    after?: string;
  }): Promise<{ items: MetaAudioItem[]; after?: string }>;
  publishingLimit(igUserId: string, token: string): Promise<{ usage: number; total: number }>;
  createReelContainer(input: ReelContainerInput): Promise<{ containerId: string }>;
  containerStatus(containerId: string, token: string): Promise<ContainerStatus>;
  publish(igUserId: string, containerId: string, token: string): Promise<{ mediaId: string }>;
  mediaPermalink(mediaId: string, token: string): Promise<string | undefined>;
}

/**
 * A Graph API refusal (any non-2xx that is not a 5xx/429): permanent for the
 * job queue, typed so the pipeline can tell a lapsed token from a refused post.
 * The message never carries a token — only Meta's own error text and codes.
 */
export class MetaGraphError extends PermanentError {
  readonly httpStatus: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly metaMessage: string;

  constructor(
    httpStatus: number,
    meta: { message?: string; code?: number; error_subcode?: number },
  ) {
    super(
      `meta graph ${httpStatus} code ${meta.code ?? "?"}${
        meta.error_subcode ? `/${meta.error_subcode}` : ""
      }: ${(meta.message ?? "").slice(0, 300)}`,
    );
    this.httpStatus = httpStatus;
    this.code = meta.code;
    this.subcode = meta.error_subcode;
    this.metaMessage = meta.message ?? "";
  }
}

/**
 * Meta's "the token no longer works" family (error-handling guide, read
 * 2026-10-10): code 190 — whose subcodes include 458/460/463/467 and 492 (the
 * user lost their role on the Page) — code 102, and codes 200–299 (a permission
 * was removed). Anything else is a refusal of the request, not of the
 * connection.
 */
export function isTokenLapse(err: unknown): boolean {
  if (!(err instanceof MetaGraphError)) return false;
  const code = err.code ?? -1;
  // Not code 10: Meta also uses it for "the app lacks this capability", which
  // a reconnect would not change — that is a refusal of the post, not a lapse.
  return code === 190 || code === 102 || (code >= 200 && code <= 299);
}

/** Meta's error text can echo a submitted signed URL; keep the path, drop the token. */
export function scrubSignedUrls(text: string): string {
  return text.replace(/(https?:\/\/[^\s?"'<>]+)\?[^\s"'<>]*/g, "$1?<signed>");
}

/** Meta's transient family: rate limits and "please retry" codes. */
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 80001, 80002]);

/** Inputs are signed URLs — the path is useful in a log, the token is not. */
function withoutQuery(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : `${url.slice(0, q)}?<signed>`;
}

type Params = Record<string, string | undefined>;

export class HttpMetaGraph implements MetaGraphProvider {
  // Permanent: a missing credential is a configuration fault no retry fixes, so
  // a job fails on its first attempt with the real message on last_error.
  private appId(): string {
    const id = getEnv().META_APP_ID;
    if (!id) throw new PermanentError("META_APP_ID is not set");
    return id;
  }

  private appSecret(): string {
    const secret = getEnv().META_APP_SECRET;
    if (!secret) throw new PermanentError("META_APP_SECRET is not set");
    return secret;
  }

  async exchangeCode(code: string, redirectUri: string) {
    const json = await this.request<{ access_token: string; expires_in?: number }>(
      "/oauth/access_token",
      {
        method: "GET",
        params: {
          client_id: this.appId(),
          client_secret: this.appSecret(),
          redirect_uri: redirectUri,
          code,
        },
      },
    );
    return { accessToken: json.access_token, expiresInSeconds: json.expires_in };
  }

  async exchangeLongLived(shortLivedToken: string) {
    const json = await this.request<{ access_token: string; expires_in?: number }>(
      "/oauth/access_token",
      {
        method: "GET",
        params: {
          grant_type: "fb_exchange_token",
          client_id: this.appId(),
          client_secret: this.appSecret(),
          fb_exchange_token: shortLivedToken,
        },
      },
    );
    return { accessToken: json.access_token, expiresInSeconds: json.expires_in };
  }

  async me(token: string) {
    const json = await this.request<{ id: string }>("/me", {
      method: "GET",
      token,
      params: { fields: "id" },
    });
    return { id: json.id };
  }

  /**
   * `longLivedUserToken`: the Page tokens this returns inherit the lifetime of
   * the User token used to fetch them — only the long-lived one yields Page
   * tokens with no expiry (Meta's Page token docs). Call exchangeLongLived first.
   */
  async pagesWithInstagram(longLivedUserToken: string) {
    const token = longLivedUserToken;
    type PageRow = {
      id: string;
      name: string;
      access_token: string;
      instagram_business_account?: {
        id: string;
        username?: string;
        name?: string;
        profile_picture_url?: string;
      };
    };
    const json = await this.request<{ data: PageRow[] }>("/me/accounts", {
      method: "GET",
      token,
      params: {
        fields:
          "id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}",
        limit: "100",
      },
    });
    return (json.data ?? [])
      .filter((page) => page.instagram_business_account?.id && page.access_token)
      .map((page) => ({
        pageId: page.id,
        pageName: page.name,
        pageToken: page.access_token,
        instagram: {
          id: page.instagram_business_account!.id,
          username: page.instagram_business_account!.username,
          name: page.instagram_business_account!.name,
          pictureUrl: page.instagram_business_account!.profile_picture_url,
        },
      }));
  }

  async instagramUser(igUserId: string, token: string) {
    const json = await this.request<{
      id: string;
      username?: string;
      name?: string;
      profile_picture_url?: string;
    }>(`/${igUserId}`, {
      method: "GET",
      token,
      params: { fields: "id,username,name,profile_picture_url" },
    });
    return {
      id: json.id,
      username: json.username,
      name: json.name,
      pictureUrl: json.profile_picture_url,
    };
  }

  async searchAudio(opts: {
    igUserId: string;
    token: string;
    kind: AudioKind;
    query?: string;
    after?: string;
  }) {
    type AudioRow = Record<string, unknown> & { audio_id: string; title?: string };
    const json = await this.request<{
      audio?: AudioRow[];
      data?: AudioRow[];
      paging?: { cursors?: { after?: string }; next?: string };
    }>("/ig_audio", {
      method: "GET",
      token: opts.token,
      params: {
        audio_type: opts.kind,
        user_id: opts.igUserId,
        search_query: opts.query?.trim() || undefined,
        after: opts.after,
      },
    });
    const rows = json.audio ?? json.data ?? [];
    const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    const num = (v: unknown) => (typeof v === "number" ? v : undefined);
    return {
      items: rows.map((row) => ({
        audioId: String(row.audio_id),
        kind: opts.kind,
        title: str(row.title) ?? "",
        creator: str(row.ig_username) ?? str(row.display_artist) ?? str(row.artist),
        durationMs: num(row.duration_in_ms),
        // The doc page is inconsistent about the cover key; read every spelling seen.
        pictureUrl:
          str(row.cover_artwork_uri) ??
          str(row.cover_artwork_url) ??
          str(row.thumbnail_url) ??
          str(row.image_url),
        previewUrl: str(row.on_platform_audio_preview_link) ?? str(row.download_url),
      })),
      // Only when Meta paged — the plan's picker hides "עוד תוצאות" otherwise.
      after: json.paging?.next ? json.paging.cursors?.after : undefined,
    };
  }

  async publishingLimit(igUserId: string, token: string) {
    const json = await this.request<{
      data?: { quota_usage?: number; config?: { quota_total?: number } }[];
    }>(`/${igUserId}/content_publishing_limit`, {
      method: "GET",
      token,
      params: { fields: "quota_usage,config" },
    });
    const row = json.data?.[0];
    // The docs disagree (100 vs 50 per 24 h); 50 is the safe figure when the
    // response names none.
    return { usage: row?.quota_usage ?? 0, total: row?.config?.quota_total ?? 50 };
  }

  async createReelContainer(input: ReelContainerInput) {
    const body: Params = {
      media_type: "REELS",
      video_url: input.videoUrl,
      caption: input.caption,
      share_to_feed: input.shareToFeed ? "true" : "false",
      ...(input.aiGenerated ? { is_ai_generated: "true" } : {}),
      ...(input.audio
        ? {
            audio_configuration: JSON.stringify({
              audio_id: input.audio.audioId,
              audio_volume: input.audio.audioVolume,
              video_volume: input.audio.videoVolume,
            }),
          }
        : {}),
    };
    logger.info(
      {
        igUserId: input.igUserId,
        videoUrl: withoutQuery(input.videoUrl),
        audioId: input.audio?.audioId,
        aiGenerated: input.aiGenerated,
        shareToFeed: input.shareToFeed,
        captionChars: input.caption.length,
      },
      "meta reel container create",
    );
    const json = await this.request<{ id: string }>(`/${input.igUserId}/media`, {
      method: "POST",
      token: input.token,
      body,
    });
    return { containerId: json.id };
  }

  async containerStatus(containerId: string, token: string) {
    const json = await this.request<{ status_code?: string; status?: string }>(`/${containerId}`, {
      method: "GET",
      token,
      params: { fields: "status_code,status" },
    });
    const code = json.status_code;
    const known: ContainerStatusCode[] = [
      "IN_PROGRESS",
      "FINISHED",
      "PUBLISHED",
      "ERROR",
      "EXPIRED",
    ];
    if (!code || !known.includes(code as ContainerStatusCode)) {
      // An unknown word is not a verdict; let the poll loop ask again.
      throw new TransientError(`meta container ${containerId} reported status_code ${code ?? "?"}`);
    }
    return { code: code as ContainerStatusCode, detail: json.status };
  }

  async publish(igUserId: string, containerId: string, token: string) {
    const json = await this.request<{ id: string }>(`/${igUserId}/media_publish`, {
      method: "POST",
      token,
      body: { creation_id: containerId },
    });
    return { mediaId: json.id };
  }

  async mediaPermalink(mediaId: string, token: string) {
    const json = await this.request<{ permalink?: string }>(`/${mediaId}`, {
      method: "GET",
      token,
      params: { fields: "permalink" },
    });
    return json.permalink;
  }

  private async request<T>(
    path: string,
    opts: { method: "GET" | "POST"; token?: string; params?: Params; body?: Params },
  ): Promise<T> {
    const url = new URL(`${GRAPH_BASE}${path}`);
    for (const [k, v] of Object.entries(opts.params ?? {})) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
    const headers: Record<string, string> = {};
    if (opts.token) {
      headers.authorization = `Bearer ${opts.token}`;
      url.searchParams.set("appsecret_proof", appSecretProof(opts.token, this.appSecret()));
    }
    let bodyText: string | undefined;
    if (opts.body) {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.body)) if (v !== undefined) form.set(k, v);
      bodyText = form.toString();
      headers["content-type"] = "application/x-www-form-urlencoded";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), META_REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: opts.method,
        headers,
        body: bodyText,
        signal: controller.signal,
      });
    } catch (err) {
      throw new TransientError(
        `meta graph request failed (${opts.method} ${path}): ${String(err)}`,
      );
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
    logger.info({ method: opts.method, path, status: response.status }, "meta graph call");

    if (!response.ok) {
      const raw = ((json as { error?: Record<string, unknown> } | null)?.error ?? {}) as {
        message?: string;
        code?: number;
        error_subcode?: number;
      };
      // Meta's text may echo the signed video_url it could not fetch.
      const meta = { ...raw, message: scrubSignedUrls(raw.message ?? "") };
      if (
        response.status >= 500 ||
        response.status === 429 ||
        (meta.code !== undefined && TRANSIENT_CODES.has(meta.code))
      ) {
        throw new TransientError(
          `meta graph ${response.status} code ${meta.code ?? "?"}: ${meta.message.slice(0, 300)}`,
        );
      }
      throw new MetaGraphError(response.status, meta);
    }
    if (json === null) throw new TransientError(`meta graph ${path} returned no JSON`);
    return json as T;
  }
}

/** HMAC-SHA256 of the access token under the app secret, hex — Meta's appsecret_proof. */
export function appSecretProof(token: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

export class SignedRequestError extends Error {}

/**
 * Meta's `signed_request` (the data-deletion callback): `<sig>.<payload>`, both
 * base64url, the signature an HMAC-SHA256 of the encoded payload under the app
 * secret. Pure, so it is unit-tested with a known secret; the env-reading
 * wrapper below is what a route calls.
 */
export function parseSignedRequest(
  signedRequest: string,
  appSecret: string,
): { userId: string; algorithm: string; issuedAt?: number } {
  const dot = signedRequest.indexOf(".");
  if (dot <= 0) throw new SignedRequestError("signed_request has no signature");
  const encodedSig = signedRequest.slice(0, dot);
  const encodedPayload = signedRequest.slice(dot + 1);
  const expected = createHmac("sha256", appSecret).update(encodedPayload).digest();
  // Buffer.from never throws on bad characters (it skips them); the length check
  // below is the real guard, and it precedes timingSafeEqual on purpose.
  const actual = Buffer.from(encodedSig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new SignedRequestError("signed_request signature does not verify");
  }
  let payload: { user_id?: string; algorithm?: string; issued_at?: number };
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new SignedRequestError("signed_request payload is not JSON");
  }
  if (!payload.user_id) throw new SignedRequestError("signed_request names no user");
  if ((payload.algorithm ?? "").toUpperCase() !== "HMAC-SHA256") {
    throw new SignedRequestError(
      `signed_request algorithm ${payload.algorithm ?? "?"} is not HMAC-SHA256`,
    );
  }
  return { userId: String(payload.user_id), algorithm: "HMAC-SHA256", issuedAt: payload.issued_at };
}

/** The route-facing form: reads the app secret itself so the web never does. */
export function verifyMetaSignedRequest(signedRequest: string): { userId: string } {
  const secret = getEnv().META_APP_SECRET;
  if (!secret) throw new Error("META_APP_SECRET is not set");
  return { userId: parseSignedRequest(signedRequest, secret).userId };
}

/**
 * DRY_RUN: a deterministic stand-in so the whole flow — connect, pick a sound,
 * schedule, publish — walks without Meta. One sample Page with one Instagram
 * account, three canned sounds, a container that is FINISHED on its first poll.
 */
export class DryRunMetaGraph implements MetaGraphProvider {
  async exchangeCode() {
    return { accessToken: "dry_short_lived_token", expiresInSeconds: 3600 };
  }
  async exchangeLongLived() {
    return { accessToken: "dry_user_token", expiresInSeconds: 60 * 24 * 3600 };
  }
  async me() {
    return { id: "dry_fb_user" };
  }
  async pagesWithInstagram() {
    return [
      {
        pageId: "dry_page_1",
        pageName: "עמוד לדוגמה",
        pageToken: "dry_page_token_1",
        instagram: { id: "dry_ig_1", username: "tavnit.sample", name: "חשבון לדוגמה" },
      },
    ];
  }
  async instagramUser(igUserId: string) {
    return { id: igUserId, username: "tavnit.sample", name: "חשבון לדוגמה" };
  }
  async searchAudio(opts: { kind: AudioKind; query?: string }) {
    const items: MetaAudioItem[] =
      opts.kind === "original_sound"
        ? [
            {
              audioId: "dry_audio_1",
              kind: opts.kind,
              title: "Original sound",
              creator: "someone",
              durationMs: 15_000,
            },
            {
              audioId: "dry_audio_2",
              kind: opts.kind,
              title: "Trending clip",
              creator: "another",
              durationMs: 30_000,
            },
          ]
        : [
            {
              audioId: "dry_music_1",
              kind: opts.kind,
              title: "Library track",
              creator: "Artist",
              durationMs: 60_000,
            },
          ];
    const q = opts.query?.trim().toLowerCase();
    return { items: q ? items.filter((i) => i.title.toLowerCase().includes(q)) : items };
  }
  async publishingLimit() {
    return { usage: 0, total: 50 };
  }
  async createReelContainer() {
    return { containerId: `dry_container_${Date.now()}` };
  }
  async containerStatus() {
    return { code: "FINISHED" as const };
  }
  async publish() {
    return { mediaId: `dry_media_${Date.now()}` };
  }
  async mediaPermalink(mediaId: string) {
    // A non-routable scheme, like `dryrun://lipsync/…`: a stub result must
    // never pass for a live one.
    return `dryrun://instagram/reel/${mediaId}`;
  }
}

let override: MetaGraphProvider | undefined;

/** Test hook (same shape as `setStorage`): the failure paths DRY_RUN can't reach. */
export function setMetaGraphProvider(provider: MetaGraphProvider | undefined): void {
  override = provider;
}

export function getMetaGraphProvider(): MetaGraphProvider {
  if (override) return override;
  return getEnv().DRY_RUN ? new DryRunMetaGraph() : new HttpMetaGraph();
}
