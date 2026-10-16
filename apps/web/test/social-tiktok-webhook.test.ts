import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TikTok's webhook (decision 0115) over the real route handler on PGlite:
 * the signature is checked over the exact raw body before anything parses it
 * (a body re-serialised from parsed JSON would not verify), a bad or missing
 * one is a 401 that touches nothing, a missing secret a 503 — and a verified
 * delivery is answered 200 whatever it was: the inbox delivery and the
 * authorisation removal are applied, everything else (post.publish.failed
 * included — the job's own poll owns failure) is left alone.
 */

const fixture = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@aiugc/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aiugc/core")>();
  return { ...actual, getDb: () => fixture.db };
});

const core = await import("@aiugc/core");
const { createTestDb } = await import("../../../packages/core/test/helpers/pglite");
const { connectTiktok, seedOwnerAndBusiness, socialTestEnv } =
  await import("../../../packages/core/test/helpers/social");
const { POST: webhook } = await import("../src/app/api/social/tiktok/webhook/route");

const schema = core.schema;
type Db = ReturnType<typeof core.getDb>;

const SECRET = "test_tiktok_client_secret";
const OPEN_ID = "tt_open_hook";

let pg: { close(): Promise<void> };
let db: Db;
let restoreEnv: () => void;
let owner: { userId: string; businessId: string };
let accountId: string;
let renderId: string;
let posts = 0;

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  core.resetEnvCache();
}

/**
 * A delivery as TikTok sends it, pretty-printed on purpose: the whitespace is
 * part of what is signed, so only a check over the raw text passes.
 */
function delivery(event: string, content: Record<string, unknown>, createTime?: number): string {
  return JSON.stringify(
    {
      client_key: "test_client_key",
      event,
      create_time: createTime ?? Math.floor(Date.now() / 1000),
      user_openid: OPEN_ID,
      content: JSON.stringify(content),
    },
    null,
    2,
  );
}

/** `TikTok-Signature: t=<unix seconds>,s=hex(HMAC-SHA256(secret, "<t>.<raw body>"))`. */
function signature(raw: string, secret = SECRET): string {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},s=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
}

function post(raw: string, header: string | null) {
  return webhook(
    new Request("http://localhost/api/social/tiktok/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(header === null ? {} : { "tiktok-signature": header }),
      },
      body: raw,
    }),
  );
}

/** A TikTok post the job has handed to TikTok: publishing, its publish id stored. */
async function uploaded(): Promise<{ id: string; publishId: string }> {
  const publishId = `v_inbox_file~v2.hook_${++posts}`;
  const [row] = await db
    .insert(schema.scheduledPosts)
    .values({
      userId: owner.userId,
      businessId: owner.businessId,
      videoRenderId: renderId,
      socialAccountId: accountId,
      platform: "tiktok",
      scheduledAt: new Date(Date.now() - 60_000),
      timezone: "Asia/Jerusalem",
      caption: "",
      status: "publishing",
      providerContainerId: publishId,
    })
    .returning();
  return { id: row!.id, publishId };
}

async function postRow(id: string) {
  return (
    await db.select().from(schema.scheduledPosts).where(eq(schema.scheduledPosts.id, id))
  )[0]!;
}

async function accountRow() {
  return (
    await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, accountId))
  )[0]!;
}

beforeAll(async () => {
  restoreEnv = socialTestEnv();
  const created = await createTestDb();
  pg = created.pg;
  db = created.db as unknown as Db;
  fixture.db = db;
  owner = await seedOwnerAndBusiness(db, { email: "webhook@social.test" });
  accountId = await connectTiktok(db, owner.userId, OPEN_ID);
  const [render] = await db
    .insert(schema.videoRenders)
    .values({ businessId: owner.businessId, service: "a", params: {}, status: "released" })
    .returning();
  renderId = render!.id;
});

beforeEach(() => {
  setEnv({ TIKTOK_CLIENT_SECRET: SECRET });
});

afterAll(async () => {
  restoreEnv();
  await pg.close();
});

