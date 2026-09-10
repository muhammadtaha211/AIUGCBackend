---
type: fact
status: verified
verified: 2026-09-10
method: "probes in apps/worker/.work (deleted after the run, reproduced by the commands below): a local HTTP server standing in for Sentry's ingest, driven by the real apps/worker/src/index.ts and by core's runLane for both terminal statuses; plus `npm view @sentry/node version dependencies` and a read of claim/failPermanent/failTransient for the attempts question. Covers ENVELOPE CONTENTS only — not Sentry-side grouping, and not the 2026-09-06 cost figure, which is founder-reported in chat and flagged below as an open discrepancy."
source: code
---

# What the worker's Sentry reporting actually does, measured

`@sentry/node@10.74.0` (engines `node >=18`; the repo requires `>=20`), added to
`apps/worker` **only** — 19 packages, including `import-in-the-middle` and three
`@opentelemetry/*`. Not in `packages/core`, which the Next.js apps bundle. See
[[0037-the-worker-reports-to-sentry-the-web-apps-do-not]] for why the boundary is
where it is, and [[worker-exits-on-a-dropped-connection]] for what it was built for.

## Measured, not assumed

| Question                                                          | Measured behaviour                                                                                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Sentry.flush()` with no client initialised                       | resolves **`false` in ~8ms** — never throws, never hangs                                                                                                         |
| `Sentry.flush(1000)` against a server that never answers          | resolves **`false` at ~1030ms** — honours the timeout, does not reject                                                                                           |
| `init({defaultIntegrations:false, registerEsmLoaderHooks:false})` | events still deliver in full: tags, `extra`, `level` all arrive                                                                                                  |
| real `index.ts`, **no** DSN, DB pointed at a dead port            | logs `error reporting off — SENTRY_DSN not set`, exits 1, **0 envelopes**                                                                                        |
| real `index.ts`, **local** DSN, same dead DB                      | logs `error reporting on`, exits 1, **1 envelope**: `fatal — connect ECONNREFUSED`                                                                               |
| a transient job exhausting attempts through `runLane`             | **1 envelope**: title `job dead: flaky`, tag `terminal=dead`, extra `{jobId, attempts: 1, lastError}`                                                            |
| a `PermanentError` job through the same lane (2026-09-10)         | **1 envelope**: title `job failed: perm`, tag `terminal=failed`, extra `{jobId, attempts: 0, lastError}` — the two titles differ (see the grouping caveat below) |
| `Sentry.init` with a malformed DSN (5 shapes tried)               | **never throws** — prints `Invalid Sentry Dsn: …` once and returns a client that silently drops every event                                                      |

The flush numbers are why the crash path is safe: it cannot hang on a dead Sentry, and it
costs nothing when reporting is off. The two `index.ts` rows are the whole acceptance test —
the crash event is delivered **before** `exit(1)`, which is the thing that does not work if
you call `captureException` and exit immediately.

**What the rig cannot see: grouping.** The stand-in below is a local HTTP server, so every row
above is a statement about the _envelope_ — what was sent. Issue grouping happens in a real
Sentry project, and `reportTerminalJob` passes no `fingerprint`, so it falls to Sentry's own
default, which keys on the message. Distinct titles are therefore _expected_ to produce
distinct issues, and that is why the status is in the title — but it is **inference, not
measurement**, and nothing in this repo has yet observed a real Sentry project. Confirm it the
first time both kinds fire in production.

## Reproducing it without a Sentry account

No DSN and no account is needed: Sentry's ingest is a plain `POST` of a newline-delimited
JSON envelope, so a local `http.createServer` that records request bodies is a complete
stand-in. Point `SENTRY_DSN` at `http://anykey@127.0.0.1:<port>/1` and read what arrives.
Point `DATABASE_URL` at `postgresql://nobody:nothing@127.0.0.1:1/nowhere` to exercise the
fatal path — **never start the worker against the live DB to read its startup lines**, it
enqueues and then runs the janitor (retention deletes) and the reaper.

## The gap, on purpose

