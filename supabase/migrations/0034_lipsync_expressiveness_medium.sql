-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).
--
-- WHY THIS EXISTS
-- Founder decision 2026-09-06 (docs/vault/decisions/0022-heygen-expressiveness-medium-
-- generic-motion-prompt.md): every Service B HeyGen submit sends expressiveness
-- "medium" and a generic, hand-free motion prompt. Two paid draws decided it
-- (docs/vault/facts/heygen-motion-prompt-two-draws.md): "high" read as "way too
-- fake" and hallucinated a red clutch bag into her hand for 23 frames; a staged
-- action in the prompt (a palm over the lens) was ignored outright; "medium"
-- "looks natural". The old prompt's "with one hand" line is the likeliest cause
-- of the prop, so the new one names no hands, gestures, props or actions.
--
-- Same discipline as 0031: a knob the founder chose is a row in the repo, not a
-- row someone typed into the SQL editor. Both statements are guarded so a later
-- deliberate change is never undone by this migration running again.
--
-- Resolution per render stays: render param (`render-b --motion-prompt` /
-- `--expressiveness`) -> these rows -> absent (packages/core/src/pipelines/renders.ts).

-- lipsync_expressiveness: never seeded before (absent = the field is omitted
-- from the submit body and HeyGen uses its own default, "low").
INSERT INTO "app_config" ("key", "value") VALUES
  ('lipsync_expressiveness', '"medium"')
ON CONFLICT ("key") DO NOTHING;

-- lipsync_motion_prompt: seeded by 0031 with the 2026-08-26 placeholder. Fires
-- only while the row still holds that placeholder.
UPDATE "app_config"
SET "value" = '"Speaks naturally to the camera with a warm, relaxed expression, small natural head movements, steady eye contact"'::jsonb,
    "updated_at" = now()
WHERE "key" = 'lipsync_motion_prompt'
  AND "value" = '"gestures casually with one hand while talking, warm smile"'::jsonb;
