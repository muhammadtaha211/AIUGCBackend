---
type: defect
status: verified
verified: 2026-09-10
method: "packages/core/src/jobs/queue.ts:53-70 — `claim()` selects `for update skip locked` and stamps `locked_by = ${opts.workerId}`; nothing filters on which machine is asking. Every local `.env` in the tree points `DATABASE_URL` at production. Occurrences measured in [[local-workers-claimed-nine-production-jobs]] (nine rows, 2026-08-26/27 and 2026-09-06)."
source: code + db
---

# Nothing stops a worker on the founder's desktop from claiming a production job

`SKIP LOCKED` is what makes two workers safe to run against one queue — neither blocks the other,
neither double-claims. It is also what makes them **indistinguishable**: `claim()`
(`packages/core/src/jobs/queue.ts:53-70`) takes a `workerId` and writes it into `locked_by`, and
that is the entire extent of the machine's involvement. There is no allowlist, no lease scoped to a
host, and no way for the box to say "this queue is mine".

So the only guard is the founder remembering not to start a local worker while the box is live.

## That discipline has now demonstrably failed at least twice

- The 2026-08-27 window — the one queue item 6 was written to check. Two jobs
  (`billing_renewals`, `janitor`) claimed by `local:light` on 2026-08-26 23:54 and 2026-08-27 00:45.
- 2026-09-06 — seven more jobs, `local:light` and `local:heavy`, including two `lipsync` jobs that
  reached HeyGen and were refused for insufficient credit.

Both are in [[local-workers-claimed-nine-production-jobs]]. Note the shape of the second one: two
`DRY_RUN=1` workers were **found alive and stopped** that same day, and a separate, earlier local
worker had already claimed at 04:49 — the found pair had started at 07:49 and 07:54 and could not
have been the claimant. Stopping the workers you can see does not tell you what already ran.

## Why this is worth a note when the measured damage is nil

It cost ₪6.50 of estimate against zero customers, and the affected rows were all founder-owned
(`role='admin'`, business Tavnit). That is the whole of the damage, and it is nothing.

The same failure with a customer in the queue costs a **deliverable**. A local worker in `DRY_RUN=1`
claiming a customer's `render_video` marks it succeeded and writes a placeholder file — the exact
scenario queue item 6 went looking for and did not find. It did not find it because there were no
customers, not because anything prevented it.

## What would actually close it

Not written, not costed — listed so the next session does not re-derive them:

- A host guard in `claim()`: refuse to claim when `WORKER_ID` is `local` and the database is the
  production one. Cheap, and it fails in the right direction.
- `DRY_RUN=1` refusing to claim at all, rather than claiming and stubbing.
- Pointing the desktop `.env` at something other than production.

## Related

- [[local-workers-claimed-nine-production-jobs]] — the measured occurrences; the **check** is closed,
  this **mechanism** is not.
- [[0016-worker-stays-on-transaction-pooler-6543]] — the other thing `locked_by` is the only record
  of.
