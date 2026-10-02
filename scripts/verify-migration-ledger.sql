-- scripts/verify-migration-ledger.sql
--
-- Proves that migrations 0008-0030, 0032-0033, 0035-0039 and 0041-0050 actually landed in
-- a given database. (0031 and 0034 have never had a row here.)
--
-- Originally written for docs/vault/defects/migration-ledger-stops-at-0007.md:
-- production's supabase_migrations.schema_migrations recorded only 0000-0007
-- while 0008-0030 had been applied by hand, and marking an unapplied migration
-- as applied is the one way to turn that annoyance into data loss.
--
-- STRICTLY READ-ONLY: one SELECT over system catalogs and existing rows.
-- Written as a single statement on purpose — the Supabase SQL editor shows only
-- the last statement's result, so 30 separate SELECTs would display one row.
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
-- expect, of 41 rows: **39 true, 1 false (0022), 1 NULL (0020)**. (0043 added
-- two rows on 2026-09-17 — '0043' and '0043-plans' — taking it from 32 to 34,
-- which this sentence had missed; 0044-0047 then added one each, to 38,
-- 0048 one more on 2026-09-21, to 39, 0049 one on 2026-10-01, to 40, and 0050
-- one on 2026-10-02, to 41.) Two of those
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
--     (This paragraph is why the count above is one short of the row count —
--     it said "27 true + 1 NULL" of 29 from 2026-09-11 to 2026-09-13, which was
--     already one out for the same reason. 0039 moved both halves: 30 rows, and
--     28 of them true; 0041 and 0042 moved both again, to 32 and 30.)
--
-- Row history: 0036 added one row on 2026-09-11, 0037 another the same day,
-- 0038 one more on 2026-09-13 and 0039 the same day. 0040 (2026-09-16) added
-- NO row: it reverted 0038, so it folded into that row instead, which is now
-- labelled '0038+0040' and asserts 20. The row COUNT is therefore unchanged at
-- 30 by 0040, 0043 took it to 34 with two ('0043', '0043-plans'), 0044-0047 to
-- 38 with one each, 0048 to 39, 0049 to 40, 0050 to **41**, and 0041/0042 before them took it to 32 with one row each — they are
-- kept separate, not paired like '0038+0040', because they assert different
-- objects and either can fail without the other: 0041 owns the column, indexes
-- and FK, 0042 owns the RLS policy. Both were applied to production 2026-09-16
-- and both read true — see RESULTS. 0022 is still the only expected false. 0037 and 0038 were both
-- applied to production on the day their row was written and both read true —
-- see RESULTS. **0039 was applied to production 2026-09-13 too, and its row read
-- true** — see RESULTS. It also changed a row that was already here: 0026 no
-- longer asserts a VALUE, because 0039 owns a_steps_credits now; that is where
-- the 28th true comes from, not from a new row alone.
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

-- 0026: credit_costs gains a_steps_credits. **The VALUE can no longer prove
-- 0026 ran** — 0039 set it to 3 on 2026-09-13, overwriting exactly the byte
-- 0026 wrote, and this row asserted that byte (= '5') until then. Same shape as
-- 0027 below, and fixed the same way rather than left to rot like 0022: what
-- survives is the KEY. 0026 is what put `a_steps_credits` into the row at all
-- (0017 rewrote the row without it), so false here means the key is gone — a
-- state in which every quote path throws, since creditCostsSchema requires it.
-- 0039's row asserts both live values.
--
-- **TRUE here no longer proves 0026 RAN.** 0039 is unconditional and writes
-- `a_steps_credits` itself, so on any database 0039 has touched this row is true
-- whether or not 0026 was ever applied — it is implied by the 0039 row rather
-- than independent of it. That is accepted, not overlooked: once a later
-- migration overwrites the only byte 0026 wrote, no predicate over the data can
-- distinguish the two, and 0026's entire content is a `NOT (value ? ...)`-guarded
-- no-op on such a database anyway, so marking it applied costs nothing. Same
-- shape as 0027 below. Do NOT read this row as evidence when repairing a ledger
-- whose 0026 history is genuinely in doubt.
('0026', 'structural', (SELECT EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'credit_costs'
    AND value ? 'a_steps_credits')), 'seeded config: a_steps_credits key present'),

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

