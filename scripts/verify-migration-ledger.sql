-- scripts/verify-migration-ledger.sql
--
-- Proves that migrations 0008-0030, 0032-0033 and 0035-0038 actually landed in
-- a given database. (0031 and 0034 have never had a row here.)
--
-- Originally written for docs/vault/defects/migration-ledger-stops-at-0007.md:
-- production's supabase_migrations.schema_migrations recorded only 0000-0007
-- while 0008-0030 had been applied by hand, and marking an unapplied migration
-- as applied is the one way to turn that annoyance into data loss.
--
-- STRICTLY READ-ONLY: one SELECT over system catalogs and existing rows.
-- Written as a single statement on purpose — the Supabase SQL editor shows only
-- the last statement's result, so 29 separate SELECTs would display one row.
--
-- ---------------------------------------------------------------------------
-- TWO LAYERS. Check the one that matches the database you are pointed at.
-- ---------------------------------------------------------------------------
--
--   layer = 'structural'  Anything a migration-built database reproduces on
--                         its own: catalog objects (columns, indexes, policies,
--                         enums, tables) and the app_config rows the migrations
--                         themselves seed. **Every structural row must read
--                         true in ANY environment** — production, staging, or a
--                         database freshly built by `supabase db push`.
--                         One row reads NULL, not true: see 0020 below.
--
--   layer = 'data'        Assertions about pre-existing business rows that only
--                         the old production database ever had. These are the
--                         real proof for the three migrations whose effect was
--                         data movement rather than DDL — but they are
--                         meaningless against an empty database, where they
--                         read false (or pass vacuously) for reasons that have
--                         nothing to do with whether the migration ran.
--
-- On a FRESH or REBUILT database, run with `WHERE layer = 'structural'` and
-- expect, of 29 rows: **27 true, 1 false (0022), 1 NULL (0020)**. Two of those
-- three need saying out loud, because neither is a finding:
--
--   * **0020 is NULL on every database** — see its own comment below.
--   * **0022 reads FALSE on any database that has also run 0036, which is all of
--     them.** 0022 asserts platform `gpu_seconds = 7200`; 0036 raised it to
--     32000 on 2026-09-11 and nobody came back to this row. The row is
--     SUPERSEDED, not failing, and 0036's own row asserts all seven caps
--     including that one. Measured 2026-09-13 twice — by replaying
--     PORTABLE_MIGRATIONS into PGlite, and then by running this file against
--     PRODUCTION, which returned exactly 27 true / 1 false / 1 NULL with 0022
--     the only false. Left as it is deliberately:
--     relaxing or re-pinning 0022's predicate is a judgement call about what
--     0022 is still supposed to prove, not a count fix. Until then, treat a
--     false on 0022 ALONE as expected and every other false as real.
--     (This paragraph is why the count above is not "28 true" — it said
--     "27 true + 1 NULL" from 2026-09-11 to 2026-09-13, which was already one
--     out for the same reason.)
--
-- Row history: 0036 added one row on 2026-09-11, 0037 another the same day,
-- 0038 one more on 2026-09-13. 0037 and 0038 were both applied to production on
-- the day their row was written and both read true — see RESULTS.
-- The old production database read all 26 of its rows
-- true (see RESULTS); it predates 0032-0033 and 0035 and is deleted, so the
-- three rows added for them have nothing to say about it.
--
-- Corrected 2026-08-26: this file previously claimed it "stays useful for
-- verifying any OTHER environment (staging, a rebuilt DB)" while mixing both
-- layers into 23 undifferentiated rows. It does not, unsplit — see the RESULTS
-- section at the bottom for the run that falsified it.
--
-- Any FALSE structural row: STOP. Do not include that migration in a repair
-- command; investigate first (each check's note says what a false can also
-- mean).
--
-- If the file ERRORS instead of returning rows, the error names a missing table
-- or column — that itself is proof the owning migration did not land. The
-- catalog checks cannot error. Only the 'data' rows dereference tables owned by
-- the migrations under test (usage_events, video_renders, demo_analyses).

WITH checks(migration, layer, applied, note) AS (VALUES

-- 0008: ALTER TABLE personas ADD COLUMN gender.
('0008', 'structural', (SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'personas'
    AND column_name = 'gender')), 'column exists'),

