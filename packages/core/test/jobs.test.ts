import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { createTestDb } from "./helpers/pglite";
import { jobs } from "../src/db/schema";
import { PermanentError } from "../src/jobs/errors";
import {
  claim,
  complete,
  deriveJobProgress,
  enqueue,
  getJobProgress,
  JOB_LEASE_MS,
  recoverExpiredLeases,
  WORKER_HEARTBEAT_STALE_MS,
} from "../src/jobs/queue";
import { ensureReaperJob } from "../src/jobs/schedule";
import { runJob, runLane, type DeadJob } from "../src/jobs/worker";

describe("job queue", () => {
  it("enqueue is idempotent on idempotency_key", async () => {
    const { db, pg } = await createTestDb();

    const first = await enqueue(db, { type: "noop", idempotencyKey: "noop:1" });
    const second = await enqueue(db, { type: "noop", idempotencyKey: "noop:1" });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);

    await pg.close();
  });

  it("claim -> run -> complete happy path", async () => {
    const { db, pg } = await createTestDb();
    await enqueue(db, { type: "noop", idempotencyKey: "noop:2", payload: { x: 1 } });

    const job = await claim(db, { workerId: "test-worker" });
    expect(job).toBeDefined();
    expect(job!.status).toBe("running");
    expect(job!.lockedBy).toBe("test-worker");
    expect(job!.payload).toEqual({ x: 1 });

    // Queue is now empty for other claimers.
    expect(await claim(db, { workerId: "other" })).toBeUndefined();

    await complete(db, job!.id);
    const rows = await db.select().from(jobs).where(eq(jobs.id, job!.id));
    expect(rows[0]!.status).toBe("succeeded");

    await pg.close();
  });

  it("claim respects a type filter (heavy/light lanes)", async () => {
    const { db, pg } = await createTestDb();
    await enqueue(db, { type: "render_video", idempotencyKey: "render:1" });

    expect(await claim(db, { workerId: "light", types: ["synth_tts"] })).toBeUndefined();
    const heavy = await claim(db, { workerId: "heavy", types: ["render_video", "lipsync"] });
    expect(heavy?.type).toBe("render_video");

    await pg.close();
  });

  it("transient failures retry with backoff, then go dead", async () => {
    const { db, pg } = await createTestDb();
    await enqueue(db, { type: "flaky", idempotencyKey: "flaky:1", maxAttempts: 2 });

    const handlers = {
      flaky: async () => {
        throw new Error("provider 503");
      },
    };

    // apps/worker passes its Sentry reporter here; it must fire on the death
    // and not on the retry before it.
    const dead: DeadJob[] = [];

    const first = await claim(db, { workerId: "w" });
    await runJob(db, first!, handlers, (d) => dead.push(d));
    let row = (await db.select().from(jobs).where(eq(jobs.id, first!.id)))[0]!;
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(1);
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(dead).toEqual([]);

    // Force it runnable again, fail again -> dead (maxAttempts = 2).
    await db
      .update(jobs)
      .set({ runAt: new Date(Date.now() - 1000) })
      .where(eq(jobs.id, row.id));
    const secondClaim = await claim(db, { workerId: "w" });
    await runJob(db, secondClaim!, handlers, (d) => dead.push(d));
    row = (await db.select().from(jobs).where(eq(jobs.id, row.id)))[0]!;
    expect(row.status).toBe("dead");
    expect(row.lastError).toContain("503");

    // Exactly once, and carrying the diagnostic the founder needs — the report
    // must agree with the row it describes.
    expect(dead).toHaveLength(1);
    expect(dead[0]).toEqual({
      jobId: row.id,
      type: "flaky",
      attempts: row.attempts,
      lastError: row.lastError,
    });

    await pg.close();
  });

  it("a settle write that throws reports no death — the row is still running", async () => {
    const { db, pg } = await createTestDb();
    await enqueue(db, { type: "flaky", idempotencyKey: "flaky:2", maxAttempts: 1 });

    const job = await claim(db, { workerId: "w" });
    const dead: DeadJob[] = [];
    // One attempt allowed, so the handler's throw would kill it — except the
    // `dead` write never lands (dead DB). The row stays `running` and the lease
    // sweep owns it; reporting a death that was never written would send the
    // founder after a job that is about to be retried.
    const deadDb = {
      ...db,
      update: () => {
        throw new Error("connection closed mid-settle");
      },
    } as unknown as typeof db;

    await runJob(
      deadDb,
      job!,
      {
        flaky: async () => {
          throw new Error("provider 503");
        },
      },
      (d) => dead.push(d),
    );

    const row = (await db.select().from(jobs).where(eq(jobs.id, job!.id)))[0]!;
    expect(row.status).toBe("running");
    expect(dead).toEqual([]);

    await pg.close();
  });

  it("permanent failures fail immediately without retry", async () => {
    const { db, pg } = await createTestDb();
    await enqueue(db, { type: "bad_input", idempotencyKey: "bad:1" });

    const job = await claim(db, { workerId: "w" });
    await runJob(db, job!, {
      bad_input: async () => {
        throw new PermanentError("הסרטון קצר מדי"); // human-readable, user-facing
      },
    });

    const row = (await db.select().from(jobs).where(eq(jobs.id, job!.id)))[0]!;
    expect(row.status).toBe("failed");
    expect(row.errorClass).toBe("permanent");
    expect(row.attempts).toBe(0);

    await pg.close();
  });

  it("reschedule keeps polling jobs alive without consuming attempts", async () => {
    const { db, pg } = await createTestDb();
    await enqueue(db, { type: "lipsync", idempotencyKey: "lipsync:1" });

    const job = await claim(db, { workerId: "w" });
    await runJob(db, job!, {
      lipsync: async (_job, ctx) => {
        await ctx.checkpoint({ falRequestId: "fal_123" });
        return { kind: "reschedule", delayMs: 30_000 };
      },
    });

    const row = (await db.select().from(jobs).where(eq(jobs.id, job!.id)))[0]!;
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(0);
    expect(row.state).toEqual({ falRequestId: "fal_123" });
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now() + 20_000);

    await pg.close();
  });

  it("runLane drains the queue and exits", async () => {
    const { db, pg } = await createTestDb();
    const seen: string[] = [];
    await enqueue(db, { type: "noop", idempotencyKey: "drain:1" });
    await enqueue(db, { type: "noop", idempotencyKey: "drain:2" });

    await runLane(db, {
      workerId: "drainer",
      drainAndExit: true,
      handlers: {
        noop: async (job) => {
          seen.push(job.idempotencyKey);
          return { kind: "done" };
        },
      },
    });

    expect(seen.sort()).toEqual(["drain:1", "drain:2"]);
    await pg.close();
  });
});

