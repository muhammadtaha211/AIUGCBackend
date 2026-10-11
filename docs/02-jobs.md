# 02 — Jobs & Orchestration

## Decision: plain `jobs` table + one worker, no queue framework

pg-boss, Trigger.dev, and Inngest were considered and rejected:

- The pipeline needs **custom claim-time semantics** — spend-cap parking, a human approval gate
  in the middle of a chain (audio preview), render concurrency pinned to 1, credits reserved at
  enqueue — which fight a framework's abstractions more than they use them.
- A single worker makes framework scheduling features moot; the whole queue layer is ~200 lines
  (`packages/core/src/jobs/`) with tests.
- The jobs table doubles as the ops dashboard (`aiugc status`, Supabase Studio) — no extra UI.
- Trigger.dev/Inngest add an external service + webhook surface the CLI phase doesn't have.

Postgres is the queue: `FOR UPDATE SKIP LOCKED` claim in a single UPDATE…RETURNING statement
(`jobs/queue.ts: claim()`). This is safe with multiple workers — a real scenario, since the
founder's `aiugc work` and the server worker can run against the same database simultaneously.

## Job anatomy

| Column                      | Role                                                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idempotency_key` UNIQUE    | one logical work item = one key (`render:{videoRenderId}`, `tts:{audioRenderId}`, `janitor:2026-07-16`); re-enqueue is a no-op returning the existing job |
| `payload`                   | input refs (ids only — data lives on domain rows)                                                                                                         |
| `state`                     | resumability checkpoint, written **before** awaiting external side effects                                                                                |
| `attempts` / `max_attempts` | failure count (claims don't count; failures do)                                                                                                           |
| `run_at`                    | visibility time — backoff, polling reschedules, and budget parking all move it                                                                            |
| `error_class`               | `transient` / `permanent` / `budget`                                                                                                                      |

## Failure taxonomy

| Class                            | Trigger                                 | Behavior                                                                                                                                                                                                                                                          |
| -------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PermanentError`                 | validation, 4xx, human-fixable problems | fail immediately as `failed` — terminal, never retried — plus a Sentry event carrying `last_error` when the worker has a `SENTRY_DSN` (§Worker); message is user-facing (Hebrew where the user sees it); domain row gets the reason (e.g. `demos.reject_reason`)  |
| `TransientError` / unknown throw | 5xx, 429, timeouts, network             | exponential backoff `min(30s·2^(n-1), 15m) + jitter`; after `max_attempts` (default 5) → `dead`, plus a Sentry event carrying `last_error` when the worker has a `SENTRY_DSN` (§Worker); a dying render/lipsync job fails + refunds its render in the same breath |
| `BudgetError`                    | rolling-24h spend cap hit (`budget.ts`) | park: back to `queued` with `run_at` pushed (default +1h), **no attempt consumed**                                                                                                                                                                                |