-- 0009: persona_images gains kind AND label. Both asserted so a half-applied
-- paste (one ALTER of the two) shows up as false.
('0009', 'structural', (SELECT (
  SELECT count(*) FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'persona_images'
    AND column_name IN ('kind', 'label')) = 2), 'both columns exist'),

-- 0010: persona_images.retired.
('0010', 'structural', (SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'persona_images'
    AND column_name = 'retired')), 'column exists'),

-- 0011: user_id NOT NULL proves ADD COLUMN + backfill + SET NOT NULL in one bit
-- (SET NOT NULL cannot succeed over an unbackfilled column); business_id
-- nullable proves the DROP NOT NULL, and the FK ran between those two. The
-- CREATE INDEX is the file's LAST statement — nothing brackets it — so it is
-- asserted separately against a truncated paste.
('0011', 'structural', (SELECT (
  SELECT count(*) FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'credit_ledger'
    AND ((column_name = 'user_id' AND is_nullable = 'NO')
      OR (column_name = 'business_id' AND is_nullable = 'YES'))) = 2
  AND EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'credit_ledger'
      AND indexname = 'credit_ledger_user_idx')),
  'nullability pair + the trailing CREATE INDEX'),

-- 0012: the 0002 policy of the SAME NAME was scoped by owns_business(business_id);
-- 0012 dropped it and recreated it scoped by user_id = auth.uid(). Existence
-- alone proves nothing — the qual text is the discriminator.
('0012', 'structural', (SELECT EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'credit_ledger'
    AND policyname = 'credit_ledger_select_own'
    AND qual LIKE '%user_id%')), 'policy requalified to user_id'),

-- 0013: the three columns, plus the two hook_clips FKs — the FK DO-blocks are
-- the file's LAST statements, so column existence alone would pass a paste
-- truncated before them.
('0013', 'structural', (SELECT (
  SELECT count(*) FROM information_schema.columns
  WHERE table_schema = 'public'
    AND ((table_name = 'demos' AND column_name = 'description')
      OR (table_name = 'hook_clips' AND column_name IN ('persona_id', 'source_clip_id')))) = 3
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.hook_clips'::regclass AND contype = 'f'
      AND conname IN ('hook_clips_persona_id_personas_id_fk',
                      'hook_clips_source_clip_id_hook_clips_id_fk')) = 2),
  'three columns + both trailing FKs'),

-- 0014: persona_images.catalog_path.
('0014', 'structural', (SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'persona_images'
    AND column_name = 'catalog_path')), 'column exists'),

-- 0015: persona_images.blur_data_url.
('0015', 'structural', (SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'persona_images'
    AND column_name = 'blur_data_url')), 'column exists'),

-- 0016: the two partial unique indexes that make double-debit/double-refund
-- structurally impossible.
('0016', 'structural', (SELECT (
  SELECT count(*) FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'credit_ledger'
    AND indexname IN ('credit_ledger_debit_render_uniq',
                      'credit_ledger_refund_failed_uniq')) = 2),
  'both partial unique indexes'),

-- 0017: full rewrite of the credit_costs row. Migration-seeded config, so it
-- reproduces on a rebuild. KEYS prove the rewrite; values are deliberately not
-- asserted — the migration's contract is "changing any of these is an UPDATE
-- here, never a deploy", so a hand-tuned number would not disprove application.
-- NOT ? 'a_render' proves replacement, not a merge over the old
-- {"a_render":1,"b_render":15} placeholder.
('0017', 'structural', (SELECT EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'credit_costs'
    AND value ?& array['a_assembly_flat', 'a_demo_per_second', 'a_outro_per_second',
                       'a_minimum_credits', 'b_per_second', 'b_minimum_credits',
                       'a_ending_reroll_per_second', 'a_remix_assembly_credits']
    AND NOT value ? 'a_render')), 'seeded config: credit_costs key set rewritten'),

