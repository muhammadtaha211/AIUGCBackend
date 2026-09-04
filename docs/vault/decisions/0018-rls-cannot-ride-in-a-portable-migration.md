---
type: decision
status: verified
verified: 2026-09-04
method: 'founder chose from three options offered in chat 2026-09-04. The constraint behind them was measured, not assumed: on a fresh PGlite instance `CREATE POLICY p ON t FOR SELECT TO authenticated USING (active)` fails with `role "authenticated" does not exist`, while the same statement without the `TO` clause succeeds, and the whole statement succeeds after `CREATE ROLE authenticated`.'
source: founder + code
---

# 0018 — RLS cannot ride in a migration the PGlite suite applies; it gets its own file

## The decision

**Migration 0032 was split.** `0032_opener_clips.sql` is portable and is in
`PORTABLE_MIGRATIONS`; `0033_rls_opener_clips.sql` is SUPABASE-ONLY and is excluded. The
brief had asked for one file numbered 0032 carrying both.

The founder chose this from three options, taking the one recommended. **He gave no separate
reason** — the reason offered with it was that it is the repo's existing precedent and adds no
new idiom: every RLS statement in this schema already lives in its own file (`0002`, and then
`0007`, `0012`, `0024`), and `0023`/`0024` is the exact shape — portable table, then policies.

## The constraint that forced it

`hook_clips`' policy, which `opener_clips` had to mirror, is
`FOR SELECT TO authenticated USING (active)` (`0002_supabase_rls.sql:99-101`). The
`authenticated` role is a Supabase artifact. PGlite is vanilla Postgres and does not have it, so
the statement raises `undefined_object` there — measured, see `method`.

Meanwhile the two new tests (`packages/core/test/migrations.test.ts`, the partial unique index and
the CHECK) need `opener_clips` to exist in PGlite, which means 0032 has to be in
`PORTABLE_MIGRATIONS`. The two requirements are not satisfiable by one file.

**The general rule this settles:** RLS is not portable in this repo, and the blocker is the
`authenticated` role, not only `auth.uid()`/`owns_business()`. Any future migration that both
creates a table the tests need and secures it is two files.

## Options offered and not chosen

| Option                                                                                             | Why not                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One file; `CREATE ROLE authenticated` in the test helper**                                       | Keeps the brief's numbering and one apply step, and would make the PGlite suite genuinely validate the policy statement — which the split never does. Rejected: the helper would fabricate a Supabase role that no migration creates. |
| **One file; the `CREATE POLICY` wrapped in `DO $$ ... EXCEPTION WHEN undefined_object THEN null`** | Keeps the numbering, uses `0013`'s existing DO/EXCEPTION idiom, touches no test infra. Rejected: it swallows an error class, leaving the ledger's policy-by-name row as the only proof the policy landed.                             |

## What it cost

The brief's "33 migrations, 0000–0032" became **34, 0000–0033**, and the founder applies two
files instead of one. `scripts/verify-migration-ledger.sql` gained a row per file — 0032 for the
column, FK, table, CHECK and partial index; 0033 for the policy and `relrowsecurity` — so the
split is visible at verification time rather than assumed.

## Related

[[0017-service-b-single-setting-selfie-talking-head]] — the format decision 0032/0033 build to.
[[../facts/every-migrated-table-enables-rls]] — the RLS census this extends by two tables' worth
(its measurement is bounded to 0000–0030 and is not restated here).
[[0013-hook-clips-near-9-16-not-exact-1080x1920]] — the Service A bank whose registration
constraints the opener bank copies.
