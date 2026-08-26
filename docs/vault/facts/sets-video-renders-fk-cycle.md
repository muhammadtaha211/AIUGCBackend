---
type: fact
status: verified
verified: 2026-08-26
method: "select conrelid::regclass, confrelid::regclass, conname from pg_constraint where contype='f' and connamespace='public'::regnamespace"
source: db
---

# `sets` and `video_renders` are a foreign-key cycle

The two tables reference each other:

| Child           | Column              | Parent             | Constraint                                   |
| --------------- | ------------------- | ------------------ | -------------------------------------------- |
| `video_renders` | `set_id`            | `sets.id`          | `video_renders_set_id_sets_id_fk`            |
| `sets`          | `parent_variant_id` | `video_renders.id` | `sets_parent_variant_id_video_renders_id_fk` |

Both directions are real and intentional: a render belongs to a set, and a remix set records the
render it was derived from. Neither constraint is `DEFERRABLE`.

## What it constrains

**There is no table order that can bulk-load both tables.** Any process that inserts rows with
foreign-key checks active — `pg_restore --data-only`, a `psql` replay of a `pg_dump` data file, a
hand-written seeder, a fixture loader that walks tables in dependency order — will fail on
whichever of the two it reaches first, because the other does not exist yet. This is a property of
the schema, not of any particular tool.

The escape is to suspend FK enforcement for the loading session rather than to re-order:

```sql
SET session_replication_role = replica;   -- then load, then reset
```

Verified 2026-08-26 that Supabase's `postgres` role is permitted to set this despite
`pg_roles.rolsuper = false`:

```
psql "<session pooler url>" -c "SET session_replication_role = replica;" -c "SHOW session_replication_role;"
-- SET / replica / current_user = postgres, rolsuper = f
```

Note what that setting does **not** do: it suspends triggers and FK checks, never primary-key or
unique-index enforcement. A load that fails partway and is retried will still duplicate-key on
every row that already landed.

The other 27 foreign keys in `public` form a normal acyclic graph rooted at `users`, `personas`,
`structures`, `plans` and `jobs`. This pair is the only cycle.

Related: [[auth-users-insert-trigger]], which is the other thing that fires during a bulk load.
