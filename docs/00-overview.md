# 00 — Architecture Overview

Backend design for the Hebrew AI UGC ad platform (V0). Product decisions are locked per the
handover; this document set covers the six backend deliverables and answers every open question
from handover §8 (checklist at the bottom).

## System shape

One pnpm monorepo, boring-tech throughout:

```
┌──────────────┐   enqueue jobs / read status    ┌─────────────────────────────┐
│  aiugc CLI   │────────────────┐                │  Node worker (Railway/Fly/  │
│ (founder)    │                │                │  Hetzner) — apps/worker     │
└──────────────┘                ▼                │  · job loop (2 lanes)       │
┌──────────────┐        ┌──────────────┐         │  · ffmpeg / Remotion        │
│ Next.js on   │───────▶│  Supabase    │◀────────│  ·  polls HeyGen (lip-sync) — fal only for nano-banana composites       │
│ Vercel       │        │  Postgres +  │         │  · calls Anthropic / EL     │
│ (at launch)  │        │  Auth +      │         └─────────────────────────────┘
└──────┬───────┘        │  Storage     │
       │ gateway        └──────────────┘
       ▼ callbacks
┌──────────────┐
│ Grow (billing)│  + Green Invoice (auto חשבונית מס קבלה)
└──────────────┘
```

- **All business logic lives in `packages/core`** — pipelines, providers, jobs, billing. The CLI
  (`apps/cli`) and the worker (`apps/worker`) are thin wrappers; the future web app wraps the
  same functions. Nothing heavy ever runs in a serverless function.
- **Supabase cloud from day 1** so the CLI phase and the web launch share one database, one
  storage layout, one job queue. (Local dev/tests run against PGlite + a filesystem storage
  backend — no Docker needed.)
- **One worker process, two lanes** (heavy = render/lipsync/upscale, light = everything else) so a
  minutes-long render never blocks an audio preview. Render concurrency is exactly 1 by
  construction. See [02-jobs.md](02-jobs.md).
- **`DRY_RUN=1` stubs every external provider** with deterministic fakes, so the entire pipeline
  (including alignment, chunking, QC — the length fit belongs to the retired Service A "full" format, [0020](vault/decisions/0020-service-a-is-hook-and-steps-only.md)) runs end-to-end without API keys. The e2e test
  (`packages/core/test/e2e.test.ts`) exercises exactly the founder workflow this way.
- **The web wizards are thin shells over the same functions.** Service A
  (`apps/web/src/components/a-wizard`): persona → hook clip → hook studio → demo → step plan →
  render. Service B (`apps/web/src/components/b-wizard`, vault decision 0017): persona →
  pointers → script → audio → hook animation (zoom hook or none; the opener-clip listing is retired 2026-09-06, its replacement pending — [0023](vault/decisions/0023-hook-is-a-remotion-animation-opener-clips-retired.md)) → render. Single setting, so B has no image step and
  no product step: the persona card shows the persona's selfie (`personaSelfie` in
  `apps/web/src/lib/service-b.ts` — the one resolver for the card and the
  render source), the wizard sends that image's id with the render, and the route refuses
  anything that is not that persona's live `kind='selfie'` image (its opener-clip check is retired 2026-09-06).
  The effect step offers the hook animation by name — none | zoom | focus | whip, the numbers behind
  each in `packages/core/src/hook-effect.ts` — and PREVIEWS it: picking one plays the real
  animation once over the persona's selfie and then shows a replay button
  (`hook-effect-preview.tsx`, which runs the composition's own `@aiugc/remotion/timing` state
  functions in the browser; vault 0026). The customer's FINAL hook text goes into render params at
  enqueue, never onto the script, and is burned centred from frame 0 over the one HeyGen clip; it may
  end with `?` or `!` but not with `.` `,` `;` `:` `…` (vault 0025). The `opener_clips` listing is
  retired 2026-09-06.
- **The dashboard is two libraries beside the two wizards.** `/home/renders` (כל היצירות) lists
  every render of the selected business, both services, 24 per page — the homepage strip is the live
  window onto the same rows and the same `GET /api/businesses/[id]/renders`, which answers in two
  shapes: no query = the strip's newest 20 with job progress for the one head render, `?page=N` =
  `{ renders, total }` with no progress at all. Both carry `service`. The 9:16 tile itself
  (`apps/web/src/app/home/render-tile.tsx`) is shared so the two surfaces cannot drift.
  `/home/demos` (סרטוני המוצר) lists the uploaded demos, and each ready one opens
  `/home/demos/[demoId]` — the A wizard's own `StepPlan` mounted outside the wizard, with no hook
  picked and nowhere to continue to, so choosing steps and writing their labels is reachable without
  starting an ad. It needs no changes to `step-plan.tsx`: the component takes `onContinue` as
  optional and every route it calls is ownership-gated on the demo id alone.
