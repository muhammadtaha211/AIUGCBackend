import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./helpers/pglite";
import { jobs } from "../src/db/schema";
import { PermanentError } from "../src/jobs/errors";
import { claim, complete, enqueue } from "../src/jobs/queue";
import { runJob, runLane } from "../src/jobs/worker";

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

    const first = await claim(db, { workerId: "w" });
    await runJob(db, first!, handlers);
    let row = (await db.select().from(jobs).where(eq(jobs.id, first!.id)))[0]!;
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(1);
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now());

    // Force it runnable again, fail again -> dead (maxAttempts = 2).
    await db
      .update(jobs)
      .set({ runAt: new Date(Date.now() - 1000) })
      .where(eq(jobs.id, row.id));
    const secondClaim = await claim(db, { workerId: "w" });
    await runJob(db, secondClaim!, handlers);
    row = (await db.select().from(jobs).where(eq(jobs.id, row.id)))[0]!;
    expect(row.status).toBe("dead");
    expect(row.lastError).toContain("503");

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
