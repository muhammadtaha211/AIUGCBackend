-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- Service C, גוש טקסט (decision 0089, founder 2026-10-07): a founder-made bank
-- clip played once under one Hebrew text block, admin-only in phase 1. Two
-- enum values carry it through the existing tables:
--
--   service_kind 'c'        video_renders.service — the render_video handler
--                           dispatches on it and releases it like Service A,
--                           never into qc_pending (pipelines/renders.ts).
--   script_kind 'text_block' scripts.kind — one row per generated text,
--                           params {skeleton, textBlockClipId, speakerGender},
--                           prompt_version text_block@vN.
--
-- ALONE IN THIS FILE ON PURPOSE, 0019's rule: ALTER TYPE ... ADD VALUE may run
-- inside a transaction block, but the new value CANNOT be used in that same
-- transaction. The table that goes with it is 0052, which names neither value.
-- Both statements are idempotent on PG 13+.
ALTER TYPE "public"."service_kind" ADD VALUE IF NOT EXISTS 'c';--> statement-breakpoint
ALTER TYPE "public"."script_kind" ADD VALUE IF NOT EXISTS 'text_block';

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER:
--
--   select enumlabel from pg_enum
--    where enumtypid = 'public.service_kind'::regtype order by enumsortorder;
--   select enumlabel from pg_enum
--    where enumtypid = 'public.script_kind'::regtype order by enumsortorder;
--
-- BEFORE expect a, b and hook_line, benefit_captions, vo_script, b_script.
-- AFTER expect a, b, c and the four plus text_block, last. No row of any table
-- changes.
-- ---------------------------------------------------------------------------
