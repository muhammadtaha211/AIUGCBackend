-- SUPABASE-ONLY: uses owns_business() and the authenticated role from
-- 0002_supabase_rls.sql. Skip this file on plain Postgres / PGlite (tests
-- apply the portable migrations only).
--
-- Closes the RLS gap for tables created after 0002: composites (0003) and
-- persona_images (0005 — which dropped persona_clips together with its
-- policy). Same read-only model as 0002: all writes go through the service
-- role, so SELECT policies only.

ALTER TABLE public.composites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "composites_select_own" ON public.composites
  FOR SELECT USING (public.owns_business(business_id));

-- Persona reference images are part of the public persona catalog: any
-- signed-in user may see images of active personas.
ALTER TABLE public.persona_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "persona_images_select_active" ON public.persona_images
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.personas p WHERE p.id = persona_id AND p.active
  ));
