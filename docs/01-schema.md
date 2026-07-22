# 01 — Database Schema

Source of truth: `packages/core/src/db/schema.ts` (Drizzle, TypeScript). Migrations are
generated into `supabase/migrations/` (`pnpm --filter @aiugc/core db:generate --name <slug>`)
and applied in filename order. Hand-written SQL lives beside the generated files:

- `0000_init.sql` — generated DDL (all tables, enums, indexes, FKs)
- `0001_extras_and_seed.sql` — portable extras (circular FK, partial unique index) + seed rows
- `0002_supabase_rls.sql` — **Supabase-only** (auth trigger + RLS); skipped on PGlite/plain PG
- `0003_composites_and_images.sql` — generated: composites table + `images` usage kind
- `0004_image_config_seed.sql` — hand-written: `images` daily cap + `imagegen_cost_agorot`
- `0005_persona_images.sql` — generated: `persona_images` table, drops `persona_clips`
- `0006_persona_images_default.sql` — hand-written: partial unique index (one default image per
  persona)

## Design rules

- IDs are `uuid` (`gen_random_uuid()`), timestamps are `timestamptz`.
- Status lives on **domain rows** (demos, audio_renders, video_renders); jobs are ephemeral
  executors, not the source of truth.
- jsonb is used where the shape is owned by code and validated with zod at the boundary
  (questionnaire, grid, params, word_timestamps) — not as a schema escape hatch.
- Append-only tables (`credit_ledger`, `usage_events`, `events`, `gateway_events`) are never
  updated, only inserted; invariants stay arithmetic (`balance = SUM(delta)`).

## Tables

### Identity & business

- **users** — mirror of `auth.users` (id, email, role `customer|admin`). Deliberately **no FK to
  auth.users**: real signups are mirrored by the trigger in 0002; the CLI phase and tests insert
  rows directly with no Supabase Auth present. `role='admin'` marks the founder — admin-owned
  businesses bypass credits and watermarks (that's how outreach samples are made with the
  production pipeline).
- **businesses** — owner, name, `questionnaire jsonb` (validated by `questionnaireSchema`),
  `sample_used_at` (the watermark-once policy flag).

### Assets

- **demos** — status `uploaded→probing→normalizing→ready|rejected`, `reject_reason` is always a
  human-readable Hebrew string, `probe jsonb`, raw/normalized/thumb storage paths, duration.
- **demo_segments** — **V2-ready, ships empty**: `(demo_id, idx, start_ms, end_ms, caption,
tts_line)` with `UNIQUE(demo_id, idx)`. Its existence is the "a demo may become an ordered
  list of segments" requirement — V2 step-captions are inserts, not a migration.
- **hook_clips** — the closed founder bank: file, duration, `tags jsonb` (energy/gender/vibe),
  `text_safe_area jsonb` ({x,y,w,h} in 1080×1920 space), `active`.
- **personas** / **persona_images** — identity jsonb, pinned ElevenLabs `voice_id`; reference
  images as separate rows (a persona accumulates looks/angles). `is_default` marks the image a
  render uses when a variant names only the persona — at most one per persona (partial unique
  index, 0006). Reference images are the only InfiniteTalk source; there are no persona base
  clips and no video-to-video.
- **composites** — product-in-hand images (Service B, `category === "physical_product"` only):
  business, persona, product photo path, generated output path, status
  `queued→generating→ready|failed`, and **`approved_at`** — a hard gate exactly like audio:
  lipsync refuses composites without it. The approved image takes precedence over the persona's
  reference image as the InfiniteTalk source.
- **structures** — the weekly "clonable winners" menu: `skeleton jsonb` (beat outline + script
  skeleton), persona-fit tags, source ref, week.
- **sounds** — weekly curated trending list (metadata only; sounds are attached natively at post
  time, never baked in).

### Copy & audio

- **scripts** — kind `hook_line|benefit_captions|vo_script|b_script`, Hebrew text,
  `params jsonb` (angle / caption lines / selected features / word budget), `prompt_version`
  (`<name>@v<N>`), `user_edited`. **Immutable once referenced** — user edits insert a new row
  (`updateScriptText`), so an audio render always points at exact text.
