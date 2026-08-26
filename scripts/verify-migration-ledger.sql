-- scripts/verify-migration-ledger.sql
--
-- Proof pass for docs/vault/defects/migration-ledger-stops-at-0007.md:
-- supabase_migrations.schema_migrations records 0000-0007, but migrations
-- 0008-0028 were applied to production by hand. Before repairing the ledger,
-- each of the 21 unrecorded migrations must be shown to have actually landed —
-- marking an unapplied migration as applied is the one way to turn this
-- annoyance into data loss.
--
-- STRICTLY READ-ONLY: one SELECT over system catalogs and existing rows.
-- Written as a single UNION ALL statement on purpose — the Supabase SQL
-- editor shows only the last statement's result, so 21 separate SELECTs
-- would display one row. Run the whole file; expect 21 rows, applied = true.
--
-- Any FALSE row: STOP. Do not include that migration in the repair command;
-- investigate first (each check's comment says what a false can also mean).
--
-- If the file ERRORS instead of returning rows, the error names a missing
-- table or column — that itself is proof the owning migration did not land.
-- The structural checks (information_schema / to_regclass / pg_* catalogs)
-- cannot error. The app_config checks (0017/0018/0022/0026/0027 and 0028's
-- first half) read a table the ledger-recorded 0000 baseline guarantees.
-- Only 0020, 0021 and 0028's second half dereference tables owned by the
-- unrecorded migrations themselves (usage_events, video_renders,
-- demo_analyses) — all confirmed present by the 2026-08-23 schema read. If
-- an error ever names demo_analyses, remove the 0028 branch and re-run to
-- get the other 20 rows; 0023 and 0028 then both need investigation.

-- 0008: ALTER TABLE personas ADD COLUMN gender.
SELECT '0008' AS migration, EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'personas'
    AND column_name = 'gender'
) AS applied

UNION ALL

-- 0009: persona_images gains kind AND label. Both are asserted so a
-- half-applied paste (one ALTER of the two) shows up as false.
SELECT '0009', (
  SELECT count(*) FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'persona_images'
    AND column_name IN ('kind', 'label')
) = 2

UNION ALL

-- 0010: persona_images.retired.
SELECT '0010', EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'persona_images'
    AND column_name = 'retired'
)

UNION ALL

-- 0011: user_id NOT NULL proves ADD COLUMN + backfill + SET NOT NULL in one
-- bit (SET NOT NULL cannot succeed over an unbackfilled column); business_id
-- nullable proves the DROP NOT NULL, and the FK ran between those two. The
-- CREATE INDEX is the file's LAST statement — nothing brackets it — so it is
-- asserted separately against a truncated paste.
SELECT '0011', (
  SELECT count(*) FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'credit_ledger'
    AND ((column_name = 'user_id' AND is_nullable = 'NO')
      OR (column_name = 'business_id' AND is_nullable = 'YES'))
) = 2
  AND EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'credit_ledger'
      AND indexname = 'credit_ledger_user_idx'
  )

UNION ALL

-- 0012: the 0002 policy of the SAME NAME scoped by owns_business(business_id);
-- 0012 dropped it and recreated it scoped by user_id = auth.uid(). Existence
-- alone proves nothing — the qual text is the discriminator.
SELECT '0012', EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'credit_ledger'
    AND policyname = 'credit_ledger_select_own'
    AND qual LIKE '%user_id%'
)

UNION ALL

-- 0013: the three columns, plus the two hook_clips FKs — the FK DO-blocks
-- are the file's LAST statements, so column existence alone would pass a
-- paste truncated before them.
SELECT '0013', (
  SELECT count(*) FROM information_schema.columns
  WHERE table_schema = 'public'
    AND ((table_name = 'demos' AND column_name = 'description')
      OR (table_name = 'hook_clips' AND column_name IN ('persona_id', 'source_clip_id')))
) = 3
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.hook_clips'::regclass AND contype = 'f'
      AND conname IN ('hook_clips_persona_id_personas_id_fk',
                      'hook_clips_source_clip_id_hook_clips_id_fk')
  ) = 2

