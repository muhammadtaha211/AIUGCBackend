-- SUPABASE-ONLY: references the auth schema and auth.uid(). Skip this file on
-- plain Postgres / PGlite (tests apply 0000 + 0001 only).
--
-- Write model: ALL writes go through the server (worker/CLI/web server routes)
-- using the service role, which bypasses RLS. Browser clients get read-only
-- access to their own rows and to the public catalog tables. No INSERT/UPDATE/
-- DELETE policies exist on purpose.

-- Mirror new auth users into public.users (public.users has no FK to
-- auth.users so the CLI phase and tests can insert rows directly).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row scoping: user sees self; owner sees their business's rows.
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_select_self" ON public.users
  FOR SELECT USING (id = (SELECT auth.uid()));

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "businesses_select_own" ON public.businesses
  FOR SELECT USING (owner_user_id = (SELECT auth.uid()));

-- Business-scoped tables share one ownership test.
CREATE OR REPLACE FUNCTION public.owns_business(bid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = bid AND b.owner_user_id = (SELECT auth.uid())
  );
$$;

ALTER TABLE public.demos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "demos_select_own" ON public.demos
  FOR SELECT USING (public.owns_business(business_id));

ALTER TABLE public.demo_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "demo_segments_select_own" ON public.demo_segments
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.demos d WHERE d.id = demo_id AND public.owns_business(d.business_id)
  ));

ALTER TABLE public.scripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scripts_select_own" ON public.scripts
  FOR SELECT USING (public.owns_business(business_id));

ALTER TABLE public.audio_renders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audio_renders_select_own" ON public.audio_renders
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.scripts s WHERE s.id = script_id AND public.owns_business(s.business_id)
  ));

ALTER TABLE public.sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sets_select_own" ON public.sets
  FOR SELECT USING (public.owns_business(business_id));

ALTER TABLE public.video_renders ENABLE ROW LEVEL SECURITY;
-- Customers must not see Service B renders before the founder releases them:
-- qc_pending/rejected rows stay invisible (rejected+regenerated is internal).
CREATE POLICY "video_renders_select_own_visible" ON public.video_renders
  FOR SELECT USING (
    public.owns_business(business_id)
    AND status NOT IN ('qc_pending', 'rejected')
  );

ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credit_ledger_select_own" ON public.credit_ledger
  FOR SELECT USING (public.owns_business(business_id));

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subscriptions_select_own" ON public.subscriptions
  FOR SELECT USING (public.owns_business(business_id));

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders_select_own" ON public.orders
  FOR SELECT USING (public.owns_business(business_id));

-- ---------------------------------------------------------------------------
-- Public catalog tables: any signed-in user may read active rows.
-- ---------------------------------------------------------------------------
ALTER TABLE public.hook_clips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hook_clips_select_active" ON public.hook_clips
  FOR SELECT TO authenticated USING (active);

ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "personas_select_active" ON public.personas
  FOR SELECT TO authenticated USING (active);

ALTER TABLE public.persona_clips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "persona_clips_select" ON public.persona_clips
  FOR SELECT TO authenticated USING (true);

ALTER TABLE public.structures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "structures_select_active" ON public.structures
  FOR SELECT TO authenticated USING (active);

ALTER TABLE public.sounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sounds_select" ON public.sounds
  FOR SELECT TO authenticated USING (true);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans_select_active" ON public.plans
  FOR SELECT TO authenticated USING (active);

-- ---------------------------------------------------------------------------
-- Server-only tables: RLS on, no policies -> invisible to browser clients.
-- ---------------------------------------------------------------------------
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pronunciation_entries ENABLE ROW LEVEL SECURITY;
