import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST_FAILED } from "../src/alerts";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { recoverExpiredLeases } from "../src/jobs/queue";
import { runLane } from "../src/jobs/worker";
import { logger } from "../src/logger";
import { handleReapDeadRenders } from "../src/pipelines/janitor";
import {
  cancelScheduledPost,
  CONTAINER_MAX_POLLS,
  failOrphanedPosts,
  QUOTA_DEFER_MAX_MS,
  schedulePosts,
  SOUND_VOLUMES,
  updateScheduledPost,
} from "../src/pipelines/social";
import { setMetaGraphProvider } from "../src/providers/meta-graph";
import { getStorage, setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import {
  connectInstagram,
  FakeMeta,
  seedOwnerAndBusiness,
  seedReleasedRender,
  socialTestEnv,
  tokenLapse,
} from "./helpers/social";
import { tempStorage } from "./helpers/storage";

/**
 * The publish job (decision 0101) against a scripted Meta: every checkpoint
 * replayed — a crash after the container exists, a crash inside media_publish,
 * a lease reclaim — must leave exactly ONE container and ONE publish; a cancel
 * before the run leaves zero calls; every failure kind lands on the row with
 * the founder's alert beside it; the AI label follows the post's own tick and
 * the volume mix follows the service (decision 0102).
 */
describe("publish_post", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let restoreEnv: () => void;
  let storageRoot: string;
  let cleanupStorage: () => void;
  let userId: string;
  let businessId: string;
  let accountId: string;
  let meta: FakeMeta;

  beforeAll(async () => {
    restoreEnv = socialTestEnv();
    ({ db, pg } = await createTestDb());
    const temp = tempStorage();
    storageRoot = temp.root;
    cleanupStorage = temp.cleanup;
    setStorage(temp.storage);
    ({ userId, businessId } = await seedOwnerAndBusiness(db));
    accountId = (await connectInstagram(db, userId))[0]!;
  });

  beforeEach(async () => {
    meta = new FakeMeta();
    setMetaGraphProvider(meta);
    await db
      .update(schema.socialAccounts)
      .set({ status: "connected" })
      .where(eq(schema.socialAccounts.id, accountId));
  });

  afterAll(async () => {
    setMetaGraphProvider(undefined);
    setStorage(undefined);
    cleanupStorage();
    restoreEnv();
    await pg.close();
  });

  /** One lane pass over everything runnable now. */
  async function lanePass(): Promise<void> {
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
  }

  /** Rescheduled or backed-off jobs become runnable. */
  async function makeRunnable(): Promise<void> {
    await db.execute(
      sql`update jobs set run_at = now() - interval '1 second' where status = 'queued'`,
    );
  }

  async function schedule(service: "a" | "b" | "c" = "a", sound = true, aiLabel?: boolean) {
    const render = await seedReleasedRender(db, getStorage(), storageRoot, { businessId, service });
    const [post] = await schedulePosts(db, {
      userId,
      videoRenderId: render.id,
      accountIds: [accountId],
      scheduledAt: new Date(),
      timezone: "Asia/Jerusalem",
      caption: "כיתוב לבדיקה",
      sound: sound ? { audioId: "audio_1", kind: "original_sound", title: "s" } : null,
      ...(aiLabel === undefined ? {} : { aiLabel }),
    });
    await makeRunnable();
    return { post: post!, render };
  }

  async function postRow(id: string) {
    return (
      await db.select().from(schema.scheduledPosts).where(eq(schema.scheduledPosts.id, id))
    )[0]!;
  }

  async function jobRow(postId: string) {
    return (
      await db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.idempotencyKey, `post:${postId}`))
    )[0]!;
  }

  async function failedEvents(postId: string) {
    return db
      .select()
      .from(schema.events)
      .where(
        sql`${schema.events.kind} = ${POST_FAILED} and ${schema.events.payload}->>'postId' = ${postId}`,
      );
  }

  it("happy path: quota read, one container, one status read, one publish, the row posted with the media id and link", async () => {
    const { post } = await schedule("a");
    await lanePass();
    const row = await postRow(post.id);
    expect(row.status).toBe("posted");
    expect(row.providerContainerId).toBe("container_1");
    expect(row.providerMediaId).toBe("media_1");
    expect(row.permalink).toBe("https://www.instagram.com/reel/media_1/");
    expect(row.startedAt).not.toBeNull();
    expect(row.postedAt).not.toBeNull();
    expect(meta.calls).toMatchObject({
      publishingLimit: 1,
      createReelContainer: 1,
      containerStatus: 1,
      publish: 1,
    });
    expect((await jobRow(post.id)).status).toBe("succeeded");
    // The signed URL was minted at post time, never stored on the row.
    expect(meta.containers[0]!.videoUrl).toMatch(/^file:\/\//);
    expect(JSON.stringify(row)).not.toContain("file://");
  });

  /** Which render each container was made for, by the signed URL Meta was handed. */
  function containersByRender(renders: Record<string, { id: string }>) {
    return new Map(
      meta.containers.map((x) => [
        Object.entries(renders).find(([, r]) => x.videoUrl.includes(r.id))![0],
        x,
      ]),
    );
  }

  it("the mix follows the service, at the founder's numbers: הוק + דמו sound 100 over silence, דמות AI voice 100 over sound 15, גוש טקסט sound 100 over the clip at 40", async () => {
    const a = await schedule("a");
    const b = await schedule("b");
    const c = await schedule("c");
    await lanePass();
    const byRender = containersByRender({ a: a.render, b: b.render, c: c.render });
    expect(byRender.get("a")!.audio).toEqual({
      audioId: "audio_1",
      audioVolume: 100,
      videoVolume: 0,
    });
    expect(byRender.get("b")!.audio).toEqual({
      audioId: "audio_1",
      audioVolume: 15,
      videoVolume: 100,
    });
    expect(byRender.get("c")!.audio).toEqual({
      audioId: "audio_1",
      audioVolume: 100,
      videoVolume: 40,
    });
    expect(SOUND_VOLUMES).toEqual({
      a: { audioVolume: 100, videoVolume: 0 },
      b: { audioVolume: 15, videoVolume: 100 },
      c: { audioVolume: 100, videoVolume: 40 },
    });
    expect(byRender.get("a")!.shareToFeed).toBe(true);
    expect((await postRow(c.post.id)).status).toBe("posted");
  });

  it("the AI label is the post's own tick: unticked by default on every service and sent for none of them; a ticked post sends it", async () => {
    const a = await schedule("a");
    const b = await schedule("b");
    const c = await schedule("c");
    const ticked = await schedule("c", true, true);
    for (const { post } of [a, b, c]) expect((await postRow(post.id)).aiLabel).toBe(false);
    expect((await postRow(ticked.post.id)).aiLabel).toBe(true);
    await lanePass();
    const byRender = containersByRender({
      a: a.render,
      b: b.render,
      c: c.render,
      ticked: ticked.render,
    });
    expect(byRender.get("a")!.aiGenerated).toBe(false);
    expect(byRender.get("b")!.aiGenerated).toBe(false);
    expect(byRender.get("c")!.aiGenerated).toBe(false);
    expect(byRender.get("ticked")!.aiGenerated).toBe(true);
  });

  it("the tick can change while the post is pending, and the job sends what the row says at post time", async () => {
    const render = await seedReleasedRender(db, getStorage(), storageRoot, {
      businessId,
      service: "b",
    });
    const [post] = await schedulePosts(db, {
      userId,
      videoRenderId: render.id,
      accountIds: [accountId],
      scheduledAt: new Date(Date.now() + 3_600_000),
      timezone: "Asia/Jerusalem",
      caption: "",
    });
    const view = await updateScheduledPost(db, { userId, postId: post!.id, aiLabel: true });
    expect(view.aiLabel).toBe(true);
    await makeRunnable();
    await lanePass();
    expect(meta.containers).toHaveLength(1);
    expect(meta.containers[0]!.aiGenerated).toBe(true);
  });

  it("a container still in progress is polled once a minute through reschedule, never a second container", async () => {
    meta.statuses = [{ code: "IN_PROGRESS" }, { code: "IN_PROGRESS" }, { code: "FINISHED" }];
    const { post } = await schedule();
    await lanePass();
    let job = await jobRow(post.id);
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(0);
    expect((job.state as { polls: number }).polls).toBe(1);
    expect((await postRow(post.id)).status).toBe("publishing");
    // Posting has started: an edit or a cancel is refused now.
    await expect(cancelScheduledPost(db, { userId, postId: post.id })).rejects.toThrow(
      /not_pending/,
    );
    await makeRunnable();
    await lanePass();
    await makeRunnable();
    await lanePass();
    job = await jobRow(post.id);
    expect(job.status).toBe("succeeded");
    expect(meta.calls.createReelContainer).toBe(1);
    expect(meta.calls.containerStatus).toBe(3);
    expect(meta.calls.publish).toBe(1);
    expect((await postRow(post.id)).status).toBe("posted");
  });

  it("a crash after the container was created resumes by polling it — one container, one publish", async () => {
    meta.throwOnceOn.containerStatus = new Error("worker lost the socket");
    const { post } = await schedule();
    await lanePass();
    let job = await jobRow(post.id);
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(1);
    expect((job.state as { containerId: string }).containerId).toBe("container_1");
    expect((await postRow(post.id)).providerContainerId).toBe("container_1");
    await makeRunnable();
    await lanePass();
    job = await jobRow(post.id);
    expect(job.status).toBe("succeeded");
    expect(meta.calls.createReelContainer).toBe(1);
    expect(meta.calls.publish).toBe(1);
    expect((await postRow(post.id)).status).toBe("posted");
  });

  it("a crash inside media_publish (the call reached Meta, the worker died) is detected by the PUBLISHED container — no second publish, the row posted without a link", async () => {
    meta.throwOnceOn.publish = new Error("connection reset after the request went out");
    const { post } = await schedule();
    await lanePass();
    let job = await jobRow(post.id);
    expect(job.status).toBe("queued");
    expect((job.state as { publishAttemptedAt?: number }).publishAttemptedAt).toBeDefined();
    expect((job.state as { mediaId?: string }).mediaId).toBeUndefined();
    await makeRunnable();
    await lanePass();
    job = await jobRow(post.id);
    expect(job.status).toBe("succeeded");
    expect(meta.calls.publish).toBe(1);
    const row = await postRow(post.id);
    expect(row.status).toBe("posted");
    expect(row.providerMediaId).toBeNull();
    expect(row.permalink).toBeNull();
  });

  it("a crash between the media-id checkpoint and the row write finishes the write on the retry without touching Meta's publish", async () => {
    const { post } = await schedule();
    // Script the state as the handler leaves it right after media_publish returned.
    await db
      .update(schema.jobs)
      .set({
        state: {
          containerId: "container_x",
          polls: 0,
          publishAttemptedAt: Date.now(),
          mediaId: "media_prev",
        },
      })
      .where(eq(schema.jobs.idempotencyKey, `post:${post.id}`));
    await lanePass();
    const row = await postRow(post.id);
    expect(row.status).toBe("posted");
    expect(row.providerMediaId).toBe("media_prev");
    expect(meta.calls).toMatchObject({
      publishingLimit: 0,
      createReelContainer: 0,
      containerStatus: 0,
      publish: 0,
      mediaPermalink: 1,
    });
  });

  it("a lease reclaim (the worker died mid-run with the container checkpointed) resumes without a second container or publish", async () => {
    meta.throwOnceOn.containerStatus = new Error("died");
    const { post } = await schedule();
    await lanePass();
    // Rewrite the aftermath as a death: running, locked 31 minutes ago, the
    // checkpointed state intact.
    await db.execute(
      sql`update jobs set status = 'running', locked_at = now() - interval '31 minutes', run_at = now() - interval '31 minutes'
            where idempotency_key = ${`post:${post.id}`}`,
    );
    expect(await recoverExpiredLeases(db)).toBe(1);
    const reclaimed = await jobRow(post.id);
    expect(reclaimed.status).toBe("queued");
    expect(reclaimed.attempts).toBe(2);
    expect((reclaimed.state as { containerId: string }).containerId).toBe("container_1");
    await lanePass();
    expect((await jobRow(post.id)).status).toBe("succeeded");
    expect(meta.calls.createReelContainer).toBe(1);
    expect(meta.calls.publish).toBe(1);
    expect((await postRow(post.id)).status).toBe("posted");
  });

  it("a post cancelled before its time never reaches Meta: the job completes as a no-op", async () => {
    const { post } = await schedule();
    await cancelScheduledPost(db, { userId, postId: post.id });
    await lanePass();
    expect((await jobRow(post.id)).status).toBe("succeeded");
    expect(meta.calls).toMatchObject({ publishingLimit: 0, createReelContainer: 0, publish: 0 });
    expect((await postRow(post.id)).status).toBe("cancelled");
  });

  it("a missing file fails the post at once as file_missing with the founder's alert row", async () => {
    const { post, render } = await schedule();
    await db
      .update(schema.videoRenders)
      .set({ filePath: null })
      .where(eq(schema.videoRenders.id, render.id));
    await lanePass();
    const row = await postRow(post.id);
    expect(row.status).toBe("failed");
    expect(row.failureKind).toBe("file_missing");
    expect(row.failedAt).not.toBeNull();
    expect((await jobRow(post.id)).status).toBe("failed");
    const alerts = await failedEvents(post.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload).toMatchObject({
      postId: post.id,
      platform: "instagram",
      failureKind: "file_missing",
    });
    // The diagnostic rides along for the founder; the caption never does.
    expect((alerts[0]!.payload as { detail: string }).detail).toContain("has no file");
    expect(JSON.stringify(alerts[0]!.payload)).not.toContain("כיתוב");
    expect(meta.calls.createReelContainer).toBe(0);
  });

  it("a lapsed token fails the post as connection_expired and marks the account expired", async () => {
    meta.throwOn.publishingLimit = tokenLapse();
    // Two posts scheduled while the account was still good; the first meets the
    // lapse, the second then finds an expired account and fails before any call.
    const { post } = await schedule();
    const next = await schedule();
    await lanePass();
    expect((await postRow(post.id)).failureKind).toBe("connection_expired");
    const account = (
      await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, accountId))
    )[0]!;
    expect(account.status).toBe("expired");
    expect(account.lastError).toMatch(/190/);
    expect((await postRow(next.post.id)).failureKind).toBe("connection_expired");
    expect(meta.calls.publishingLimit).toBe(1);
    expect(meta.calls.createReelContainer).toBe(0);
  });

  it("an ERROR container names the sound → sound_unavailable; any other error or an EXPIRED container → platform_refused", async () => {
    meta.statuses = [{ code: "ERROR", detail: "The audio track is not available" }];
    const first = await schedule();
    await lanePass();
    expect((await postRow(first.post.id)).failureKind).toBe("sound_unavailable");

    meta = new FakeMeta();
    setMetaGraphProvider(meta);
    meta.statuses = [{ code: "ERROR", detail: "2207026" }];
    const second = await schedule();
    await lanePass();
    const row = await postRow(second.post.id);
    expect(row.failureKind).toBe("platform_refused");
    expect(row.failureDetail).toContain("2207026");
    expect(meta.calls.publish).toBe(0);
  });

  it("a container that never finishes fails as platform_timeout after the poll budget, counted in polls not wall-clock", async () => {
    meta.statuses = [{ code: "IN_PROGRESS" }];
    const { post } = await schedule();
    await lanePass();
    await db
      .update(schema.jobs)
      .set({ state: { containerId: "container_1", polls: CONTAINER_MAX_POLLS } })
      .where(eq(schema.jobs.idempotencyKey, `post:${post.id}`));
    await makeRunnable();
    await lanePass();
    expect((await postRow(post.id)).failureKind).toBe("platform_timeout");
    expect(meta.calls.publish).toBe(0);
  });

  it("Instagram's spent quota defers the post hourly with deferred_until set, and fails as quota_exhausted after a day", async () => {
    meta.limit = { usage: 50, total: 50 };
    const { post } = await schedule();
    await lanePass();
    let job = await jobRow(post.id);
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(0);
    const since = (job.state as { deferredSince: number }).deferredSince;
    expect(since).toBeGreaterThan(0);
    let row = await postRow(post.id);
    expect(row.status).toBe("publishing");
    expect(row.deferredUntil).not.toBeNull();
    expect(meta.calls.createReelContainer).toBe(0);

    // The quota frees: the deferral clears and the post goes out.
    meta.limit = { usage: 10, total: 50 };
    await makeRunnable();
    await lanePass();
    row = await postRow(post.id);
    expect(row.status).toBe("posted");
    expect(row.deferredUntil).toBeNull();

    // A day of deferral: failed, never published.
    meta = new FakeMeta();
    setMetaGraphProvider(meta);
    meta.limit = { usage: 50, total: 50 };
    const stuck = await schedule();
    await lanePass();
    await db
      .update(schema.jobs)
      .set({ state: { deferredSince: Date.now() - QUOTA_DEFER_MAX_MS - 1 } })
      .where(eq(schema.jobs.idempotencyKey, `post:${stuck.post.id}`));
    await makeRunnable();
    await lanePass();
    row = await postRow(stuck.post.id);
    expect(row.status).toBe("failed");
    expect(row.failureKind).toBe("quota_exhausted");
    expect(row.deferredUntil).toBeNull();
    expect(meta.calls.createReelContainer).toBe(0);
  });

  it("the last transient attempt fails the post as platform_timeout and the job goes dead", async () => {
    meta.throwOn.publishingLimit = () => new Error("meta is down");
    const { post } = await schedule();
    await db
      .update(schema.jobs)
      .set({ attempts: 4 })
      .where(eq(schema.jobs.idempotencyKey, `post:${post.id}`));
    await lanePass();
    expect((await jobRow(post.id)).status).toBe("dead");
    const row = await postRow(post.id);
    expect(row.status).toBe("failed");
    expect(row.failureKind).toBe("platform_timeout");
    expect(await failedEvents(post.id)).toHaveLength(1);
  });

  it("a transient failure with retries left leaves the row publishing and the job queued with backoff", async () => {
    meta.throwOnceOn.publishingLimit = new Error("blip");
    const { post } = await schedule();
    await lanePass();
    const job = await jobRow(post.id);
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(1);
    expect((await postRow(post.id)).status).toBe("publishing");
    expect(await failedEvents(post.id)).toHaveLength(0);
    await makeRunnable();
    await lanePass();
    expect((await postRow(post.id)).status).toBe("posted");
  });

  it("a live Reel whose row write was lost is marked posted even after the account lapsed since — no guard turns a live post into a failure", async () => {
    const { post } = await schedule();
    await db
      .update(schema.jobs)
      .set({
        state: {
          containerId: "container_x",
          publishAttemptedAt: Date.now(),
          mediaId: "media_live",
        },
      })
      .where(eq(schema.jobs.idempotencyKey, `post:${post.id}`));
    await db
      .update(schema.scheduledPosts)
      .set({ status: "publishing" })
      .where(eq(schema.scheduledPosts.id, post.id));
    await db
      .update(schema.socialAccounts)
      .set({ status: "expired" })
      .where(eq(schema.socialAccounts.id, accountId));
    await lanePass();
    const row = await postRow(post.id);
    expect(row.status).toBe("posted");
    expect(row.providerMediaId).toBe("media_live");
    expect(row.permalink).toBeNull();
    expect(meta.calls).toMatchObject({
      publishingLimit: 0,
      createReelContainer: 0,
      publish: 0,
      mediaPermalink: 0,
    });
    expect(await failedEvents(post.id)).toHaveLength(0);
  });

  it("an EXPIRED container (never published) is replaced once; a second expiry is a timeout", async () => {
    meta.statuses = [{ code: "EXPIRED" }, { code: "FINISHED" }];
    const { post } = await schedule();
    // The replacement is rescheduled with no delay, so one drain carries the
    // post through both containers.
    await lanePass();
    const job = await jobRow(post.id);
    expect(job.status).toBe("succeeded");
    expect((job.state as { recreated?: boolean }).recreated).toBe(true);
    expect(meta.calls.createReelContainer).toBe(2);
    expect(meta.calls.publish).toBe(1);
    expect((await postRow(post.id)).status).toBe("posted");

    meta = new FakeMeta();
    setMetaGraphProvider(meta);
    meta.statuses = [{ code: "EXPIRED" }];
    const twice = await schedule();
    await lanePass();
    const row = await postRow(twice.post.id);
    expect(row.status).toBe("failed");
    expect(row.failureKind).toBe("platform_timeout");
    expect(meta.calls.createReelContainer).toBe(2);
    expect(meta.calls.publish).toBe(0);
  });

  it("a post waiting out the quota can still be cancelled — nothing has reached Meta — but not edited", async () => {
    meta.limit = { usage: 50, total: 50 };
    const { post } = await schedule();
    await lanePass();
    expect((await postRow(post.id)).status).toBe("publishing");
    await expect(
      updateScheduledPost(db, { userId, postId: post.id, caption: "x" }),
    ).rejects.toThrow(/not_pending/);
    const cancelled = await cancelScheduledPost(db, { userId, postId: post.id });
    expect(cancelled.status).toBe("cancelled");
    meta.limit = { usage: 0, total: 50 };
    await makeRunnable();
    await lanePass();
    expect((await jobRow(post.id)).status).toBe("succeeded");
    expect(meta.calls.createReelContainer).toBe(0);
    expect((await postRow(post.id)).status).toBe("cancelled");
  });

  it("the orphan sweep ends a post whose job died outside the handler: posted when the state carries a media id, failed as platform_timeout otherwise", async () => {
    const live = await schedule();
    const lost = await schedule();
    await db
      .update(schema.jobs)
      .set({
        status: "dead",
        lastError: "lease expired",
        state: { containerId: "c", mediaId: "media_orphan" },
      })
      .where(eq(schema.jobs.idempotencyKey, `post:${live.post.id}`));
    await db
      .update(schema.scheduledPosts)
      .set({ status: "publishing" })
      .where(eq(schema.scheduledPosts.id, live.post.id));
    await db
      .update(schema.jobs)
      .set({ status: "dead", lastError: "lease expired: worker died mid-run" })
      .where(eq(schema.jobs.idempotencyKey, `post:${lost.post.id}`));

    expect(await failOrphanedPosts(db)).toBe(2);
    expect((await postRow(live.post.id)).status).toBe("posted");
    expect((await postRow(live.post.id)).providerMediaId).toBe("media_orphan");
    const failed = await postRow(lost.post.id);
    expect(failed.status).toBe("failed");
    expect(failed.failureKind).toBe("platform_timeout");
    expect(failed.failureDetail).toContain("worker died mid-run");
    expect(await failedEvents(lost.post.id)).toHaveLength(1);
    // Idempotent: nothing left to end.
    expect(await failOrphanedPosts(db)).toBe(0);
    // The reaper carries it too.
    await handleReapDeadRenders(
      {
        id: "r",
        type: "reap_dead_renders",
        status: "running",
        payload: {},
        state: {},
        attempts: 0,
        maxAttempts: 1,
        runAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        idempotencyKey: "reap_dead_renders",
        lastError: null,
        errorClass: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      { db, log: logger, checkpoint: async () => {} },
    );
  });

  it("a missing SOCIAL_TOKEN_KEY fails the post on the first attempt as internal_error, never blaming the platform", async () => {
    const { post } = await schedule();
    const key = process.env.SOCIAL_TOKEN_KEY;
    delete process.env.SOCIAL_TOKEN_KEY;
    resetEnvCache();
    try {
      await lanePass();
    } finally {
      process.env.SOCIAL_TOKEN_KEY = key;
      resetEnvCache();
    }
    const row = await postRow(post.id);
    expect(row.status).toBe("failed");
    expect(row.failureKind).toBe("internal_error");
    expect(row.failureDetail).toMatch(/SOCIAL_TOKEN_KEY/);
    expect((await jobRow(post.id)).status).toBe("failed");
    expect(meta.calls.publishingLimit).toBe(0);
  });

  it("a retired full-format A render carries a voiceover, so it takes דמות AI's speech-on-top mix", async () => {
    const render = await seedReleasedRender(db, getStorage(), storageRoot, {
      businessId,
      service: "a",
    });
    await db
      .update(schema.videoRenders)
      .set({ params: { format: "full" } })
      .where(eq(schema.videoRenders.id, render.id));
    await schedulePosts(db, {
      userId,
      videoRenderId: render.id,
      accountIds: [accountId],
      scheduledAt: new Date(),
      timezone: "Asia/Jerusalem",
      caption: "",
      sound: { audioId: "audio_1", kind: "music", title: "s" },
    });
    await makeRunnable();
    await lanePass();
    expect(meta.containers[0]!.audio).toEqual({ audioId: "audio_1", ...SOUND_VOLUMES.b });
  });

  it("the last attempt dying after a publish attempt asks Meta first: a PUBLISHED container is posted, never failed", async () => {
    // State as the handler leaves it right after media_publish went out, with
    // the fake remembering that the container was published; the final attempt
    // then dies on a DB-shaped transient before the row write.
    const { post } = await schedule();
    meta.publishedContainers.add("container_live");
    meta.throwOn.mediaPermalink = () => new Error("db blip after publish");
    await db
      .update(schema.jobs)
      .set({
        attempts: 4,
        state: {
          containerId: "container_live",
          polls: 0,
          publishAttemptedAt: Date.now(),
          mediaId: "m",
        },
      })
      .where(eq(schema.jobs.idempotencyKey, `post:${post.id}`));
    await db
      .update(schema.scheduledPosts)
      .set({ status: "publishing" })
      .where(eq(schema.scheduledPosts.id, post.id));
    await lanePass();
    // mediaPermalink is best-effort (caught), so this path posts directly.
    expect((await postRow(post.id)).status).toBe("posted");

    // Without a media id but after a publish attempt: the container decides.
    meta = new FakeMeta();
    setMetaGraphProvider(meta);
    meta.publishedContainers.add("container_live2");
    meta.throwOn.containerStatus = () => new Error("meta unreachable once");
    const second = await schedule();
    await db
      .update(schema.jobs)
      .set({
        attempts: 4,
        state: { containerId: "container_live2", polls: 0, publishAttemptedAt: Date.now() },
      })
      .where(eq(schema.jobs.idempotencyKey, `post:${second.post.id}`));
    await db
      .update(schema.scheduledPosts)
      .set({ status: "publishing" })
      .where(eq(schema.scheduledPosts.id, second.post.id));
    // The handler's own container read throws once (the fifth and last
    // attempt); the terminal mapping's confirmation read then answers
    // PUBLISHED, so the post is marked posted instead of failed.
    delete meta.throwOn.containerStatus;
    meta.throwOnceOn.containerStatus = new Error("meta unreachable once");
    await lanePass();
    const row = await postRow(second.post.id);
    expect(row.status).toBe("posted");
    expect(row.providerMediaId).toBeNull();
    expect((await jobRow(second.post.id)).status).toBe("dead");
    expect(await failedEvents(second.post.id)).toHaveLength(0);
  });

  it("no token reaches a failure detail, an account error or an alert payload", async () => {
    meta.throwOn.publishingLimit = tokenLapse();
    const { post } = await schedule();
    await lanePass();
    const row = await postRow(post.id);
    expect(row.failureDetail).not.toContain("PAGE_TOKEN");
    const account = (
      await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, accountId))
    )[0]!;
    expect(account.lastError).not.toContain("PAGE_TOKEN");
    const [alert] = await failedEvents(post.id);
    expect(JSON.stringify(alert!.payload)).not.toContain("PAGE_TOKEN");
    expect(JSON.stringify(alert!.payload)).toContain("connection_expired");
  });
});