- **pronunciation_entries** — `business_id NULL` = global; plain-string match/replacement,
  longest-match-first, business entries shadow globals (`applyPronunciationMap`).
- **audio_renders** — the audio preview + hard gate. Holds `rendered_text` (exact
  post-pronunciation-map text sent to TTS — reproducibility), `word_timestamps jsonb`
  (2–4-word karaoke chunks, ready for Remotion), `alignment_source` (`elevenlabs|whisperx`),
  `stretch_ratio` (≤1.05), and **`approved_at`** — every render path checks it.

### Variants & renders

- **sets** — the variant engine. `grid jsonb` = {hookClipIds[], hookLineScriptIds[], mode,
  captionScriptId?, audioRenderId?}; cells = hook clips × hook lines (captions/audio derive from
  the demo, so they're held per set). **`parent_variant_id`** makes "more like this" one insert:
  a new set holding the starred variant's params and varying the requested axes
  (`moreLikeThis()`); the FK to video_renders is added in 0001 (circular with `set_id`).
- **video_renders** — one row per variant/render. `params jsonb` is the fully resolved cell.
  Status: `queued→rendering→(qc_pending)→released | rejected | failed`. Service A skips
  `qc_pending`; Service B enters it unless `auto_release_b`. `watermarked`, `starred_at`,
  `released_at`, `rejected_reason`, `error`. QC rejection + regeneration inserts a **new row**
  with the same params (no re-debit).

### Jobs & usage

- **jobs** — see [02-jobs.md](02-jobs.md). `idempotency_key` UNIQUE; `state jsonb` checkpoints
  external side effects (e.g. the fal request id); `(status, run_at)` index drives the claim.
- **usage_events** — one row per external call: provider, kind (`llm_tokens|tts_chars|
gpu_seconds|images`), quantity, cost estimate in agorot, job/business refs. Feeds the
  rolling-24h spend caps and any future per-business analytics.

### Billing (details in [05-billing.md](05-billing.md))

- **plans** — code PK, price (agorot), monthly credits, `allows_service_b`. Seeded placeholders:
  starter ₪299/40cr (A only), pro ₪599/100cr, studio ₪999/200cr.
- **subscriptions** — status `active|past_due|canceled|suspended`, `gateway_recurring_ref`
  (the הוראת קבע token), period bounds, `cancel_at_period_end`. Partial unique index (0001):
  at most one live subscription per business.
- **gateway_events** — raw callback/charge log; `gateway_event_id` UNIQUE makes processing
  idempotent.
- **credit_ledger** — append-only. Reasons: `grant_period`, `grant_manual`, `debit_render`,
  `refund_failed`, `expire_period`. No-rollover = an `expire_period` row zeroing the remainder
  at each renewal — the `balance = SUM(delta)` invariant never bends.
- **orders** — DFY tier tracking (status, price, payment kind: Bit/invoice, notes).

### Misc

- **events** — append-only analytics: `star` (with the variant's params — the platform's
  format-performance data), `qc_release`, `qc_reject`, `content_policy_flag`.
- **app_config** — key/value jsonb knobs (seeded in 0001/0004): `auto_release_b`, `daily_caps`
  (now including `images`), `words_per_second` (per voice, calibrated once with test renders),
  `retention_days`, `audio_preview_daily_limit`, `credit_costs`, `dunning`,
  `imagegen_cost_agorot` (per-image cost estimate; a fal price change is an UPDATE here).

## Row-level security (0002, Supabase only)

Write model: **all writes go through the server** (service role bypasses RLS); browser clients
get read-only access. Policies:

- Owner-scoped SELECT: businesses, demos, demo_segments, scripts, audio_renders, sets,
  video_renders, credit_ledger, subscriptions, orders — via `owns_business()` (SECURITY DEFINER).
- **video_renders additionally hides `qc_pending`/`rejected` rows** — customers never see
  Service B output before the founder releases it; a rejected-and-regenerated render is
  internal.
- Catalog SELECT for any authenticated user: hook_clips/personas/structures (active rows),
  sounds, plans. (0002's persona_clips policy is dropped with the table in 0005.)
- Server-only (RLS on, no policies): jobs, usage_events, gateway_events, events, app_config,
  pronunciation_entries.
- `handle_new_user()` trigger mirrors `auth.users` inserts into `public.users`.
