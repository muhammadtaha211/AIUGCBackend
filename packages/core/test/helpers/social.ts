import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { resetEnvCache } from "../../src/config";
import type { Db } from "../../src/db";
import * as schema from "../../src/db/schema";
import { createBusiness } from "../../src/pipelines/businesses";
import { upsertInstagramConnections, upsertTiktokConnection } from "../../src/pipelines/social";
import {
  MetaGraphError,
  type AudioKind,
  type ContainerStatus,
  type MetaGraphProvider,
  type MetaPageWithInstagram,
  type ReelContainerInput,
} from "../../src/providers/meta-graph";
import {
  TiktokApiError,
  type TiktokProvider,
  type TiktokPublishStatus,
  type TiktokTokens,
} from "../../src/providers/tiktok";
import type { Storage } from "../../src/storage";

/** The env the social pipeline needs in a test: a 32-byte key, dry run. */
export function socialTestEnv(): () => void {
  const previous = { ...process.env };
  process.env.SOCIAL_TOKEN_KEY = randomBytes(32).toString("base64");
  process.env.DRY_RUN = "1";
  resetEnvCache();
  return () => {
    process.env = previous;
    resetEnvCache();
  };
}

export async function seedOwnerAndBusiness(
  db: Db,
  opts: { email: string; role?: "customer" | "admin" } = { email: "owner@test.local" },
): Promise<{ userId: string; businessId: string }> {
  const business = await createBusiness(db, {
    ownerEmail: opts.email,
    name: "עסק",
    ownerRole: opts.role ?? "customer",
    allowWithoutAuthAccount: true,
  });
  return { userId: business.ownerUserId, businessId: business.id };
}

/** A released render whose file exists in the temp storage. */
export async function seedReleasedRender(
  db: Db,
  storage: Storage,
  storageRoot: string,
  opts: { businessId: string; service?: "a" | "b" | "c"; releasedAt?: Date },
): Promise<typeof schema.videoRenders.$inferSelect> {
  const [render] = await db
    .insert(schema.videoRenders)
    .values({
      businessId: opts.businessId,
      service: opts.service ?? "a",
      params: { format: "steps" },
      status: "released",
      releasedAt: opts.releasedAt ?? new Date(),
    })
    .returning();
  const key = `${opts.businessId}/video/${render!.id}/final.mp4`;
  const local = path.join(storageRoot, "seed", `${render!.id}.mp4`);
  mkdirSync(path.dirname(local), { recursive: true });
  writeFileSync(local, "fake mp4 bytes");
  const filePath = await storage.put("renders", key, local);
  const [updated] = await db
    .update(schema.videoRenders)
    .set({ filePath })
    .where(eq(schema.videoRenders.id, render!.id))
    .returning();
  return updated!;
}

export function samplePage(igId = "17841400000000001", suffix = ""): MetaPageWithInstagram {
  return {
    pageId: `page_${igId}`,
    pageName: `עמוד ${suffix}`.trim(),
    pageToken: `PAGE_TOKEN_${igId}`,
    instagram: {
      id: igId,
      username: `user${suffix}`,
      name: `חשבון ${suffix}`.trim(),
      pictureUrl: "https://cdn/pic.jpg",
    },
  };
}

export async function connectInstagram(
  db: Db,
  userId: string,
  pages: MetaPageWithInstagram[] = [samplePage()],
): Promise<string[]> {
  const views = await upsertInstagramConnections(db, {
    userId,
    fbUserId: "fb_user_1",
    userToken: "USER_TOKEN",
    userTokenExpiresAt: new Date(Date.now() + 60 * 86_400_000),
    pages,
  });
  return views.map((v) => v.id);
}

export function tokenLapse(): MetaGraphError {
  return new MetaGraphError(400, {
    message: "Error validating access token: Session has expired",
    code: 190,
    error_subcode: 463,
  });
}

/**
 * A scripted Meta: every call counted, the container statuses fed in order,
 * and any method made to throw once or always. Tests assert on the counters.
 */
export class FakeMeta implements MetaGraphProvider {
  calls = {
    exchangeCode: 0,
    exchangeLongLived: 0,
    me: 0,
    pagesWithInstagram: 0,
    instagramUser: 0,
    searchAudio: 0,
    publishingLimit: 0,
    createReelContainer: 0,
    containerStatus: 0,
    publish: 0,
    mediaPermalink: 0,
  };
  containers: ReelContainerInput[] = [];
  statuses: ContainerStatus[] = [{ code: "FINISHED" }];
  limit = { usage: 0, total: 50 };
  publishedContainers = new Set<string>();
  throwOn: Partial<Record<keyof FakeMeta["calls"], Error | (() => Error)>> = {};
  throwOnceOn: Partial<Record<keyof FakeMeta["calls"], Error>> = {};
  profile: { username?: string; name?: string; pictureUrl?: string } = {
    username: "refreshed",
    name: "שם חדש",
    pictureUrl: "https://cdn/new.jpg",
  };
  profileByAccount: Record<
    string,
    Error | { username?: string; name?: string; pictureUrl?: string }
  > = {};

  private hit(name: keyof FakeMeta["calls"]): void {
    this.calls[name]++;
    const once = this.throwOnceOn[name];
    if (once) {
      delete this.throwOnceOn[name];
      throw once;
    }
    const always = this.throwOn[name];
    if (always) throw typeof always === "function" ? always() : always;
  }

