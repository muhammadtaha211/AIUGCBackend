-- SUPABASE-ONLY: references auth.uid(). Skip this file on plain Postgres /
-- PGlite (tests apply the portable migrations only).
--
-- 0041 re-keyed subscriptions to the account and dropped business_id, which
-- 0002's policy went through owns_business() to read — so 0041 had to drop the
-- policy to drop the column. Scope it directly by user_id instead, exactly as
-- 0012 did for credit_ledger after 0011.

CREATE POLICY "subscriptions_select_own" ON public.subscriptions
  FOR SELECT USING (user_id = (SELECT auth.uid()));
