---
type: defect
status: verified
verified: 2026-08-23
method: "select version, name from supabase_migrations.schema_migrations (read-only) — 8 rows, last is 0007; ls supabase/migrations/*.sql — 29 files; checked each unrecorded file's first statement for IF NOT EXISTS"
source: db
---

# `supabase db push` can never work against production again

## FIXED 2026-08-26 (proof-then-repair, exactly the shape this note asked for)

Every unrecorded migration was proven applied before being marked so:
`scripts/verify-migration-ledger.sql` (one read-only UNION ALL, one boolean per
migration — column/table/index/policy/enum existence for DDL, key/value in the
live row for the `app_config` UPDATEs, self-verifying data predicates for
`0020`/`0028`) returned true 23 of 23 against production, twice — once by the
founder in the SQL editor, once via tsx. Then
`npx supabase migration repair --db-url <session pooler> --status applied`
ran in two phases (`0008`-`0028`, then `0029`-`0030` after their own proof).
Read-back: 31 rows, `0000`-`0030`, names correct; `supabase migration list`
shows local and remote in full agreement. `supabase db push` is usable again.

One consequence worth naming: the argument that made `0027`'s in-place rewrite
hazard-free ([[migration-0027-still-seeds-the-old-llm-cap]] — "the ledger
already believes it never ran") is now dead. The ledger records `0000`-`0030`
as applied, so retro-editing any of them carries the standard applied-migration
hazard; schema changes need new files from here on.

## The ledger has 8 of 29

```
select version, name from supabase_migrations.schema_migrations order by version;
0000 init · 0001 extras_and_seed · 0002 supabase_rls · 0003 composites_and_images
0004 image_config_seed · 0005 persona_images · 0006 persona_images_default
0007 rls_composites_persona_images
```

Eight rows. `supabase/migrations/` holds **29 files**. Migrations `0008` through `0028` were applied
by hand and the ledger was never told, so the Supabase CLI still considers all 21 of them pending.

(The drizzle journal is worse and separate: `supabase/migrations/meta/_journal.json` lists **three**
entries — `0000`, `0003`, `0005`. It indexes nothing that matters.)

## What happens if anyone runs `supabase db push`

The CLI replays from `0008`. The very first statement is:

```sql
-- supabase/migrations/0008_persona_gender.sql
ALTER TABLE "personas" ADD COLUMN "gender" text;
```

No `IF NOT EXISTS`. The column exists. **The push aborts on the first statement.**

That is the good news and the bad news at once:

- **Good:** the destructive scenario does not occur. Several of the unrecorded migrations are
  unconditional `UPDATE`s on `app_config` — `0017`, `0018`, `0022`, `0026`, `0027`, `0028` — and
  `0027` would reset `per_account.llm_tokens` from the hand-raised 1,500,000 back to 500,000
  ([[migration-0027-still-seeds-the-old-llm-cap]]). The abort at `0008` means none of them is
  reached. The failure is loud and harmless.
- **Bad:** it will _always_ abort there. There is no state from which `supabase db push` makes
  forward progress. The tool is not slow or awkward against this database — it is unusable, and it
  will stay unusable for every migration written from now on.

Of the 21 unrecorded files only three carry any idempotency guard (`0011`, `0013`, `0023`, `0025`
have `IF NOT EXISTS`/`ON CONFLICT` in places). The rest are bare `ALTER`/`CREATE`/`UPDATE`.

## Blast radius

Every future schema change. It is already the reason CLAUDE.md says "migrations are applied by hand
— see docs/01" and why `pnpm db:migrate` is listed as "still to come". The hand process works, but
it has no record, no ordering guarantee, and no way to tell whether a given environment is current.
Rebuilding or branching the database is the case where this stops being an inconvenience.

## Fix shape

One command, no code:

```bash
supabase migration repair --status applied 0008 0009 0010 0011 0012 0013 0014 0015 0016 0017 0018 0019 0020 0021 0022 0023 0024 0025 0026 0027 0028
```

That backfills the ledger to match reality and makes `push` usable again. **Verify each one really
was applied before marking it so** — marking an unapplied migration as applied is the one way to
turn this from an annoyance into data loss. The schema read confirms the columns and tables exist,
so the DDL ones are safe to repair; the `app_config` `UPDATE`s should be checked against the live
row first ([[app-config-live-state]] has it).

Not attempted here — it is a write against production.

## Related

- [[migration-0027-still-seeds-the-old-llm-cap]]
