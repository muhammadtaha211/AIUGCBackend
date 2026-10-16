import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../src/config";
import { PermanentError, TransientError } from "../src/jobs/errors";
import { logger } from "../src/logger";
import {
  HttpTiktok,
  isTiktokPendingCap,
  isTiktokTokenLapse,
  parseTiktokSignature,
  rawIdField,
  TIKTOK_API_BASE,
  TIKTOK_REDIRECT_URI,
  TIKTOK_SIGNATURE_MAX_AGE_SECONDS,
  TiktokApiError,
  tiktokAuthorizeUrl,
  TiktokSignatureError,
} from "../src/providers/tiktok";

/**
 * TikTok's contract (read 2026-10-16), pinned without a live call: the
 * authorize link carries exactly the console's redirect and two scopes; the
 * OAuth endpoint is a form POST whose errors are a FLAT body read whatever the
 * HTTP status (`invalid_grant` a lapse — the sandbox → production swap;
 * server_error transient); the inbox init is PULL_FROM_URL with nothing but the
 * source; a 19-digit post id survives as digits; the signature is HMAC-SHA256 of
 * "t.body" under the client secret; no token or signed query reaches a log.
 */
describe("HttpTiktok", () => {
  const fetchMock = vi.fn();
  const provider = new HttpTiktok();

  beforeAll(() => {
    process.env.TIKTOK_CLIENT_KEY = "client_key_1";
    process.env.TIKTOK_CLIENT_SECRET = "client_secret_1";
    resetEnvCache();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => fetchMock.mockReset());

  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.TIKTOK_CLIENT_KEY;
    delete process.env.TIKTOK_CLIENT_SECRET;
    resetEnvCache();
  });

  function response(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  }

  function lastCall(): {
    url: string;
    init: { method: string; headers: Record<string, string>; body?: string };
  } {
    const [url, init] = fetchMock.mock.calls.at(-1)! as [
      string,
      { method: string; headers: Record<string, string>; body?: string },
    ];
    return { url: String(url), init };
  }

  const tokenBody = {
    open_id: "open_1",
    scope: "user.info.basic,video.upload",
    access_token: "act.ACCESS",
    expires_in: 86400,
    refresh_token: "rft.REFRESH",
    refresh_expires_in: 31536000,
    token_type: "Bearer",
  };

  it("builds the authorize link with the console's exact redirect, both scopes, a state and no PKCE", () => {
    const url = new URL(tiktokAuthorizeUrl({ clientKey: "ck", state: "st_1" }));
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_key: "ck",
      response_type: "code",
      scope: "user.info.basic,video.upload",
      redirect_uri: "https://tavnit.ai/api/social/tiktok/callback",
      state: "st_1",
      disable_auto_auth: "1",
    });
    expect(TIKTOK_REDIRECT_URI).toBe("https://tavnit.ai/api/social/tiktok/callback");
  });

  it("exchanges a code by form POST with the constant redirect and reads the granted scopes", async () => {
    fetchMock.mockResolvedValueOnce(response(200, tokenBody));
    const before = Date.now();
    const tokens = await provider.exchangeCode("code_1");
    const { url, init } = lastCall();
    expect(url).toBe(`${TIKTOK_API_BASE}/v2/oauth/token/`);
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      client_key: "client_key_1",
      client_secret: "client_secret_1",
      code: "code_1",
      grant_type: "authorization_code",
      redirect_uri: TIKTOK_REDIRECT_URI,
    });
    expect(tokens).toMatchObject({
      openId: "open_1",
      scopes: ["user.info.basic", "video.upload"],
      accessToken: "act.ACCESS",
      refreshToken: "rft.REFRESH",
    });
    expect(tokens.accessExpiresAt.getTime()).toBeGreaterThanOrEqual(before + 86_400_000);
    expect(tokens.refreshExpiresAt.getTime()).toBeGreaterThanOrEqual(before + 31_536_000_000);
  });

  it("refreshes with the refresh token and returns the one TikTok sent back (rotation)", async () => {
    fetchMock.mockResolvedValueOnce(response(200, { ...tokenBody, refresh_token: "rft.ROTATED" }));
    const tokens = await provider.refresh("rft.OLD");
    expect(Object.fromEntries(new URLSearchParams(lastCall().init.body))).toEqual({
      client_key: "client_key_1",
      client_secret: "client_secret_1",
      grant_type: "refresh_token",
      refresh_token: "rft.OLD",
    });
    expect(tokens.refreshToken).toBe("rft.ROTATED");
  });

  it("reads OAuth errors from the flat body whatever the status: invalid_grant is a lapse, at 200 and at 400", async () => {
    for (const status of [200, 400]) {
      fetchMock.mockResolvedValueOnce(
        response(status, {
          error: "invalid_grant",
          error_description: "Refresh token is invalid or expired.",
          log_id: "log_1",
        }),
      );
      const err = await provider.refresh("rft.SANDBOX").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TiktokApiError);
      expect((err as TiktokApiError).code).toBe("invalid_grant");
      expect(isTiktokTokenLapse(err)).toBe(true);
    }
  });

  it("treats server_error, temporarily_unavailable, 5xx and 429 on the OAuth endpoint as transient", async () => {
    fetchMock.mockResolvedValueOnce(response(200, { error: "server_error" }));
    await expect(provider.refresh("r")).rejects.toBeInstanceOf(TransientError);
    fetchMock.mockResolvedValueOnce(response(400, { error: "temporarily_unavailable" }));
    await expect(provider.refresh("r")).rejects.toBeInstanceOf(TransientError);
    fetchMock.mockResolvedValueOnce(response(503, "upstream"));
    await expect(provider.refresh("r")).rejects.toBeInstanceOf(TransientError);
    fetchMock.mockResolvedValueOnce(response(429, {}));
    await expect(provider.refresh("r")).rejects.toBeInstanceOf(TransientError);
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(provider.refresh("r")).rejects.toBeInstanceOf(TransientError);
  });

  it("an OAuth refusal that is not a lapse is permanent but leaves the connection alone", async () => {
    fetchMock.mockResolvedValueOnce(response(400, { error: "invalid_request" }));
    const err = await provider.exchangeCode("c").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TiktokApiError);
    expect(isTiktokTokenLapse(err)).toBe(false);
  });

  it("asks user info for open_id, display_name and avatar_url with a Bearer token", async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, {
        data: {
          user: { open_id: "open_1", display_name: "תבנית", avatar_url: "https://p16/a.jpg" },
        },
        error: { code: "ok", message: "", log_id: "l" },
      }),
    );
    const profile = await provider.userInfo("act.ACCESS");
    const { url, init } = lastCall();
    expect(url).toBe(`${TIKTOK_API_BASE}/v2/user/info/?fields=open_id,display_name,avatar_url`);
    expect(init.method).toBe("GET");
    expect(init.headers.authorization).toBe("Bearer act.ACCESS");
    expect(profile).toEqual({
      openId: "open_1",
      displayName: "תבנית",
      avatarUrl: "https://p16/a.jpg",
    });
  });

  it("initiates the inbox upload by PULL_FROM_URL with nothing but the source — no caption, no sound, no label", async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, {
        data: { publish_id: "v_inbox_url~v2.123456789" },
        error: { code: "ok", message: "", log_id: "l" },
      }),
    );
    const video =
      "https://auth.tavnit.ai/storage/v1/object/sign/renders/b/video/r/final.mp4?token=SECRET";
    const { publishId } = await provider.initInboxPull("act.ACCESS", video);
    const { url, init } = lastCall();
    expect(url).toBe(`${TIKTOK_API_BASE}/v2/post/publish/inbox/video/init/`);
    expect(init.headers.authorization).toBe("Bearer act.ACCESS");
    expect(init.headers["content-type"]).toBe("application/json; charset=UTF-8");
    expect(JSON.parse(init.body!)).toEqual({
      source_info: { source: "PULL_FROM_URL", video_url: video },
    });
    expect(publishId).toBe("v_inbox_url~v2.123456789");
  });

  it("maps the init refusals: the pending cap, a lapsed token, an unverified URL, the rate limit", async () => {
    fetchMock.mockResolvedValueOnce(
      response(403, { error: { code: "spam_risk_too_many_pending_share", message: "cap" } }),
    );
    const cap = await provider.initInboxPull("a", "https://x/y").catch((e: unknown) => e);
    expect(isTiktokPendingCap(cap)).toBe(true);
    expect(isTiktokTokenLapse(cap)).toBe(false);

    fetchMock.mockResolvedValueOnce(response(401, { error: { code: "access_token_invalid" } }));
    expect(
      isTiktokTokenLapse(await provider.initInboxPull("a", "u").catch((e: unknown) => e)),
    ).toBe(true);

    fetchMock.mockResolvedValueOnce(
      response(403, { error: { code: "url_ownership_unverified", message: "verify" } }),
    );
    const unverified = await provider.initInboxPull("a", "u").catch((e: unknown) => e);
    expect(unverified).toBeInstanceOf(TiktokApiError);
    expect((unverified as TiktokApiError).code).toBe("url_ownership_unverified");
    expect(isTiktokTokenLapse(unverified)).toBe(false);

    fetchMock.mockResolvedValueOnce(response(429, { error: { code: "rate_limit_exceeded" } }));
    await expect(provider.initInboxPull("a", "u")).rejects.toBeInstanceOf(TransientError);
    fetchMock.mockResolvedValueOnce(response(500, { error: { code: "internal_error" } }));
    await expect(provider.initInboxPull("a", "u")).rejects.toBeInstanceOf(TransientError);
  });

  it("reads the publish status, keeps a bare 19-digit post id as its exact digits, and calls an unknown status transient", async () => {
    fetchMock.mockResolvedValueOnce(
      response(
        200,
        '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7300000000000000123],"uploaded_bytes":0},"error":{"code":"ok","message":"","log_id":"l"}}',
      ),
    );
    const status = await provider.publishStatus("act.ACCESS", "v_inbox_url~v2.1");
    expect(JSON.parse(lastCall().init.body!)).toEqual({ publish_id: "v_inbox_url~v2.1" });
    expect(status).toEqual({
      code: "PUBLISH_COMPLETE",
      failReason: undefined,
      postId: "7300000000000000123",
    });

    fetchMock.mockResolvedValueOnce(
      response(200, {
        data: { status: "FAILED", fail_reason: "video_pull_failed" },
        error: { code: "ok" },
      }),
    );
    expect(await provider.publishStatus("a", "p")).toMatchObject({
      code: "FAILED",
      failReason: "video_pull_failed",
    });

    fetchMock.mockResolvedValueOnce(
      response(200, { data: { status: "SOMETHING_NEW" }, error: { code: "ok" } }),
    );
    await expect(provider.publishStatus("a", "p")).rejects.toBeInstanceOf(TransientError);
  });

  it("logs method, path and status only — never a token, a code or the signed URL's query", async () => {
    const info = vi.spyOn(logger, "info");
    fetchMock.mockResolvedValueOnce(response(200, tokenBody));
    await provider.exchangeCode("CODE_SECRET");
    fetchMock.mockResolvedValueOnce(
      response(200, { data: { publish_id: "p" }, error: { code: "ok" } }),
    );
    await provider.initInboxPull("act.ACCESS", "https://auth.tavnit.ai/x.mp4?token=SIGNED_SECRET");
    const logged = JSON.stringify(info.mock.calls);
    info.mockRestore();
    for (const secret of [
      "CODE_SECRET",
      "client_secret_1",
      "act.ACCESS",
      "SIGNED_SECRET",
      "rft.REFRESH",
    ]) {
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain("x.mp4?<signed>");
  });

  it("throws a permanent error at use, not at boot, when a credential is missing", async () => {
    delete process.env.TIKTOK_CLIENT_SECRET;
    resetEnvCache();
    await expect(new HttpTiktok().refresh("r")).rejects.toBeInstanceOf(PermanentError);
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.TIKTOK_CLIENT_SECRET = "client_secret_1";
    resetEnvCache();
  });
});