**Amended later the same day, 2026-09-10 — one of the two gaps below was not "on purpose", it was a hole.**
Until then only the retry-exhaustion `dead` reported, and `status='failed'` — every
`PermanentError` — reported nothing. **Founder-reported in chat, 2026-09-10** (not measured
here): two lipsync jobs on 2026-09-06 each logged a HeyGen charge and then settled `failed`,
~₪6.50 burned in silence, and a smoke-test job (max_attempts 1, non-existent videoRenderId)
settled `failed` with `last_error "video render … not found"` and produced no event. The
silence is verified here; the cost is not. **Open discrepancy worth a look:**
[[heygen-motion-prompt-two-draws]] (verified 2026-09-06) records a same-day pair refused by
HeyGen for zero API credits at 325 agorot each — 2 × 325 = the same ₪6.50 — but says those
`usage_events` rows were "none real". If that is the same pair, the incident may have cost
nothing and the recorded rows are the defect; if it is a different pair, that note is
incomplete. Not resolved.

> **Resolved 2026-09-10 — it is the same pair, and the first branch is the right one.** Measured in
> the Supabase SQL editor: the two `failed` `lipsync` jobs of 2026-09-06 04:49 carry
> `last_error = "lipsync failed: Insufficient credit. This operation requires 'api' credits."` —
> the same refusal string [[heygen-motion-prompt-two-draws]] recorded — and their `usage_events`
> rows are `heygen` / `gpu_seconds` / quantity 13 / `cost_estimate_agorot` **325 each**, 650 agorot
> together. The code says why both can be true at once: `recordUsage` fires at
> `packages/core/src/pipelines/renders.ts:317-324`, immediately after `provider.submit()` returns a
> `providerJobId` — the estimate is written at **submit** time. The refusal arrives later, in the
> poll branch at `:339-342`, and only then becomes a `PermanentError`. So the row is an estimate for
> an operation HeyGen went on to refuse, not a confirmation of a charge. **The ₪6.50 figure is a
> recorded estimate; it is not established that any money was spent**, and
> [[heygen-motion-prompt-two-draws]]'s "none real" stands.
>
> **This changes nothing about the widening**, which is the point of this note: the silence was real
> either way, and a `PermanentError` thrown after a paid submit is exactly the class that has to
> report. It also fixes an attribution nothing here ever carried: both jobs were claimed by
> `local:heavy` — a worker on the founder's desktop, not the Hetzner box
> ([[local-workers-claimed-nine-production-jobs]]).

Either way the silence was real, and both terminal statuses now report, under separate Sentry
titles — [[0037-the-worker-reports-to-sentry-the-web-apps-do-not]] §Amendment.

What is still silent, and genuinely on purpose: `recoverExpiredLeases` also writes `dead`, in
one set-based `UPDATE` returning a count rather than rows, so there is no per-job hook to
fire — and that path was out of scope to change. In practice the lease-expiry death follows
a worker death, and the worker death reports on its own; an external kill (OOM, SIGKILL)
still reports neither, because no code of ours runs.

## `attempts: 0` on a `failed` event is correct

Measured 2026-09-10: `claim()` writes only
status/locked_at/locked_by/updated_at, and `failPermanent` writes only
status/error_class/last_error/updated_at. Neither touches `attempts`, whose only writers are
`failTransient` (`job.attempts + 1`) and `recoverExpiredLeases` (`attempts + 1`). So a job
that ran once and threw a `PermanentError` ends at `attempts: 0` — the column counts consumed
retry budget, not executions, exactly as `docs/02-jobs.md` §Job anatomy says ("claims don't
count; failures do").

Nothing in the code is misled by it. All three pipelines that branch on terminal-ness
(`renders.ts:1043`, `demo-analysis.ts:741`, `demo-step-plans.ts:1310`) test
`err instanceof PermanentError` **before** ever calling `isLastAttempt`, so the refund path
never consults `attempts` on the permanent branch. Nothing in `apps/cli`, `apps/web` or
`apps/admin` reads `attempts` at all. The only thing it misleads is a **human** reading the
Sentry event, where `attempts: 0` on a job that demonstrably ran looks like it never started —
which is why `reportTerminalJob`'s doc comment says so out loud.

## Import cost

Importing `@sentry/node` measured **1.65-2.24s idle** on the Windows desktop (three runs,
`node -e "await import('@sentry/node')"` timed with hrtime), and 4.5-5.8s on the same machine
under six concurrent agents. It is a static import, so it is paid even with reporting off — but
once, at startup, on a process meant to run for weeks. The box is Linux and should be faster;
that has not been measured.
