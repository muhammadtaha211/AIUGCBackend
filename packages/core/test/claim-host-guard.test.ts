import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../src/config";
import {
  claim,
  enqueue,
  isLocalWorkerId,
  isProductionDatabaseUrl,
  PRODUCTION_PROJECT_REF,
} from "../src/jobs/queue";
import { createTestDb } from "./helpers/pglite";

/**
 * The guard that keeps a developer machine out of the production queue.
 * Nine production jobs were claimed by `local:*` workers before it existed
 * (docs/vault/facts/local-workers-claimed-nine-production-jobs.md); the
 * scenario it actually exists for — a DRY_RUN worker marking a customer's
 * render succeeded and writing a placeholder — had not happened yet.
 *
 * The box must remain unaffected: it sets WORKER_ID=hetzner
 * (docs/07-worker-box.md:184) and does not run DRY_RUN, so neither predicate
 * is true there.
 */

// No password: a connection string in a test file should not look like one.
const PROD_URL = `postgres://postgres.${PRODUCTION_PROJECT_REF}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;
const OTHER_URL =
  "postgres://postgres.someotherproject@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";

const originalUrl = process.env.DATABASE_URL;
const originalDryRun = process.env.DRY_RUN;

function setEnv(env: { DATABASE_URL?: string; DRY_RUN?: string }): void {
  if (env.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = env.DATABASE_URL;
  if (env.DRY_RUN === undefined) delete process.env.DRY_RUN;
  else process.env.DRY_RUN = env.DRY_RUN;
  resetEnvCache();
}

afterEach(() => {
  setEnv({ DATABASE_URL: originalUrl, DRY_RUN: originalDryRun });
  vi.restoreAllMocks();
});

/** A queued job that a working claim would return. */
async function queueOne(): Promise<Awaited<ReturnType<typeof createTestDb>>> {
  const fixture = await createTestDb();
  await enqueue(fixture.db, { type: "noop", idempotencyKey: "guard:1" });
  return fixture;
}

describe("isLocalWorkerId", () => {
  it("matches both prefixes this repo hands a developer machine", () => {
    // WORKER_ID default, and what every desktop .env pins.
    expect(isLocalWorkerId("local:heavy")).toBe(true);
    expect(isLocalWorkerId("local:light")).toBe(true);
    expect(isLocalWorkerId("local")).toBe(true);
    // `aiugc work` hardcodes these and never reads WORKER_ID.
    expect(isLocalWorkerId("cli:heavy")).toBe(true);
    expect(isLocalWorkerId("cli:light")).toBe(true);
  });

  it("does not match the box, or a second box the founder may add", () => {
    expect(isLocalWorkerId("hetzner:heavy")).toBe(false);
    expect(isLocalWorkerId("hetzner:light")).toBe(false);
    expect(isLocalWorkerId("hetzner2:heavy")).toBe(false);
    // Deny list, not allowlist: an unknown host is allowed through on purpose.
    expect(isLocalWorkerId("fly-iad:heavy")).toBe(false);
  });

  it("matches on the host segment, not a substring of it", () => {
    expect(isLocalWorkerId("localish:heavy")).toBe(false);
    expect(isLocalWorkerId("clip:heavy")).toBe(false);
    expect(isLocalWorkerId("box-local:heavy")).toBe(false);
  });
});

describe("isProductionDatabaseUrl", () => {
  it("matches the live project ref however the connection string spells the host", () => {
    expect(isProductionDatabaseUrl(PROD_URL)).toBe(true);
    expect(
      isProductionDatabaseUrl(
        `postgres://postgres:x@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`,
      ),
    ).toBe(true);
    // The transaction pooler, which the worker box is still on (vault 0016).
    expect(
      isProductionDatabaseUrl(
        `postgres://postgres.${PRODUCTION_PROJECT_REF}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`,
      ),
    ).toBe(true);
  });

  it("does not match another project or an unset url", () => {
    expect(isProductionDatabaseUrl(OTHER_URL)).toBe(false);
    expect(isProductionDatabaseUrl("postgres://localhost:5432/aiugc")).toBe(false);
    expect(isProductionDatabaseUrl(undefined)).toBe(false);
  });
});

