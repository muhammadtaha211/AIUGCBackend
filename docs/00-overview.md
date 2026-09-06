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
  The effect step offers the hook animation (zoom hook — `hookZoom` in `packages/remotion` — or none); the customer's FINAL hook text goes into render params at enqueue, never onto the script, and is burned centred from frame 0 over the one HeyGen clip. The `opener_clips` listing is retired 2026-09-06.

## Repo layout

```
docs/                   this design set
prompts/<name>/v<N>.md  versioned Claude prompts (see 04-integrations.md)
supabase/migrations/    0000 (drizzle-generated DDL) · 0001 (extras+seed) · 0002 (Supabase-only RLS)
packages/core/src/
  db/                   drizzle schema + driver-agnostic client
  jobs/                 queue (SKIP LOCKED), worker lanes, failure taxonomy, daily scheduler
  providers/            anthropic · elevenlabs · imagegen · lipsync · upscale (fal) · remotion ·
                        whisperx (dormant fallback)
  media/ffmpeg.ts       probe/normalize/thumbnail/atempo
  pipelines/            businesses · demos · copy · pronunciation · tts · composites · sets ·
                        renders · qc · credits · billing · janitor · bank
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

- **Sentry** in the worker (wrap `runJob` failures) and later in web routes — `SENTRY_DSN` env.
- **pino structured logs** with `jobId`/`jobType` on every job line; the janitor emits a daily
  digest line (deletes, refunds).
- **Dead jobs** (`status='dead'`) are the alert condition: at this scale, a daily glance at
  `aiugc status` or a Studio filter is sufficient; a Sentry event fires per dead job when wired.
- PostHog stays a web-app concern at launch (`events` table already captures stars server-side).

## Handover §8 checklist — where each question is answered

| Open question                                           | Answer                                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Job orchestration choice + retry/idempotency semantics  | [02-jobs.md](02-jobs.md) — plain jobs table + SKIP LOCKED, taxonomy, per-call idempotency           |
| Remotion render budget / concurrency                    | [02-jobs.md](02-jobs.md) §Render budget                                                             |
| Storage layout, retention, lifecycle                    | [03-storage.md](03-storage.md)                                                                      |
| Webhooks vs polling for GPU                             | [04-integrations.md](04-integrations.md) §Lipsync — polling (CLI phase has no public URL)           |
| Sets & "more like this" = one insert                    | [01-schema.md](01-schema.md) §sets; `moreLikeThis()` in `pipelines/sets.ts`                         |
| Prompt/template versioning                              | [04-integrations.md](04-integrations.md) §Anthropic — `prompts/<name>/v<N>.md`, recorded per script |
| Credits: grant/debit semantics, quotas, caps, watermark | [05-billing.md](05-billing.md)                                                                      |
| Gateway callbacks, dunning, cancellations, plan changes | [05-billing.md](05-billing.md)                                                                      |
| Admin/ops surface                                       | this file, above                                                                                    |
| Content policy for Service A                            | [04-integrations.md](04-integrations.md) §Content policy — Claude classifier pre-render             |
| Terms & privacy: the position each page takes, and why  | [legal-review.md](legal-review.md) — per-marker positions, statutes, what counsel must confirm      |
| Observability                                           | this file, above                                                                                    |
