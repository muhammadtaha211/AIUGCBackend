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
- `0007_rls_composites_persona_images.sql` — **Supabase-only**: SELECT policies for the tables
  created after 0002 (composites owner-scoped; persona_images of active personas readable by
  any authenticated user)

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
- **demo_segments** — **dropped in 0023** (never held a row). The "a demo becomes an ordered
  list of segments" idea now lives in `demo_analyses` + `demo_step_plans` (the step-plan
  format), which add the plan-level status, approval gate and versioning this table lacked.
- **demo_analysis_footage** (0050) — what `analyze_demo` knows about the recording itself, one row
  per analysis (`analysis_id` is the primary key and the FK), written right before the analysis
  lands. **Its instants are read** by the plan job, the plan save path and the analysis route,
  to place every moment's 2 s clip (`analysisInstants`, vault 0084); the moments' spans are read
  by nothing yet. `demo_analyses.timeline` is unchanged. `fps` (the sampling
  rate the moments were found at), `file_sha` (sha256 of the normalized file), `moments jsonb`
  (`{ t, startMs, endMs, read }[]`: every kept moment with the first and last sample its picture
  held on; `read: false` is a moment whose vision read failed, which the timeline drops and this
  list keeps), `detector` + `instants jsonb` (`{ atMs, strength, abrupt }[]`: every instant the
  picture changes, found from the footage alone; both NULL when not computed). An instant is not
  a screen change: a popup or a content load is one too, and no model names them
  ([vault 0077](vault/decisions/0077-moments-keep-their-real-start-and-end.md),
  [0080](vault/decisions/0080-a-moment-is-never-dropped-for-a-failed-read.md),
  [0083](vault/decisions/0083-no-model-names-the-instants-for-now.md)).
- **hook_clips** — the closed founder bank: file, duration, `tags jsonb` (energy/gender/vibe),
  `text_safe_area jsonb` ({x,y,w,h} in 1080×1920 space), `active`. Clips run **3–4 seconds**; the
  live bank holds 28 active clips across 7 personas, 4 each, plus 1 generic (`persona_id` NULL)
  row (measured 2026-09-20, read-only probe of `personas`/`hook_clips`) — see
  [04-integrations.md](04-integrations.md) §Hook-clip bank source, which also records why the
  ~60-char hook-line cap is calibrated to the long end.
  `text_safe_area` is required at register; `DEFAULT_HOOK_TEXT_RECT` only seeds the editor.
  `text_color` (0049) is `'white' | 'black'` (a CHECK), default `'white'`: the colour the clip's
  Service A hook line burns in, set by the founder in admin `/hooks` and read off the row at render
  time — never from a customer ([vault 0073](vault/decisions/0073-hook-text-colour-is-set-per-clip-by-the-founder.md)).
- **social_accounts** (0058) — a connected Instagram (later TikTok) account, owned by the Tavnit
  account (`user_id`), with its sealed tokens; and **scheduled_posts** (0058) — one row per
  video × account with the instant, caption, sound snapshot and the publish outcome. Both
  server-only; the enum types `social_platform`, `social_account_status` and
  `scheduled_post_status` are 0057. Columns and the state machine: [09-social-posting.md](09-social-posting.md).
