-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- The legibility gate split (demo-analysis.ts changes in the same commit).
-- The single gate — illegible (low + unreadable) fraction > 0.4 => rejected —
-- was calibrated before any real footage existed. On the first five real
-- analyses, "low" is the model's ordinary verdict on a filmed screen, not a
-- refilm signal:
--
--   analysis  states  unreadable  illegible  status before 0028
--   6a1b247e  80      0.013       0.250      ready
--   075933e0  80      0.013       0.300      ready
--   208695ff  80      0.000       0.438      rejected
--   a179f069  61      0.016       0.492      ready (hand-flipped from
--                                            rejected by a raw status-only
--                                            UPDATE — phase-1 V5 finding)
--   4a682b35  52      0.019       0.538      rejected
--
-- Four of five carry exactly one unreadable state (~1 per analysis is the
-- observed rate; 0.25 leaves ~13x headroom) and the max illegible is 0.538
-- (0.75 passes everything real). The code gate is now
-- unreadable > 0.25 OR illegible > 0.75, both knobs read via getConfigValueOr
-- — missing row = default — so NO app_config rows are seeded here.
--
-- Three statements:
--
-- 1) The threshold tuning attempt landed INSIDE the credit_costs JSONB
--    instead of its own top-level row; nothing reads it there. Strip it, no
--    replacement row — missing row = default is the convention. The `?` guard
--    keeps a re-run a true no-op (0026 precedent: never bump a hand-tuned
--    row's updated_at for nothing).
--
-- 2) Backfill: re-run the new gate over rows the old gate rejected. Eligible
--    means status='rejected' AND a non-empty stored timeline (the
--    zero-cluster rejection shares the same failReason but writes no
--    timeline; PermanentError paths write 'failed', not 'rejected' — so
--    rejected + non-empty timeline isolates the legibility gate exactly) AND
--    both fractions, recomputed from the stored JSONB, pass 0.25/0.75. The
--    no-ready-sibling and newest-eligible-per-demo guards are
--    invariant-preserving, not filters: on current production data they
--    exclude nothing (five analyses over five distinct demos, one attempt
--    each), but they keep demo_analyses_one_ready_per_demo (0023's partial
--    unique index) satisfiable on any DB this runs against — the PGlite test
--    DB and hand-applied staging DBs included.
--
-- 3) fail_reason hygiene: the code always nulls fail_reason when it writes
--    'ready', so a ready row still carrying one can only come from a raw
--    status-only hand-flip — and it would surface the Hebrew refilm message
--    on a successful analysis. The pre-migration check (2026-08-18) found
--    a179f069 already reason-NULL (its xmin is the newest of the five rows,
--    consistent with a later hand-edit), so on production this statement
--    changes nothing — it is the invariant, kept.
--
-- PREDICTED OUTCOME on production, to verify right after application —
-- exactly two rows flip:
--   4a682b35 (demo 4dc00d73, 0.019/0.538) rejected -> ready
--   208695ff (demo ee69edfa, 0.000/0.438) rejected -> ready
-- Unchanged: 075933e0 (0.013/0.300, ready), 6a1b247e (0.013/0.250, ready),
--            a179f069 (0.016/0.492, ready).
-- A third row changing status means the predicate is wrong: stop and report,
-- do not adjust the predicate to match.

UPDATE "app_config"
SET "value" = "value" - 'a_analysis_legibility_threshold',
    "updated_at" = now()
WHERE "key" = 'credit_costs'
  AND "value" ? 'a_analysis_legibility_threshold';

WITH eligible AS (
  SELECT da."id", da."demo_id", da."created_at"
  FROM "demo_analyses" da
  WHERE da."status" = 'rejected'
    AND da."timeline" IS NOT NULL
    AND jsonb_array_length(da."timeline") > 0
    AND (SELECT (count(*) FILTER (WHERE s->>'legibility' = 'unreadable'))::numeric
                / NULLIF(count(*), 0)
         FROM jsonb_array_elements(da."timeline") s) <= 0.25
    AND (SELECT (count(*) FILTER (WHERE s->>'legibility' <> 'high'))::numeric
                / NULLIF(count(*), 0)
         FROM jsonb_array_elements(da."timeline") s) <= 0.75
    AND NOT EXISTS (
      SELECT 1 FROM "demo_analyses" r
      WHERE r."demo_id" = da."demo_id" AND r."status" = 'ready'
    )
),
newest AS (
  SELECT DISTINCT ON ("demo_id") "id"
  FROM eligible
  ORDER BY "demo_id", "created_at" DESC, "id" DESC
)
UPDATE "demo_analyses"
SET "status" = 'ready',
    "fail_reason" = NULL,
    "updated_at" = now()
WHERE "id" IN (SELECT "id" FROM newest);

UPDATE "demo_analyses"
SET "fail_reason" = NULL,
    "updated_at" = now()
WHERE "status" = 'ready'
  AND "fail_reason" IS NOT NULL;
