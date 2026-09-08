---
type: decision
status: verified
verified: 2026-09-08
method: "founder brief in chat, 2026-09-08, specifying the query (active structures LEFT JOINed to max(scripts.created_at) over this business's kind='b_script' rows, ORDER BY that ASC NULLS FIRST then structures.created_at ASC, LIMIT 1). Implementation verified by packages/core/test/structure-rotation.test.ts — 6 tests, PGlite, DRY_RUN — run with `pnpm --filter @aiugc/core exec vitest run --fileParallelism=false test/structure-rotation.test.ts`; a mutation run with `nulls first` removed fails 5 of the 6."
source: founder
---

# 0031 — The structure bank rotates least-recently-used, per business

The web wizard's script step picked a structure at random:

```ts
const structure = activeStructures[Math.floor(Math.random() * activeStructures.length)];
```

With the five seeded skeletons ([[0028-scripts-end-on-a-closer-from-a-curated-bank]]) a customer
who regenerated drew the same skeleton again about one time in five, and the same one three times
running about one regenerate in twenty-five. Variants are the product; a regenerate that returns
the same skeleton is a wasted Claude call and a customer who thinks the generator is stuck.

## Decided

Rotate. `pickStructureForBusiness(db, businessId)` in `packages/core/src/pipelines/copy.ts`
returns the active structure this business's `b_script` rows have gone longest without — one
query, no state column:

```sql
select structures.id from structures
  left join scripts
    on scripts.structure_id = structures.id
   and scripts.business_id = $1
   and scripts.kind = 'b_script'
 where structures.active = true
 group by structures.id
 order by max(scripts.created_at) asc nulls first, structures.created_at asc
 limit 1
```

Five active structures therefore give five consecutive generations five different skeletons, and
the sixth wraps to the first.

Three details are load-bearing:

- **`NULLS FIRST` is explicit.** Postgres defaults to `NULLS LAST` on `ASC`, which would rank a
  never-used structure _behind_ every used one — the first generation would then repeat itself
  forever. Removing those two words fails 5 of the 6 tests.
- **`business_id` and `kind` sit in the JOIN, not the WHERE.** In the WHERE they would filter away
  the null-extended rows and turn the left join into an inner one, so a business would only ever
  rotate among structures it had already used.
- **The tie-break is `structures.created_at ASC`**, so the rotation's order is the bank's own
  order and a never-used structure joins the queue behind the never-used ones seeded before it.
  A structure seeded into an _exhausted_ bank is picked on the very next generation.

## Where it is not

Not in `pipelines/bank.ts`: that module adds, normalises and seeds bank inventory. This reads one
business's generation history to choose from that inventory, which is `copy.ts`'s subject — and
`copy.ts` already imported both tables, so the picker cost no new imports.

Not in the CLI. `aiugc copy b-script --structure <id>` still takes an explicit id: the founder
picks a skeleton deliberately when driving the pipeline by hand.

Not in the database. No `last_used_at` column, no cursor row — `scripts.created_at` already
records every use, so the rotation has nothing to keep in sync and nothing to migrate.

## Rejected

- **Random-but-not-the-last-one.** Cheaper, but only removes the immediate repeat; with five
  skeletons the second-order repeats stay.
- **A `last_used_at` column on `structures`.** Global, not per business — one customer's
  generation would move another's queue — and it needs a write on every generation.
- **Shuffling a per-business cursor.** State to store, state to invalidate when the bank changes.

## Known edge

The picker counts every `b_script` row with that `structure_id`, and `updateScriptText` copies
`structure_id` onto the new row it inserts for a user edit. So an edit counts as another use of
the structure it edits. In the wizard that is always the script just generated
(`apps/web/src/components/b-wizard/step-script.tsx` — `saveAndContinue` posts to the id `generate`
just set), whose structure is already last in the queue, so the order does not move; the test
`is not disturbed by a user edit of the script just generated` pins exactly that. Editing an
_older_ script would move its structure to the back of the queue. No path in the product does
that today. If one ever does, the fix is one clause — `and scripts.user_edited = false` in the
join.

## Touched

- `packages/core/src/pipelines/copy.ts` — `pickStructureForBusiness`.
- `apps/web/src/app/api/businesses/[businessId]/scripts/route.ts` — the random pick replaced; the
  500 (`אין כרגע תבנית תסריט זמינה — נסו שוב מאוחר יותר.`) still fires when the bank has no active
  structure.
- `packages/core/test/structure-rotation.test.ts` — new. Its `seedBank()` stamps
  `structures.created_at` rather than inheriting it from insert timing, because PGlite's `now()`
  is only millisecond-grained ([[pglite-now-is-millisecond-grained]]) and this bank's order is the
  rotation's tie-break.
- `docs/01-schema.md` — the `structures` bullet now says the wizard rotates rather than randomises.