- **text_block_clips** (0052) — the גוש טקסט bank (Service C,
  [vault 0089](vault/decisions/0089-service-c-text-block-exists-admin-only-phase-1.md),
  [0090](vault/decisions/0090-text-block-format-clip-once-with-its-own-sound.md),
  [0099](vault/decisions/0099-service-c-phase-2-opens-to-customers.md)): file,
  `duration_ms`, `speaker_gender` (`'female' | 'male'`, a CHECK — Hebrew first person is
  gendered, so the prompt is told whose voice the text is in; always the character's gender, set
  from the persona at register, at a reassign and by `updatePersona`), `persona_id` (0054,
  nullable FK to personas — the character the clip belongs to; NULL = listed to no customer and
  flagged in admin, 0012's hook pattern), `text_safe_area jsonb` ({x,y,w,h}, seeded by
  `DEFAULT_TEXT_BLOCK_RECT` — the area the customer's box starts on), `text_color`
  (`'white' | 'black'`, the same vocabulary and ink table as hook_clips), `active`. Its own table,
  not a kind on hook_clips, so Service A's hook listings can never return one. Registered by hand
  in admin `/text-blocks`; the clip is played once with its own sound under the text block.
  Server-only RLS (no policy): every reader is the server, so phase 2 added none (0099).
- **opener_clips** (0032) — **retired 2026-09-06** ([vault 0023](vault/decisions/0023-hook-is-a-remotion-animation-opener-clips-retired.md)): the table stays (no migration drops it) but no render reads it — the Service B hook is a Remotion animation over the one HeyGen clip. What it held: one founder-made clip per (selfie image × effect), stored play-ready…
  nothing processes it at render time). `persona_image_id`, `effect` (free key, e.g.
  `hand_cover`/`finger_snap`), `label` (Hebrew, shown to the customer), `file_path`,
  `duration_ms`, `reveal_at_ms`, `text_safe_area jsonb` ({x,y,w,h} in 1080×1920, the same shape
  and the same required-at-register rule as `hook_clips`), `active`. The reveal is constrained by
  `CHECK (reveal_at_ms >= 0 AND reveal_at_ms <= duration_ms)`, and one **active** row per
  (image, effect) by a partial unique index — so a superseded clip stays as `active=false` and
  the pair can be re-registered. Soft delete is `active=false`, like the hook bank.
  `reveal_at_ms` was where the hard cut landed (the first frame whose pose matched the selfie — hand out of frame and settled); the hook text burned over the palm phase and the render hard-cut into the HeyGen output there. No render cuts anything against the HeyGen clip since 2026-09-06 ([vault 0023](vault/decisions/0023-hook-is-a-remotion-animation-opener-clips-retired.md)).
  The hook text burns over the palm phase before it and the render hard-cuts into the HeyGen
  output there — which is why **a clip must end on (approximately) the selfie frame it was made
  from**
  (`docs/vault/facts/heygen-avatar-iv-idles-on-leading-silence.md`;
  `docs/vault/decisions/0017-service-b-single-setting-selfie-talking-head.md`).
