-- SUPABASE-ONLY: uses the authenticated role from 0002_supabase_rls.sql. Skip
-- this file on plain Postgres / PGlite (tests apply the portable migrations
-- only — do NOT add this file to PORTABLE_MIGRATIONS).
--
-- RLS for the opener-clip bank (0032). Same read-only model as 0002/0007/0024:
-- all writes go through the service role, so a SELECT policy only. opener_clips
-- is founder-curated catalog data with no business_id, so it mirrors
-- hook_clips_select_active exactly — any signed-in user may read active rows.

ALTER TABLE public.opener_clips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "opener_clips_select_active" ON public.opener_clips
  FOR SELECT TO authenticated USING (active);
