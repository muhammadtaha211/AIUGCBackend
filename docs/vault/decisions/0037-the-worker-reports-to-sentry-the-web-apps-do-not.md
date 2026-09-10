---
type: decision
status: verified
verified: 2026-09-10
method: "founder instruction in chat, 2026-09-10: install @sentry/node in apps/worker only, capture in exactly two places, and 'Do NOT add Sentry to apps/web or apps/admin — separate decision'"
source: founder
---

# 0037 — The worker reports to Sentry; the web apps do not

## What was decided

`@sentry/node` becomes a dependency of **`apps/worker` and nothing else**, capturing in
**exactly two** places:

1. a job reaching `status='dead'`, carrying `jobId`, `type`, `attempts` and `jobs.last_error`;
2. the fatal crash path — the three `exit(1)` sites in `apps/worker/src/index.ts`.

`SENTRY_DSN` unset stays a first-class configuration: nothing initialises, both capture
functions are no-ops, and the worker logs `error reporting off — SENTRY_DSN not set` at
startup. Turning it on is one env line and a restart — no deploy, no code change.

## Why the boundary is at apps/worker

- `packages/core` is imported by `apps/web` and `apps/admin`, which run on Vercel. A node-only
  SDK in core would be pulled toward their bundles for no benefit
  ([[vercel-route-handlers-cannot-write-work-dir]] is the same boundary biting from the other
  side). So core learns about a death through a **plain function type** —
  `WorkerLaneOptions.onJobDead` — and never imports a reporter.
- `aiugc work --once` runs the identical lanes from the CLI. It passes no `onJobDead` and never
  loads the SDK, so the CLI is silent **by construction** rather than by configuration.
- Web/admin reporting was explicitly deferred by the founder in the same instruction. Not an
  oversight — do not "finish the job" by wiring it without asking.

## Options offered, and what was chosen

| Option                                                                | Verdict                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Optional `onJobDead` callback on `WorkerLaneOptions`                  | **chosen** — ~20 additive lines in core, fires once, after the write, from the same `isLastAttempt` the write used |
| Worker wraps every handler and re-derives "was that the last attempt" | rejected — zero core changes, but duplicates the classification, and drifts silently when core's changes           |
| Worker polls the `jobs` table for `dead` rows                         | rejected — needs a "reported" marker (a migration) or re-reports everything on restart                             |
| Report the lease sweep's deaths too                                   | rejected — the sweep was out of scope, and it returns a count, not rows ([[worker-sentry-reporting]])              |

## Engine settings, and why they are not the defaults

`init({ defaultIntegrations: false, registerEsmLoaderHooks: false })`. The default integrations
install Sentry's **own** `uncaughtException`/`unhandledRejection` handlers, which would give the
crash path a second owner that can exit on its own schedule — in the one process whose crash
behaviour is the subject of a defect note with sixteen deaths in it. Every event here is captured
by hand, so the OpenTelemetry patching and ESM loader hooks buy nothing. Tracing stays off; it
requires `tracesSampleRate`. Verified that events still deliver in full under these settings —
[[worker-sentry-reporting]].

## What this does not do

It makes a death **visible**, not survivable. The worker still exits on a fatal and is still
restarted only by systemd on the box ([[worker-exits-on-a-dropped-connection]]). An external kill
(OOM, SIGKILL) reports nothing, because no code of ours runs.