- **personas** / **persona_images** — identity jsonb, pinned ElevenLabs `voice_id` (nullable since
  0055: a character for גוש טקסט alone has none, and Service B's picker lists only voiced personas,
  vault 0099); reference
  images as separate rows (a persona accumulates looks/angles). `is_default` marks the image a
  render uses when a variant names only the persona — at most one per persona (partial unique
  index, 0006). `kind` (0009) is `'preview'` (avatar-card thumbnail only) | `'background'`
  (background picker) | `'selfie'` (added by 0032 — the Service B render source and the B card
  thumbnail). It is plain text with no CHECK, so a new value costs no DDL, but the first two
  literals are enforced at the app boundary in `apps/admin/src/lib/admin.ts` and
  `apps/web/src/lib/service-b.ts`; 0032 changed neither. `source_image_id` (0032) is lineage
  only — which standing image a selfie was derived from — a self-FK with no cascade, exactly
  like `hook_clips.source_clip_id`. 0032 does **not** touch `is_default` or its index: pointing a
  persona's default at its selfie is an UPDATE, not a migration. Reference images are the only
  lipsync source — HeyGen, not the InfiniteTalk this line used to name; the image+audio-only
  constraint survived the switch. There are no persona base clips and no video-to-video (locked
  decision #12).
- **composites** — product-in-hand images (Service B, `category === "physical_product"` only):
  business, persona, product photo path, generated output path, status
  `queued→generating→ready|failed`, and **`approved_at`** — a hard gate exactly like audio:
  lipsync refuses composites without it. The approved image takes precedence over the persona's
  reference image as the HeyGen lipsync source.
- **structures** — the weekly "clonable winners" menu: `skeleton jsonb` (beat outline + script
  skeleton), persona-fit tags, source ref, week. The web wizard does not choose one at random:
  `pickStructureForBusiness` rotates the `active` rows least-recently-used first, per business,
  off `max(scripts.created_at)` — no `last_used_at` column
  ([vault 0031](vault/decisions/0031-the-structure-bank-rotates-least-recently-used-per-business.md)).
- **sounds** — a **trending-sound research tracker**, not an asset bank: which sound trended on
  which platform in which week (`title, platform, url, week, tags`). There is no storage path
  and no file reference, so nothing here can be bundled into a render — bundled audio would need
  new columns or a new table. Sounds are attached natively at post time, never baked in
  ([04-integrations.md](04-integrations.md) §Service A audio).

### Copy & audio

- **scripts** — kind `hook_line|benefit_captions|vo_script|b_script|text_block` (0051 added
  `text_block`: one Service C text per row, `params {skeleton, textBlockClipId, speakerGender,
questionnaireUpdatedAt}` — the last, since phase 2, the questionnaire stamp the batch was written
  against), Hebrew text, `params jsonb` (angle / caption lines / selected features / word budget),
  `prompt_version` (`<name>@v<N>`), `user_edited`, `shown_at` (0056 — when the גוש טקסט wizard
  first served this text_block row; NULL = unseen. The rotation's clock, since a batch's rows share
  one `created_at`; the one column written after insert). **Immutable once referenced** — user
  edits insert a new row (`updateScriptText`), so an audio render always points at exact text.
- **pronunciation_entries** — `business_id NULL` = global; plain-string match/replacement,
  longest-match-first, business entries shadow globals (`applyPronunciationMap`).
- **audio_renders** — the audio preview + hard gate. Holds `rendered_text` (exact
  post-pronunciation-map text sent to TTS — reproducibility), `word_timestamps jsonb`
  (2–4-word karaoke chunks, ready for Remotion), `alignment_source` (`elevenlabs|whisperx` —
  `elevenlabs` in practice; whisperx is a dormant fallback, see 04),
  `stretch_ratio` (≤1.05), and **`approved_at`** — every render path checks it.

### Variants & renders

- **sets** — the variant engine. `grid jsonb` = {hookClipIds[], hookLineScriptIds[], mode,
  captionScriptId?, audioRenderId?}; cells = hook clips × hook lines (captions/audio derive from
  the demo, so they're held per set). **`parent_variant_id`** makes "more like this" one insert:
  a new set holding the starred variant's params and varying the requested axes
  (`moreLikeThis()`); the FK to video_renders is added in 0001 (circular with `set_id`).
- **video_renders** — one row per variant/render. `params jsonb` is the fully resolved cell;
  for Service B the pipeline also pins `leadInMs` (before the HeyGen submit), `lipsyncPath` (the one clip Remotion composes) and the FINAL `hookText` + `hookTextSafeArea` (copied at enqueue, [vault 0017](vault/decisions/0017-service-b-single-setting-selfie-talking-head.md)) on it (`VariantParams`, `pipelines/sets.ts`); HeyGen has no seed and no upscale stage, and `openerClipId` is retired 2026-09-06 ([vault 0023](vault/decisions/0023-hook-is-a-remotion-animation-opener-clips-retired.md)). Status: `queued→rendering→(qc_pending)→released | rejected | failed`.
  Service A skips `qc_pending`; Service B enters it unless `auto_release_b`; Service C (`service`
  `c`, 0051 — גוש טקסט, `params {textBlockClipId, scriptId, text, textSafeArea}`, the text and the
  customer's box — or the clip's area when none was placed — copied at enqueue like B's
  `hookText`) skips it like A. `watermarked`,
  `starred_at`, `released_at`, `rejected_reason`, `error`. QC rejection + regeneration inserts a **new row** with the same params minus `lipsyncPath` (no re-debit) — HeyGen has no seed, so the regeneration is a fresh non-deterministic take ([04-integrations.md](04-integrations.md) §HeyGen).

### Jobs & usage

- **jobs** — see [02-jobs.md](02-jobs.md). `idempotency_key` UNIQUE; `state jsonb` checkpoints
  external side effects (e.g. the fal request id); `(status, run_at)` index drives the claim.
- **usage_events** — one row per external call: provider, kind (`llm_tokens|tts_chars|
gpu_seconds|images`), quantity, cost estimate in agorot, job/business refs. Feeds the
  rolling-24h spend caps and any future per-business analytics. The four values cover every call made today — the Topaz upscale that had no `usage_kind` left with InfiniteTalk in 2026-08 (HeyGen has no upscale stage; [04-integrations.md](04-integrations.md) §HeyGen).

### Billing (details in [05-billing.md](05-billing.md))

- **plans** — code PK, price (agorot), monthly credits, `allows_service_b`. Seeded placeholders:
  starter ₪299/40cr (A only), pro ₪599/100cr, studio ₪999/200cr. Migration 0043 (**applied
  2026-09-17**) replaced all three — starter ₪150/1000cr, pro ₪300/2500cr, studio
  ₪500/5000cr, `allows_service_b` true on all three — those are the live values; see
  [05-billing.md](05-billing.md). `name` is Hebrew since 0044 (**applied 2026-09-17**): התחלה /
  מתקדם / פרימיום.
- **subscriptions** — keyed to the ACCOUNT since 0041: `user_id` NOT NULL and **no `business_id`
  at all** (one owner, one subscription, one credit pool that every business he holds spends from
  — the same model `credit_ledger` has had since 0011). Status
  `active|past_due|canceled|suspended`, `gateway_recurring_ref` (the הוראת קבע token), period
  bounds, `cancel_at_period_end`, and `scheduled_plan_code` (0045, nullable FK to plans — a pending
  downgrade or last-day upgrade the next renewal applies; `plan_code` stays what was paid for
  until then, [vault 0053](vault/decisions/0053-downgrades-are-scheduled-not-applied.md)).
  `gateway` defaults to `'sumit'` since 0044 (the API layer our code will call; Upay is the
  acquirer behind it, [vault 0054](vault/decisions/0054-payment-stack-is-sumit-via-upay.md)).
  Partial unique index
  `subscriptions_one_live_per_user` (0041, replacing 0001's per-business one): at most one live
  subscription per account.
- **gateway_events** — raw callback/charge log; `gateway_event_id` UNIQUE makes processing
  idempotent. Kinds: `recurring_charge_success|failed` (renewals),
  `plan_change_charge_success|failed` (prorated upgrades), `checkout_charge`,
  `checkout_refused`, `checkout_unconfirmed` (the hosted checkout, 0062), and the ₪5 intro
  offer's `intro_charge`, `continue_charge`, `continue_charge_failed`,
  `continue_charge_unconfirmed`, `continue_charge_cleared`, `continue_charge_orphaned`
  ([vault 0109](vault/decisions/0109-a-five-shekel-intro-offer.md)). `kind` is plain text.
- **checkout_intents** (0048) — the hosted checkout's server-side half; since 0062 a `kind`
  (`plan|intro`, CHECK) with `plan_code` NULL exactly for an intro intent.
- **intro_trials** (0062) — one row per account that bought the ₪5 intro offer: `user_id` is the
  PRIMARY KEY (once per account), the completed `intent_id`, the `sumit_customer_id` a continue
  charges, `credits`, the ledger baseline at activation (`balance_before`, `manual_before`,
  `open_debits_before`), `started_at`/`expires_at` (30 days after the payment), `expired_at`,
  `converted_at` + `subscription_id`, and the continue attempt (`continue_attempt_at/_plan/_agorot`,
  all or none). Server-only.
- **terms_acceptances** (0046) — the record that a signed-in customer ticked the terms box at
  checkout: `user_id` (not null), `terms_version` (the date string the terms page shows at its
  head), `context` (`'checkout'`, and since 0109 `'intro'` and `'continue'` — plain text), `ip`,
  `user_agent`, `accepted_at`; index on `user_id`.
  Server-only: RLS on, no policies, the 0035 pattern.
- **credit_ledger** — append-only, keyed to the ACCOUNT since 0011: `user_id` NOT NULL is
  ownership (`balance = SUM(delta)` per user — one owner's businesses share one balance),
  `business_id` nullable context on spend rows (user-level grants have none). Reasons:
  `grant_period`, `grant_manual`, `debit_render`, `refund_failed`, `expire_period`, and since
  0061 the intro offer's `grant_trial` / `expire_trial` (ref = the intro intent).
  No-rollover = an `expire_period` row zeroing the remainder at each renewal — the
  `balance = SUM(delta)` invariant never bends.
- **orders** — DFY tier tracking (status, price, payment kind: Bit/invoice, notes).

### Misc

- **events** — append-only analytics: `star` (with the variant's params — the platform's
  format-performance data), `qc_release`, `qc_reject`, `content_policy_flag`.
- **feedback** (0035) — the in-app "צור קשר" inbox: one row per message a signed-in customer
  writes at `/home/feedback`. `user_id` (nullable since 0047, so that a public `/contact` form —
  a separate task, not built yet — can write anonymous rows carrying `contact_name`,
  `contact_email` and `ip` instead; nothing writes those three columns today), `business_id`
  (nullable — a user with no business can still write), `message`, `page` (the pathname the form
  was opened from, context only), `created_at` + an index on it. The founder reads them at `/feedback` in the admin
  console; **nothing is emailed, posted or notified**, and there is no handled/resolved state.
  Server-only: RLS on, no policies — and because there is no policy, the ENABLE rides in the
  portable migration rather than a separate Supabase-only file
  ([vault 0035](vault/decisions/0035-a-policyless-table-keeps-its-rls-in-the-portable-file.md)).
- **app_config** — key/value jsonb knobs (seeded in 0001/0004): `auto_release_b`, `daily_caps`
  (now including `images`), `words_per_second` (live value `{"default": 2.1}`; per-voice keys
  deliberately left empty and the read path unclamped — [04-integrations.md](04-integrations.md)
  §Anthropic),
  `retention_days`, `audio_preview_daily_limit`, `credit_costs`, `dunning`,
  `imagegen_cost_agorot` (per-image cost estimate; a fal price change is an UPDATE here), and
  `intro_offer` (`{"enabled": bool}`, seeded off by 0062 — the ₪5 intro offer's switch; absent or
  unparseable reads as off, [vault 0109](vault/decisions/0109-a-five-shekel-intro-offer.md)).
  Several knobs are **opt-in and unseeded** — read with `getConfigValueOr`, so a missing row is
  the code default and toggling them is an INSERT/DELETE, never a migration:
  `tts_enhance` (boolean; absent = `false` = no v3 audio-tag pass), `tts_stability` (number;
  absent = `voice_settings` omitted from the ElevenLabs body — v3 takes 0.0 / 0.5 / 1.0 =
  creative / natural / robust), and the HeyGen knobs (`pipelines/renders.ts`): `lipsync_resolution` (default `1080p`), `lipsync_lead_in_ms` (default 800), `lipsync_motion_prompt` and `lipsync_expressiveness` — the last two seeded by 0034 at the generic hand-free prompt and `"medium"` ([vault 0022](vault/decisions/0022-heygen-expressiveness-medium-generic-motion-prompt.md)); `lipsync_resolution`, `lipsync_motion_prompt` and `tts_enhance` are seeded by 0031, so the genuinely unseeded rows are `tts_stability` and `lipsync_lead_in_ms`. `personas.identity.motionPrompt` is unread.

## Row-level security (0002, Supabase only)

Write model: **all writes go through the server** (service role bypasses RLS); browser clients
get read-only access. Policies:

- Owner-scoped SELECT: businesses, demos, demo_analyses + demo_step_plans (0024, joined
  through demos), scripts, audio_renders, sets,
  video_renders, orders — via `owns_business()` (SECURITY DEFINER).
  credit_ledger is scoped directly by `user_id = auth.uid()` since 0012, and subscriptions the
  same way since 0042 — both are account-level, and neither has a `business_id` to go through
  (0011, 0041).
- **video_renders additionally hides `qc_pending`/`rejected` rows** — customers never see
  Service B output before the founder releases it; a rejected-and-regenerated render is
  internal.
- Catalog SELECT for any authenticated user: hook_clips/personas/structures (active rows),
  sounds, plans, opener_clips (active rows — `opener_clips_select_active`, 0033, mirroring
  `hook_clips_select_active`), and persona_images of active personas (0007). (0002's
  persona_clips policy is dropped with the table in 0005; composites get an owner-scoped SELECT
  in 0007.)
- Server-only (RLS on, no policies): jobs, usage_events, gateway_events, events, app_config,
  pronunciation_entries, `text_block_clips` (0052 — no customer SELECT policy, not even in
  phase 2: every reader is the server over `DATABASE_URL`, vault 0099), `social_accounts` and
  `scheduled_posts` (0058, the same shape — tokens never reach a browser client), `intro_trials`
  (0062), and `feedback` — whose ENABLE is in **0035**, not here, because a
  policy-less table needs no Supabase role and so stays portable
  ([vault 0035](vault/decisions/0035-a-policyless-table-keeps-its-rls-in-the-portable-file.md),
  measured in [facts](vault/facts/pglite-accepts-bare-enable-row-level-security.md)).
  `demo_analysis_footage` (0050) follows the same pattern in its own file.
- `handle_new_user()` trigger mirrors `auth.users` inserts into `public.users`.
