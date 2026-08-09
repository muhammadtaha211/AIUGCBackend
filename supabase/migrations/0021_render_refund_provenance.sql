-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- QC regeneration provenance + refund display state.
--
-- rejectRender creates a fresh render with no debit of its own (the customer
-- is never double-charged for our QC), but nothing linked that render back to
-- the original: refundRenderIfNeeded(regeneratedRenderId) found no debit and
-- no-oped while the wizard claimed the credits came back. regenerated_from is
-- the walkable link to the debit-bearing ancestor.
ALTER TABLE "video_renders" ADD COLUMN "regenerated_from" uuid REFERENCES "video_renders"("id");

-- Derived display state for /api/renders/[id]: the ledger stays the source of
-- truth. Written only by failRenderAndRefund, in the same transaction as the
-- refund row. Nothing else may write it.
ALTER TABLE "video_renders" ADD COLUMN "refunded_at" timestamp with time zone;

-- Backfill from the ledger for renders refunded before the column existed —
-- the refund sentence must be true for old failures too.
UPDATE "video_renders" vr
SET "refunded_at" = cl."created_at"
FROM "credit_ledger" cl
WHERE cl."ref_id" = vr."id" AND cl."reason" = 'refund_failed';

-- One prod row (1ff0a5be…, 2026-08-08) was failed by the pre-terminal-mirror
-- janitor sweep, which copied the dead job's raw English last_error into the
-- customer-facing column, and /api/renders now serves that column verbatim.
-- Rewrite to the fixed Hebrew retry-exhaustion string (the render WAS retried
-- to death); the diagnostic stays on jobs.last_error.
UPDATE "video_renders"
SET "error" = 'יצירת הסרטון נכשלה בגלל תקלה חוזרת בעיבוד — נסו שוב מאוחר יותר.'
WHERE "status" = 'failed' AND "error" LIKE 'storage upload failed%';
