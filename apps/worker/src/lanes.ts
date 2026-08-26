import { logger, runLane, type Db, type WorkerLaneOptions } from "@aiugc/core";

/**
 * Keep a lane alive across abnormal exits. runLane guards its own poll and
 * settle writes, so anything escaping it is an unforeseen fault — and one
 * lane's death must never take down the other (a light-lane blip would kill a
 * heavy lane mid-Remotion-render; it happened twice — see
 * docs/vault/defects/worker-exits-on-a-dropped-connection.md). Returns only
 * when the lane exits cleanly (abort or drain). `lane` is injectable for tests.
 */
export async function superviseLane(
  db: Db,
  opts: WorkerLaneOptions,
  lane: typeof runLane = runLane,
): Promise<void> {
  for (;;) {
    try {
      await lane(db, opts);
      return;
    } catch (err) {
      logger.error({ err, workerId: opts.workerId }, "lane crashed — restarting");
    }
    if (opts.signal?.aborted) return;
    // One poll interval of backoff (2s matches runLane's default) so a
    // persistent fault restart-loops gently instead of hot-spinning. Abort
    // interrupts the wait — graceful shutdown must not queue behind it.
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, opts.pollIntervalMs ?? 2000);
      opts.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  }
}
