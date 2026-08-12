-- SUPABASE-ONLY: uses owns_business() and the authenticated role from
-- 0002_supabase_rls.sql. Skip this file on plain Postgres / PGlite (tests
-- apply the portable migrations only — do NOT add this file to
-- PORTABLE_MIGRATIONS).
--
-- RLS for the step-plan tables (0023). Same read-only model as 0002/0007:
-- all writes go through the service role, so SELECT policies only. Neither
-- table carries business_id — ownership is a join through demos.

ALTER TABLE public.demo_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "demo_analyses_select_own" ON public.demo_analyses
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.demos d
    WHERE d.id = demo_id AND public.owns_business(d.business_id)
  ));

ALTER TABLE public.demo_step_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "demo_step_plans_select_own" ON public.demo_step_plans
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.demos d
    WHERE d.id = demo_id AND public.owns_business(d.business_id)
  ));
