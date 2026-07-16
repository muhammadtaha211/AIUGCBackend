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

| Class                            | Trigger                                 | Behavior                                                                                                                          |
| -------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `PermanentError`                 | validation, 4xx, human-fixable problems | fail immediately; message is user-facing (Hebrew where the user sees it); domain row gets the reason (e.g. `demos.reject_reason`) |
| `TransientError` / unknown throw | 5xx, 429, timeouts, network             | exponential backoff `min(30s·2^(n-1), 15m) + jitter`; after `max_attempts` (default 5) → `dead` + Sentry                          |
| `BudgetError`                    | rolling-24h spend cap hit (`budget.ts`) | park: back to `queued` with `run_at` pushed (default +1h), **no attempt consumed**                                                |

Handlers that own a domain row mirror terminal failures onto it (demo → `rejected`,
audio_render → `failed`, video_render → `failed` + **credit refund**). The daily janitor sweeps
dead render/lipsync jobs as a second net: marks their renders failed and refunds
(`refundRenderIfNeeded` is idempotent — one refund per debit, ever).

## Idempotency per external call

- **Anthropic / ElevenLabs**: calls are cheap and stateless — a retry simply re-calls. Every
  call is logged to `usage_events` first-class, so double-spend is visible and capped.
- **fal.ai (GPU)**: the expensive one. `handleLipsync` writes `state.providerJobId` via
  `checkpoint()` **immediately after submission acceptance**; any retry/crash resumes polling
  that id instead of resubmitting a paid GPU run.
- **Remotion/ffmpeg**: local and idempotent by construction (same inputs → overwrite outputs).
- **Gateway charges**: `gateway_events.gateway_event_id` UNIQUE — processing a duplicate
  callback/charge report is a no-op ([05-billing.md](05-billing.md)).

## Chains, not DAGs

Each handler enqueues its successor in code — no DAG engine:

```
Service A silent : ingest_demo ─▶ ready ─┐ (user picks copy + set)      ┌▶ released
                                          └ createSet ─▶ render_video ──┘
Service A voiced : synth_tts ─▶ audio ready ─▶ ⏸ HUMAN: approveAudio ⏸ ─▶ createSet ─▶ render_video
Service B        : synth_tts ─▶ ⏸ approve ⏸ ─▶ createBRender ─▶ lipsync (submit ▶ poll…) ─▶ render_video ─▶ qc_pending ─▶ ⏸ HUMAN: QC ⏸ ─▶ released
Daily            : janitor · billing_renewals (idempotency key = date; enqueued by any running worker, hourly)
```

The two human gates (audio approval, founder QC) are represented as _the absence of the next
job_ — approval/`releaseRender` performs the state change and (for QC-reject-regenerate)
enqueues the next job. No job ever waits on a human inside a handler.

`synth_tts` contains the deterministic **length-fit loop** internally (measure → at most one
tighter-budget script regeneration → atempo ≤5% → else fail with a human-readable message);
`state.regenerated` guarantees the regeneration happens at most once even across retries.

## Worker: two lanes, one process

`apps/worker` runs two sequential lanes (`runLane`):

- **heavy** — `render_video`, `lipsync`: strictly one at a time → Remotion render concurrency
  is 1 by construction; lipsync jobs cost the lane nothing while pending (they reschedule).
- **light** — everything else: audio previews and copy stay responsive during a long render.

`aiugc work [--once]` runs the identical lanes inline for the CLI phase. Scaling path (not
built): a second worker box just works — SKIP LOCKED already handles it.

## Remotion render budget

- 1080×1920 @ 30fps, H.264. A 30–60s ad ≈ 900–1800 frames.
- On an 8-vCPU box (Hetzner CPX41-class, ~€30/mo flat): **~2–6 min wall time per video**,
  concurrency 1. At side-income scale (say 300 renders/mo ≈ 25h CPU) one box is ~10× headroom.
- Target ceiling: <10 min per video; alert (dead job) beyond `max_attempts`.
- Remotion license: **free** — company ≤3 people (verified). Remotion Lambda explicitly
  deferred until volume demands parallel rendering; the render contract
  (`providers/remotion.ts`) doesn't change.

## Verification

`packages/core/test/jobs.test.ts` covers enqueue idempotency, claim/complete, lane filtering,
transient→dead, permanent, reschedule-with-checkpoint, drain. `test/e2e.test.ts` runs every
chain above end-to-end in DRY_RUN, including the lipsync submit→checkpoint→poll cycle and both
human gates.