-- 0018: daily_caps gains per_account.tts_chars = 25000. Key + seeded value.
-- False with the key PRESENT = hand-tuned after application — reconcile with
-- the live row, do not treat as unapplied.
('0018', 'structural', (SELECT EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'daily_caps'
    AND value #>> '{per_account,tts_chars}' = '25000')),
  'seeded config: per_account.tts_chars'),

-- 0019: ALTER TYPE usage_provider ADD VALUE 'heygen'.
('0019', 'structural', (SELECT EXISTS (
  SELECT 1 FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'usage_provider' AND e.enumlabel = 'heygen')), 'enum value exists'),

-- 0020: DATA-ONLY MIGRATION — it has no structural footprint at all, so there
-- is nothing a fresh database can assert. NULL, not true: a true here would be
-- an assertion this file cannot make. The proof lives in the 'data' row below.
-- A NULL on this row is therefore the CORRECT result on every database — the
-- expected structural read-out is 27 true, one false (0022) and this one NULL on
-- a FRESH database (this said 24 until 2026-09-13 — it had gone stale at every
-- row added since 0032; the header at the top of this file is the count to
-- trust, and it explains the 0022 false), and a NULL here
-- is not a failed check and needs no investigation. Only the 0020 'data' row
-- (meaningful on the old production database alone) can say whether the
-- backfill actually ran.
('0020', 'structural', NULL::boolean,
  'data-only backfill — no DDL, nothing structural to assert'),

-- 0021 structural half: the two columns prove the ALTERs.
('0021', 'structural', (SELECT (
  SELECT count(*) FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'video_renders'
    AND column_name IN ('regenerated_from', 'refunded_at')) = 2),
  'both columns exist'),

-- 0022: per_account.gpu_seconds is the decisive half — the key did not exist
-- before this migration. The platform gpu_seconds key PRE-EXISTED (36000 by
-- hand on 2026-08-06), so only its value 7200 evidences the second statement.
('0022', 'structural', (SELECT EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'daily_caps'
    AND value #>> '{per_account,gpu_seconds}' = '2000'
    AND value ->> 'gpu_seconds' = '7200')),
  'seeded config: per_account.gpu_seconds + platform gpu_seconds'),

-- 0023: the two tables prove the CREATE TABLEs (their enum-typed status columns
-- imply the CREATE TYPEs succeeded too); demo_segments gone proves the DROP.
('0023', 'structural', (SELECT
  to_regclass('public.demo_analyses') IS NOT NULL
  AND to_regclass('public.demo_step_plans') IS NOT NULL
  AND to_regclass('public.demo_segments') IS NULL),
  'two tables created, demo_segments dropped'),

-- 0024: both SELECT policies exist AND row security is actually enabled on both
-- tables — ENABLE and CREATE POLICY are separate statements, so both halves are
-- asserted against a partial paste.
('0024', 'structural', (SELECT (
  SELECT count(*) FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname IN ('demo_analyses_select_own', 'demo_step_plans_select_own')) = 2
  AND (SELECT count(*) FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname IN ('demo_analyses', 'demo_step_plans')
         AND c.relrowsecurity) = 2),
  'both policies + RLS enabled on both tables'),

-- 0025: demo_step_plans.notes.
('0025', 'structural', (SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'demo_step_plans'
    AND column_name = 'notes')), 'column exists'),

-- 0026: credit_costs gains a_steps_credits = 5. The migration itself sanctions
-- tuning ("tuning it below 5 works"), so false with the key PRESENT = tuned
-- after application, not unapplied.
('0026', 'structural', (SELECT EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'credit_costs'
    AND value ->> 'a_steps_credits' = '5')), 'seeded config: a_steps_credits'),

-- 0027: daily_caps per_account.llm_tokens. Its literal was retro-edited on
-- 2026-08-26 to match the 2026-08-21 hand-raise (500000 -> 1500000). **0036
-- then set it to 500000 for good, so the VALUE can no longer prove 0027 ran** —
-- 0036 overwrites exactly the byte 0027 wrote, and this row asserted that byte
-- until 2026-09-11. What survives is the KEY: 0027 is what put
-- `per_account.llm_tokens` into the row at all (0018 seeded per_account with
-- tts_chars only, 0022 added gpu_seconds). False here means the key is gone,
-- which throws on every budget read in the product. The current VALUE is
-- asserted by the 0036 row below, which is now its only check.
('0027', 'structural', (SELECT EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'daily_caps'
    AND value #>> '{per_account,llm_tokens}' IS NOT NULL)),
  'seeded config: per_account.llm_tokens key present'),

-- 0028 structural half: the stray a_analysis_legibility_threshold key is gone
-- from credit_costs. Necessary but weak alone — also absent if the stray write
-- had never happened, or was hand-removed.
('0028', 'structural', (SELECT EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'credit_costs'
    AND NOT value ? 'a_analysis_legibility_threshold')),
  'seeded config: stray legibility key stripped'),

