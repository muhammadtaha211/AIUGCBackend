-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- Double-debit and double-refund become structurally impossible instead of
-- check-then-write impossible. refundRenderIfNeeded read the ledger twice and
-- then inserted, with nothing between the reads and the write: the render
-- handler's permanent-failure path and the janitor's dead-job sweep could both
-- pass the check and both refund. Partial (not plain) unique indexes because
-- only these two reasons key on a render id — grants and expiries carry a
-- subscription id or no ref_id at all, and several may legitimately share one.
CREATE UNIQUE INDEX "credit_ledger_debit_render_uniq"
  ON "credit_ledger" ("ref_id") WHERE "reason" = 'debit_render';

CREATE UNIQUE INDEX "credit_ledger_refund_failed_uniq"
  ON "credit_ledger" ("ref_id") WHERE "reason" = 'refund_failed';
