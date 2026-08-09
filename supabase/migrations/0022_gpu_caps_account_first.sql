-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- Account-first GPU caps. Until now per_account carried only tts_chars, so
-- the platform-wide gpu_seconds cap was the ONLY GPU protection at either
-- level — and a platform cap punishes everyone for one account's spend.
--
-- per_account.gpu_seconds = 2000 mirrors the tts ceiling on purpose: 25,000
-- chars/24h is ~2,000 seconds of Hebrew speech (12.49 chars/s measured), and
-- every lip-synced second is a second of approved TTS audio — an account
-- cannot legitimately lip-sync more than it can synthesize in the same
-- window. ~65 thirty-second renders a day, ~₪500/account/day worst-case
-- exposure at 25 agorot/s. The busiest day ever recorded across ALL accounts
-- is 127 gpu-seconds; an honest heavy user never sees this.
--
-- Platform gpu_seconds becomes 7200 (2h of video/day, ~₪1,800/day worst
-- case): a runaway backstop that only trips on what no account cap can stop —
-- a loop across accounts or a compromised key — never on legitimate load.
-- The live value was 36,000, set by a hand UPDATE on 2026-08-06 and recorded
-- nowhere; that drift is why this lives in a migration.
--
-- dailyCapsSchema (packages/core/src/config.ts) is a CLOSED zod object, so
-- the per_account key and the schema must land together or every read throws.
UPDATE "app_config"
SET "value" = jsonb_set("value", '{per_account,gpu_seconds}', '2000'),
    "updated_at" = now()
WHERE "key" = 'daily_caps';

UPDATE "app_config"
SET "value" = "value" || '{"gpu_seconds": 7200}'::jsonb,
    "updated_at" = now()
WHERE "key" = 'daily_caps';