-- 0038 + 0040: audio_preview_daily_limit, the free-preview attempt cap.
-- 0038 took it 20 -> 50 on 2026-09-13; 0040 took it 50 -> 20 on 2026-09-16.
-- ONE row for the pair, asserting the END of the chain, because that is the
-- only thing both migrations together leave behind and it is what a rebuilt
-- database must reproduce. Splitting them would mean a permanently-false 0038
-- row, and this file has exactly one of those (0022) on purpose -- the rule
-- "a false on 0022 ALONE is expected, every other false is real" is what makes
-- the file usable, and it is not worth spending twice.
--
-- Asserts the ACTUAL VALUE, not the row's existence -- 0001 seeds this key, so
-- the row exists in every environment and existence proves nothing about
-- whether either migration ran. Same hazard as 0036: nothing validates writes
-- to app_config, so a row that looks touched while the number has not moved is
-- the failure this row is here to catch.
--
-- Compared as jsonb (`value = '20'::jsonb`) rather than through `->>` like the
-- object-valued rows above, because this key holds a bare scalar and jsonb
-- equality is TYPE-AWARE: it rejects a hand-pasted '"20"' (a JSON string),
-- which `->>` would render as the text 20 and pass. That matters here --
-- tts.ts:76 parses the row with z.number().int(), so a string would satisfy a
-- looser check and then throw at the next customer preview instead.
--
-- NOTE the one thing this row CANNOT tell you: 0001 also seeds 20, so on a
-- database where 0038 and 0040 both ran and on one where NEITHER ran, this
-- reads true either way. `migration list` is what distinguishes them, and the
-- 0040 RESULTS entry below records the before-read (50) that proves 0040's
-- guard actually matched rather than no-opping.
--
-- A false here means 0040 did not land, OR prod was hand-edited after it did.
-- Reconcile before repairing.
('0038+0040', 'structural', (SELECT EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'audio_preview_daily_limit'
    AND value = '20'::jsonb)),
  'seeded config: audio_preview_daily_limit is the number 20'),

-- 0039: the steps flat splits — a_steps_credits 5 -> 3 and a NEW key
-- a_demo_analysis_credits = 2, the demo analysis charged once per demo.
-- Asserts BOTH values, because either half alone is a live failure and they
-- are not the same failure: a missing a_demo_analysis_credits makes
-- creditCostsSchema throw on EVERY quote path (steps, full, silent and Service
-- B stop together), while a_steps_credits still at 5 prices every render of an
-- already-paid demo at the old flat and makes the first one cost 7.
--
-- Compared through `->` as jsonb rather than `->>` as text, so a hand-pasted
-- '"3"' (a JSON string) is rejected here instead of passing and then throwing
-- at the next customer quote — z.number() does not accept it. Same reasoning as
-- the '0038+0040' row's `value = '20'::jsonb`.
--
-- 0039 is UNCONDITIONAL, so a false here means it did not land, or prod was
-- hand-edited after it did. Reconcile before repairing. Note 0026's row above
-- no longer asserts a value at all: 0039 is what owns a_steps_credits now.
-- 0039 split the steps flat into 3 + 2; 0043 (2026-09-17) then re-based the
-- whole row on the 0.15 ILS credit and took those two to 25 and 20. Asserting
-- 0039's literals would now read FALSE on a correct database, so the pair is
-- folded into one row at the CURRENT values, exactly as 0038's row was folded
-- into '0038+0040'. What 0039 is still on the hook for is that the KEY exists
-- at all -- that is the '0026' row above.
('0039+0043', 'structural', (SELECT EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'credit_costs'
    AND value -> 'a_steps_credits' = '25'::jsonb
    AND value -> 'a_demo_analysis_credits' = '20'::jsonb)),
  'seeded config: a_steps_credits 25 AND a_demo_analysis_credits 20 (0043 scale)'),

-- 0043: the other two halves of the same migration. b_minimum_credits is the
-- one key that is not a re-denomination -- it was 0 (inactive) from 0017 until
-- 0043 made it a real 15-second floor -- and the plans row is statement (b),
-- which is guarded SEPARATELY, so the file can half-apply. Both are asserted
-- so that a half-apply cannot read as success.
('0043', 'structural', (SELECT EXISTS (
  SELECT 1 FROM app_config
  WHERE key = 'credit_costs'
    AND value -> 'b_per_second' = '5'::jsonb
    AND value -> 'b_minimum_credits' = '75'::jsonb)),
  'seeded config: b_per_second 5 AND b_minimum_credits 75 (the new Service B floor)'),