UNION ALL

-- 0014: persona_images.catalog_path.
SELECT '0014', EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'persona_images'
    AND column_name = 'catalog_path'
)

UNION ALL

-- 0015: persona_images.blur_data_url.
SELECT '0015', EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'persona_images'
    AND column_name = 'blur_data_url'
)

UNION ALL

-- 0016: the two partial unique indexes that make double-debit/double-refund
-- structurally impossible.
SELECT '0016', (
  SELECT count(*) FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'credit_ledger'
    AND indexname IN ('credit_ledger_debit_render_uniq', 'credit_ledger_refund_failed_uniq')
) = 2

UNION ALL

-- 0017: full rewrite of the credit_costs row. KEYS prove the rewrite; values
-- are deliberately not asserted — the migration's own contract is "changing
-- any of these is an UPDATE here, never a deploy", so a hand-tuned number
-- would not disprove application. NOT ? 'a_render' proves it was a
-- replacement, not a merge over the old {"a_render":1,"b_render":15}
-- placeholder. (Live values still matched the seed on 2026-08-23 —
-- docs/vault/facts/credit-costs-row.md, on feat/service-a-steps.)
SELECT '0017', EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'credit_costs'
    AND value ?& array['a_assembly_flat', 'a_demo_per_second', 'a_outro_per_second',
                       'a_minimum_credits', 'b_per_second', 'b_minimum_credits',
                       'a_ending_reroll_per_second', 'a_remix_assembly_credits']
    AND NOT value ? 'a_render'
)

UNION ALL

-- 0018: daily_caps gains per_account.tts_chars = 25000. Key + seeded value;
-- still 25000 on 2026-08-23. False with the key PRESENT = hand-tuned after
-- application — reconcile with the live row, don't treat as unapplied.
SELECT '0018', EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'daily_caps'
    AND value #>> '{per_account,tts_chars}' = '25000'
)

UNION ALL

-- 0019: ALTER TYPE usage_provider ADD VALUE 'heygen'.
SELECT '0019', EXISTS (
  SELECT 1 FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'usage_provider' AND e.enumlabel = 'heygen'
)

UNION ALL

-- 0020: data-only backfill. Post-0019 code writes provider='heygen' directly,
-- so heygen rows alone prove nothing about the BACKFILL; the decisive half is
-- that zero mislabeled rows remain: fal + gpu_seconds priced at exactly
-- 25 agorot/s (the HeyGen rate — genuine fal spend was 150 or 75/s, so the
-- predicate cannot match a legitimate fal row). The EXISTS guard keeps an
-- empty usage_events table from passing vacuously. ::text casts so the file
-- returns false instead of erroring if 0019's enum value is missing.
SELECT '0020',
  EXISTS (SELECT 1 FROM usage_events WHERE provider::text = 'heygen')
  AND NOT EXISTS (
    SELECT 1 FROM usage_events
    WHERE provider::text = 'fal' AND kind::text = 'gpu_seconds'
      AND cost_estimate_agorot = quantity * 25
  )

UNION ALL

-- 0021: the two columns prove the ALTERs; the fourth (last) statement's
-- rewrite of the one English 'storage upload failed%' error is asserted
-- because if it ran, the paste completed all four statements. (Vacuously
-- true if retention ever deletes that 2026-08-08 failed render; the column
-- check still stands.) The refunded_at backfill is not separately checkable:
-- post-0021 code writes refunded_at on its own, so no query distinguishes
-- backfilled rows from code-written ones.
SELECT '0021',
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'video_renders'
     AND column_name IN ('regenerated_from', 'refunded_at')) = 2
  AND NOT EXISTS (
    SELECT 1 FROM video_renders
    WHERE status::text = 'failed' AND error LIKE 'storage upload failed%'
  )

UNION ALL

