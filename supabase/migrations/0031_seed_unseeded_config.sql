-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).
--
-- WHY THIS EXISTS
-- Rebuilding onto a new Supabase project on 2026-08-26 (docs/08-supabase-project-rebuild.md)
-- ran 0000-0030 into an empty database and then compared app_config against the
-- old production project. The old project had 13 rows; the rebuilt one had 8.
-- Five knobs existed ONLY in the production database and in no migration, so a
-- rebuild silently replaced each with whatever constant the code happened to
-- carry. Two more rows had been hand-edited away from their seeds and quietly
-- reverted.
--
-- Every one of those was a deliberate operational decision that survived only
-- as a row someone typed into the SQL editor. That is the same class of problem
-- as 0027's llm_tokens cap. This migration moves them into the repo so the next
-- rebuild reproduces them by construction.
--
-- Absent rows are not errors: getConfigValueOr (packages/core/src/appConfig.ts:18-29)
-- returns the caller's fallback when a key is missing, which is why the drift
-- was invisible.

-- ---------------------------------------------------------------------------
-- 1. The four knobs that were live in production and seeded nowhere.
-- ---------------------------------------------------------------------------
-- Values are the ones read from the old project on 2026-08-26, not new choices.
--
--   tts_enhance            false   — matches its code fallback (tts.ts:228), seeded
--                                    anyway so the OFF state is a recorded decision
--                                    rather than an accident of a missing row.
--   lipsync_resolution     1080p   — matches DEFAULT_LIPSYNC_RESOLUTION (renders.ts:61);
--                                    same reasoning.
--   lipsync_motion_prompt          — no fallback: absent means the field is omitted
--                                    from the HeyGen submit body entirely
--                                    (renders.ts:180), so losing this row silently
--                                    changes what every Service B render looks like.
--   poll_deadline_seconds  900     — the code constant is 2400 (poll.ts:17), and
--                                    poll.ts:14 already says "900s is the intended
--                                    live setting". Losing this row stretches every
--                                    poll window 2.7x before a stuck job fails.
INSERT INTO "app_config" ("key", "value") VALUES
  ('tts_enhance', 'false'),
  ('lipsync_resolution', '"1080p"'),
  ('lipsync_motion_prompt', '"gestures casually with one hand while talking, warm smile"'),
  ('poll_deadline_seconds', '900')
ON CONFLICT ("key") DO NOTHING;

-- tts_stability is DELIBERATELY NOT SEEDED. The old project carried 0.5; the
-- founder's decision on 2026-08-26 was to let ElevenLabs' own default stand
-- instead. The absence of this row IS the setting — getConfigValueOr passes
-- `undefined` for stability (tts.ts:229) and synthesize() then omits it. Recorded
-- here rather than left silent, because "no row" and "nobody thought about it"
-- otherwise look identical.

-- ---------------------------------------------------------------------------
-- 2. Two seeded rows whose production values had diverged from the seed.
-- ---------------------------------------------------------------------------
-- Both updates are guarded to fire only when the row still holds the original
-- seeded value. A later deliberate change — a recalibration, a founder flip —
-- must not be undone by this migration running against an environment that has
-- already moved on.

-- auto_release_b: seeded false by 0001, but true in production by standing
-- founder instruction (CLAUDE.md decision #8 amendment, 2026-08-09; see
-- docs/vault/facts/app-config-live-state.md). Service B releases without passing
-- through qc_pending. The QC machinery stays in the tree and this flag is the
-- switch — its off-position has to keep working — but ON is the live setting and
-- it should not depend on someone remembering to flip it after a rebuild.
UPDATE "app_config"
SET "value" = 'true'::jsonb, "updated_at" = now()
WHERE "key" = 'auto_release_b' AND "value" = 'false'::jsonb;

-- words_per_second.default: seeded 2.2 by 0001, which calibrate.ts:9 itself calls
-- "the seed value ... a guess". Production held 2.1 — calibration output, not
-- drift (docs/vault/facts/app-config-live-state.md). Recalibrating `default` is a
-- manual UPDATE by design: aiugc calibrate-wps writes only per-voice keys and
-- structurally cannot touch `default` (docs/04-integrations.md).
-- jsonb_set, not a whole-value rewrite, so per-voice calibrations survive.
UPDATE "app_config"
SET "value" = jsonb_set("value", '{default}', '2.1'), "updated_at" = now()
WHERE "key" = 'words_per_second' AND "value" ->> 'default' = '2.2';
