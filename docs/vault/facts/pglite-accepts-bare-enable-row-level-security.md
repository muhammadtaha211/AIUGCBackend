---
type: fact
status: verified
verified: 2026-09-08
method: "fresh PGlite instance, packages/core/.work/pglite-rls-probe.mjs: CREATE TABLE t; ALTER TABLE t ENABLE ROW LEVEL SECURITY; SELECT relrowsecurity FROM pg_class WHERE relname='t'; CREATE POLICY p ON t FOR SELECT TO authenticated USING (true)"
source: code
---

# PGlite runs a bare ENABLE ROW LEVEL SECURITY; only the role reference is unportable

Measured on a fresh PGlite instance, in this order:

| statement                                               | result                                       |
| ------------------------------------------------------- | -------------------------------------------- |
| `ALTER TABLE t ENABLE ROW LEVEL SECURITY`               | **succeeds**                                 |
| `SELECT relrowsecurity FROM pg_class WHERE relname='t'` | **true**                                     |
| `CREATE POLICY p ON t FOR SELECT TO authenticated ...`  | fails, `role "authenticated" does not exist` |

PGlite is vanilla Postgres, and RLS is a vanilla Postgres feature. Nothing about enabling it needs
Supabase. What needs Supabase is the `authenticated` role a policy's `TO` clause names — the same
blocker [[../decisions/0018-rls-cannot-ride-in-a-portable-migration]] measured from the other side.

**Consequence, and the bound this puts on 0018.** 0018's rule reads as "RLS is not portable in this
repo". The accurate rule is narrower: _a policy naming a Supabase role_ is not portable. A table that
needs RLS **and no policy** — the server-only shape of `0002`'s "Server-only tables" block — is one
portable file, not two. `0035_feedback.sql` is the first migration to use that: it creates
`feedback`, enables RLS, and writes no policy, and the PGlite suite applies the whole file
(`PORTABLE_MIGRATIONS`, `packages/core/test/migrations.test.ts` asserts `relrowsecurity` is true and
`pg_policies` is empty). See [[../decisions/0035-a-policyless-table-keeps-its-rls-in-the-portable-file]].

This does not weaken 0018 for the case it was written about. `opener_clips` mirrors
`hook_clips_select_active`, which is `TO authenticated`, so it still needs its own file.

## Related

[[every-migrated-table-enables-rls]] — the rule `feedback` follows rather than becoming the first
exception to. That note's measurement is bounded to migrations 0000–0030 and was NOT re-run here;
what is measured here is only that 0035's own `ENABLE` lands (`pg_class.relrowsecurity` is asserted
in `migrations.test.ts`).
[[../decisions/0018-rls-cannot-ride-in-a-portable-migration]] — the decision this bounds.