-- 0022: per_account.gpu_seconds is the decisive half — the key did not exist
-- before this migration. The platform gpu_seconds key PRE-EXISTED (36000 by
-- hand on 2026-08-06), so only its value 7200 evidences the second statement.
-- False with per_account.gpu_seconds present = hand-tuned after; reconcile,
-- don't assume unapplied.
SELECT '0022', EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'daily_caps'
    AND value #>> '{per_account,gpu_seconds}' = '2000'
    AND value ->> 'gpu_seconds' = '7200'
)

UNION ALL

-- 0023: the two tables prove the CREATE TABLEs (their enum-typed status
-- columns imply the CREATE TYPEs succeeded too); demo_segments gone proves
-- the DROP. The FKs/indexes ran between those statements.
SELECT '0023',
  to_regclass('public.demo_analyses') IS NOT NULL
  AND to_regclass('public.demo_step_plans') IS NOT NULL
  AND to_regclass('public.demo_segments') IS NULL

UNION ALL

-- 0024: both SELECT policies exist AND row security is actually enabled on
-- both tables — the ENABLE and the CREATE POLICY are separate statements, so
-- both halves are asserted against a partial paste.
SELECT '0024',
  (SELECT count(*) FROM pg_policies
   WHERE schemaname = 'public'
     AND policyname IN ('demo_analyses_select_own', 'demo_step_plans_select_own')) = 2
  AND (SELECT count(*) FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname IN ('demo_analyses', 'demo_step_plans')
         AND c.relrowsecurity) = 2

UNION ALL

-- 0025: demo_step_plans.notes.
SELECT '0025', EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'demo_step_plans'
    AND column_name = 'notes'
)

UNION ALL

-- 0026: credit_costs gains a_steps_credits = 5. Key + seeded value; the
-- migration itself sanctions tuning ("tuning it below 5 works"), so false
-- with the key PRESENT = tuned after application, not unapplied.
SELECT '0026', EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'credit_costs'
    AND value ->> 'a_steps_credits' = '5'
)

UNION ALL

-- 0027: daily_caps per_account.llm_tokens = 1500000. The file's literal was
-- retro-edited on 2026-08-26 to match the 2026-08-21 hand-raise (500000 ->
-- 1500000), so live value and file agree today. False with the key PRESENT =
-- prod moved again — reconcile before repairing.
SELECT '0027', EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'daily_caps'
    AND value #>> '{per_account,llm_tokens}' = '1500000'
)

UNION ALL

-- 0028: three data statements, two checkable. (1) the strip: the stray
-- a_analysis_legibility_threshold key is gone from credit_costs — necessary
-- but weak alone (also absent if the stray write had never happened, or was
-- hand-removed). (2) the real proof: the exact two analyses the migration's
-- PREDICTED OUTCOME names flipped rejected -> ready. (3) fail_reason hygiene
-- changed nothing on prod by design, so it has no observable effect to check.
SELECT '0028',
  EXISTS (SELECT 1 FROM app_config
          WHERE key = 'credit_costs'
            AND NOT value ? 'a_analysis_legibility_threshold')
  AND (SELECT count(*) FROM demo_analyses
       WHERE (id::text LIKE '4a682b35%' OR id::text LIKE '208695ff%')
         AND status::text = 'ready') = 2

ORDER BY migration;

-- ---------------------------------------------------------------------------
-- REPAIR (do NOT run until every row above reads true — remove any false
-- migration from the list and investigate it first):
--
--   supabase migration repair --status applied 0008 0009 0010 0011 0012 0013 0014 0015 0016 0017 0018 0019 0020 0021 0022 0023 0024 0025 0026 0027 0028
--
-- Scope note: 0029 and 0030 exist on feat/service-a-steps and are NOT covered
-- here — this file proves exactly the 0008-0028 range the defect records.
-- 0029 is known applied (2026-08-25); the same proof exercise is owed for
-- both before extending the repair to them.
