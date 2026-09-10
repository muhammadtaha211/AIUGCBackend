---
type: fact
status: verified
verified: 2026-09-10
method: "probes in apps/worker/.work (deleted after the run, reproduced by the commands below): a local HTTP server standing in for Sentry's ingest, driven by the real apps/worker/src/index.ts and by core's runLane; plus `npm view @sentry/node version dependencies`"
source: code
---

# What the worker's Sentry reporting actually does, measured

`@sentry/node@10.74.0` (engines `node >=18`; the repo requires `>=20`), added to
`apps/worker` **only** — 19 packages, including `import-in-the-middle` and three
`@opentelemetry/*`. Not in `packages/core`, which the Next.js apps bundle. See
[[0037-the-worker-reports-to-sentry-the-web-apps-do-not]] for why the boundary is
where it is, and [[worker-exits-on-a-dropped-connection]] for what it was built for.

## Measured, not assumed

| Question                                                          | Measured behaviour                                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Sentry.flush()` with no client initialised                       | resolves **`false` in ~8ms** — never throws, never hangs                                                    |
| `Sentry.flush(1000)` against a server that never answers          | resolves **`false` at ~1030ms** — honours the timeout, does not reject                                      |
| `init({defaultIntegrations:false, registerEsmLoaderHooks:false})` | events still deliver in full: tags, `extra`, `level` all arrive                                             |
| real `index.ts`, **no** DSN, DB pointed at a dead port            | logs `error reporting off — SENTRY_DSN not set`, exits 1, **0 envelopes**                                   |
| real `index.ts`, **local** DSN, same dead DB                      | logs `error reporting on`, exits 1, **1 envelope**: `fatal — connect ECONNREFUSED`                          |
| real job dying through `runLane` with `onJobDead`                 | **1 envelope**: `job dead: flaky`, `level error`, tag `jobType`, extra `{jobId, attempts, lastError}`       |
| `Sentry.init` with a malformed DSN (5 shapes tried)               | **never throws** — prints `Invalid Sentry Dsn: …` once and returns a client that silently drops every event |

The flush numbers are why the crash path is safe: it cannot hang on a dead Sentry, and it
costs nothing when reporting is off. The two `index.ts` rows are the whole acceptance test —
the crash event is delivered **before** `exit(1)`, which is the thing that does not work if
you call `captureException` and exit immediately.

## Reproducing it without a Sentry account

No DSN and no account is needed: Sentry's ingest is a plain `POST` of a newline-delimited
JSON envelope, so a local `http.createServer` that records request bodies is a complete
stand-in. Point `SENTRY_DSN` at `http://anykey@127.0.0.1:<port>/1` and read what arrives.
Point `DATABASE_URL` at `postgresql://nobody:nothing@127.0.0.1:1/nowhere` to exercise the
fatal path — **never start the worker against the live DB to read its startup lines**, it
enqueues and then runs the janitor (retention deletes) and the reaper.

## The gap, on purpose

Only the **retry-exhaustion** death reports. `recoverExpiredLeases` also writes `dead`, in
one set-based `UPDATE` returning a count rather than rows, so there is no per-job hook to
fire — and that path was out of scope to change. In practice the lease-expiry death follows
a worker death, and the worker death now reports on its own; an external kill (OOM, SIGKILL)
still reports neither, because no code of ours runs.

## Import cost

Importing `@sentry/node` measured **1.65-2.24s idle** on the Windows desktop (three runs,
`node -e "await import('@sentry/node')"` timed with hrtime), and 4.5-5.8s on the same machine
under six concurrent agents. It is a static import, so it is paid even with reporting off — but
once, at startup, on a process meant to run for weeks. The box is Linux and should be faster;
that has not been measured.