-- 0029: demo_step_plans gains fail_kind + retry_violations. Two
-- ADD COLUMN IF NOT EXISTS statements, no data movement.
('0029', 'structural', (SELECT (
  SELECT count(*) FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'demo_step_plans'
    AND column_name IN ('fail_kind', 'retry_violations')) = 2), 'both columns exist'),

-- 0030: demo_analyses gains sections + sections_prompt_version. Same shape.
('0030', 'structural', (SELECT (
  SELECT count(*) FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'demo_analyses'
    AND column_name IN ('sections', 'sections_prompt_version')) = 2), 'both columns exist'),

-- 0032: persona_images.source_image_id and its FK, then the opener_clips table,
-- its named CHECK and its partial unique index. All four are separate
-- statements after the first ALTER, so each is asserted against a paste
-- truncated mid-file. `kind` gaining 'selfie' is deliberately NOT asserted:
-- the column is plain text with no CHECK, so that value has no DDL footprint
-- and nothing structural can prove it. to_regclass, never ::regclass — a cast
-- would ERROR rather than read false when the table is absent.
('0032', 'structural', (SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'persona_images'
      AND column_name = 'source_image_id')
  AND EXISTS (SELECT 1 FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND contype = 'f'
      AND conname = 'persona_images_source_image_id_persona_images_id_fk')
  AND to_regclass('public.opener_clips') IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND contype = 'c'
      AND conname = 'opener_clips_reveal_within_duration')
  AND EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'opener_clips'
      AND indexname = 'opener_clips_one_active_per_image_effect')),
  'column + its FK, table, CHECK, partial unique index'),

-- 0033: the SELECT policy exists AND row security is actually enabled on
-- opener_clips — ENABLE and CREATE POLICY are separate statements, so both
-- halves are asserted against a partial paste, exactly as 0024's row does.
('0033', 'structural', (SELECT
  EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'opener_clips'
      AND policyname = 'opener_clips_select_active')
  AND EXISTS (SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'opener_clips' AND c.relrowsecurity)),
  'policy + RLS enabled'),

-- 0035: the feedback table, its created_at index, and row security actually
-- enabled on it. Unlike 0032/0033 this is ONE file, because the ENABLE names no
-- role (decisions/0018 only bites on `TO authenticated`) — so a partial paste
-- that stopped after CREATE TABLE is exactly what the relrowsecurity half
-- catches. The absence of a policy is the intended state and is not asserted:
-- a future policy would be an addition, not a sign 0035 failed.
('0035', 'structural', (SELECT
  to_regclass('public.feedback') IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'feedback'
      AND indexname = 'feedback_created_idx')
  AND EXISTS (SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'feedback' AND c.relrowsecurity)),
  'table + created_at index + RLS enabled'),

