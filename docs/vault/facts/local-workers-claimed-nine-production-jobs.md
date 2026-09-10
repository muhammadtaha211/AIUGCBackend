---
type: fact
status: verified
verified: 2026-09-10
method: "Supabase SQL editor against live (hyaqydcmwbnbaiqqufow), 2026-09-10: `select id, type, status, locked_by, locked_at, updated_at from jobs where locked_by like 'local:%' order by coalesce(locked_at, created_at) desc;` — nine rows. Then `usage_events` for the two failed lipsync job ids. The query recorded in state-of-play item 6 until today could not run: it selected `finished_at`, and `jobs` has no such column (packages/core/src/db/schema.ts:506-528, supabase/migrations/0000_init.sql:115-132)."
source: db
---

# Local workers claimed nine production jobs — and they were not in DRY_RUN

The check queue item 6 existed to run has been run. It found something smaller and different from
what it was looking for.

## The census

Nine rows, `locked_by like 'local:%'`, against the live database:

| n   | type                         | lane          | when (UTC)                         | outcome                                                                                    |
| --- | ---------------------------- | ------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| 3   | `synth_tts`                  | `local:light` | 2026-09-06 13:38–40                | succeeded                                                                                  |
| 1   | `render_video`               | `local:heavy` | 2026-09-06 04:55:26                | succeeded                                                                                  |
| 2   | `lipsync`                    | `local:heavy` | 2026-09-06 04:55:20                | succeeded                                                                                  |
| 2   | `lipsync`                    | `local:heavy` | 2026-09-06 04:49                   | **failed** — `lipsync failed: Insufficient credit. This operation requires 'api' credits.` |
| 2   | `billing_renewals`/`janitor` | `local:light` | 2026-08-26 23:54, 2026-08-27 00:45 | succeeded                                                                                  |

## The premise of the check was wrong, in the founder's favour

Queue item 6 was looking for **placeholder files wearing a success status** — jobs claimed by a
`DRY_RUN=1` worker that reported success without doing the work. That never happened.

`Insufficient credit. This operation requires 'api' credits` is a real HeyGen API refusal, and
`DRY_RUN` never calls HeyGen at all. So those workers were **live**, not dry-run. A different and
smaller thing did happen: live workers on the founder's desktop doing real, billable work against
production.

## Blast radius: nil

Every affected `video_renders` row is owned by a `role='admin'` user, business **Tavnit**. Nothing
customer-owned was touched. The three `synth_tts` jobs produced `audio_renders` rows that are all
`status='ready'` with real durations — 14080, 10800 and 14000 ms — one of them approved
2026-09-06 13:40:33.

## What the census does not cover

The filter is `locked_by like 'local:%'`. `aiugc work` does **not** use `WORKER_ID`: it hardcodes
`cli:heavy` / `cli:light` (`apps/cli/src/index.ts:920`, `:926`), and `apps/cli/.env` also carries
`DRY_RUN=1`. A CLI drain is therefore equally capable of eating a production job and is **excluded
by this filter**. Nothing has counted those rows. `locked_by not like 'hetzner:%'` is the filter
that would.

## The corrected query

The one recorded in state-of-play until today cannot run — `jobs` has no `finished_at`. Its real
columns are `id, type, status, payload, state, attempts, max_attempts, run_at, locked_at,
locked_by, idempotency_key, last_error, error_class, created_at, updated_at`. The working form:

```sql
select id, type, status, locked_by, locked_at, updated_at
from jobs
where locked_by like 'local:%'
order by coalesce(locked_at, created_at) desc;
```

`updated_at` is trustworthy for job rows specifically — there is no `ON UPDATE` trigger anywhere in
this schema, but the queue writes it explicitly in the claim `UPDATE`
(`packages/core/src/jobs/queue.ts:70`).

## Where the lane names come from

One write site: `packages/core/src/jobs/queue.ts:69`, `locked_by = ${opts.workerId}` inside the
claim `UPDATE`. The worker appends the lane — `apps/worker/src/index.ts:61` (`:heavy`) and `:68`
(`:light`) — to `WORKER_ID`, which defaults to `local`
(`packages/core/src/config.ts:16`) and is pinned `local` in the desktop `.env`. The box sets
`WORKER_ID=hetzner` (`docs/07-worker-box.md:184`, and `:189` explains why it must never be `local`).

## Related

- [[worker-death-tally-2026-08-20-to-25]] — the earlier `locked_by` value census (2026-08-26).
- [[heygen-motion-prompt-two-draws]] — the same 2026-09-06 HeyGen pair, from the other side.
- [[local-workers-compete-with-the-box-for-production-jobs]] — the mechanism, which this check does
  **not** close.
