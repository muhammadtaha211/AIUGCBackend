---
type: decision
status: verified
verified: 2026-09-08
method: "founder instruction in the build brief 2026-09-08, with the fallback he named; the constraint behind it measured on a fresh PGlite instance — see facts/pglite-accepts-bare-enable-row-level-security"
source: founder + code
---

# 0035 — a table that needs RLS and no policy keeps its ENABLE in the portable migration

## The decision

**`0035_feedback.sql` is one file.** It creates `feedback`, adds both FKs and the `created_at` index,
and ends with `ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY` — no separate SUPABASE-ONLY file,
and the whole thing is in `PORTABLE_MIGRATIONS`.

The founder asked for this directly in the brief, with the reason: `feedback` needs **no policy**, a
bare `ENABLE` is plain Postgres, and one file is one apply step for him. He named the fallback
himself — if the PGlite run rejected the statement, fall back to [[0018-rls-cannot-ride-in-a-portable-migration]]'s
two-file precedent. It did not: measured before the file was written, the bare `ENABLE` succeeds on
PGlite and `pg_class.relrowsecurity` reads true
([[../facts/pglite-accepts-bare-enable-row-level-security]]).

## Why this does not reopen 0018

0018 is about a policy. Its measured blocker is the `authenticated` role in
`CREATE POLICY ... TO authenticated`, which PGlite does not have. `feedback` is a server-only table
in the sense of `0002_supabase_rls.sql`'s "Server-only tables" block — RLS on, zero policies, which
is deny-all for `anon` and `authenticated` — and its only readers (the web POST route, the admin
page) reach it over `DATABASE_URL` as `postgres`, which bypasses RLS. There is no policy to be
unportable.

So the two notes are not in tension; 0035 bounds 0018's general rule to what was actually measured.
A future migration that creates a table the tests need **and gives it a policy** is still two files.

## What it cost

`scripts/verify-migration-ledger.sql` gets **one** row for 0035 instead of two, and it has to assert
`relrowsecurity` itself — with the table and the ENABLE in the same file, a paste truncated after
`CREATE TABLE` is exactly the failure that row exists to catch. The absence of a policy is
deliberately not asserted: a policy added later would be an addition, not evidence 0035 failed.

## Related

[[0018-rls-cannot-ride-in-a-portable-migration]] — the rule this bounds.
[[../facts/pglite-accepts-bare-enable-row-level-security]] — the measurement.
[[../facts/every-migrated-table-enables-rls]] — the rule this keeps. Its census is bounded to
0000–0030 and was not re-run for 0035; the new table's RLS is asserted directly in
`packages/core/test/migrations.test.ts` instead.
