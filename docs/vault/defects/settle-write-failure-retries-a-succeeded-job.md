---
type: defect
status: verified
verified: 2026-08-26
method: "read packages/core/src/jobs/worker.ts:44-77 (post-resilience-fix): complete() and reschedule() sit inside the same try as the handler, so a rejection from either routes into the catch and is classified as a job failure. Not reproduced against a live DB — reasoned from the code."
source: code
---

# A settle write that fails retries a job whose handler already succeeded

`runJob` runs the handler and the settle write in one try block: handler → `complete()` (or
`reschedule()`). The catch cannot tell them apart. A `complete()` that rejects — the same dropped
pooler socket as [[worker-exits-on-a-dropped-connection]] — is classified like a handler failure:

- If the DB recovers between the two writes, `failTransient` succeeds: a job that **did its work
  and spent its money** is marked `queued` with `attempts + 1` and re-runs. On its last attempt it
  goes `dead` instead — a finished job recorded as a failure.
- If the DB is still down, the new recovery-write guard swallows the second failure, the row stays
  `running`, and the lease sweep reclaims it (consuming an attempt) — also a re-run.

Either way the re-run re-executes everything after the handler's last checkpoint. Checkpoints
before external spend are the designed mitigation (a reclaimed job polls its provider instead of
re-submitting), so the double-spend is bounded, not zero — the same class as `5e98a9f4` re-buying
its vision batches after a worker death.

Pre-existing: this window is not something the 2026-08-26 resilience fix introduced — a settle
rejection landed in the same catch before it. The fix made it _visible_ (a both-writes-fail now
logs "recovery write failed" instead of killing the process) and this note exists because writing
those guards surfaced the classification hole.

**Deliberately not fixed 2026-08-26** (founder: one task, one concern — the resilience fix must
not change how jobs are classified or retried). Fix shape, when it is picked up: settle writes
should not share the handler's catch — a rejection from `complete()`/`reschedule()` after a
successful handler is a _settlement_ failure, to be retried as such, not a job failure that burns
an attempt and re-runs paid work.

## Related

- [[worker-exits-on-a-dropped-connection]] — the fault that makes the settle write rejectable
- [[cli-and-worker-have-no-tests]] — the worker's new resilience tests pin the guard behaviour
  (row stays `running` when both writes fail) but deliberately do not pin this misclassification
