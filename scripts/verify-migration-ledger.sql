-- scripts/verify-migration-ledger.sql
--
-- Proves that migrations 0008-0030 actually landed in a given database.
--
-- Originally written for docs/vault/defects/migration-ledger-stops-at-0007.md:
-- production's supabase_migrations.schema_migrations recorded only 0000-0007
-- while 0008-0030 had been applied by hand, and marking an unapplied migration
-- as applied is the one way to turn that annoyance into data loss.
--
-- STRICTLY READ-ONLY: one SELECT over system catalogs and existing rows.
-- Written as a single statement on purpose — the Supabase SQL editor shows only
-- the last statement's result, so 26 separate SELECTs would display one row.
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
-- expect 22 true + 1 NULL. On the old production database, run the whole file
-- and expect all 26 to read true.
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
-- expected structural read-out is 22 true plus this one NULL, and a NULL here
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

-- 0027: daily_caps per_account.llm_tokens = 1500000. The file's literal was
-- retro-edited on 2026-08-26 to match the 2026-08-21 hand-raise (500000 ->
-- 1500000), so file and live value agree. False with the key PRESENT = prod
-- moved again — reconcile before repairing.
('0027', 'structural', (SELECT EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'daily_caps'
    AND value #>> '{per_account,llm_tokens}' = '1500000')),
  'seeded config: per_account.llm_tokens'),

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
-- ---------------------------------------------------------------------------
-- RESULTS
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
-- 2026-08-26 (later the same day), NEW project, after `db push` applied 0031:
-- ledger 32 rows 0000-0031 with no gaps. This split file, structural layer:
-- 22 true + the expected 0020 NULL. Data rows: 0020 false, 0028 false, 0021
-- vacuously true — all three exactly as their notes predict on a rebuilt
-- database. app_config held 12 rows with poll_deadline_seconds=900,
-- auto_release_b=true, words_per_second.default=2.1, and no tts_stability row.
