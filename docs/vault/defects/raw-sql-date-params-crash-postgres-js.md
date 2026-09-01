---
type: defect
status: verified
verified: 2026-09-01
method: "packages/core/.work/repro-date-param.ts — the ahead-query shape from getJobProgress run through getDb() against the project DB: the Date param throws ERR_INVALID_ARG_TYPE at postgres/src/bytes.js:22, the .toISOString() form returns a row"
source: code
---

# A JS Date in a raw `sql` param crashes postgres-js — and PGlite tests cannot see it

## The incident

2026-09-01, deployed Service A wizard, render step: every poll of
`GET /api/renders/[id]` returned 500 while the render job sat `queued`.
Production log, complete — no stack, because `coreErrorResponse` logged the bare
error object and the deployed log surface dropped its stack (fixed in the same
change: stack and cause now go into the message string). Same night as
[[computed-path-reads-are-invisible-to-vercel-tracing]]'s ENOENT; that one was
easy precisely because it carried a path:

```
api route failed [TypeError: The "string" argument must be of type string or an
instance of Buffer or ArrayBuffer. Received an instance of Date] { code: 'ERR_INVALID_ARG_TYPE' }
```

## Mechanism — three layers, each fine alone

1. `getJobProgress` (`packages/core/src/jobs/queue.ts`) interpolated `${job.runAt}` —
   a `Date`, because drizzle returns timestamptz columns as JS Dates — into a **raw**
   `sql` template for the "ahead of you in the lane" count. Raw-sql params skip
   drizzle's column mappers (noop encoder), so the Date reached the driver as a Date.
2. postgres-js infers a Date param as oid 1184 and would serialize it itself
   (`postgres/src/types.js:31`) — but **drizzle-orm's postgres-js adapter replaces the
   serializers for 1082/1083/1114/1184 with an identity function**
   (`drizzle-orm/postgres-js/driver.js`, `construct()`), because typed queries are
   already mapped before they reach the driver.
3. The wire encoder then measures the param with `Buffer.byteLength(x)`
   (`postgres/src/connection.js:964` → `bytes.js:22`) — TypeError.

So: the ONLY values that can trip this are Dates interpolated into raw `sql`
templates, and the sweep on 2026-09-01 found exactly one in the repo —
`${job.runAt}` in the ahead query. Every other raw interpolation is a string,
number, or sql fragment.

## Why the suite was green and prod was down

The test harness is PGlite; drizzle's PGlite driver serializes Date params
correctly. `test/jobs.test.ts` even exercises the exact buggy query with a queued
job — and passes. **Driver-level param bugs are invisible to the PGlite harness.**
The regression test added with the fix pins the invariant one layer up instead:
it wraps `db.execute` and asserts no param is `instanceof Date`
("getJobProgress hands db.execute no raw Date params").

## Why it looked deploy-only (it is not)

The throw is deterministic but only reachable while the poll catches the job row
still `queued` (the ahead query runs only then, and only when the caller passes
`aheadOfTypes` — the render poll and the analysis poll both do). Why it never
appeared locally is **plausible but unconfirmed** (corrected 2026-09-01): the
"local worker claims jobs near-instantly, so polls landed after the claim"
explanation was asserted, not measured — the desktop worker was only up briefly
around 2026-08-27 and no local wizard run has been deliberately tested against
it since, so the explanation holds at most for that narrow window. On the
deployed setup the wizard's first poll always landed inside the queued window —
and each retry backoff reopened it.

## Fixed

Same change as this note: `${job.runAt.toISOString()}` at the interpolation site
(the boundary where an app value enters a raw-SQL param is the right layer — the
column stays `mode: "date"` for its many typed consumers), plus the
`db.execute`-param regression test.

## The rule this leaves behind

Never interpolate a `Date` into a raw ``sql`...` `` template — convert to
ISO string at the interpolation. Drizzle disables the driver's own Date
serialization, and no test on the PGlite harness will catch the mistake.
