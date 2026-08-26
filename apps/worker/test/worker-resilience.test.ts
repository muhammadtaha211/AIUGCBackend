import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../packages/core/test/helpers/pglite";
import type { Db } from "../../../packages/core/src/db";
import { jobs } from "../../../packages/core/src/db/schema";
import { enqueue } from "../../../packages/core/src/jobs/queue";
import { runLane, type WorkerLaneOptions } from "../../../packages/core/src/jobs/worker";
import { superviseLane } from "../src/lanes";

// These pin the fix for docs/vault/defects/worker-exits-on-a-dropped-connection.md:
// a transient DB fault during the poll (or the settle write after a failed job)
// killed the whole worker process twice in production.

type DbMethods = Record<
  "execute" | "select" | "insert" | "update",
  (...args: unknown[]) => unknown
>;

/** Real PGlite db with chosen methods overridden to simulate a DB fault. */
function stubDb(db: Db, overrides: Partial<DbMethods>): Db {
  const real = db as unknown as DbMethods;
  return {
    execute: (...args: unknown[]) => real.execute(...args),
    select: (...args: unknown[]) => real.select(...args),
    insert: (...args: unknown[]) => real.insert(...args),
    update: (...args: unknown[]) => real.update(...args),
    ...overrides,
  } as unknown as Db;
}

/**
 * Each db.execute consumes the next scripted outcome; "fail" rejects the way a
 * recycled pooler socket does, an exhausted script delegates to the real db.
 * Only the lease sweep and claim() reach db.execute on the lane path, and the
 * sweep runs exactly once per test lane (first iteration, then not for 60s) —
 * so call #1 is the sweep and every later call is a claim.
 */
function scriptedExecuteDb(db: Db, script: Array<"ok" | "fail">): Db {
  const real = db as unknown as { execute: (...args: unknown[]) => unknown };
  const queue = [...script];
  return stubDb(db, {
    execute: (...args: unknown[]) => {
      if ((queue.shift() ?? "ok") === "fail") {
        return Promise.reject(new Error("ECONNRESET: pooler recycled the socket"));
      }
      return real.execute(...args);
    },
  });
}

async function statusOf(db: Db, idempotencyKey: string): Promise<string | undefined> {
  const rows = await db.select().from(jobs);
  return rows.find((j) => j.idempotencyKey === idempotencyKey)?.status;
}

describe("lane resilience (a dropped connection must not kill the worker)", () => {
  it("a rejected claim does not exit the lane — it keeps polling and the job still runs", async () => {
    const { db, pg } = await createTestDb();
    await enqueue(db, { type: "noop", idempotencyKey: "survive:1" });
    const abort = new AbortController();
    const seen: string[] = [];

    // Script: sweep ok, first claim rejects, retry claim hits the real db.
    await runLane(scriptedExecuteDb(db, ["ok", "fail"]), {
      workerId: "resilient",
      pollIntervalMs: 5,
      signal: abort.signal,
      handlers: {
        noop: async (job) => {
          seen.push(job.idempotencyKey);
          abort.abort(); // job processed — end the otherwise endless lane
          return { kind: "done" };
        },
      },
    });

    expect(seen).toEqual(["survive:1"]);
    expect(await statusOf(db, "survive:1")).toBe("succeeded");
    await pg.close();
  });

  it("drain mode does not throw on a single claim failure followed by success", async () => {
    const { db, pg } = await createTestDb();
    await enqueue(db, { type: "noop", idempotencyKey: "blip:1" });
    const seen: string[] = [];

    await runLane(scriptedExecuteDb(db, ["ok", "fail"]), {
      workerId: "blipped",
      drainAndExit: true,
      pollIntervalMs: 5,
      handlers: {
        noop: async (job) => {
          seen.push(job.idempotencyKey);
          return { kind: "done" };
        },
      },
    });

    expect(seen).toEqual(["blip:1"]);
    await pg.close();
  });

  it("claimFailures resets on success: fail, fail, ok, fail again drains instead of throwing", async () => {
    const { db, pg } = await createTestDb();
    await enqueue(db, { type: "noop", idempotencyKey: "reset:1" });
    const seen: string[] = [];

    // sweep, fail, fail (2 consecutive), ok (claims the job -> counter resets),
    // fail (1 of 3 again — cumulative would be 3 and throw without the reset),
    // ok (empty queue -> drain exits).
    await runLane(scriptedExecuteDb(db, ["ok", "fail", "fail", "ok", "fail", "ok"]), {
      workerId: "resetter",
      drainAndExit: true,
      pollIntervalMs: 5,
      handlers: {
        noop: async (job) => {
          seen.push(job.idempotencyKey);
          return { kind: "done" };
        },
      },
    });

    expect(seen).toEqual(["reset:1"]);
    await pg.close();
  });

  it("drain mode fails fast on the third consecutive claim failure", async () => {
    const { db, pg } = await createTestDb();

    await expect(
      runLane(scriptedExecuteDb(db, ["ok", "fail", "fail", "fail"]), {
        workerId: "drainer",
        drainAndExit: true,
        pollIntervalMs: 5,
        handlers: {},
      }),
    ).rejects.toThrow(/pooler recycled/);

    await pg.close();
  });

  it("a settle write that throws does not exit the lane; the row stays running for the sweep", async () => {
    const { db, pg } = await createTestDb();
    await enqueue(db, { type: "boom", idempotencyKey: "boom:1" });

    // Handler fails AND the failTransient write fails (dead DB): the lane must
    // carry on. The job stays `running` — the lease sweep is the recovery path.
    await runLane(
      stubDb(db, {
        update: () => {
          throw new Error("connection closed mid-settle");
        },
      }),
      {
        workerId: "settler",
        drainAndExit: true,
        pollIntervalMs: 5,
        handlers: {
          boom: async () => {
            throw new Error("provider 503");
          },
        },
      },
    );

    expect(await statusOf(db, "boom:1")).toBe("running");
    await pg.close();
  });
});

