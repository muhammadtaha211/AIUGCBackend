---
paths:
  - "supabase/**"
  - "scripts/verify-migration-ledger.sql"
  - "packages/core/src/db/schema.ts"
  - "packages/core/drizzle.config.ts"
  - "packages/core/scripts/verify-*.ts"
  - "packages/core/test/migrations.test.ts"
  - "packages/core/test/helpers/pglite.ts"
---

# Migrations — the production gate

Moved out of CLAUDE.md on 2026-09-29. It loads when you touch `supabase/`, the schema or the
migration tooling. The dated history these rules came from, push by push, is
`docs/vault/facts/production-migration-push-log.md`.

## Why the gate covers everything

Migrations are gated by reversibility, not by the word "production", and nothing is reversible any
more.

- There is **one** Supabase project, `hyaqydcmwbnbaiqqufow`. It holds real data, and all five `.env`
  files point at it: `.env`, `apps/web/.env.local`, `apps/admin/.env.local`, `apps/worker/.env` and
  `apps/cli/.env`.
- The old project (`mtpmrqltldfwhziyyzdu`) is deleted (founder-reported).
- The "still-empty, so delete and recreate it in three minutes" escape hatch died at the env flip on
  2026-08-27.
- The ledger is clean: no gaps, nothing unapplied (the push log has the last measurement). So a push
  genuinely runs, which makes the gate more necessary, not less.

## Rules

1. Never `db push`, never `migration repair`, never ad-hoc DDL — except on the founder's explicit
   instruction for that one push. An instruction covers that one push. It is never standing
   permission.
2. Never apply a migration at the end of a task. Say in Next step that one is waiting, and include
   its `db push --dry-run` output.
3. Apply with `supabase db push --db-url <url>`, where `<url>` is `DATABASE_URL` from `.env` with
   `:6543/` swapped to `:5432/` (session pooler). Every command takes the same `--db-url`, including
   `migration list` and the dry-run; nothing relies on link state
   (`docs/vault/facts/supabase-link-state-removed.md`). Read the URL out of `.env` inside the script
   that spawns the CLI. Never type it on a command line; that is CLAUDE.md's credential rule. The CLI
   may quote its own DSN in an error, so scrub the URL, password, host and user from any output
   before you print or report it (`scripts/verify-migration-ledger.sql`, the 0037 entry).
4. `supabase` is a root devDependency (2.109.1), so there is nothing to fetch. Spawn the pinned
   binary `node_modules/.pnpm/@supabase+cli-windows-x64@*/node_modules/@supabase/cli-windows-x64/bin/supabase.exe`
   directly:
   - Use the `.exe`, not the `.cmd` shim. Spawning a `.cmd` on Node 20+ needs `shell: true`, and a
     shell would put the connection string through cmd.exe quoting.
   - Never use `npx -y supabase`. It fetched a second copy every time.
5. Pre-flight every push with a read-only `migration list` and `db push --dry-run`.
6. **Guarded migration** (an `UPDATE` guarded on the old value): read the row through the code's
   own parse BEFORE the push and after it, not just after. A guard that matches nothing exits 0,
   prints the same output and still records its version. The ledger would then say applied while
   the value had not moved.
7. **Destructive migration** (an irreversible `DROP COLUMN`, for example): read BEFORE, always,
   because the question is what is in the column. Put the count in the report.
8. **A column an RLS policy reads cannot be dropped** until the policy is. 0041 drops
   `subscriptions_select_own` itself, so the portable file still applies everywhere, and 0042
   recreates it on `user_id` (0011/0012's shape).
9. 0039 had to go FIRST, ahead of its own code: `creditCostsSchema`
   makes its new key required, so a build carrying the schema key against a row without it throws on
   every quote path rather than mis-pricing.
10. `db push` records the version itself, so a push needs no `migration repair`. If a migration is
    ever applied by hand instead, immediately run
    `supabase migration repair --status applied <version>` with the same `--db-url`. Otherwise the
    ledger drifts again and `db push` goes back to being unusable.
11. Post-apply proofs are in `scripts/verify-migration-ledger.sql` §RESULTS.
