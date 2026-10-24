import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../packages/core/test/helpers/pglite";
import type { Db } from "../../../packages/core/src/db";
import { events } from "../../../packages/core/src/db/schema";

/**
 * The autopilot's night check-in (decision 0127): one Sentry "ok" per night row
 * core wrote, the monitor's exact config, never an error event — and a row is
 * marked so the next sweep sends nothing.
 */
const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureCheckIn: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
}));
vi.mock("@sentry/node", () => sentry);

describe("the autopilot's Sentry check-in", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  const previousDsn = process.env.SENTRY_DSN;

  beforeAll(async () => {
    // Reporting turns on only with a DSN; this one is never dialled (Sentry is mocked).
    process.env.SENTRY_DSN = "https://public@o0.ingest.sentry.io/0";
    ({ db, pg } = await createTestDb());
  });

  afterAll(async () => {
    process.env.SENTRY_DSN = previousDsn;
    await pg.close();
  });

  it("checks in once per night row, with the monitor's config, and marks it", async () => {
    const { sweepAutopilotNights } = await import("../src/autopilot-checkin");
    const { AUTOPILOT_MONITOR_CONFIG } = await import("../src/reporting");
    await db.insert(events).values([
      { kind: "autopilot_night", payload: { day: "2026-10-25" } },
      { kind: "autopilot_night", payload: { day: "2026-10-26" } },
      { kind: "post_failed", payload: {} },
    ]);
    expect(await sweepAutopilotNights(db)).toBe(2);
    expect(sentry.captureCheckIn).toHaveBeenCalledTimes(2);
    expect(sentry.captureCheckIn).toHaveBeenCalledWith(
      { monitorSlug: "autopilot-night", status: "ok" },
      {
        schedule: { type: "crontab", value: "0 3 * * *" },
        timezone: "Asia/Jerusalem",
        checkinMargin: 120,
        failureIssueThreshold: 1,
        recoveryThreshold: 1,
      },
    );
    expect(AUTOPILOT_MONITOR_CONFIG.checkinMargin).toBe(120);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    // Marked: a second sweep sends nothing.
    expect(await sweepAutopilotNights(db)).toBe(0);
    expect(sentry.captureCheckIn).toHaveBeenCalledTimes(2);
  });
});
