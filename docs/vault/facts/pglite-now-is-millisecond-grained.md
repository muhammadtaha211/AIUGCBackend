---
type: fact
status: verified
verified: 2026-09-08
method: "Two scratch probes under packages/core/.work/ (gitignored, both deleted after the run), executed with apps/cli/node_modules/.bin/tsx. Probe A: bare PGlite, `create table s (id serial primary key, created_at timestamptz not null default now())`, 60 runs × 5 back-to-back `insert into s default values`, gaps read as `extract(epoch from created_at) * 1000000`. Result: {runs:60, gaps:240, ties:3, minGapUs:0}. Probe B: the real fixture path — createTestDb() from packages/core/test/helpers/pglite.ts, 40 runs × 5 addStructure() calls. Result: {runs:40, gaps:160, ties:0, minGapUs:1000}."
source: code
---

# PGlite's `now()` is millisecond-grained, so fast back-to-back inserts can share a `created_at`

Postgres `now()` is the transaction timestamp, and on real Postgres it carries microseconds. On
in-process PGlite it is quantised to whole milliseconds. Two rows inserted inside the same
millisecond therefore get **identical** `created_at`, and any ordering that uses that column as a
tie-break becomes non-deterministic.

Measured on this machine (Windows, `@electric-sql/pglite`, the version pinned in
`packages/core`):

| Probe                                           | Gaps | Ties  | Smallest gap |
| ----------------------------------------------- | ---- | ----- | ------------ |
| A — bare `insert … default values`              | 240  | **3** | 0 µs         |
| B — real `addStructure()` on a migrated test DB | 160  | 0     | 1000 µs      |

So ties are not hypothetical: probe A produced them on this same build. Probe B is clean only
because a drizzle insert with a jsonb column and `returning` takes longer than one millisecond
here — an accident of machine speed, not a guarantee. A faster box collides.

## Consequence

A test that asserts an order derived from `created_at` must **stamp** the timestamps it means
rather than inherit them from insert timing. `packages/core/test/structure-rotation.test.ts`
does this in `seedBank()` — each structure gets `Date.UTC(2026, 0, 1, 0, 0, i)` after insert —
because `structures.created_at` is the rotation's tie-break
([[0031-the-structure-bank-rotates-least-recently-used-per-business]]).

Production is unaffected: Supabase Postgres keeps microseconds, and structures are seeded one
network round trip apart by `seedStructures`.
