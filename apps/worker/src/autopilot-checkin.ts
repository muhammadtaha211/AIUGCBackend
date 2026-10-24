import { logger, markEventsNotified, pendingAutopilotNights, type Db } from "@aiugc/core";
import { reportAutopilotNight } from "./reporting";

/**
 * The autopilot's "the night ran" rows (core writes one per Israel night once
 * planning finishes, decision 0127) become Sentry check-ins here: Sentry lives
 * in apps/worker alone (decision 0037), so core only writes the row. A night
 * that never ran, or whose planning kept failing, writes none, and the monitor
 * misses. Marked AFTER the check-in, so a worker that dies mid-sweep repeats an
 * "ok" rather than losing one. Swallows everything, like sweepAlerts.
 */
export async function sweepAutopilotNights(
  db: Db,
  report: () => void = reportAutopilotNight,
): Promise<number> {
  try {
    const nights = await pendingAutopilotNights(db);
    if (nights.length === 0) return 0;
    for (const _night of nights) report();
    await markEventsNotified(
      db,
      nights.map((night) => night.id),
    );
    logger.info({ days: nights.map((n) => n.day) }, "autopilot: night check-in");
    return nights.length;
  } catch (err) {
    logger.warn({ err }, "autopilot check-in sweep failed — retrying next interval");
    return 0;
  }
}