describe("lane supervision", () => {
  it("a crash-looping lane does not stop the other lane, and the supervisor keeps restarting it", async () => {
    const { db, pg } = await createTestDb();
    await enqueue(db, { type: "light_noop", idempotencyKey: "light:1" });
    const abort = new AbortController();
    const seen: string[] = [];
    let crashes = 0;

    const alwaysCrashing: typeof runLane = async () => {
      crashes += 1;
      throw new Error("simulated lane crash");
    };
    const laneOpts = (workerId: string, types: string[]): WorkerLaneOptions => ({
      workerId,
      types,
      pollIntervalMs: 5,
      signal: abort.signal,
      handlers: {
        light_noop: async (job) => {
          seen.push(job.idempotencyKey);
          return { kind: "done" };
        },
      },
    });

    await Promise.all([
      superviseLane(db, laneOpts("heavy", ["render_video"]), alwaysCrashing),
      superviseLane(db, laneOpts("light", ["light_noop"])),
      (async () => {
        // The light lane must finish its job WHILE the heavy lane crash-loops.
        while (seen.length === 0) await new Promise((r) => setTimeout(r, 5));
        abort.abort();
      })(),
    ]);

    expect(seen).toEqual(["light:1"]);
    expect(await statusOf(db, "light:1")).toBe("succeeded");
    expect(crashes).toBeGreaterThan(1); // restarted after crashing — not a one-shot
    await pg.close();
  });

  it("superviseLane returns promptly when aborted during its restart backoff", async () => {
    const abort = new AbortController();
    let crashes = 0;
    const crashing: typeof runLane = async () => {
      crashes += 1;
      throw new Error("simulated lane crash");
    };

    // Huge poll interval so the post-crash backoff is the only thing that
    // could block shutdown. No db needed — the lane never touches it.
    const supervised = superviseLane(
      {} as Db,
      { workerId: "w", handlers: {}, pollIntervalMs: 60_000, signal: abort.signal },
      crashing,
    );
    while (crashes === 0) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 20)); // settle into the backoff sleep

    const abortedAt = Date.now();
    abort.abort();
    await supervised;

    // Well under the 60s backoff: shutdown must not queue behind it. This pins
    // the 2s-delayed-SIGTERM regression of a signal-blind restart sleep.
    expect(Date.now() - abortedAt).toBeLessThan(5_000);
  });
});
