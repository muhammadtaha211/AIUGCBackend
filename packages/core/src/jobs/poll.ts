import { z } from "zod";
import { getConfigValueOr } from "../appConfig";
import type { Db } from "../db";
import type { Logger } from "../logger";
import { PermanentError } from "./errors";

/**
 * Polling reschedules don't consume attempts, so a provider that never returns
 * would leave the customer on an infinite spinner with no error and no refund.
 * Every polling handler (lipsync, generate_composite) calls this on a
 * "pending" poll; past the window the job fails permanently and goes through
 * its normal terminal-failure path. The window is measured from the FIRST
 * submit — `submittedAt` lives in job state next to `providerJobId` and
 * survives resubmits. Override: app_config `poll_deadline_seconds` (no seed
 * row) — HeyGen returns in ~2min, so 900s is the intended live setting.
 */
export const DEFAULT_POLL_DEADLINE_SECONDS = 2400;

export async function assertPollDeadline(
  db: Db,
  log: Logger,
  opts: { providerJobId: string; submittedAt: number },
): Promise<void> {
  const seconds = await getConfigValueOr(
    db,
    "poll_deadline_seconds",
    z.number().positive(),
    DEFAULT_POLL_DEADLINE_SECONDS,
  );
  if (Date.now() - opts.submittedAt <= seconds * 1000) return;
  // The provider job id is the handle for looking the stuck request up with the provider.
  log.error(
    { providerJobId: opts.providerJobId, submittedAt: new Date(opts.submittedAt).toISOString() },
    "poll deadline exceeded — failing the job",
  );
  throw new PermanentError("העיבוד לא הסתיים בזמן — נסו שוב");
}