('0043-plans', 'structural', (SELECT NOT EXISTS (
  SELECT 1 FROM plans
  WHERE (code, price_agorot, monthly_credits, allows_service_b) NOT IN (
    ('starter', 15000, 1000, true),
    ('pro',     30000, 2500, true),
    ('studio',  50000, 5000, true)))),
  'plans: 150/300/500 ILS at 1000/2500/5000 credits, Service B on all three'),

-- 0041: subscriptions re-keyed from the business to the ACCOUNT. Asserts all
-- four halves, because each is a different failure: user_id present but
-- NULLABLE would let a subscription exist with no owner; business_id surviving
-- would mean the DROP silently did not run (0041 ends with it, so a partial
-- apply stops exactly there); the old partial unique index surviving would keep
-- enforcing one-live-per-BUSINESS, which is the rule this migration exists to
-- retire; and the FK must now point at users, not businesses.
--
-- The predicate is pinned by NAME on both indexes, not just by presence, and
-- the unique one is checked for its live-status WHERE clause — an index on
-- user_id with no predicate would read true on a bare existence check and then
-- refuse a customer's second subscription after they cancelled the first.
--
-- NOTE what this row cannot see: production held **zero** subscriptions rows
-- when 0041 ran (measured pre-flight, see RESULTS), so nothing proves the
-- BACKFILL moved a row. That half is pinned in PGlite instead, by
-- packages/core/test/migrations.test.ts ("0041: backfills user_id from each
-- subscription's business owner, then drops business_id"), which seeds
-- business-keyed rows first.
('0041', 'structural', (SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
      AND column_name = 'user_id' AND is_nullable = 'NO')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
      AND column_name = 'business_id')
  AND EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'subscriptions'
      AND indexname = 'subscriptions_one_live_per_user'
      AND indexdef LIKE '%active%' AND indexdef LIKE '%past_due%'
      AND indexdef LIKE '%suspended%')
  AND EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'subscriptions'
      AND indexname = 'subscriptions_user_idx')
  AND NOT EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'subscriptions'
      AND indexname IN ('subscriptions_one_live_per_business',
                        'subscriptions_business_idx'))
  AND EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscriptions'::regclass
      AND conname = 'subscriptions_user_id_users_id_fk')),
  'subscriptions keyed on user_id: column, both indexes, FK, business_id gone'),

-- 0042: the RLS policy 0041 had to drop to drop the column. Separate row from
-- 0041 on purpose — 0041 leaves the table RLS-ENABLED WITH NO POLICY, which is
-- default-deny and therefore silent: a customer sees an empty list, not an
-- error. Nothing reads subscriptions through an RLS-bound client today, so a
-- missed 0042 would cost nothing YET and would be discovered by the first
-- billing screen ever built. This row is what finds it before then.
--
-- Checked for the SHAPE of the qualifier, not just the policy's existence: a
-- policy still going through owns_business() cannot exist (the column is gone)
-- but one scoped to the wrong column could.
('0042', 'structural', (SELECT EXISTS (
  SELECT 1 FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'subscriptions'
    AND policyname = 'subscriptions_select_own'
    AND cmd = 'SELECT'
    AND qual LIKE '%user_id%' AND qual NOT LIKE '%owns_business%')
  AND (SELECT relrowsecurity FROM pg_class
       WHERE oid = 'public.subscriptions'::regclass)),
  'policy re-scoped to user_id = auth.uid(), RLS still enabled'),