  async exchangeCode() {
    this.hit("exchangeCode");
    return { accessToken: "SHORT", expiresInSeconds: 3600 };
  }
  async exchangeLongLived() {
    this.hit("exchangeLongLived");
    return { accessToken: "LONG", expiresInSeconds: 5_184_000 };
  }
  async me() {
    this.hit("me");
    return { id: "fb_user_1" };
  }
  async pagesWithInstagram() {
    this.hit("pagesWithInstagram");
    return [samplePage()];
  }
  async instagramUser(igUserId: string) {
    this.hit("instagramUser");
    const scripted = this.profileByAccount[igUserId];
    if (scripted instanceof Error) throw scripted;
    return { id: igUserId, ...(scripted ?? this.profile) };
  }
  async searchAudio(opts: { kind: AudioKind }) {
    this.hit("searchAudio");
    return { items: [{ audioId: "a1", kind: opts.kind, title: "t" }] };
  }
  async publishingLimit() {
    this.hit("publishingLimit");
    return { ...this.limit };
  }
  async createReelContainer(input: ReelContainerInput) {
    this.hit("createReelContainer");
    this.containers.push(input);
    return { containerId: `container_${this.containers.length}` };
  }
  async containerStatus(containerId: string) {
    this.hit("containerStatus");
    if (this.publishedContainers.has(containerId)) return { code: "PUBLISHED" as const };
    const next = this.statuses.length > 1 ? this.statuses.shift()! : this.statuses[0]!;
    return next;
  }
  async publish(_igUserId: string, containerId: string) {
    // Count and record BEFORE a scripted throw: that is what "the call reached
    // Meta and the worker died before the response" looks like.
    this.calls.publish++;
    this.publishedContainers.add(containerId);
    const once = this.throwOnceOn.publish;
    if (once) {
      delete this.throwOnceOn.publish;
      throw once;
    }
    if (this.throwOn.publish) {
      const t = this.throwOn.publish;
      throw typeof t === "function" ? t() : t;
    }
    return { mediaId: `media_${this.calls.publish}` };
  }
  async mediaPermalink(mediaId: string) {
    this.hit("mediaPermalink");
    return `https://www.instagram.com/reel/${mediaId}/`;
  }
}

/** A TikTok token pair as Login Kit returns it (decision 0115). */
export function sampleTiktokTokens(
  openId = "tt_open_1",
  opts: { access?: string; refresh?: string; accessExpiresAt?: Date } = {},
): TiktokTokens {
  return {
    openId,
    scopes: ["user.info.basic", "video.upload"],
    accessToken: opts.access ?? `ACCESS_${openId}`,
    accessExpiresAt: opts.accessExpiresAt ?? new Date(Date.now() + 86_400_000),
    refreshToken: opts.refresh ?? `REFRESH_${openId}`,
    refreshExpiresAt: new Date(Date.now() + 365 * 86_400_000),
  };
}

export async function connectTiktok(
  db: Db,
  userId: string,
  openId = "tt_open_1",
  opts: { access?: string; refresh?: string; accessExpiresAt?: Date } = {},
): Promise<string> {
  const view = await upsertTiktokConnection(db, {
    userId,
    tokens: sampleTiktokTokens(openId, opts),
    profile: { openId, displayName: "חשבון טיקטוק", avatarUrl: "https://cdn/tt.jpg" },
  });
  return view.id;
}

export function tiktokRefusal(code: string, status = 400): TiktokApiError {
  return new TiktokApiError(status, { code, message: code });
}

/**
 * A scripted TikTok: every call counted, the publish statuses fed in order, any
 * method made to throw once or always. `initInboxPull` counts and records
 * BEFORE a scripted throw — "the upload reached TikTok and the worker died".
 */
export class FakeTiktok implements TiktokProvider {
  private static instances = 0;
  /** Unique per fake, as TikTok's publish ids are unique: a later test never matches an earlier post. */
  readonly idPrefix = `v_inbox_file~v2.${++FakeTiktok.instances}_`;
  calls = { exchangeCode: 0, refresh: 0, userInfo: 0, initInboxPull: 0, publishStatus: 0 };
  pulls: { accessToken: string; videoUrl: string }[] = [];
  refreshedWith: string[] = [];
  statusTokens: string[] = [];
  statuses: TiktokPublishStatus[] = [{ code: "SEND_TO_USER_INBOX" }];
  throwOn: Partial<Record<keyof FakeTiktok["calls"], Error>> = {};
  throwOnceOn: Partial<Record<keyof FakeTiktok["calls"], Error>> = {};
  tokens: TiktokTokens = sampleTiktokTokens("tt_open_1");
  profile = { displayName: "שם טיקטוק חדש", avatarUrl: "https://cdn/tt-new.jpg" };

  private hit(name: keyof FakeTiktok["calls"]): void {
    this.calls[name]++;
    const once = this.throwOnceOn[name];
    if (once) {
      delete this.throwOnceOn[name];
      throw once;
    }
    const always = this.throwOn[name];
    if (always) throw always;
  }

  async exchangeCode() {
    this.hit("exchangeCode");
    return { ...this.tokens };
  }
  async refresh(refreshToken: string) {
    this.refreshedWith.push(refreshToken);
    this.hit("refresh");
    const n = this.calls.refresh;
    return {
      ...this.tokens,
      accessToken: `ACCESS_R${n}`,
      accessExpiresAt: new Date(Date.now() + 86_400_000),
      refreshToken: `REFRESH_R${n}`,
    };
  }
  async userInfo() {
    this.hit("userInfo");
    return { openId: this.tokens.openId, ...this.profile };
  }
  async initInboxPull(accessToken: string, videoUrl: string) {
    this.pulls.push({ accessToken, videoUrl });
    this.hit("initInboxPull");
    return { publishId: `${this.idPrefix}${this.calls.initInboxPull}` };
  }
  async publishStatus(accessToken: string) {
    this.statusTokens.push(accessToken);
    this.hit("publishStatus");
    return this.statuses.length > 1 ? this.statuses.shift()! : this.statuses[0]!;
  }
}
