---
type: defect
status: verified
verified: 2026-08-26
method: "fix verified by pnpm --filter @aiugc/worker test (7/7, apps/worker/test/worker-resilience.test.ts) and pnpm --filter @aiugc/core test -- jobs (19/19); original crash-path reading 2026-08-23 stands below"
source: code
---

# A DB fault during the poll kills the worker permanently — and it has happened twice

## FIXED 2026-08-26 — all four holes, in the commit that carries this note edit

(The vault rule "a note changes in the same commit as the code" means this section cannot cite its
own SHA — `git log -1 --follow` on this file is the provenance.)

1. **The bare poll** — `claim()` in `runLane` now has the same guard shape as the sweep: log, sleep
   one poll interval, continue. One founder-approved deviation from the original "log, sleep,
   continue" spec: in drain mode (`aiugc work --once`) a **third consecutive** claim failure
   rethrows (`DRAIN_CLAIM_FAILURE_LIMIT = 3`), so a pooler blip mid-drain recovers but a wrong
   `DATABASE_URL` exits non-zero instead of hanging the CLI forever.
2. **The recovery writes** — `runJob`'s catch block (`failPermanent`/`parkForBudget`/
   `failTransient`) and the no-handler `failPermanent` are guarded. If the settle write hits the
   same dead DB, the row stays `running` and the lease sweep reclaims it; the lane logs
   "recovery write failed" and carries on. Consequence recorded separately:
   [[settle-write-failure-retries-a-succeeded-job]].
3. **One lane killing the other** — `apps/worker/src/lanes.ts` (`superviseLane`) restarts a lane
   that exits abnormally, with one poll interval of abort-aware backoff; `main()`'s `Promise.all`
   now runs supervisors. Clean exits (abort/drain) still return, so SIGINT/SIGTERM drain is
   unchanged.
4. **Silent death** — `unhandledRejection`/`uncaughtException` handlers in `apps/worker/src/index.ts`
   log through pino before `exit(1)`. Safe without `pino.final` (removed in v7): pino 9.14.0's
   `fatal()` calls `stream.flushSync()` before returning (`lib/levels.js`) even though the default
   SonicBoom destination is async — verified in the installed package.

Deliberately left as-is (founder, 2026-08-26 in chat): the boot-time `ensureDailyJobs`/
`ensureReaperJob` awaits still fail fast — that becomes the _desired_ behaviour once the worker
runs under systemd `Restart=always` (landing separately). The CLI's continuous `aiugc work` keeps
its bare `Promise.all`; holes 1–2 protect it from within, but it has no supervisor.

Everything below is the original 2026-08-23 analysis, kept as the record of the crash path.

## The crash path

`runLane` (`packages/core/src/jobs/worker.ts:85-112`) is an unguarded `for(;;)` loop. Its one
try/catch is around the lease sweep:

```ts
// worker.ts:93-103
if (Date.now() - lastLeaseSweep > LEASE_SWEEP_INTERVAL_MS) {
  try { … await recoverExpiredLeases(db) … }
  catch (err) { logger.warn({ err }, "lease sweep failed — retrying next interval"); }
}
const job = await claim(db, { workerId: opts.workerId, types: opts.types });   // :104 — bare
```

Line 104 has no guard. `claim` (`packages/core/src/jobs/queue.ts:53-80`) is a raw `db.execute` with
no retry of its own. A rejected promise there escapes the loop, escapes `runLane`, escapes the
`Promise.all` in `main()`, and lands on:

```ts
// apps/worker/src/index.ts:56-59
main().catch((err) => {
  logger.error({ err }, "worker crashed");
  process.exit(1);
});
```

The irony is right there in the source: the comment above the sweep's catch says **"a sweep blip
must not add a crash path"** (`worker.ts:92`). The author guarded the sweep and left the poll it
guards bare — and the poll runs every 2 seconds, forever, while the sweep runs once a minute.

`runJob` does catch handler errors (`worker.ts:53`), but the catch block's own recovery writes are
unguarded — `failPermanent` (`worker.ts:56`), `parkForBudget` (`:59`), `failTransient` (`:62`). If
the database is what is unreachable, the error handler throws out of its own catch and reaches the
same `exit(1)`. The hole is wider than the poll.

`Promise.all` in `main()` rejects on the first lane to fail, so **a light-lane poll failure kills a
heavy lane that may be mid-Remotion-render.** There is no `unhandledRejection` or
`uncaughtException` handler anywhere in the repo — the only process handlers are the SIGINT/SIGTERM
aborts at `apps/worker/src/index.ts:28-29`.

## Why a drop is expected, not exceptional

