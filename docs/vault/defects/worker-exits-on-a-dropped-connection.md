---
type: defect
status: verified
verified: 2026-08-23
method: "read packages/core/src/jobs/worker.ts:85-112 and jobs/queue.ts:53-80 and apps/worker/src/index.ts:56-59; DB checked for stuck jobs (read-only) — none found"
source: code
---

# A DB fault during the poll kills the worker permanently — and it has happened twice

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

`runJob` does catch handler errors (`worker.ts:53`), but its catch handler itself writes to the DB
(`failPermanent`, `parkForBudget`), so a connection lost mid-job escapes by the same route.

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