-- 0044: the Hebrew plan names and the gateway default. The name UPDATEs are
-- GUARDED on the Latin names, so as with 0040 a miss exits 0 and still records
-- the version -- this row is how a silent no-op is found. NOT IN over every
-- plans row, like '0043-plans', so a fourth plan would need a row edit here.
('0044', 'structural', (SELECT NOT EXISTS (
  SELECT 1 FROM plans
  WHERE (code, name) NOT IN (
    ('starter', 'התחלה'),
    ('pro',     'מתקדם'),
    ('studio',  'פרימיום')))
  AND EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
      AND column_name = 'gateway' AND column_default = '''sumit''::text')),
  'plans named in Hebrew; subscriptions.gateway defaults to sumit'),

-- 0045: the scheduled-downgrade column, nullable, with its FK to plans. Both
-- halves: the column alone would let a schedule name a plan that does not
-- exist, which the renewal would then skip forever.
('0045', 'structural', (SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions'
      AND column_name = 'scheduled_plan_code' AND is_nullable = 'YES')
  AND EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscriptions'::regclass
      AND conname = 'subscriptions_scheduled_plan_code_plans_code_fk')),
  'subscriptions.scheduled_plan_code, nullable, FK to plans'),

-- 0046: terms_acceptances -- table, its seven columns, the user index, the FK
-- and RLS enabled with no policy (0035's pattern). to_regclass so a missing
-- table reads false instead of erroring the whole file.
('0046', 'structural', (SELECT
  to_regclass('public.terms_acceptances') IS NOT NULL
  AND (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'terms_acceptances') = 7
  AND EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'terms_acceptances'
      AND indexname = 'terms_acceptances_user_idx')
  AND EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = to_regclass('public.terms_acceptances')
      AND conname = 'terms_acceptances_user_id_users_id_fk')
  AND COALESCE((SELECT relrowsecurity FROM pg_class
       WHERE oid = to_regclass('public.terms_acceptances')), false)
  AND NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'terms_acceptances')),
  'terms_acceptances: 7 columns, user index, FK, RLS on with no policy'),

-- 0047: feedback can hold an anonymous /contact row -- user_id nullable and
-- the three contact columns present. All four, because a nullable user_id
-- without contact_email is a message nobody can answer.
('0047', 'structural', (SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'feedback'
       AND ((column_name = 'user_id' AND is_nullable = 'YES')
            OR column_name IN ('contact_name', 'contact_email', 'ip'))) = 4),
  'feedback.user_id nullable; contact_name, contact_email, ip present'),

-- 0048: checkout_intents (decision 0062) -- table, its ten columns, the
-- (user_id, status) index, the five named constraints (payment-id UNIQUE, the
-- status CHECK, three FKs) and RLS enabled with no policy (0046's pattern).
-- to_regclass so a missing table reads false instead of erroring the file.
('0048', 'structural', (SELECT
  to_regclass('public.checkout_intents') IS NOT NULL
  AND (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'checkout_intents') = 10
  AND EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'checkout_intents'
      AND indexname = 'checkout_intents_user_status_idx')
  AND (SELECT count(*) FROM pg_constraint
    WHERE conrelid = to_regclass('public.checkout_intents')
      AND conname IN ('checkout_intents_sumit_payment_id_unique',
                      'checkout_intents_status_check',
                      'checkout_intents_user_id_users_id_fk',
                      'checkout_intents_plan_code_plans_code_fk',
                      'checkout_intents_terms_acceptance_id_terms_acceptances_id_fk')) = 5
  AND COALESCE((SELECT relrowsecurity FROM pg_class
       WHERE oid = to_regclass('public.checkout_intents')), false)
  AND NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'checkout_intents')),
  'checkout_intents: 10 columns, (user_id,status) index, unique payment id + CHECK + 3 FKs, RLS on with no policy'),

-- 0049: hook_clips.text_color (decision 0073) -- the column (text, NOT NULL,
-- default 'white') AND its named white|black CHECK; a column that landed
-- without the constraint would accept any string the code never wrote.
('0049', 'structural', (SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'hook_clips'
      AND column_name = 'text_color' AND data_type = 'text'
      AND is_nullable = 'NO' AND column_default = '''white''::text')
  AND EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = to_regclass('public.hook_clips') AND contype = 'c'
      AND conname = 'hook_clips_text_color_check'
      AND pg_get_constraintdef(oid) LIKE '%white%'
      AND pg_get_constraintdef(oid) LIKE '%black%')),
  'hook_clips.text_color: text NOT NULL default white + the white|black CHECK'),