Handlers that own a domain row mirror terminal failures onto it (demo → `rejected`,
audio_render → `failed`, video_render → `failed` + **credit refund**). For renders this
includes the LAST transient attempt, not just permanent errors — the moment a job dies, the
render dies with it, refund-first (`refundRenderIfNeeded` is idempotent — one refund per
debit, ever; the customer never reads `failed` while the balance hasn't moved).
`video_renders.error` is displayable by construction: a `PermanentError`'s user-facing
message, or a fixed Hebrew string on retry exhaustion — the raw diagnostic stays on
`jobs.last_error`. The dead-render reaper (`reap_dead_renders`, a singleton job that
reschedules itself every ~60s) is the net under a worker crash/OOM, where no handler code
ran; in normal operation it finds zero rows. The janitor is daily and does retention only.

**Lease recovery** (`recoverExpiredLeases`, swept by every lane every ~60s): a job whose
worker died between claim and completion would otherwise sit at `running` forever —
never dead, never requeued, invisible to the reaper (the reaper singleton itself was the
first victim: `ensure` no-ops against a stuck row). A `running` job whose `locked_at` is
older than the 30-minute lease (`JOB_LEASE_MS`; worst legitimate hold measured 2026-08-09
was a 313s `render_video`) is requeued **with an attempt consumed**, mirroring
`failTransient`'s arithmetic — a job that reliably kills its worker exhausts its attempts
and goes `dead`, into the reaper's fail-and-refund path, instead of looping. The sweep is
lane-level on purpose: a stuck job can only be healed from outside the job system's
`running` state. A death that happens **here** is not reported to Sentry: the sweep is one
set-based `UPDATE` that returns a count, not rows, so it has no per-job hook to fire. Only the
terminal writes inside `runJob` report — `dead` and `failed` alike (§Worker); this sweep is the
one terminal write left silent.

## Idempotency per external call

- **Anthropic / ElevenLabs**: calls are cheap and stateless — a retry simply re-calls. Every
  call is logged to `usage_events` first-class, so double-spend is visible and capped.
- **HeyGen lipsync / fal composites (GPU + image gen)**: the expensive ones. `handleLipsync`
  writes `state.providerJobId` via `checkpoint()` **immediately after submission acceptance**;
  any retry/crash resumes polling that id instead of resubmitting a paid GPU run
  (`generate_composite` does the same). For Service B the submit hop first pins
  `params.leadInMs` (app_config `lipsync_lead_in_ms`, default 800) on the render and uploads
  the lead-in-padded `vo-padded.mp3`; a retry of that hop reuses the pinned value, so the
  file HeyGen gets and the layout Remotion assumes can never disagree
  ([04-integrations.md](04-integrations.md) §HeyGen). A pending poll past the deadline (`assertPollDeadline`,
  app_config `poll_deadline_seconds`) fails the job permanently through the normal
  terminal-failure path — render failed, credits refunded.
- **Remotion/ffmpeg**: local and idempotent by construction (same inputs → overwrite outputs).
- **Gateway charges**: `gateway_events.gateway_event_id` UNIQUE — processing a duplicate
  callback/charge report is a no-op ([05-billing.md](05-billing.md)).

## Chains, not DAGs

Each handler enqueues its successor in code — no DAG engine:

```
Service A silent : ingest_demo ─▶ ready ─┐ (user picks copy + set)      ┌▶ released
                                          └ createSet ─▶ render_video ──┘
Service A voiced : synth_tts ─▶ audio ready ─▶ ⏸ HUMAN: approveAudio ⏸ ─▶ createSet ─▶ render_video
Service B        : synth_tts ─▶ ⏸ approve ⏸ ─▶ createBRender ─▶ lipsync (pad lead-in ▶ submit ▶ poll…) ─▶ render_video (one clip + timeline + hook animation) ─▶ qc_pending ─▶ ⏸ HUMAN: QC ⏸ ─▶ released
Service C        : admin registers a clip under its character ─▶ normalize_text_block_clip (30fps check, audio kept) · wizard: serveNextTextBlock (sync; generateTextBlocks only on an empty stock) — or the admin batch route ─▶ createTextBlockRender (quote, content-policy gate, debit 25) ─▶ render_video (the clip once, with its sound, under the text block) ─▶ released — never qc_pending; a failure refunds (vault 0089, 0099)
Social posting   : schedulePosts (one tx: N scheduled_posts rows + N publish_post jobs, run_at = the instant) ─▶ publish_post (scheduled ─▶ publishing ▶ container ▶ poll… ▶ media_publish) ─▶ posted | failed (+ events post_failed) — never twice: see docs/09-social-posting.md
Daily            : janitor (retention only) · billing_renewals · check_social_tokens — idempotency key = date, so each runs ONCE a day (the server worker re-attempts the enqueue hourly; `aiugc work` doesn't)
Continuous       : reap_dead_renders — singleton (constant key), reschedules itself every ~60s; ensured at both server-worker and `aiugc work` startup
```

The two human gates (audio approval, founder QC) are represented as _the absence of the next
job_ — approval/`releaseRender` performs the state change and (for QC-reject-regenerate)
enqueues the next job. No job ever waits on a human inside a handler.

`synth_tts` contains the whole **length fit** internally: measure → atempo ≤5% if that closes the
gap → otherwise store the natural length. An overrun past the stretch is never corrected — it is
an ending, decided by `planAOutro` and priced in the advisory before confirm. `synth_tts` never
repoints `audio_renders.script_id`. _(For Service A this whole paragraph is retired as of
2026-09-05: the live steps format is silent — no script, no VO, no ending. `synth_tts` still
serves Service B's audio; the length fit and `planAOutro` are reachable only from the CLI's
`format: "full"`.)_

## Worker: two lanes, one process

`apps/worker` runs two sequential lanes (`runLane`):

- **heavy** — `render_video`, `lipsync`: strictly one at a time → Remotion render
  concurrency is 1 by construction; lipsync jobs cost the lane nothing while pending
  (they reschedule).
- **light** — everything else: audio previews and copy stay responsive during a long render.

`aiugc work [--once]` runs the identical lanes inline for the CLI phase. Scaling path (not
built): a second worker box just works — SKIP LOCKED already handles it.

**Error reporting** (`apps/worker/src/reporting.ts`, `@sentry/node`). The worker has no
supervisor and nothing watching it, so it reports two things and only two:

- **a job written to a terminal status** — `runJob` calls `WorkerLaneOptions.onJobTerminal`
  after the settle write lands, with `jobId`, `type`, `status`, `attempts` and `last_error`.
  Fired from core through a plain function type: `@sentry/node` is a dependency of
  `apps/worker` alone, because `packages/core` is bundled by the Next.js apps and must not
  pull a node-only SDK into them. After the write on purpose — a settle that threw leaves the
  row `running` for the sweep, and nothing has ended. Both terminal statuses fire:
  - `dead` — `failTransient` exhausted `max_attempts`. `attempts` is the incremented value.
  - `failed` — a `PermanentError`, **or** a job whose type has no registered handler. Never
    retries, and the handler may already have paid a provider before throwing, so this is the
    expensive kind. `attempts` is the row's own count, which is `0` for a first-run permanent
    error — it counts consumed retry budget, and a permanent error consumes none.

  The two get **different Sentry titles** (`job dead: <type>` vs `job failed: <type>`) plus a
  `terminal` tag, so they never collapse into one issue: an exhausted retry is a flaky
  provider, a permanent failure is a bug or bad input. Not fired for the lease sweep's deaths
  (§Failure taxonomy).

- **the fatal crash path** — the three `exit(1)` sites in `index.ts`. Sentry's transport is
  async, so the event is flushed (≤2.25s, raced and swallowed) before the exit; a flush that
  stalls or rejects must never make the crash slower to fail.

Reporting is opt-in and silence is supported: with no `SENTRY_DSN` nothing initialises, the
worker logs `error reporting off — SENTRY_DSN not set` at startup, and both functions are
no-ops. `aiugc work --once` passes no `onJobTerminal` and never loads the SDK, so the CLI stays
silent by construction. `apps/web`/`apps/admin` are not wired — a separate decision.

Two things to know before turning it on:

- **A crash loop is an event every ~5s.** systemd's `Restart=always`
  ([07-worker-box.md](07-worker-box.md)) turns a persistent fault — a wrong `DATABASE_URL`, a
  DNS failure — into a restart loop, and now each turn of it reports. Nothing here rate-limits
  that; the fix is a per-key rate limit in Sentry (Settings → Client Keys), which needs no
  deploy. Left server-side on purpose: a client-side limiter is more machinery on the one path
  that must stay simple.
- **`last_error` leaves the box.** It is `err.message` only — never a stack, never the job
  payload — but it is not sanitised, so a provider error quoting customer text goes with it.
  That is the deliberate trade: without `last_error` the event says a job died and gives no
  route to why, which is the gap this exists to close.
- **A malformed DSN reads as working.** `Sentry.init` does not throw on a bad DSN — measured:
  it prints `Invalid Sentry Dsn: …` once and returns a client that silently drops everything,
  so the startup line still says `error reporting on`. A truncated paste therefore looks
  healthy. `grep "error reporting"` is not proof on its own; grep for `Invalid Sentry Dsn`
  too, and confirm a real event landed before trusting it ([[worker-sentry-reporting]]).

## Remotion render budget

- 1080×1920 @ 30fps, H.264. A 30–60s ad ≈ 900–1800 frames.
- On the box (Hetzner CPX32, 4 shared vCPU — ~$41/mo + ~$0.72/mo IPv4, founder-reported from the
  Hetzner console at creation, never checked against an invoice): **~66s wall time per video**.
  Measured mean 66.1s over three consecutive live wizard renders of real customer footage,
  2026-09-02 on `af158cb`, range 64.9–68.5s, run one at a time so heavy-lane **job** concurrency
  was 1 — not to be confused with Remotion's frame concurrency, which is 4 on this box. Demo
  length was not captured and render time scales with output duration, so this is one point on a
  line, not a constant ([[service-a-render-wall-clock-on-the-box]]). At 300 renders/mo that is
  ~5.5h of box time.
- Target ceiling: <10 min per video; alert (dead job) beyond `max_attempts`.
- Remotion license: **free** — company ≤3 people (verified). Remotion Lambda explicitly
  deferred until volume demands parallel rendering; the render contract
  (`providers/remotion.ts`) doesn't change.

## Verification

`packages/core/test/jobs.test.ts` covers enqueue idempotency, claim/complete, lane filtering,
transient→dead, permanent, reschedule-with-checkpoint, drain. `test/e2e.test.ts` runs every
chain above end-to-end in DRY_RUN, including the lipsync submit→checkpoint→poll cycle and both
human gates.
