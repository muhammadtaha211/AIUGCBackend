-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).
-- Separate file from 0019 because the value it uses was added there — see that
-- file's note on why the two cannot share a transaction.

-- Relabel ONLY the rows HeyGen actually produced.
--
-- `provider = 'fal' AND kind = 'gpu_seconds'` is NOT a safe predicate: 7 of the
-- 21 GPU rows on the live database are genuine fal/InfiniteTalk spend from
-- before the switch. All 21 join to lipsync jobs, so job type cannot separate
-- them either. The per-second rate can, and it is self-verifying:
--
--   150 agorot/s  fal, InfiniteTalk era   (2026-07-24 .. 07-27)   4 rows
--    75 agorot/s  fal, revised rate       (2026-07-30 .. 08-01)   3 rows
--    25 agorot/s  HeyGen                  (2026-08-02 onward)    14 rows
--
-- 25 = GPU_COST_AGOROT_PER_SECOND in pipelines/renders.ts, which landed in
-- c339043 on 2026-08-02 — the exact day the rate changes. Matching on the rate
-- rather than a date cutoff means the statement cannot touch a row priced any
-- other way, whatever its timestamp.
--
-- nano-banana image rows are legitimately fal and are excluded by kind.
UPDATE "usage_events"
SET "provider" = 'heygen'
WHERE "provider" = 'fal'
  AND "kind" = 'gpu_seconds'
  AND "cost_estimate_agorot" = "quantity" * 25;