describe("lease recovery (worker killed between claim and completion)", () => {
  /** Simulate the worker dying mid-run: the row stays `running` forever. */
  async function abandonPastLease(db: Awaited<ReturnType<typeof createTestDb>>["db"], id: string) {
    await db.execute(
      sql`update jobs set locked_at = now() - interval '31 minutes' where id = ${id}`,
    );
  }

  it("reclaims an abandoned job, consuming an attempt; a live lock is untouched", async () => {
    const { db, pg } = await createTestDb();
    await enqueue(db, { type: "noop", idempotencyKey: "stuck:1" });
    await enqueue(db, { type: "noop", idempotencyKey: "alive:1" });
    const stuck = await claim(db, { workerId: "died" });
    const alive = await claim(db, { workerId: "working" });
    await abandonPastLease(db, stuck!.id);

    expect(await recoverExpiredLeases(db)).toBe(1);

    const rows = Object.fromEntries((await db.select().from(jobs)).map((j) => [j.id, j]));
    expect(rows[stuck!.id]!.status).toBe("queued");
    expect(rows[stuck!.id]!.attempts).toBe(1);
    expect(rows[stuck!.id]!.lastError).toMatch(/lease expired/);
    expect(rows[alive!.id]!.status).toBe("running");
    expect(rows[alive!.id]!.attempts).toBe(0);

    // The reclaimed job is genuinely runnable again.
    const reclaimed = await claim(db, { workerId: "second-worker" });
    expect(reclaimed?.id).toBe(stuck!.id);
    await pg.close();
  });

  it("a job that reliably kills its worker exhausts attempts and goes dead", async () => {
    const { db, pg } = await createTestDb();
    await enqueue(db, { type: "worker_killer", idempotencyKey: "killer:1", maxAttempts: 2 });

    for (let attempt = 0; attempt < 2; attempt++) {
      const job = await claim(db, { workerId: `victim-${attempt}` });
      expect(job).toBeDefined();
      await abandonPastLease(db, job!.id);
      await recoverExpiredLeases(db);
    }

    // Second reclaim reached max_attempts: dead, not requeued — it enters the
    // dead-job machinery (reaper -> failed render + refund) instead of looping.
    const row = (await db.select().from(jobs).where(eq(jobs.status, "dead")))[0]!;
    expect(row.idempotencyKey).toBe("killer:1");
    expect(row.attempts).toBe(2);
    expect(await claim(db, { workerId: "nobody" })).toBeUndefined();
    await pg.close();
  });

  it("a stuck reaper singleton recovers with no manual SQL", async () => {
    const { db, pg } = await createTestDb();
    await ensureReaperJob(db);
    const job = await claim(db, { workerId: "died-mid-sweep" });
    expect(job?.type).toBe("reap_dead_renders");
    await abandonPastLease(db, job!.id);

    // The bug this heals: ensure is a no-op against a running row, so before
    // the lease sweep no replacement could ever be created.
    await ensureReaperJob(db);
    const stillStuck = (await db.select().from(jobs).where(eq(jobs.id, job!.id)))[0]!;
    expect(stillStuck.status).toBe("running");

    expect(await recoverExpiredLeases(db)).toBe(1);
    const healed = await claim(db, { workerId: "next-worker" });
    expect(healed?.id).toBe(job!.id);
    expect(healed?.type).toBe("reap_dead_renders");
    // maxAttempts is effectively infinite — a reclaim can never kill the singleton.
    expect(healed!.attempts).toBe(1);
    expect(healed!.maxAttempts).toBe(1_000_000);
    await pg.close();
  });
});

