import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../src/config";
import { TransientError } from "../src/jobs/errors";
import {
  appSecretProof,
  GRAPH_BASE,
  HttpMetaGraph,
  isTokenLapse,
  MetaGraphError,
  parseSignedRequest,
  scrubSignedUrls,
  SignedRequestError,
} from "../src/providers/meta-graph";

/**
 * The Graph API contract, pinned without a live call: the token travels in the
 * Authorization header with appsecret_proof beside it and never in the URL;
 * the audio search is the ROOT edge with user_id and search_query; the Reel
 * container carries audio_configuration as JSON, is_ai_generated only when
 * true, share_to_feed always; and the error taxonomy (5xx/429 → Transient,
 * 4xx → MetaGraphError, code 190 → a lapsed token).
 */
describe("HttpMetaGraph", () => {
  const fetchMock = vi.fn();
  const provider = new HttpMetaGraph();

  beforeAll(() => {
    process.env.META_APP_ID = "app_1";
    process.env.META_APP_SECRET = "app_secret";
    resetEnvCache();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => fetchMock.mockReset());

  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    resetEnvCache();
  });

  function response(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  }

  function lastCall(): {
    url: URL;
    init: { method: string; headers: Record<string, string>; body?: string };
  } {
    const [url, init] = fetchMock.mock.calls.at(-1)! as [
      URL,
      { method: string; headers: Record<string, string>; body?: string },
    ];
    return { url: url instanceof URL ? url : new URL(String(url)), init };
  }

  it("sends the token as a Bearer header plus appsecret_proof, never as a query parameter", async () => {
    fetchMock.mockResolvedValueOnce(response(200, { id: "17841400000000000", username: "tavnit" }));
    await provider.instagramUser("17841400000000000", "TOKEN123");
    const { url, init } = lastCall();
    expect(url.origin + url.pathname).toBe(`${GRAPH_BASE}/17841400000000000`);
    expect(init.headers.authorization).toBe("Bearer TOKEN123");
    expect(url.searchParams.get("access_token")).toBeNull();
    expect(url.searchParams.get("appsecret_proof")).toBe(appSecretProof("TOKEN123", "app_secret"));
    expect(url.searchParams.get("fields")).toBe("id,username,name,profile_picture_url");
  });

  it("searches audio on the root edge with user_id and search_query, one kind per call, and maps the rows", async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, {
        audio: [
          {
            audio_id: "587784541076604",
            title: "Trending sound",
            duration_in_ms: 15000,
            ig_username: "someone",
            on_platform_audio_preview_link: "https://ig.example/preview.mp3",
          },
        ],
        paging: { cursors: { after: "CURSOR" }, next: "https://graph.facebook.com/next" },
      }),
    );
    const result = await provider.searchAudio({
      igUserId: "17841400000000000",
      token: "T",
      kind: "original_sound",
      query: "קיץ",
    });
    const { url } = lastCall();
    expect(url.pathname).toBe("/v26.0/ig_audio");
    expect(url.searchParams.get("audio_type")).toBe("original_sound");
    expect(url.searchParams.get("user_id")).toBe("17841400000000000");
    expect(url.searchParams.get("search_query")).toBe("קיץ");
    expect(result.after).toBe("CURSOR");
    expect(result.items).toEqual([
      {
        audioId: "587784541076604",
        kind: "original_sound",
        title: "Trending sound",
        creator: "someone",
        durationMs: 15000,
        pictureUrl: undefined,
        previewUrl: "https://ig.example/preview.mp3",
      },
    ]);
  });

  it("omits search_query when empty (trending) and reports no cursor when Meta did not page", async () => {
    fetchMock.mockResolvedValueOnce(response(200, { audio: [] }));
    const result = await provider.searchAudio({
      igUserId: "1",
      token: "T",
      kind: "music",
      query: "  ",
    });
    expect(lastCall().url.searchParams.has("search_query")).toBe(false);
    expect(result.after).toBeUndefined();
  });

  it("creates a REELS container with audio_configuration as JSON, is_ai_generated only when true, share_to_feed always", async () => {
    fetchMock.mockResolvedValueOnce(response(200, { id: "container_1" }));
    const { containerId } = await provider.createReelContainer({
      igUserId: "17841400000000000",
      token: "T",
      videoUrl: "https://storage.example/renders/a.mp4?token=secret",
      caption: "כיתוב",
      audio: { audioId: "587784541076604", audioVolume: 15, videoVolume: 100 },
      aiGenerated: true,
      shareToFeed: true,
    });
    expect(containerId).toBe("container_1");
    const { url, init } = lastCall();
    expect(url.pathname).toBe("/v26.0/17841400000000000/media");
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(init.body!);
    expect(body.get("media_type")).toBe("REELS");
    expect(body.get("video_url")).toBe("https://storage.example/renders/a.mp4?token=secret");
    expect(body.get("caption")).toBe("כיתוב");
    expect(body.get("share_to_feed")).toBe("true");
    expect(body.get("is_ai_generated")).toBe("true");
    expect(JSON.parse(body.get("audio_configuration")!)).toEqual({
      audio_id: "587784541076604",
      audio_volume: 15,
      video_volume: 100,
    });

    fetchMock.mockResolvedValueOnce(response(200, { id: "container_2" }));
    await provider.createReelContainer({
      igUserId: "1",
      token: "T",
      videoUrl: "https://storage.example/c.mp4",
      caption: "",
      aiGenerated: false,
      shareToFeed: true,
    });
    const plain = new URLSearchParams(lastCall().init.body!);
    expect(plain.has("is_ai_generated")).toBe(false);
    expect(plain.has("audio_configuration")).toBe(false);
  });

  it("reads the container status and the subcode in `status`; an unknown word is transient", async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, { status_code: "ERROR", status: "2207026", id: "c" }),
    );
    expect(await provider.containerStatus("c", "T")).toEqual({ code: "ERROR", detail: "2207026" });
    expect(lastCall().url.searchParams.get("fields")).toBe("status_code,status");

    fetchMock.mockResolvedValueOnce(response(200, { status_code: "SOMETHING_NEW", id: "c" }));
    await expect(provider.containerStatus("c", "T")).rejects.toThrow(TransientError);
  });

  it("publishes with creation_id and reads the quota with 50 as the fallback total", async () => {
    fetchMock.mockResolvedValueOnce(response(200, { id: "media_1" }));
    expect(await provider.publish("1", "container_1", "T")).toEqual({ mediaId: "media_1" });
    expect(new URLSearchParams(lastCall().init.body!).get("creation_id")).toBe("container_1");

    fetchMock.mockResolvedValueOnce(
      response(200, { data: [{ quota_usage: 3, config: { quota_total: 50 } }] }),
    );
    expect(await provider.publishingLimit("1", "T")).toEqual({ usage: 3, total: 50 });
    fetchMock.mockResolvedValueOnce(response(200, { data: [{ quota_usage: 7 }] }));
    expect(await provider.publishingLimit("1", "T")).toEqual({ usage: 7, total: 50 });
  });

  it("lists only the Pages that carry an Instagram account, with their Page token", async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, {
        data: [
          {
            id: "p1",
            name: "Page one",
            access_token: "PAGE1",
            instagram_business_account: { id: "ig1", username: "one" },
          },
          { id: "p2", name: "No instagram", access_token: "PAGE2" },
        ],
      }),
    );
    const pages = await provider.pagesWithInstagram("USER");
    expect(pages).toEqual([
      {
        pageId: "p1",
        pageName: "Page one",
        pageToken: "PAGE1",
        instagram: { id: "ig1", username: "one", name: undefined, pictureUrl: undefined },
      },
    ]);
    expect(lastCall().url.searchParams.get("fields")).toContain("instagram_business_account{");
  });

  it("exchanges a code and extends it to a long-lived token with the app secret, server-side", async () => {
    fetchMock.mockResolvedValueOnce(response(200, { access_token: "SHORT", expires_in: 5000 }));
    expect(await provider.exchangeCode("CODE", "https://tavnit.ai/cb")).toEqual({
      accessToken: "SHORT",
      expiresInSeconds: 5000,
    });
    let { url } = lastCall();
    expect(url.pathname).toBe("/v26.0/oauth/access_token");
    expect(url.searchParams.get("client_secret")).toBe("app_secret");
    expect(url.searchParams.get("code")).toBe("CODE");

    fetchMock.mockResolvedValueOnce(response(200, { access_token: "LONG", expires_in: 5183944 }));
    expect(await provider.exchangeLongLived("SHORT")).toEqual({
      accessToken: "LONG",
      expiresInSeconds: 5183944,
    });
    ({ url } = lastCall());
    expect(url.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(url.searchParams.get("fb_exchange_token")).toBe("SHORT");
  });

  it("maps 5xx and 429 to TransientError, other 4xx to MetaGraphError, and recognises a lapsed token", async () => {
    fetchMock.mockResolvedValueOnce(response(500, { error: { message: "down", code: 2 } }));
    const down = await provider.me("TOKEN123").catch((e: unknown) => e);
    expect(down).toBeInstanceOf(TransientError);
    expect((down as Error).message).not.toContain("TOKEN123");
    fetchMock.mockResolvedValueOnce(response(429, { error: { message: "slow down", code: 4 } }));
    await expect(provider.me("TOKEN123")).rejects.toThrow(TransientError);

    fetchMock.mockResolvedValueOnce(
      response(400, {
        error: {
          message: "Error validating access token",
          type: "OAuthException",
          code: 190,
          error_subcode: 463,
        },
      }),
    );
    const lapsed = await provider.me("TOKEN123").catch((e: unknown) => e);
    expect(lapsed).toBeInstanceOf(MetaGraphError);
    expect(isTokenLapse(lapsed)).toBe(true);
    expect((lapsed as Error).message).not.toContain("TOKEN123");

    fetchMock.mockResolvedValueOnce(
      response(400, { error: { message: "Unsupported format", code: 352 } }),
    );
    const refused = await provider.publish("1", "c", "TOKEN123").catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(MetaGraphError);
    expect(isTokenLapse(refused)).toBe(false);
    expect((refused as MetaGraphError).code).toBe(352);

    // Code 10 is a capability refusal, not a lapse — a reconnect would change nothing.
    fetchMock.mockResolvedValueOnce(
      response(400, { error: { message: "(#10) Application does not have permission", code: 10 } }),
    );
    const capability = await provider.publish("1", "c", "TOKEN123").catch((e: unknown) => e);
    expect(isTokenLapse(capability)).toBe(false);
  });

  it("scrubs a signed URL that Meta's error text echoes back", async () => {
    fetchMock.mockResolvedValueOnce(
      response(400, {
        error: {
          message:
            "The media could not be fetched from this uri: https://storage.example/renders/a.mp4?token=SECRETSIG&x=1",
          code: 9004,
        },
      }),
    );
    const err = await provider
      .createReelContainer({
        igUserId: "1",
        token: "T",
        videoUrl: "https://storage.example/renders/a.mp4?token=SECRETSIG&x=1",
        caption: "",
        aiGenerated: false,
        shareToFeed: true,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaGraphError);
    expect((err as Error).message).not.toContain("SECRETSIG");
    expect((err as Error).message).toContain("https://storage.example/renders/a.mp4?<signed>");
    expect((err as MetaGraphError).metaMessage).not.toContain("SECRETSIG");
    expect(scrubSignedUrls("plain text, no url")).toBe("plain text, no url");
  });

  it("fails at use with a plain message when the app credentials are unset", async () => {
    delete process.env.META_APP_SECRET;
    resetEnvCache();
    await expect(provider.me("T")).rejects.toThrow(/META_APP_SECRET is not set/);
    process.env.META_APP_SECRET = "app_secret";
    resetEnvCache();
  });
});