-- 0050: demo_analysis_footage (decisions 0077, 0078, 0080, 0083) -- the table,
-- its eight columns, the primary key that is also the FK to demo_analyses, and
-- RLS enabled with no policy (0048's pattern). to_regclass so a missing table
-- reads false instead of erroring the file. Written 2026-10-02 BEFORE the
-- migration was pushed: until the founder pushes 0050 this row reads false on
-- production, and that false means "not pushed yet", nothing else.
('0050', 'structural', (SELECT
  to_regclass('public.demo_analysis_footage') IS NOT NULL
  AND (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'demo_analysis_footage') = 8
  AND (SELECT count(*) FROM pg_constraint
    WHERE conrelid = to_regclass('public.demo_analysis_footage')
      AND conname IN ('demo_analysis_footage_pkey',
                      'demo_analysis_footage_analysis_id_demo_analyses_id_fk')) = 2
  AND COALESCE((SELECT relrowsecurity FROM pg_class
       WHERE oid = to_regclass('public.demo_analysis_footage')), false)
  AND NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'demo_analysis_footage')),
  'demo_analysis_footage: 8 columns, PK = FK to demo_analyses, RLS on with no policy'),

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
-- 0032/0033, 0035, 0036, 0037, 0038 and 0039 are NOT in it (0036 and 0038 were
-- missing from this sentence until 2026-09-13, and 0039 was added the same day
-- it was pushed). `db push` records them itself and needs no
-- repair — SIX times running now; only a hand-paste into the SQL editor does,
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
-- 2026-10-01, production (hyaqydcmwbnbaiqqufow), after `db push` applied
-- **0049** (hook_clips.text_color, decision 0073) alone, on the founder's
-- explicit instruction for this one push ("apply 0049, then publish the
-- branch"): ledger read-back **50 rows, 0000-0049, NO GAPS, nothing unapplied
-- and NO REPAIR NEEDED** -- `db push` recorded it itself, the TWELFTH time in a
-- row. Pre-flight was `migration list` (0000-0048 local == remote, 0049 the
-- only row with an empty remote) and `db push --dry-run`, which named
-- 0049_hook_clips_text_color.sql alone. Same Docker catalog-cache warning as
-- 0035-0048, not a failure; the apply printed "Applying migration
-- 0049_hook_clips_text_color.sql..." and exited 0.
--
-- Read at BOTH ends through the code's own connection, inside a read-only
-- transaction (packages/core/.work/readback-0049.ts -- the migration's own
-- VERIFY block). BEFORE: no text_color column, no constraint, the group-by
-- errored "column text_color does not exist", 30 hook_clips rows, ledger 49
-- rows 0000-0048. AFTER: text_color | text | NO | 'white'::text;
-- hook_clips_text_color_check = CHECK ((text_color = ANY (ARRAY['white'::text,
-- 'black'::text]))); 30 rows, all 30 'white'; ledger 50 rows latest 0049. Pure
-- additive DDL: the constant default filled every existing row, nothing deleted.
--
-- Applied through packages/core/.work/supabase-cli-scrubbed.mjs: the pinned
-- local binary spawned directly, DATABASE_URL read out of `.env` by the
-- wrapper, :6543/ swapped for :5432/, the URL scrubbed from every byte of
-- output. Never typed, never printed.
--
-- THIS FILE was then run against production (packages/core/.work/
-- run-ledger-sql.mjs, read-only) and returned **43 rows: 40 structural, 38 true
-- / 1 false / 1 NULL**, with 0022 the only false and 0020 the NULL -- exactly
-- the header's expectation -- and the new '0049' row true. The 3 data rows read
-- 2 true / 1 false, as before.
--
-- 2026-09-21, production (hyaqydcmwbnbaiqqufow), after `db push` applied
-- **0048** (checkout_intents, decision 0062) alone, on the founder's written
-- instruction in the Sumit-adapter brief ("apply to production only at the
-- end, with the read-back pattern") -- for this one push: ledger read-back
-- **49 rows, 0000-0048, NO GAPS, nothing unapplied and NO REPAIR NEEDED** --
-- `db push` recorded it itself, the ELEVENTH time in a row. Pre-flight was
-- `migration list` (0000-0047 local == remote, 0048 the only row with an empty
-- remote) and `db push --dry-run`, which named 0048_checkout_intents.sql
-- alone. Same Docker catalog-cache warning as 0035-0047, not a failure; the
-- apply printed "Applying migration 0048_checkout_intents.sql..." and exited 0.
--
-- Read at BOTH ends through the code's own connection
-- (packages/core/.work/readback-0048.ts, read-only -- the migration's own
-- VERIFY block). BEFORE: to_regclass('public.checkout_intents') absent (the
-- first query errored "relation does not exist"), 0 columns, ledger 48 rows
-- 0000-0047. AFTER: relrowsecurity true, 10 columns, indexes
-- [checkout_intents_pkey, checkout_intents_sumit_payment_id_unique,
-- checkout_intents_user_status_idx], the six constraints (pkey, unique, check,
-- three FKs), 0 policies, 0 rows, ledger 49 rows latest 0048. Pure DDL, nothing
-- backfilled, nothing deleted.
--
-- Applied by a session through the same throwaway wrapper shape as 0044-0047
-- (packages/core/.work/push-0048.mjs): the pinned local binary spawned
-- directly, DATABASE_URL read out of `.env` by the wrapper, :6543/ swapped for
-- :5432/, the URL scrubbed from every byte of output. Never typed, never
-- printed.
--
-- THIS FILE was then run against production through psql 17 (the same
-- wrapper shape, packages/core/.work/run-ledger-sql.mjs, read-only) and
-- returned **42 rows: 39 structural, 37 true / 1 false / 1 NULL**, with 0022
-- the only false and 0020 the NULL -- exactly the header's expectation -- and
-- the new '0048' row true. The 3 data rows read 0020 t, 0021 t, 0028 f, as
-- before.
--
-- 2026-09-17 (second push that day), production (hyaqydcmwbnbaiqqufow), after
-- `db push` applied **0044, 0045, 0046 and 0047 together** (Hebrew plan names +
-- gateway default 'sumit'; subscriptions.scheduled_plan_code; terms_acceptances;
-- feedback.user_id nullable + contact columns), on the founder's explicit
-- instruction for this one push: ledger read-back **48 rows, 0000-0047, NO
-- GAPS, nothing unapplied and NO REPAIR NEEDED** -- `db push` recorded all four
-- itself, the TENTH time in a row the REPAIR note above has predicted
-- correctly. Pre-flight was `migration list` (0000-0043 local == remote,
-- 0044-0047 the only rows with an empty remote) and `db push --dry-run`, which
-- named exactly those four files in that order. Same Docker catalog-cache
-- warning as 0035-0043, and not a failure; the apply printed "Applying
-- migration 0044_plans_hebrew_names_sumit.sql..." through "...0047..." and
-- exited 0.
--
-- 0044's three UPDATEs are GUARDED on the Latin names, so it was read at BOTH
-- ends (packages/core/.work/readback-0044-0047.ts, read-only, the 0040 rule).
-- BEFORE: plans.name = 'Pro' / 'Starter' / 'Studio' with all three guards
-- matching, subscriptions.gateway default 'grow'::text, scheduled_plan_code
-- absent, terms_acceptances absent, feedback.user_id NOT NULL with 1 row (1
-- with a user), subscriptions 0 rows, ledger 44 rows 0000-0043. The push was
-- scripted to refuse unless every one of those read "not applied" -- and its
-- first run DID refuse, on a miscount in the guard script itself (the read-back
-- prints "not applied" eight times, not five), which is the check working.
-- AFTER: 'מתקדם' / 'התחלה' / 'פרימיום', default 'sumit'::text,
-- scheduled_plan_code present nullable text with its FK, terms_acceptances
-- present with 7 columns / RLS on / 0 policies / [pkey, user_idx] / the users
-- FK / 0 rows, feedback.user_id + contact_name + contact_email + ip all
-- nullable with the same 1 row, subscriptions still 0 rows. Nothing was
-- deleted; 0047 relaxes a NOT NULL and adds three columns.
--
-- Applied by a session, not by hand; the pinned local binary was spawned
-- directly through a throwaway wrapper that read DATABASE_URL out of `.env`
-- itself, swapped :6543/ for :5432/, and scrubbed the URL, password, user and
-- host out of every byte the CLI wrote. Never typed on a command line, never
-- printed.
--
-- THIS FILE was then run against production through psql 17 and returned
-- **41 rows: 38 structural, 36 true / 1 false / 1 NULL**, with 0022 the only
-- false and 0020 the NULL -- exactly the header's (corrected) expectation --
-- and all four new rows ('0044' through '0047') true. The 3 data rows read
-- 0020 t, 0021 t, 0028 f, as expected against this database.
--
-- STILL OPEN at the time of writing: the worker box is on origin/main, which
-- predates 0045. Its daily `billing_renewals` job selects `subscriptions`
-- through drizzle by column name, and origin/main's schema does not name
-- scheduled_plan_code, so the OLD code keeps working on the NEW database
-- (additive column). The branch's code is the other way round -- it names the
-- column and needs 0045 -- which is why the migrations went first. After the
-- merge the box needs `cd ~/AIUGCBackend && git pull && pnpm install && sudo
-- systemctl restart aiugc-worker` for the renewal change to ship.
--
-- ---------------------------------------------------------------------------
--
-- 2026-09-16 (second push that day), production (hyaqydcmwbnbaiqqufow), after
-- `db push` applied **0041 and 0042 together** (subscriptions re-keyed from
-- business_id to user_id, and its RLS policy re-scoped to auth.uid()), on the
-- founder's explicit instruction for this one push: ledger read-back **43 rows,
-- 0000-0042, NO GAPS, nothing unapplied and NO REPAIR NEEDED** -- `db push`
-- recorded both itself, the EIGHTH time in a row the REPAIR note above has
-- predicted correctly. Pre-flight was `migration list` (0000-0040 local ==
-- remote, 0041 and 0042 the only rows with an empty remote) and
-- `db push --dry-run`, which named exactly those two files in that order. Same
-- Docker catalog-cache warning as 0035-0040, and not a failure; the apply
-- printed "Applying migration 0041..." then "...0042..." and exited 0.
--
-- **This one needed a BEFORE-read for a different reason than 0040's.** 0040's
-- was a guard that could silently match nothing; 0041's is an irreversible
-- DROP COLUMN, so what mattered was knowing what was in the column first.
-- Pre-flight measured, read-only: `select count(*) from subscriptions` = **0**
-- -- the first count of that table ever taken on THIS project (the only earlier
-- one, docs/vault/facts/demo-corpus.md, is 2026-08-23 against the database
-- deleted at the 2026-08-27 env flip and says nothing about this one). So the
-- DROP destroyed no data and the backfill moved no row; the backfill is proven
-- in PGlite instead, see the 0041 row's NOTE above. The before-read also
-- confirmed the shape 0041 assumes: business_id NOT NULL, the two old indexes
-- present, FK to businesses, and the 0002 policy still reading
-- `owns_business(business_id)` -- which is WHY 0041 has to drop that policy:
-- Postgres refuses to drop a column a policy depends on, so without it the
-- apply would have failed at the last statement.
--
-- Applied by a session, not by hand, and the pinned local binary was spawned
-- directly (node_modules/.pnpm/@supabase+cli-windows-x64@2.109.1/.../supabase.exe,
-- the .exe and not the .cmd shim) through a throwaway wrapper that read
-- DATABASE_URL out of `.env` itself and swapped :6543/ for :5432/. The
-- connection string was never typed on a command line and never printed.
--
-- Post-apply read-back, read-only, 11 checks, ALL PASS: business_id gone,
-- user_id present and NOT NULL, the other 10 columns intact,
-- pg_indexes on subscriptions exactly
-- [subscriptions_one_live_per_user, subscriptions_pkey, subscriptions_user_idx]
-- with the live-status predicate on the unique one, FK now
-- subscriptions_user_id_users_id_fk and the businesses FK gone, one policy
-- whose qual is `(user_id = ( SELECT auth.uid() AS uid))` with RLS still
-- enabled, ledger 43 rows 0000-0042 with no gaps, and subscriptions still 0
-- rows. credit_ledger was confirmed untouched: 2 grant_manual (0 with a
-- business) and 2 debit_render (2 with a business), unchanged.
--
-- THIS FILE was then run against production and returned **32 structural rows,
-- 30 true / 1 false / 1 NULL**, with 0022 the only false and 0020 the NULL --
-- exactly the header's expectation, and both new rows ('0041', '0042') true.
--
-- STILL OPEN at the time of writing: the worker box was on the pre-0041 commit
-- when this landed. Its daily `billing_renewals` job selects subscriptions
-- through drizzle and will name business_id until the box is redeployed, so
-- that one job fails until `cd ~/AIUGCBackend && git pull && pnpm install &&
-- sudo systemctl restart aiugc-worker` runs. Blast radius is that job alone:
-- zero subscriptions rows, so it does nothing even when it succeeds, and no
-- other code path in the tree reads the table.
--
-- ---------------------------------------------------------------------------
--
-- 2026-09-13 (later the same day), production (hyaqydcmwbnbaiqqufow), after
-- `db push` applied 0039 (credit_costs: a_steps_credits 5 -> 3, new
-- a_demo_analysis_credits 2), on the founder's explicit instruction for this one
-- push: ledger read-back **40 rows, 0000-0039, NO GAPS, nothing unapplied and NO
-- REPAIR NEEDED** -- `db push` recorded 0039 itself, the SIXTH time in a row the
-- REPAIR note above has predicted correctly. Pre-flight was `migration list`
-- (0000-0038 local == remote, 0039 the only row with an empty remote) and
-- `db push --dry-run`, which named 0039_demo_analysis_credits.sql alone. Same
-- Docker catalog-cache warning as 0035-0038, and not a failure; the apply printed
-- "Applying migration 0039_demo_analysis_credits.sql..." and exited 0.
--
-- Applied by a session, not by hand, and the pinned local binary was spawned
-- directly (node_modules/.pnpm/@supabase+cli-windows-x64@2.109.1/.../supabase.exe)
-- through a throwaway wrapper that read DATABASE_URL out of `.env` itself, swapped
-- :6543/ for :5432/, and SCRUBBED the URL, password, host and user out of every
-- byte the CLI wrote before printing it -- the credential rule applied to a tool
-- that quotes its own DSN in errors.
--
-- Post-apply read-back went through the CODE'S OWN PARSE
-- (packages/core/scripts/verify-credit-costs.ts, read-only, 16 checks, PASS):
-- getConfigValue(db, 'credit_costs', creditCostsSchema) -- the exact call every
-- quote path makes -- returned a_steps_credits 3 and a_demo_analysis_credits 2,
-- `jsonb_typeof` said **number** for both (so no hand-pasted '"3"' that would
-- satisfy `->>` and then throw at the next customer quote), the row holds
-- **10 keys** with the other eight rates at their 0017 values (the `||` merge
-- clobbered nothing), and quoteServiceASteps returned 3 for a reused demo and 5
-- itemised as steps 3 + analysis 2 for a first paid render. Both rows this file
-- carries for the change -- 0026 (key presence) and 0039 (both values) -- read
-- **true** against production.
--
-- **The code was NOT deployed at this point, deliberately, and the gap is
-- benign in exactly one direction.** The migration goes first because
-- creditCostsSchema makes the new key required; the reverse gap -- old row, new
-- code -- throws on every quote path. This gap is the safe one: the DEPLOYED
-- schema is a plain z.object, so it strips the key it does not know about, and
-- the only live effect is that a steps render prices at 3 instead of 5 until the
-- branch merges. An undercharge window, not an outage.
--
-- 2026-09-16, production (hyaqydcmwbnbaiqqufow), after `db push` applied 0040
-- (audio_preview_daily_limit 50 -> 20, reverting 0038), on the founder's
-- explicit instruction for this one push: ledger read-back **41 rows,
-- 0000-0040, NO GAPS, nothing unapplied, nothing remote-only and NO REPAIR
-- NEEDED** -- `db push` recorded 0040 itself, the SEVENTH time in a row the
-- REPAIR note above has predicted correctly. Pre-flight was `migration list`
-- (0000-0039 local == remote, 0040 the only row with an empty remote) and
-- `db push --dry-run`, which named 0040_audio_preview_cap_back_to_20.sql alone.
-- Same Docker catalog-cache warning as 0035-0039, and not a failure; the apply
-- printed "Applying migration 0040_audio_preview_cap_back_to_20.sql..." and
-- exited 0.
--
-- **0040's UPDATE is GUARDED (`AND value = '50'::jsonb`), so this push needed a
-- verification the previous six did not: a BEFORE-read.** A guarded UPDATE that
-- matches nothing exits 0 and prints the same thing as one that worked, and
-- `db push` would record the version either way -- so "the migration applied"
-- would have been true and "the value moved" false, with nothing in the output
-- to tell them apart. Read BEFORE the push through the code's own parse:
-- getConfigValue(db, 'audio_preview_daily_limit', z.number().int()) returned
-- **50**, PASS -- the guard's precondition held exactly, so the row had NOT
-- been hand-edited since 0038. Read AFTER the same way: **20**, PASS. Both via
-- packages/core/.work/readback-0040.ts (throwaway, gitignored), which is the
-- exact call pipelines/tts.ts:76 makes. A raw SELECT would not have
-- distinguished the number 20 from the JSON string "20", which is the one way
-- this row can be wrong and only surfaces at a customer's next preview.
--
-- The structural row for this key is now '0038+0040' and asserts **20**. Note
-- what it cannot prove on its own: 0001 seeds 20 as well, so it reads true both
-- on a database where the pair ran and on one where neither did. The before-read
-- above is what closes that gap for THIS database.
--
-- **This file was then run against production in full, structural layer, and it
-- matches its own header exactly: 30 rows, 28 TRUE, 1 false, 1 NULL.** The new
-- '0038+0040' row read **true**. The single false is 0022, unchanged and not a
-- finding (see its note); the single NULL is 0020, as always. So folding 0038's
-- row into '0038+0040' did what it was meant to: the row count did not move and
-- 0022 is still the ONLY expected false, which is the rule that makes this file
-- usable. Measured via packages/core/.work/run-ledger-0040.ts (throwaway,
-- gitignored) -- it reads this file, refuses it if any write statement appears
-- outside a comment, and runs it over the session pooler read-only.
--
-- No worker restart and no deploy were needed: requestAudio reads the row live
-- on every call. Decision: docs/vault/decisions/0049-audio-preview-attempt-cap-
-- back-to-20.md, superseding 0047.

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