- **Service C, גוש טקסט, is open to every customer with credits since phase 2** (2026-10-09,
  [vault 0099](vault/decisions/0099-service-c-phase-2-opens-to-customers.md); phase 1 was
  admin-only, [0089](vault/decisions/0089-service-c-text-block-exists-admin-only-phase-1.md)): a
  founder-made bank clip played once with its own sound under one Hebrew text block. The wizard is
  `/home/c/new` (the dashboard's third card): character → one of that character's clips → a studio
  that serves one text at a time (`serveNextTextBlock`: a stored batch from `generateTextBlocks`,
  rotated by the structure the business has gone longest without seeing; the model is called only
  when no unseen text is left) with a free edit and A's placement editor over the clip → a 25-credit
  render (`createTextBlockRender`, the third debit site) → the library. The founder's console keeps
  `/text-blocks` (register a clip under its character) and `/text-blocks/new` (the whole batch at
  once, admin-owned businesses only).

## Repo layout

```
docs/                   this design set
docs/unattended/        cloud-session runs from a spec: protocol, spec template, runbook (vault 0096)
.claude/hooks/          the pre-push hook refusing a push to main, and its installer (vault 0097)
prompts/<name>/v<N>.md  versioned Claude prompts (see 04-integrations.md)
supabase/migrations/    0000 (drizzle-generated DDL) · 0001 (extras+seed) · 0002 (Supabase-only RLS)
packages/core/src/
  db/                   drizzle schema + driver-agnostic client
  jobs/                 queue (SKIP LOCKED), worker lanes, failure taxonomy, daily scheduler
  providers/            anthropic · elevenlabs · imagegen · lipsync · upscale (fal) · remotion ·
                        whisperx (dormant fallback)
  media/ffmpeg.ts       probe/normalize/thumbnail/atempo
  pipelines/            businesses · demos · copy · pronunciation · tts · composites · sets ·
                        renders · qc · credits · billing · janitor · bank · text-blocks
  storage.ts            Supabase Storage / local filesystem backends
  captions.ts           word alignment -> 2–4-word karaoke chunks (pure, tested)
  budget.ts             rolling-24h spend caps + usage recording
apps/cli/               `aiugc` — the founder's headless pipeline
apps/worker/            the production job loop
apps/web/               the customer app — onboarding, /home, the two wizards (see System shape)
```

## Environments

|                   | Database                     | Storage                                                          | Providers             |
| ----------------- | ---------------------------- | ---------------------------------------------------------------- | --------------------- |
| Tests             | PGlite (in-process Postgres) | temp dir                                                         | DRY_RUN stubs         |
| Founder CLI (now) | Supabase cloud               | Supabase Storage (or local `.storage/` until the project exists) | real keys, or DRY_RUN |
| Production        | Supabase cloud               | Supabase Storage                                                 | real keys             |

Config: secrets in `.env` (see `.env.example`); every operational knob (caps, retention,
credit costs, dunning, `auto_release_b`, words-per-second calibration) is an `app_config` row —
changing policy is an UPDATE, not a deploy.

## Admin / ops surface (V0)

- **Service B QC queue**: `aiugc qc list|approve|reject` or a Supabase Studio view on
  `video_renders where status='qc_pending'` (RLS hides these rows from customers).
- **DFY orders**: the `orders` table, managed via Studio; money moves over Bit + manual rows.
- **Ops dashboard**: the `jobs` table is the dashboard (`aiugc status`); `usage_events` is the
  spend view; `events` is the stars/QC log.
- **auto_release_b**: one `app_config` update flips Service B to auto-release. Not a rebuild.

## Observability

- **Sentry** (`@sentry/node`, `apps/worker` only — [02-jobs.md](02-jobs.md) §Worker): one event
  per job that ends for good — `dead` **or** `failed` — carrying `jobs.last_error`, and one per
  fatal crash, flushed before the `exit(1)`. Opt-in on `SENTRY_DSN`; unset means nothing
  initialises and the worker says so at startup. Web routes are **not** wired — a separate
  decision, not an oversight.
- **pino structured logs** with `jobId`/`jobType` on every job line; the janitor emits a daily
  digest line (deletes, refunds).
- **Terminal jobs are the alert condition — both kinds.** `status='dead'` is a transient failure
  that exhausted `max_attempts`; `status='failed'` is a permanent error, which never retries.
  **`failed` is the more common and the more expensive of the two**: the handler may already have
  paid a provider before throwing, which is how two lipsync jobs burned a HeyGen charge each on
  2026-09-06. Watching only `dead` misses exactly the class that costs money. At this scale a
  daily glance at `aiugc status` or a Studio filter covers both; with a `SENTRY_DSN` set, an
  event also fires per terminal job, under a separate issue per kind. Still not covered: the
  lease sweep's deaths.
- PostHog stays a web-app concern at launch (`events` table already captures stars server-side).

## Handover §8 checklist — where each question is answered

| Open question                                           | Answer                                                                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Job orchestration choice + retry/idempotency semantics  | [02-jobs.md](02-jobs.md) — plain jobs table + SKIP LOCKED, taxonomy, per-call idempotency                                          |
| Remotion render budget / concurrency                    | [02-jobs.md](02-jobs.md) §Render budget                                                                                            |
| Storage layout, retention, lifecycle                    | [03-storage.md](03-storage.md)                                                                                                     |
| Webhooks vs polling for GPU                             | [04-integrations.md](04-integrations.md) §Lipsync — polling (CLI phase has no public URL)                                          |
| Sets & "more like this" = one insert                    | [01-schema.md](01-schema.md) §sets; `moreLikeThis()` in `pipelines/sets.ts`                                                        |
| Prompt/template versioning                              | [04-integrations.md](04-integrations.md) §Anthropic — `prompts/<name>/v<N>.md`, recorded per script                                |
| Credits: grant/debit semantics, quotas, caps, watermark | [05-billing.md](05-billing.md)                                                                                                     |
| Gateway callbacks, dunning, cancellations, plan changes | [05-billing.md](05-billing.md)                                                                                                     |
| Admin/ops surface                                       | this file, above                                                                                                                   |
| Content policy for Service A                            | [04-integrations.md](04-integrations.md) §Content policy — Claude classifier pre-render                                            |
| Terms & privacy: the position each page takes, and why  | [legal-review.md](legal-review.md) — per-marker positions, statutes, what counsel must confirm                                     |
| Observability                                           | this file, above                                                                                                                   |
| Social posting: connections, scheduling, publish once   | [09-social-posting.md](09-social-posting.md) — data model, the publish job's checkpoints, the switch, the Meta and TikTok runbooks |