describe("claim refuses a local or DRY_RUN worker against production", () => {
  it("a local worker id against production claims nothing", async () => {
    const { db, pg } = await queueOne();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    setEnv({ DATABASE_URL: PROD_URL });

    const job = await claim(db, { workerId: "local:heavy" });

    expect(job).toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
    const line = String(err.mock.calls[0]?.[0]);
    expect(line).toContain("claim refused");
    expect(line).toContain("local:heavy");
    expect(line).toContain(PRODUCTION_PROJECT_REF);
    await pg.close();
  });

  it("`aiugc work` claims nothing against production either", async () => {
    const { db, pg } = await queueOne();
    vi.spyOn(console, "error").mockImplementation(() => {});
    setEnv({ DATABASE_URL: PROD_URL });

    expect(await claim(db, { workerId: "cli:heavy" })).toBeUndefined();
    expect(await claim(db, { workerId: "cli:light" })).toBeUndefined();
    await pg.close();
  });

  it("the same local worker claims normally against a non-production database", async () => {
    const { db, pg } = await queueOne();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    setEnv({ DATABASE_URL: OTHER_URL });

    const job = await claim(db, { workerId: "local:heavy" });

    expect(job?.type).toBe("noop");
    expect(job?.lockedBy).toBe("local:heavy");
    expect(err).not.toHaveBeenCalled();
    await pg.close();
  });

  it("THE BOX: a non-local worker still claims against production", async () => {
    const { db, pg } = await queueOne();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    setEnv({ DATABASE_URL: PROD_URL });

    const job = await claim(db, { workerId: "hetzner:heavy" });

    expect(job?.type).toBe("noop");
    expect(job?.lockedBy).toBe("hetzner:heavy");
    expect(job?.status).toBe("running");
    expect(err).not.toHaveBeenCalled();
    await pg.close();
  });

  it("DRY_RUN against production claims nothing whatever the worker id", async () => {
    const { db, pg } = await queueOne();
    vi.spyOn(console, "error").mockImplementation(() => {});
    setEnv({ DATABASE_URL: PROD_URL, DRY_RUN: "1" });

    // Including the box's own id: a DRY_RUN worker writing a placeholder file
    // over a customer's render is the failure this half exists for.
    expect(await claim(db, { workerId: "hetzner:heavy" })).toBeUndefined();
    expect(await claim(db, { workerId: "local:heavy" })).toBeUndefined();
    await pg.close();
  });

  it("DRY_RUN against a non-production database still claims", async () => {
    const { db, pg } = await queueOne();
    setEnv({ DATABASE_URL: OTHER_URL, DRY_RUN: "1" });

    const job = await claim(db, { workerId: "local:light" });

    expect(job?.type).toBe("noop");
    await pg.close();
  });

  it("a refusal returns the empty-queue shape rather than throwing, and leaves the job queued", async () => {
    const { db, pg } = await queueOne();
    vi.spyOn(console, "error").mockImplementation(() => {});
    setEnv({ DATABASE_URL: PROD_URL, DRY_RUN: "1" });

    // Same resolved shape as an empty queue — `runLane` sleeps on it and
    // drain mode returns, neither of which happens on a rejection.
    await expect(claim(db, { workerId: "local:heavy" })).resolves.toBeUndefined();

    // And the job is untouched, so the box picks it up unharmed.
    setEnv({ DATABASE_URL: PROD_URL });
    const job = await claim(db, { workerId: "hetzner:light" });
    expect(job?.type).toBe("noop");
    expect(job?.attempts).toBe(0);
    await pg.close();
  });
});