-- 0036: daily_caps becomes a runaway detector — every platform cap raised to
-- 16x its per_account pair, and per_account.llm_tokens tightened 1500000 ->
-- 500000 (the outlier vault 0040 named). Asserts ALL SEVEN VALUES rather than
-- the row's existence, because the hazard here is precisely a row that looks
-- changed while the cap has not moved: nothing validates writes to app_config,
-- and dailyCapsSchema is a plain z.object at both levels, so a mistyped key is
-- stripped on read and the cap never moves.
--
-- A false here means the migration did not land, OR prod was hand-edited after
-- it did. Reconcile before repairing. This row cannot see a stripped key at
-- all — for that, run the read-back that goes through the zod schema:
--   apps/cli/node_modules/.bin/tsx packages/core/scripts/verify-daily-caps.ts
('0036', 'structural', (SELECT EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'daily_caps'
    AND value ->> 'images' = '400'
    AND value ->> 'tts_chars' = '400000'
    AND value ->> 'llm_tokens' = '8000000'
    AND value ->> 'gpu_seconds' = '32000'
    AND value #>> '{per_account,tts_chars}' = '25000'
    AND value #>> '{per_account,llm_tokens}' = '500000'
    AND value #>> '{per_account,gpu_seconds}' = '2000')),
  'seeded config: all seven daily_caps values'),

-- 0037: events.notified_at, the "already reported" marker that makes the
-- worker's alert sweep safe to poll, plus the partial index it runs on. BOTH
-- halves are asserted, and the index half is the one worth having: a hand-paste
-- that stopped after the ALTER leaves a working sweep that scans a
-- forever-growing table every 60 seconds, which is slow rather than broken and
-- would therefore never announce itself.
--
-- The predicate is asserted by CONTENT, not by the index's existence: it repeats
-- ALERT_EVENT_KINDS (packages/core/src/alerts.ts) as an immutable literal
-- because a partial index cannot read an array from the application, so the two
-- can drift. A false on the kind checks means the list gained a member and this
-- index was not rebuilt.
--
-- This row cannot see whether the drizzle model AGREES with the column. For
-- that, run the read-back that goes through the code's own schema:
--   apps/cli/node_modules/.bin/tsx packages/core/scripts/verify-events-notified-at.ts
('0037', 'structural', (SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events'
      AND column_name = 'notified_at' AND data_type = 'timestamp with time zone'
      AND is_nullable = 'YES')
  AND EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'events'
      AND indexname = 'events_unnotified_alerts_idx'
      AND indexdef ILIKE '%notified_at IS NULL%'
      AND indexdef LIKE '%platform_budget_tripped%'
      AND indexdef LIKE '%auth_email_send_failed%')),
  'events.notified_at + the partial alert index, predicate included'),

-- 0038: audio_preview_daily_limit 20 -> 50, the free-preview attempt cap.
-- Asserts the ACTUAL VALUE, not the row's existence — 0001 seeds this key, so
-- the row exists in every environment and existence proves nothing about
-- whether 0038 ran. Same hazard as 0036: nothing validates writes to
-- app_config, so a row that looks touched while the number has not moved is the
-- failure this row is here to catch.
--
-- Compared as jsonb (`value = '50'::jsonb`) rather than through `->>` like the
-- object-valued rows above, because this key holds a bare scalar and jsonb
-- equality is TYPE-AWARE: it rejects a hand-pasted '"50"' (a JSON string),
-- which `->>` would render as the text 50 and pass. That matters here —
-- tts.ts:76 parses the row with z.number().int(), so a string would satisfy a
-- looser check and then throw at the next customer preview instead.
--
-- A false here means the migration did not land, OR prod was hand-edited after
-- it did. Reconcile before repairing.
('0038', 'structural', (SELECT EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'audio_preview_daily_limit'
    AND value = '50'::jsonb)),
  'seeded config: audio_preview_daily_limit is the number 50'),

-- ---------------------------------------------------------------------------
-- DATA LAYER — true only against the old production database. On an empty or
-- rebuilt database these read false, or pass vacuously, for reasons unrelated
-- to whether the migration ran. Do not "fix" them by relaxing the predicate.
-- ---------------------------------------------------------------------------

-- 0020 (the real proof): post-0019 code writes provider='heygen' directly, so
-- heygen rows alone prove nothing about the BACKFILL; the decisive half is that
-- zero mislabeled rows remain — fal + gpu_seconds priced at exactly 25 agorot/s
-- (the HeyGen rate; genuine fal spend was 150 or 75/s, so the predicate cannot
-- match a legitimate fal row). The leading EXISTS is a deliberate guard that
-- keeps an empty usage_events table from passing vacuously — which is exactly
-- why this row reads false on a rebuilt database. ::text casts so the file
-- returns false rather than erroring if 0019's enum value is missing.
('0020', 'data', (SELECT
  EXISTS (SELECT 1 FROM usage_events WHERE provider::text = 'heygen')
  AND NOT EXISTS (
    SELECT 1 FROM usage_events
    WHERE provider::text = 'fal' AND kind::text = 'gpu_seconds'
      AND cost_estimate_agorot = quantity * 25)),
  'needs real usage_events rows; false on an empty database BY DESIGN'),