describe("job progress", () => {
  const now = new Date("2026-08-22T12:00:00Z");
  const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);

  it("derives state from the job row, elapsed from the right anchor", () => {
    expect(deriveJobProgress({ now })).toEqual({ state: "missing", heartbeat: "unknown" });
    expect(
      deriveJobProgress({
        job: { status: "queued", lockedAt: null, createdAt: secondsAgo(90), runAt: now },
        now,
      }),
    ).toEqual({ state: "queued", elapsedMs: 90_000, heartbeat: "unknown" });
    // Running measures from the claim, not the enqueue.
    expect(
      deriveJobProgress({
        job: {
          status: "running",
          lockedAt: secondsAgo(30),
          createdAt: secondsAgo(300),
          runAt: now,
        },
        now,
      }),
    ).toEqual({ state: "running", elapsedMs: 30_000, heartbeat: "unknown" });
    expect(
      deriveJobProgress({
        job: { status: "succeeded", lockedAt: null, createdAt: now, runAt: now },
        now,
      }).state,
    ).toBe("done");
    for (const status of ["failed", "dead"] as const) {
      expect(
        deriveJobProgress({ job: { status, lockedAt: null, createdAt: now, runAt: now }, now })
          .state,
      ).toBe("failed");
    }
  });

  it("progress surfaces only a running job's sane 0-1 checkpoint fraction", () => {
    const running = (state: unknown) =>
      deriveJobProgress({
        job: { status: "running", lockedAt: secondsAgo(30), createdAt: now, runAt: now, state },
        now,
      }).progress;
    expect(running({ renderProgress: 0.42 })).toBe(0.42);
    expect(running({ renderProgress: 0 })).toBe(0);
    expect(running({ renderProgress: 1 })).toBe(1);
    // Other handlers' state shapes, junk, and out-of-range values stay silent.
    expect(running({})).toBeUndefined();
    expect(running({ falRequestId: "abc" })).toBeUndefined();
    expect(running({ renderProgress: "0.5" })).toBeUndefined();
    expect(running({ renderProgress: 1.5 })).toBeUndefined();
    expect(running(undefined)).toBeUndefined();
    // A queued job never carries one, whatever a stale checkpoint left behind.
    expect(
      deriveJobProgress({
        job: {
          status: "queued",
          lockedAt: null,
          createdAt: now,
          runAt: now,
          state: { renderProgress: 0.9 },
        },
        now,
      }).progress,
    ).toBeUndefined();
  });

  it("ahead passes through only for queued jobs with a count", () => {
    const queued = { status: "queued", lockedAt: null, createdAt: now, runAt: now } as const;
    expect(deriveJobProgress({ job: queued, aheadCount: 3, now }).ahead).toBe(3);
    expect(deriveJobProgress({ job: queued, now }).ahead).toBeUndefined();
    expect(
      deriveJobProgress({
        job: { status: "running", lockedAt: null, createdAt: now, runAt: now },
        aheadCount: 3,
        now,
      }).ahead,
    ).toBeUndefined();
  });

  it("a deliberately-rescheduled queued job carries resumeAtMs; a near-now one does not", () => {
    const at = (runAt: Date) =>
      deriveJobProgress({
        job: { status: "queued", lockedAt: null, createdAt: secondsAgo(10), runAt },
        now,
      }).resumeAtMs;
    // Budget park / deep backoff: hours out — "starts soon" would be a lie.
    const parked = new Date(now.getTime() + 4 * 60 * 60_000);
    expect(at(parked)).toBe(parked.getTime());
    // First-retry backoff (~30-40s) and ordinary queue wait read as normal.
    expect(at(new Date(now.getTime() + 40_000))).toBeUndefined();
    expect(at(secondsAgo(5))).toBeUndefined();
  });

  it("heartbeat: fresh reaper = alive, past the threshold = stale, absent = unknown", () => {
    const at = (heartbeatAt?: Date) => deriveJobProgress({ heartbeatAt, now }).heartbeat;
    expect(at(undefined)).toBe("unknown");
    expect(at(secondsAgo(60))).toBe("alive");
    // Exactly at the threshold is still alive — only PAST it is stale.
    expect(at(new Date(now.getTime() - WORKER_HEARTBEAT_STALE_MS))).toBe("alive");
    expect(at(new Date(now.getTime() - WORKER_HEARTBEAT_STALE_MS - 1))).toBe("stale");
  });

  it("a lease-valid running lock proves a worker even when the reaper is starved", () => {
    // The reaper shares the sequential light lane: a single long light job
    // (a 1GB ingest) starves it past the stale window while the pipeline is
    // demonstrably working — the running lock must keep the heartbeat alive.
    const staleReaper = new Date(now.getTime() - WORKER_HEARTBEAT_STALE_MS - 60_000);
    const at = (runningLockedAt?: Date, heartbeatAt?: Date) =>
      deriveJobProgress({ heartbeatAt, runningLockedAt, now }).heartbeat;
    expect(at(secondsAgo(240), staleReaper)).toBe("alive");
    expect(at(secondsAgo(240), undefined)).toBe("alive");
    // A lock older than the lease proves nothing — the sweep will reclaim it.
    expect(at(new Date(now.getTime() - JOB_LEASE_MS - 1), staleReaper)).toBe("stale");
    expect(at(new Date(now.getTime() - JOB_LEASE_MS - 1), undefined)).toBe("unknown");
  });

  it("getJobProgress counts the lane ahead of a queued job in claim order", async () => {
    const { db, pg } = await createTestDb();
    const heavy = ["render_video", "lipsync", "analyze_demo"] as const;
    // Real-clock relative: claim() and the ahead count compare against the
    // DB's own now(), so the fixed test clock above cannot be used here.
    const realSecondsAgo = (s: number) => new Date(Date.now() - s * 1000);

    // Claim order is run_at asc: one running render, two runnable heavy jobs
    // earlier than ours, one light job (other lane), one future heavy job.
    await enqueue(db, {
      type: "render_video",
      idempotencyKey: "r:running",
      runAt: realSecondsAgo(50),
    });
    expect((await claim(db, { workerId: "w", types: heavy }))?.idempotencyKey).toBe("r:running");
    await enqueue(db, {
      type: "render_video",
      idempotencyKey: "r:early",
      runAt: realSecondsAgo(40),
    });
    await enqueue(db, { type: "lipsync", idempotencyKey: "l:early", runAt: realSecondsAgo(30) });
    await enqueue(db, { type: "janitor", idempotencyKey: "j:light", runAt: realSecondsAgo(60) });
    await enqueue(db, {
      type: "analyze_demo",
      idempotencyKey: "analyze:me",
      runAt: realSecondsAgo(20),
    });
    await enqueue(db, {
      type: "render_video",
      idempotencyKey: "r:future",
      runAt: new Date(Date.now() + 60_000),
    });

    const progress = await getJobProgress(db, {
      idempotencyKey: "analyze:me",
      aheadOfTypes: heavy,
    });
    expect(progress.state).toBe("queued");
    // r:early + l:early + the running render; never itself, the light job, or
    // the future one.
    expect(progress.ahead).toBe(3);
    // No reaper row, but r:running's fresh lock proves a worker.
    expect(progress.heartbeat).toBe("alive");

    await pg.close();
  });

  it("getJobProgress hands db.execute no raw Date params (postgres-js can't serialize them)", async () => {
    const { db, pg } = await createTestDb();
    await enqueue(db, { type: "render_video", idempotencyKey: "r:queued" });

    // The production driver throws ERR_INVALID_ARG_TYPE when a Date reaches a
    // raw-sql param: raw params skip drizzle's column mappers, and drizzle
    // replaces postgres-js's own Date serializer with an identity fn. PGlite
    // serializes Dates fine, so this harness can't observe the throw — pin
    // the invariant on the params themselves.
    const rawParams: unknown[] = [];
    const realExecute = db.execute.bind(db);
    db.execute = ((query: Parameters<typeof db.execute>[0]) => {
      if (typeof query !== "string") {
        rawParams.push(...new PgDialect().sqlToQuery(query.getSQL()).params);
      }
      return realExecute(query);
    }) as typeof db.execute;

    const progress = await getJobProgress(db, {
      idempotencyKey: "r:queued",
      aheadOfTypes: ["render_video", "lipsync", "analyze_demo"],
    });

    expect(progress.state).toBe("queued");
    expect(rawParams.length).toBeGreaterThan(0);
    expect(rawParams.filter((p) => p instanceof Date)).toEqual([]);

    await pg.close();
  });

  it("getJobProgress reads the reaper singleton — and a fresh running lock — as the heartbeat", async () => {
    const { db, pg } = await createTestDb();
    await ensureReaperJob(db);
    await enqueue(db, { type: "ingest_demo", idempotencyKey: "ingest:d1" });

    const fresh = await getJobProgress(db, { idempotencyKey: "ingest:d1" });
    expect(fresh.state).toBe("queued");
    expect(fresh.heartbeat).toBe("alive");

    await db
      .update(jobs)
      .set({ updatedAt: new Date(Date.now() - WORKER_HEARTBEAT_STALE_MS - 60_000) })
      .where(eq(jobs.idempotencyKey, "reap_dead_renders"));
    const stale = await getJobProgress(db, { idempotencyKey: "ingest:d1" });
    expect(stale.heartbeat).toBe("stale");

    // The starved-reaper hole: claim the ingest (a long light job) — its own
    // lease-valid lock must read as alive, not "nothing is processing this".
    // (Typed claim: the stale reaper row is older and would be picked first.)
    expect((await claim(db, { workerId: "w", types: ["ingest_demo"] }))?.idempotencyKey).toBe(
      "ingest:d1",
    );
    const working = await getJobProgress(db, { idempotencyKey: "ingest:d1" });
    expect(working.state).toBe("running");
    expect(working.heartbeat).toBe("alive");

    expect((await getJobProgress(db, { idempotencyKey: "ingest:nope" })).state).toBe("missing");

    await pg.close();
  });

  it("newestMatching follows a re-run key family instead of the first attempt's corpse", async () => {
    const { db, pg } = await createTestDb();
    await enqueue(db, { type: "analyze_demo", idempotencyKey: "analyze:d9" });
    await db
      .update(jobs)
      .set({ status: "failed", createdAt: new Date(Date.now() - 60_000) })
      .where(eq(jobs.idempotencyKey, "analyze:d9"));
    await enqueue(db, { type: "analyze_demo", idempotencyKey: "analyze:d9:r1" });

    // Pinned to the bare key: the dead first attempt.
    expect((await getJobProgress(db, { idempotencyKey: "analyze:d9" })).state).toBe("failed");
    // newestMatching: the live retry.
    expect(
      (await getJobProgress(db, { idempotencyKey: "analyze:d9", newestMatching: true })).state,
    ).toBe("queued");

    await pg.close();
  });
});