Both `.env` and `apps/worker/.env` point `DATABASE_URL` at port **6543** — Supabase's transaction
pooler — and both hostnames contain `pooler`. `packages/core/src/db/index.ts:27` even sets
`prepare: false` with the comment "keeps us compatible with Supabase's transaction pooler", so the
choice is deliberate.

A transaction pooler recycles server-side connections between transactions; a long-lived client
polling every 2 s is exactly the shape that gets its socket closed under it. _(That a pooler on 6543
recycles connections is Supabase's documented behaviour, not something measured here — treat that
one clause as inherited.)_

**Not every recycle is fatal, and the distinction matters for how urgent this is.** `postgres-js`
absorbs a close on an _idle_ socket and reconnects. Only a fault on an **in-flight query** reaches
the caller. With a 2 s poll around a short `UPDATE`, the socket is idle most of the time — so the
realistic trigger is the stale-pooled-socket case, where the reset is not observed until the next
write lands inside the query window. Rare, not constant.

## Nothing restarts it

`apps/worker/package.json` has `"dev": "tsx src/index.ts"` and `"start": "tsx src/index.ts"`. No
`--watch`, no supervisor, no Dockerfile, no pm2 or systemd unit anywhere in the repo. **`exit(1)` is
terminal.** The queue keeps accepting jobs; nothing drains them; the wizard spins.

**And nothing tells anyone.** The crash writes one pino line to stdout and exits; `logger` is a bare
`pino({ level })` with no transport (`packages/core/src/logger.ts:5-7`). `SENTRY_DSN` is declared at
`packages/core/src/config.ts:11`, but **no `@sentry` package is installed** and nothing initialises
it, so nothing is reported anywhere. The founder finds out by noticing jobs have stopped moving.

## It has happened twice, and both times it cost money

I first looked for jobs stuck at `status = 'running'` and found none — but that is the wrong
fingerprint, because the lease sweep reclaims them and rewrites the status. The right one is in
`last_error`:

| job        | type              | when             | attempts | `last_error`                                                     |
| ---------- | ----------------- | ---------------- | -------- | ---------------------------------------------------------------- |
| `5e98a9f4` | `analyze_demo`    | 2026-08-17 01:27 | **3**    | `lease expired: worker died mid-run (was locked by local:heavy)` |
| `50f676a7` | `plan_demo_steps` | 2026-08-19 23:05 | **1**    | `lease expired: worker died mid-run (was locked by cli:light)`   |

Both eventually succeeded — the sweep reclaimed them and they re-ran. Both are **the two cost
anomalies already recorded elsewhere in this vault**, and this is their cause:

- `5e98a9f4` is the ₪4.35 / 17-call analysis in [[analyze-demo-cost]], 2.1x a clean run. It
  re-bought its vision batches after the death.
- `50f676a7` is the one 3-call plan job in [[first-call-violation-rate]], the outlier spanning
  1,855.7 s instead of the usual 5–14 s.

So the mechanism is not hypothetical and the cost is not zero: **two deaths, roughly 2 ILS of
re-bought API calls, and a 31-minute stall on a job that normally takes seconds.**

What is _not_ established is that a pooler drop caused these two specifically. `lease expired`
records that the lock holder stopped, not why — a crash, a laptop sleep or a Ctrl-C leaves the
identical marker. The code path above is a sufficient explanation, not a proven one.

**The recovery worked both times, and that is what keeps the severity down.** Both jobs are now
`succeeded`. `recoverExpiredLeases` reclaims a job whose lock is older than
`JOB_LEASE_MS = 30 * 60_000` (`packages/core/src/jobs/queue.ts:95`), and the sweep runs every
`LEASE_SWEEP_INTERVAL_MS = 60_000` (`worker.ts:114`). The worst case is therefore a ~30-minute
stall — but only once somebody restarts the worker, because the sweep lives inside the loop that
died.

## Fix shape

Two candidates, and the cheap one is not the right one:

1. **One line, wrong layer:** point `apps/worker/.env` at port 5432 (session pooler / direct).
   Fewer drops, but it trades a crash-on-drop for a lower connection ceiling, and it does not make
   the loop survive anything.
2. **The actual fix:** wrap the `claim` call in the same try/catch shape the sweep already has —
   log, sleep, continue. Five lines in `worker.ts`, and it makes every future transient DB error
   non-fatal instead of just this one.

A supervisor (`--watch` in dev, a restart policy in prod) is worth having as well, but it is a
backstop, not a substitute: a worker that restart-loops on every pooler recycle is not healthy
either.

## Related

- [[cli-and-worker-have-no-tests]] — nothing would catch a regression here
