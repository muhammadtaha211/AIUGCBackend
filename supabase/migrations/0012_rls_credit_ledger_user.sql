-- SUPABASE-ONLY: references auth.uid(). Skip this file on plain Postgres /
-- PGlite (tests apply the portable migrations only).
--
-- 0011 re-keyed credits to the account (user_id). The 0002 policy went through
-- owns_business(business_id), which misses user-level grant rows (business_id
-- NULL). Scope directly by user_id instead.

DROP POLICY "credit_ledger_select_own" ON public.credit_ledger;
CREATE POLICY "credit_ledger_select_own" ON public.credit_ledger
  FOR SELECT USING (user_id = (SELECT auth.uid()));