describe("TikTok's webhook", () => {
  it("a delivery signed over its exact raw text is applied: the post is delivered", async () => {
    const { id, publishId } = await uploaded();
    const raw = delivery("post.publish.inbox_delivered", { publish_id: publishId });
    // The body really is pretty-printed: compact JSON would not be the signed bytes.
    expect(raw).toContain("\n  ");
    const response = await post(raw, signature(raw));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const row = await postRow(id);
    expect(row.status).toBe("delivered");
    expect(row.deliveredAt).not.toBeNull();

    // TikTok delivers at least once: the same delivery again changes nothing.
    const again = await post(raw, signature(raw));
    expect(again.status).toBe(200);
    expect((await postRow(id)).deliveredAt?.getTime()).toBe(row.deliveredAt!.getTime());
  });

  it("the same body with one byte changed is a 401, and nothing changes", async () => {
    const { id, publishId } = await uploaded();
    const raw = delivery("post.publish.inbox_delivered", { publish_id: publishId });
    const header = signature(raw);
    // One space becomes a tab: the same JSON, not the same bytes.
    const tampered = raw.replace("\n  ", "\n\t ");
    expect(tampered).not.toBe(raw);
    expect(tampered.length).toBe(raw.length);
    expect(JSON.parse(tampered)).toEqual(JSON.parse(raw));
    const response = await post(tampered, header);
    expect(response.status).toBe(401);
    expect((await postRow(id)).status).toBe("publishing");

    // Signed under another secret: the same 401.
    const foreign = await post(raw, signature(raw, "not_the_secret"));
    expect(foreign.status).toBe(401);
    expect((await postRow(id)).status).toBe("publishing");
  });

  it("no signature header is a 401, and nothing changes", async () => {
    const { id, publishId } = await uploaded();
    const raw = delivery("post.publish.inbox_delivered", { publish_id: publishId });
    expect((await post(raw, null)).status).toBe(401);
    expect((await post(raw, "")).status).toBe(401);
    expect((await postRow(id)).status).toBe("publishing");
  });

  it("with the client secret unset the route answers 503 — ours to fix, and TikTok retries", async () => {
    const { id, publishId } = await uploaded();
    const raw = delivery("post.publish.inbox_delivered", { publish_id: publishId });
    const header = signature(raw);
    setEnv({ TIKTOK_CLIENT_SECRET: undefined });
    const response = await post(raw, header);
    expect(response.status).toBe(503);
    expect((await postRow(id)).status).toBe("publishing");
  });

  it("an event it does not handle is answered 200 and changes nothing", async () => {
    const { id, publishId } = await uploaded();
    const raw = delivery("video.something.new", { publish_id: publishId });
    const response = await post(raw, signature(raw));
    expect(response.status).toBe(200);
    expect(await postRow(id)).toMatchObject({ status: "publishing", deliveredAt: null });
  });

  it("post.publish.failed is answered 200 and leaves the row to the job's own poll", async () => {
    const { id, publishId } = await uploaded();
    const before = await postRow(id);
    const raw = delivery("post.publish.failed", { publish_id: publishId, reason: "file_format" });
    const response = await post(raw, signature(raw));
    expect(response.status).toBe(200);
    const after = await postRow(id);
    expect(after.status).toBe("publishing");
    expect(after.failureKind).toBeNull();
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("authorization.removed disconnects the account, erases its tokens and fails what still waits", async () => {
    const [waiting] = await db
      .insert(schema.scheduledPosts)
      .values({
        userId: owner.userId,
        businessId: owner.businessId,
        videoRenderId: renderId,
        socialAccountId: accountId,
        platform: "tiktok",
        scheduledAt: new Date(Date.now() + 3_600_000),
        timezone: "Asia/Jerusalem",
        caption: "",
      })
      .returning();
    expect((await accountRow()).status).toBe("connected");
    // TikTok stamps the removal after the connect: a removal older than a
    // reconnect would not undo it.
    const raw = delivery("authorization.removed", { reason: 1 }, Math.ceil(Date.now() / 1000) + 1);
    const response = await post(raw, signature(raw));
    expect(response.status).toBe(200);
    expect(await accountRow()).toMatchObject({
      status: "disconnected",
      accessTokenEnc: null,
      refreshTokenEnc: null,
    });
    expect(await postRow(waiting!.id)).toMatchObject({
      status: "failed",
      failureKind: "connection_expired",
    });
  });
});
