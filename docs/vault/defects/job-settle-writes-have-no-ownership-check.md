---
type: defect
status: verified
verified: 2026-10-11
method: "read packages/core/src/jobs/queue.ts at feat/social-posting-connect (= origin/main 8bff2e8 for this file): complete() :185-190, reschedule() :196-213, checkpoint() :217-224, failPermanent() :230-235, failTransient() :246-260 and parkForBudget() :262 each end in `.where(eq(jobs.id, jobId))` and nothing else; recoverExpiredLeases() :168-183 requeues a `running` job whose locked_at is older than JOB_LEASE_MS (:156, 30 min); runJob in packages/core/src/jobs/worker.ts :77-172 settles by job.id. Found by the social-posting PR 1 session (report of 2026-10-11), written here on the founder's instruction in the PR 2 prompt."
source: code
---

# A job's settle writes do not check that the worker still owns the job

Every write that settles or advances a claimed job — `complete`, `reschedule`, `checkpoint`,
`failPermanent`, `failTransient`, `parkForBudget` — updates the row **by id alone**. None of them
is guarded on `status = 'running' AND locked_by = <this worker> AND locked_at = <this claim>`.

**The window (REASONED from the cited code):** a handler that runs past the 30-minute lease is
treated as dead. `recoverExpiredLeases` requeues it (consuming an attempt), and a later claim — by
any lane — starts a second run of the same job. When the first run finally returns, its settle
write lands on the row the second run now holds:

- its `complete()` marks the job `succeeded` under the second run;
- its `checkpoint(state)` replaces the second run's state with its own, older one;
- its `reschedule()` puts a running job back to `queued`, so a third claim can start.

There is no per-job timeout either, so nothing stops a handler from outliving its lease.

**Exposure today (REASONED):** the long handler is `render_video` (313 s worst observed against a
30-minute lease, per the comment at `queue.ts:148-155`). `publish_post` holds the lock for one
HTTP round trip at a time — each capped at 20 s (`META_REQUEST_TIMEOUT_MS`) — and reschedules
between container polls, so reaching the lease would take a hang that outlives the request
timeout. Its exactly-once guarantee rests on `checkpoint` ordering (the container id before the
status read, the media id the instant `media_publish` returns), which is the state a stale
`checkpoint` from an overrun first run could overwrite. No incident is known.

**Not fixed.** The fix is the guard above on every settle write, with zero rows meaning "this run
lost the job; stop quietly". It touches every handler's settle path, so it is its own task, not
part of the social-posting PRs.

## Related

- [[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]] — the publish job whose replay
  tests (`social-publish.test.ts`) cover lease reclaim but not an overrunning first run.
- [[worker-death-tally-2026-08-20-to-25]] — the claim/settle hardening that followed (`c46131d`)
  made a failed settle write survivable; it did not add ownership.
- [[render-wait-elapsed-resets-on-reclaim]] — another consequence of the lease reclaim.