describe("parseSignedRequest", () => {
  const secret = "app_secret";
  function sign(payload: Record<string, unknown>): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
    return `${sig}.${encoded}`;
  }

  it("verifies the HMAC and returns the Facebook user id", () => {
    const parsed = parseSignedRequest(
      sign({ algorithm: "HMAC-SHA256", user_id: "218471", issued_at: 1291840400 }),
      secret,
    );
    expect(parsed).toEqual({ userId: "218471", algorithm: "HMAC-SHA256", issuedAt: 1291840400 });
  });

  it("refuses a bad signature, a foreign algorithm and a payload without a user", () => {
    const good = sign({ algorithm: "HMAC-SHA256", user_id: "1" });
    expect(() => parseSignedRequest(good, "other_secret")).toThrow(SignedRequestError);
    expect(() => parseSignedRequest(`x${good}`, secret)).toThrow(SignedRequestError);
    expect(() => parseSignedRequest(sign({ algorithm: "MD5", user_id: "1" }), secret)).toThrow(
      /HMAC-SHA256/,
    );
    expect(() => parseSignedRequest(sign({ algorithm: "HMAC-SHA256" }), secret)).toThrow(
      /names no user/,
    );
    expect(() => parseSignedRequest("nodot", secret)).toThrow(SignedRequestError);
  });
});