-- 0021 (data half): the fourth and last statement rewrote the one English
-- 'storage upload failed%' error. Asserted because if it ran, the paste
-- completed all four statements. Vacuously true against an empty database, and
-- also if retention ever deletes that 2026-08-08 failed render — the structural
-- row above is what still stands in either case. The refunded_at backfill is
-- not separately checkable: post-0021 code writes refunded_at on its own, so no
-- query distinguishes backfilled rows from code-written ones.
('0021', 'data', (SELECT NOT EXISTS (
  SELECT 1 FROM video_renders
  WHERE status::text = 'failed' AND error LIKE 'storage upload failed%')),
  'VACUOUSLY TRUE on an empty database — proves nothing there'),

-- 0028 (data half, the real proof): the exact two analyses the migration's
-- PREDICTED OUTCOME names flipped rejected -> ready. The third data statement,
-- fail_reason hygiene, changed nothing on prod by design and has no observable
-- effect to check.
('0028', 'data', (SELECT (
  SELECT count(*) FROM demo_analyses
  WHERE (id::text LIKE '4a682b35%' OR id::text LIKE '208695ff%')
    AND status::text = 'ready') = 2),
  'names two specific prod rows; false on any other database')

)
SELECT migration, layer, applied, note
FROM checks
-- Fresh or rebuilt database: add  WHERE layer = 'structural'
ORDER BY migration, layer DESC;