describe("rawIdField", () => {
  it("reads quoted, bare, listed and escaped ids as exact digits", () => {
    expect(rawIdField('{"post_id":7300000000000000123}', "post_id")).toBe("7300000000000000123");
    expect(rawIdField('{"post_id": "7300000000000000124"}', "post_id")).toBe("7300000000000000124");
    expect(
      rawIdField(
        '{"publicaly_available_post_id":[ 7300000000000000125 ]}',
        "publicaly_available_post_id",
      ),
    ).toBe("7300000000000000125");
    // A webhook's `content` is a JSON string inside the JSON: its quotes arrive escaped.
    const inner = '{"publish_id":"v_inbox_file~v2.1","post_id":7300000000000000126}';
    expect(rawIdField(JSON.stringify({ content: inner }), "post_id")).toBe("7300000000000000126");
    expect(rawIdField('{"publish_id":"x"}', "post_id")).toBeUndefined();
    // The digits a JS number would have kept are not these.
    expect(String(JSON.parse(inner).post_id)).not.toBe("7300000000000000126");
  });
});

describe("parseTiktokSignature", () => {
  const secret = "client_secret_1";
  const body =
    '{"client_key":"ck","event":"post.publish.complete","create_time":1700000000,"user_openid":"o","content":"{\\"publish_id\\":\\"p\\"}"}';
  const now = 1_700_000_100;
  const sign = (t: number, payload = body, key = secret) =>
    `t=${t},s=${createHmac("sha256", key).update(`${t}.${payload}`).digest("hex")}`;

  it("verifies TikTok's scheme: HMAC-SHA256 of 't.body' under the client secret, hex", () => {
    expect(
      parseTiktokSignature({ header: sign(now - 10), rawBody: body, secret, nowSeconds: now }),
    ).toEqual({
      timestamp: now - 10,
    });
  });

  it("refuses a missing or malformed header, another secret, and a body changed by one byte", () => {
    const bad =
      (header: string | null, rawBody = body) =>
      () =>
        parseTiktokSignature({ header, rawBody, secret, nowSeconds: now });
    expect(bad(null)).toThrow(TiktokSignatureError);
    expect(bad("t=abc,s=00")).toThrow(TiktokSignatureError);
    expect(bad(`t=${now},s=zz`)).toThrow(TiktokSignatureError);
    expect(bad(sign(now, body, "another_secret"))).toThrow(TiktokSignatureError);
    expect(bad(sign(now), body.replace("complete", "complete "))).toThrow(TiktokSignatureError);
    expect(bad(`t=${now},s=${"ab".repeat(16)}`)).toThrow(TiktokSignatureError);
  });

  it("accepts a retry up to 73 hours old, refuses older, and refuses more than 5 minutes ahead", () => {
    const at = (t: number) => () =>
      parseTiktokSignature({ header: sign(t), rawBody: body, secret, nowSeconds: now });
    expect(at(now - TIKTOK_SIGNATURE_MAX_AGE_SECONDS)).not.toThrow();
    expect(at(now - TIKTOK_SIGNATURE_MAX_AGE_SECONDS - 1)).toThrow(TiktokSignatureError);
    expect(at(now + 300)).not.toThrow();
    expect(at(now + 301)).toThrow(TiktokSignatureError);
  });
});

describe("TiktokApiError", () => {
  it("keeps a signed URL's path and drops its token when TikTok echoes it", () => {
    const err = new TiktokApiError(403, {
      code: "url_ownership_unverified",
      message:
        "cannot pull https://auth.tavnit.ai/storage/v1/object/sign/renders/x/final.mp4?token=SIGNED_SECRET",
    });
    expect(err.message).toContain("final.mp4?<signed>");
    expect(err.message).not.toContain("SIGNED_SECRET");
  });
});
