---
type: defect
status: verified
verified: 2026-09-11
method: "Original finding: packages/core/src/jobs/queue.ts:53-70 — `claim()` selects `for update skip locked` and stamps `locked_by = ${opts.workerId}`; nothing filtered on which machine is asking. Every local `.env` in the tree points `DATABASE_URL` at production. Occurrences measured in [[local-workers-claimed-nine-production-jobs]] (nine rows, 2026-08-26/27 and 2026-09-06). Fix verified 2026-09-11 by packages/core/test/claim-host-guard.test.ts — 12 tests green, including the box case (a non-local id against a production url still claims) and the refusal shape (resolves undefined, never rejects)."
source: code + db
---

# Nothing stops a worker on the founder's desktop from claiming a production job

## FIXED 2026-09-11 (the MECHANISM; the measured-occurrences note is untouched)

`claim()` now refuses, before it issues the `UPDATE`, in two cases — both only when
`DATABASE_URL` points at the live project:

- the asking worker is on a developer machine, or
- the asking worker is in `DRY_RUN`, **whatever its id**.

The second is the one that mattered. The nine measured occurrences were live workers doing real,
billable work; the failure this note said "has not happened yet" — a `DRY_RUN=1` worker claiming a
customer's `render_video`, marking it succeeded and writing a placeholder file — is the case that
half closes.

**Two predicates, both pure and exported** (`packages/core/src/jobs/queue.ts`):

- `isLocalWorkerId(workerId)` matches the **host segment** (`id.split(":")[0]`) against
  `["local", "cli"]`. `local` is the `WORKER_ID` default (`config.ts:16`) and what every desktop
  `.env` pins; `cli` is hardcoded by `aiugc work` (`apps/cli/src/index.ts:920`, `:926`), which never
  reads `WORKER_ID` at all — so a filter on `local:%` alone would have missed the CLI drain
  entirely, exactly as [[local-workers-claimed-nine-production-jobs]] §"What the census does not
  cover" warned.
- `isProductionDatabaseUrl(url)` matches the project ref `hyaqydcmwbnbaiqqufow` as a substring.
  The ref, not a hostname pattern: the session pooler, the transaction pooler and the direct
  connection spell the host three different ways and every one of them carries the ref.

**The box is unaffected** because it sets `WORKER_ID=hetzner` (`docs/07-worker-box.md:184`) and does
not run `DRY_RUN` — neither predicate is ever true there. This is a **deny list, not an allowlist**,
so the second-real-box scaling path this note's fix list did not want to close stays open: set
`WORKER_ID` to anything that is not `local` or `cli` and it just works.

**It refuses; it does not throw.** A refusal returns `undefined` — the same shape as an empty queue —
plus one `console.error` naming both conditions. A throw would have been worse than the disease:
the box runs under systemd `Restart=always`, so one bad env var would become a crash every few
seconds. `runLane` sleeps a poll interval on an empty result, and drain mode (`work --once`)
returns, so a refused CLI drain exits cleanly instead of spinning.

**Not done, deliberately:** `SKIP LOCKED`, the lease sweep and the claim query's locking semantics
are untouched; no allowlist table and no migration. The third item on this note's own fix list —
pointing the desktop `.env` somewhere other than production — is still open and is the founder's
call.

The refusal is logged on **every poll**, not once per process, and that is a choice rather than an
oversight: it needs no module state, and a desktop that is misconfigured against production should
be impossible to miss.

---

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
