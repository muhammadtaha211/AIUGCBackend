-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- Per-ACCOUNT spend caps. `daily_caps` was platform-wide only, which made one
-- looping account everyone else's problem: it burned the shared ElevenLabs
-- window and parked every other customer's jobs behind a BudgetError.
--
-- Keyed on users.id, not businesses.id, because business creation is
-- self-serve and unlimited (apps/web onboarding/complete accepts
-- allowCreate) — a per-business cap is farmable at N businesses.
--
-- 25000 chars/24h is ~2000 seconds of Hebrew speech at the measured 12.49
-- chars/sec: roughly 50 full-length previews a day, ~7.50 ILS/account/day of
-- exposure at 30 agorot/1k chars. An honest customer never sees it.
--
-- dailyCapsSchema (packages/core/src/config.ts) is a CLOSED zod object, so the
-- key and the schema must land together or every read throws.
UPDATE "app_config"
SET "value" = "value" || '{"per_account": {"tts_chars": 25000}}'::jsonb,
    "updated_at" = now()
WHERE "key" = 'daily_caps';