-- ---------------------------------------------------------------------------
-- REPAIR (only ever needed where DDL was applied outside the ledger; do NOT run
-- until every structural row reads true — remove any false migration from the
-- list and investigate it first):
--
--   supabase migration repair --status applied 0008 0009 0010 0011 0012 0013 0014 0015 0016 0017 0018 0019 0020 0021 0022 0023 0024 0025 0026 0027 0028 0029 0030
--
-- That command is the 2026-08-26 backfill of the old ledger, kept as written.
-- 0032/0033, 0035, 0036, 0037 and 0038 are NOT in it (0036 and 0038 were missing
-- from this sentence until 2026-09-13). `db push` records them itself and needs no
-- repair — five times running now; only a hand-paste into the SQL editor does,
-- and then only once the row(s) above for what you pasted read true:
--
--   npx -y supabase migration repair --status applied 0032 0033 --db-url <session pooler url>
--   npx -y supabase migration repair --status applied 0035 --db-url <session pooler url>
--
-- 0031 and 0034 have no row here to gate on, so a hand-paste of either is
-- repaired on the founder's own evidence that it ran, not on this file's.
--
-- ---------------------------------------------------------------------------
-- RESULTS
--
-- 2026-09-13, production (hyaqydcmwbnbaiqqufow), after `db push` applied 0038
-- (audio_preview_daily_limit 20 -> 50), on the founder's explicit instruction for
-- this one push: ledger read-back **39 rows, 0000-0038, NO GAPS, nothing
-- unapplied and NO REPAIR NEEDED** -- `db push` recorded 0038 itself, the FIFTH
-- time in a row the REPAIR note above has predicted correctly. Pre-flight was
-- `migration list` (0000-0037 local == remote, 0038 the only row with an empty
-- remote) and `db push --dry-run`, which named 0038_audio_preview_limit_50.sql
-- alone. Same Docker catalog-cache warning as 0035-0037, and not a failure; the
-- apply printed "Applying migration 0038_audio_preview_limit_50.sql..." and
-- exited 0.
--
-- Post-apply read-back went through the CODE'S OWN PARSE, not this file and not
-- a raw SELECT: getConfigValue(db, 'audio_preview_daily_limit', z.number().int())
-- -- the exact call pipelines/tts.ts:76 makes -- returned **50** and PASSED. That
-- is the check that matters for a bare jsonb scalar, because a row holding the
-- JSON string "50" prints identically to the number 50 in most SQL output and
-- then throws at the next customer preview instead.
--
-- **This file was then run against production in full, and that run is the first
-- one that ever measured its own expected counts: 29 structural rows, 27 true,
-- 1 false, 1 NULL.** The 0038 row read TRUE. The single false is **0022**, and it
-- is not a finding: 0022 asserts platform gpu_seconds = 7200, which 0036 raised
-- to 32000 on 2026-09-11 without anyone revisiting the row. It has therefore been
-- false on every database since that day, and the header's count said "27 true +
-- 1 NULL" for 28 rows -- already one out -- for two days before this run caught
-- it. 0022's predicate is deliberately NOT changed here; 0036's own row asserts
-- all seven caps including that one. Data layer the same minute: 0020 **true**
-- (real heygen rows exist and no mislabeled fal row remains -- the first time
-- that row has passed on this project, it read false on the rebuilt database in
-- 2026-08-26's run), 0021 true, 0028 false exactly as its note predicts on any
-- database that is not the old production one.
--
-- 2026-08-26, OLD production project (mtpmrqltldfwhziyyzdu): all 23 checks read
-- true in the pre-split version of this file (twice — founder run in the SQL
-- editor, then a tsx run), and the repair ran in two phases (0008-0028, then
-- 0029-0030) via `npx supabase migration repair --db-url <session pooler>`.
-- Ledger read-back: 31 rows, 0000-0030; `supabase migration list` showed local
-- and remote in full agreement.
--
-- 2026-08-26, NEW project (hyaqydcmwbnbaiqqufow, eu-central-1), built from
-- empty by `supabase db push`: all 31 migrations applied clean, exit 0, ledger
-- 31 rows 0000-0030 with no gaps, local == remote, NO REPAIR NEEDED. The
-- pre-split file returned 21 true and 2 false — 0020 and 0028 — and that is
-- what prompted this split: both falses were the data halves against empty
-- tables (usage_events 0 rows, demo_analyses 0 rows), while 0028's structural
-- half read true. No migration failed. Every structural assertion passed, which
-- is the result that matters: the sequence replays cleanly from nothing.
--
-- 2026-09-08, production (hyaqydcmwbnbaiqqufow), after `db push` applied 0035
-- (the in-app feedback table): ledger read-back 36 rows, 0000-0035, NO GAPS and
-- NO REPAIR NEEDED -- `db push` recorded 0035 itself, exactly as the REPAIR note
-- below predicts. Structural layer: **25 true, 0 false, 1 NULL**, the NULL being
-- 0020 as always. The 0035 row read true. Direct catalog check on the new table:
-- relrowsecurity = true, 0 policies (the intended server-only shape), 2 indexes
-- (pkey + feedback_created_idx), 2 FKs, 0 rows. Pre-flight before the push was
-- `supabase migration list`: 0000-0034 local == remote, 0035 the only pending
-- file, and `db push --dry-run` named that one file alone.
--
-- The push emitted one warning that is NOT a failure: "failed to cache
-- migrations catalog ... docker". The CLI tries to build a pg-delta catalog in
-- Docker AFTER applying, and there is no Docker on this machine. The apply
-- itself printed "Applying migration 0035_feedback.sql..." and exited 0.
--
-- 2026-09-11, production (hyaqydcmwbnbaiqqufow), after `db push` applied 0037
-- (events.notified_at + the partial alert index), on the founder's explicit
-- instruction for this one push: ledger read-back **38 rows, 0000-0037, NO GAPS
-- and NO REPAIR NEEDED** -- `db push` recorded 0037 itself, the FOURTH time in a
-- row the REPAIR note above has predicted correctly. Pre-flight was
-- `supabase migration list` (0000-0036 local == remote, 0037 the only row with
-- an empty remote) and `db push --dry-run`, which named
-- `0037_events_notified_at.sql` alone. The 0037 structural row above was then
-- run on its own against production and read **true** -- both halves, including
-- the index PREDICATE, not just the index's existence.
--
-- Post-apply read-back went through the drizzle model, not this file:
-- `apps/cli/node_modules/.bin/tsx packages/core/scripts/verify-events-notified-at.ts`
-- returned nine `ok` lines and PASS -- column type `timestamp with time zone`,
-- nullable YES, the predicate naming both alert kinds, and the two queries the
-- worker's sweep actually runs.
--
-- The same Docker catalog-cache warning as 0035 and 0036 appeared and is not a
-- failure ("failed to cache migrations catalog ... docker" -- the CLI tries to
-- build a pg-delta catalog in Docker AFTER applying, and there is no Docker on
-- this machine). The apply printed "Applying migration
-- 0037_events_notified_at.sql..." and exited 0.
--
-- **Two notes on HOW it was applied, both of which correct CLAUDE.md.**
-- First, `npx -y supabase` was NOT used and is no longer the right recipe:
-- `supabase` is a root devDependency (2.109.1), so the pinned local binary at
-- node_modules/.pnpm/@supabase+cli-windows-x64@2.109.1/.../bin/supabase.exe was
-- spawned directly. CLAUDE.md:132 says "no Supabase CLI is installed -- npx
-- fetches it", which is stale. Spawning the .exe rather than the .cmd shim also
-- avoids shell:true on Windows, which would have put the connection string
-- through cmd.exe quoting. Second, the connection string was read out of `.env`
-- inside a throwaway wrapper that SCRUBBED the URL, password, host and user out
-- of every byte the CLI wrote before printing it -- the credential rule's
-- "verify by connecting, report the outcome" applied to a tool that may quote
-- its own DSN in an error.
--
-- **The `events` table is EMPTY -- 0 rows, of every kind, measured the same
-- minute.** `select count(*) from events` returned 0, and so did the two
-- filtered counts (unnotified alert kinds, already-notified). So no event kind
-- has ever fired in this project: not `platform_budget_tripped`, not
-- `qc_release`/`qc_reject` (which state-of-play already recorded as zero), not
-- `content_policy_flag`, not `refund_resolved_to_ancestor`. Two consequences
-- worth keeping. The migration is a pure DDL no-op on data -- there was nothing
-- to backfill and nothing that could have been mis-marked. And the alert sweep
-- will read an empty partial index every 60s until something actually happens,
-- which is the intended steady state rather than evidence it is not running.
-- 2026-09-11, production (hyaqydcmwbnbaiqqufow), after `db push` applied 0036
-- (daily_caps -> runaway detector), on the founder's explicit instruction for
-- this one push: ledger read-back **37 rows, 0000-0036, NO GAPS and NO REPAIR
-- NEEDED** -- `db push` recorded 0036 itself, the third time in a row the REPAIR
-- note below has predicted correctly. Pre-flight was `supabase migration list`
-- (0000-0035 local == remote, 0036 the only row with an empty remote) and
-- `db push --dry-run` (named `0036_daily_caps_runaway_detector.sql` alone).
-- Post-apply read-back went through the zod schema, not this file --
-- `apps/cli/node_modules/.bin/tsx packages/core/scripts/verify-daily-caps.ts`
-- returned all seven values ok and PASS, with no stripped-key warning.
-- The same Docker catalog-cache warning as 0035 appeared and is not a failure;
-- the apply printed "Applying migration 0036_daily_caps_runaway_detector.sql..."
-- and exited 0.
--
-- **0036 was a DATA no-op and that is worth recording.** The seven values were
-- already live when it ran: the read-back above returned PASS *before* the push,
-- measured the same day, while the ledger had no 0036 row -- so the caps had
-- been moved by hand in the SQL editor, exactly the drift 0022's header exists
-- to prevent. The push changed no value; what it changed is that the lineage now
-- records them, so a rebuilt database reproduces the caps instead of coming up
-- on the old ones. This is the reason the rule says migration, not hand UPDATE.

-- 2026-08-26 (later the same day), NEW project, after `db push` applied 0031:
-- ledger 32 rows 0000-0031 with no gaps. This split file, structural layer:
-- 22 true + the expected 0020 NULL. Data rows: 0020 false, 0028 false, 0021
-- vacuously true — all three exactly as their notes predict on a rebuilt
-- database. app_config held 12 rows with poll_deadline_seconds=900,
-- auto_release_b=true, words_per_second.default=2.1, and no tts_stability row.
