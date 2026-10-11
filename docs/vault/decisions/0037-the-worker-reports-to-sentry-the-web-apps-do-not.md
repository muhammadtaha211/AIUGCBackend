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

> **Amended the same day, 2026-09-10 — (1) was too narrow, and the narrowness cost money.**
> `status='dead'` is only one of the two terminal statuses; `failPermanent` writes `'failed'`,
> which never retries, and that path reported nothing. It is also the expensive one — the
> handler can already have paid a provider before throwing. Two lipsync jobs on 2026-09-06 each
> logged a HeyGen charge and then settled `failed`: ~₪6.50 gone with no event, and a 2026-09-10
> smoke test reproduced the silence exactly. Capture site (1) is now **any terminal write inside
> `runJob`** — `dead`, and `failed` from either a `PermanentError` or a job type with no
> registered handler. Still two capture functions, still nothing else.
>
> **Two corrections to that paragraph, measured 2026-09-10, neither of which touches the decision.**
> First, **which machine**: both jobs were claimed by `local:heavy` — a worker on the founder's
> desktop, not the Hetzner box ([[local-workers-claimed-nine-production-jobs]]). Nothing here ever
> said which, and the reflex reading is the box. Second, **"logged a HeyGen charge" is stronger
> than the evidence**: `recordUsage` runs at `pipelines/renders.ts:317-324`, right after
> `provider.submit()` succeeds, so what exists is a submit-time **estimate**
> (`cost_estimate_agorot` 325 × 2 = 650). HeyGen's insufficient-credit refusal arrives later, in
> the poll branch at `:339-342`. So ~₪6.50 is a
> recorded estimate for an operation HeyGen refused, and it is not established that money moved
> (see [[worker-sentry-reporting]] §"The gap, on purpose" and [[heygen-motion-prompt-two-draws]]).
> **The argument for widening is unaffected**: a `PermanentError` thrown after a paid submit is the
> expensive class whether or not this particular pair was billed, and the silence was real.
>
> The hook is renamed to match: `DeadJob` → `TerminalJob` (with a `status` field),
> `WorkerLaneOptions.onJobDead` → `onJobTerminal`, `reportDeadJob` → `reportTerminalJob`. The
> old names asserted that exhausted-attempts was the only reported ending, which is the same
> false framing the docs carried and the reason the hole survived review.
>
> **The two do not share a Sentry issue.** The title carries the status (`job dead: <type>` vs
> `job failed: <type>`) and a `terminal` tag repeats it, because an exhausted retry is a flaky
> provider and a permanent failure is a bug or bad input — different problems, answered
> differently. Rejected: one title with only a tag to tell them apart, which groups them into a
> single issue and buries whichever is rarer.

`SENTRY_DSN` unset stays a first-class configuration: nothing initialises, both capture
functions are no-ops, and the worker logs `error reporting off — SENTRY_DSN not set` at
startup. Turning it on is one env line and a restart — no deploy, no code change.

## Amended 2026-09-11 — a SECOND reporting path exists, and the boundary is intact

There are now two ways something reaches Sentry, and only one of them is a callback.

| path            | writer                                         | how it reaches Sentry                                                               |
| --------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| a job ends      | `runJob` in `packages/core/src/jobs/worker.ts` | the `onJobTerminal` callback above, in-process, synchronous                         |
| an `events` row | `apps/web` (a Vercel function)                 | the worker POLLS `events` and reports on its behalf — `apps/worker/src/index.ts:60` |

**The boundary this decision exists to hold is unchanged.** `apps/web` still never loads
`@sentry/node`; it writes a row and returns. `packages/core` still never imports a reporting SDK —
`packages/core/src/alerts.ts` knows only how to READ the queue (`pendingAlertEvents`, `:127`) and
MARK it drained (`markEventsNotified`, `:171`). The sweep lives in `apps/worker/src/index.ts` and
**not** in core's lanes, so `aiugc work --once` stays silent BY CONSTRUCTION exactly as this
decision requires, rather than by remembering not to configure it.

**This is the option the table below REJECTS, chosen for a different writer.** The row reads:
"Worker polls the `jobs` table for `dead` rows — rejected — needs a 'reported' marker (a migration)
or re-reports everything on restart." The objection was right, and migration 0037
(`supabase/migrations/0037_events_notified_at.sql`) is the marker it named:
`events.notified_at`, plus a partial index over the unnotified rows of the alert kinds. It is
rejected there and chosen here because the WRITER is on the other side of the SDK boundary — a job
ends inside the worker's own process, where a callback is free, while a failed signup happens in a
Vercel function that can never report anything itself. Polling is the price of that, and the
migration is what makes polling safe.

**What is reported, and what is not.** `ALERT_EVENT_KINDS` (`alerts.ts:107`) is an allowlist of two:
`platform_budget_tripped` and the new `auth_email_send_failed` (`alerts.ts:35`). Every other
`events` kind — `qc_release`, `refund_resolved_to_ancestor`, `content_policy_flag`, the rest — costs
nothing and can never turn into mail. The kind is in the TITLE (`alert: <kind>`,
`apps/worker/src/reporting.ts:93`) for the same reason `job dead` and `job failed` are separate
titles.

`SENTRY_DSN` unset is still first-class: `reportAlertEvent` returns immediately, the sweep still
marks the rows, and nothing initialises.

---

## Why the boundary is at apps/worker

- `packages/core` is imported by `apps/web` and `apps/admin`, which run on Vercel. A node-only
  SDK in core would be pulled toward their bundles for no benefit
  ([[vercel-route-handlers-cannot-write-work-dir]] is the same boundary biting from the other
  side). So core learns that a job has ended through a **plain function type** —
  `WorkerLaneOptions.onJobTerminal` — and never imports a reporter.
- `aiugc work --once` runs the identical lanes from the CLI. It passes no `onJobTerminal` and
  never loads the SDK, so the CLI is silent **by construction** rather than by configuration.
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

_(Pointer 2026-10-11: browser errors from `apps/web` are now captured — through PostHog, not
Sentry, beside this decision and not reopening it. The web apps still never load Sentry and the
server routes still report nowhere: [[0103-posthog-in-apps-web-eu-cloud-free-plan]] §2.)_

## What this does not do

It makes a death **visible**, not survivable. The worker still exits on a fatal and is still
restarted only by systemd on the box ([[worker-exits-on-a-dropped-connection]]). An external kill
(OOM, SIGKILL) reports nothing, because no code of ours runs.
