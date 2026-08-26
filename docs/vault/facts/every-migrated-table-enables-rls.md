---
type: fact
status: verified
verified: 2026-08-26
method: "set difference of CREATE TABLE vs ALTER TABLE ... ENABLE ROW LEVEL SECURITY across supabase/migrations/0000-0030; pg_class.relrowsecurity on prod"
source: code
---

# No table in this schema relies on RLS being off

The migrations create 27 tables and explicitly `ENABLE ROW LEVEL SECURITY` on all 27 — in
`0002_supabase_rls.sql`, `0007_rls_composites_persona_images.sql` and `0024_rls_step_plans.sql`.
The set difference "created but never RLS-enabled" is **empty**.

Two of the 27 are dropped later (`persona_clips` in `0005`, `demo_segments` in `0023`), which is
why production has 25 tables. Confirmed on the live project: all 25 have
`pg_class.relrowsecurity = true`, and none has `relforcerowsecurity`.

**Consequence:** Supabase's "automatic RLS" project setting is a no-op for this schema. It enables
what the migrations already enable. Creating the new project with it on changes nothing and
requires no migration edits.

## Six tables have RLS on and zero policies

`app_config`, `events`, `gateway_events`, `jobs`, `pronunciation_entries`, `usage_events`.

RLS on with no policy is deny-all for `anon` and `authenticated`. That is the current working
state, not a defect: the worker, the CLI and the API route handlers all reach these tables as
`postgres` over `DATABASE_URL`, which bypasses RLS. Nothing reads them through PostgREST — see
[[data-api-surface-is-two-tables]].

The 19 policies on the other 19 tables are the customer-facing ones. `businesses_select_own`
(`owner_user_id = auth.uid()`) and `users_select_self` (`id = auth.uid()`) are both SELECT-only,
which is why granting those two tables to `authenticated` widens nothing.
