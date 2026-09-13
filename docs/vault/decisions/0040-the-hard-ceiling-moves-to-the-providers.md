---
type: decision
status: verified
verified: 2026-09-10
method: 'Founder decision in chat, 2026-09-10. Live `daily_caps` read the same day: {"images":100,"tts_chars":100000,"llm_tokens":2000000,"gpu_seconds":7200,"per_account":{"tts_chars":25000,"llm_tokens":1500000,"gpu_seconds":2000}}. NOTHING in app_config was changed. Code read at 91e4470: packages/core/src/budget.ts:40-47 (platform trip -> events row + BudgetError), :107-111 (AccountBudgetError), :51-57 (why one parks and the other does not); packages/core/src/jobs/errors.ts:36-43 (BudgetError parks, default resume +1h); packages/core/src/pipelines/janitor.ts:25 (MAX_BUDGET_PARK_MS = 6h) and :54-68 (findOverparkedRenders); packages/core/src/config.ts:39-54 (dailyCapsSchema, plain z.object).'
source: founder
---

# 0040 — The caps stay; the hard ceiling moves to the providers

Nothing in `app_config` changed. This note exists so that when the values do change, they change
for the right reason.

## ACTIONED 2026-09-11 — the LLM-pair finding below is now implemented

The values did change, and this note's §"The LLM pair is the wrong shape" is the reason they did.
Founder decision 2026-09-10, written as
`supabase/migrations/0036_daily_caps_runaway_detector.sql` and **applied to production on
2026-09-11** on the founder's explicit instruction for that one push — ledger 37 rows, `0000`–`0036`,
no gaps, no repair needed; post-apply read-back through `dailyCapsSchema` returned all seven values
`ok`. Proof in `scripts/verify-migration-ledger.sql` §RESULTS.

**The push was a DATA no-op, and that is the finding.** Measured the same day, immediately before it:
the live row already held all seven target values while the ledger had no `0036` row — so the caps
had been moved **by hand in the SQL editor**, which is precisely the drift `0022`'s header exists to
prevent and precisely what the "Rules for whoever changes the values" section below told whoever
changed them not to do. The migration moved no value; it moved the **lineage**, so a rebuilt database
now reproduces these caps instead of coming up on the old ones.

|               | platform (was → now)      | per_account (was → now) |
| ------------- | ------------------------- | ----------------------- |
| `tts_chars`   | 100,000 → **400,000**     | 25,000 → 25,000         |
| `llm_tokens`  | 2,000,000 → **8,000,000** | 1,500,000 → **500,000** |
| `gpu_seconds` | 7,200 → **32,000**        | 2,000 → 2,000           |
| `images`      | 100 → **400**             | none, and none added    |

Exactly one per-account value moved — `llm_tokens`, the outlier this note named. Every platform cap
is now exactly **16x** its per-account pair, so "accounts needed to trip it" is 16 at every unit
instead of 4 / 3.6 / **1.33**. `images` has no per-account pair and is not covered by the rule.

The three rules this note set for whoever changed the values were all followed: it is a migration
and not a hand `UPDATE`; the read-back goes through the zod schema
(`packages/core/scripts/verify-daily-caps.ts`, plus `packages/core/test/daily-caps.test.ts` against
PGlite); and the struck-through third rule stayed struck — `0027`'s literal was **not** retro-edited
a second time, because `0036` runs after it and a rebuild replays to the new value by construction.

The calibration in `0036`'s header is labelled REASONED and rests on the same two stale figures this
note flags below. Nothing was re-measured; the migration says so in its own header.

## The decision

**The in-app caps stay where they are. The hard ceiling moves to the providers** — prepaid balances
and organisation spend limits at Anthropic, ElevenLabs and HeyGen, set at whatever a very bad day
looks like.

The proof that it works is in this session's own data: HeyGen's
`Insufficient credit. This operation requires 'api' credits` stopped a runaway **loudly and
immediately, with no parked job** ([[local-workers-claimed-nine-production-jobs]]). It failed in the
direction a ceiling should fail.

A provider ceiling also catches the one thing an in-app cap **structurally cannot**: a stolen
`ANTHROPIC_API_KEY` used **outside** the app, where no `usage_events` row is ever written and
`assertBudget` never runs.

The in-app platform cap is then demoted to a **high circuit breaker** — raised until legitimate load
cannot reach it. At that point the parking behaviour below stops mattering and needs no code change,
which is the whole appeal of this answer.

**The per-account cap keeps doing the real work**, because it already fails correctly:
`AccountBudgetError` is thrown before anything is enqueued and surfaces as an immediate Hebrew
rejection (`budget.ts:107-111`, and `:51-57` explains the choice).

## Why the platform cap should not be the ceiling

### The LLM pair is the wrong shape

| cap           | platform  | per_account | accounts to trip |
| ------------- | --------- | ----------- | ---------------- |
| `tts_chars`   | 100,000   | 25,000      | 4                |
| `gpu_seconds` | 7,200     | 2,000       | 3.6              |
| `llm_tokens`  | 2,000,000 | 1,500,000   | **1.33**         |

One account can legitimately consume **75%** of the platform's entire daily LLM budget, and **two**
ordinary heavy users trip it. LLM is the outlier and the number to change.

For calibration, from [[token-and-money-budgets]] §"Last measured" — and **stated more carefully
than it usually is**: the largest platform window ever recorded is **899,599 tokens, 45.0% of the
cap (2026-08-22)**; the last measured window is 192,290 / 9.6% (2026-08-23 03:38 UTC), which is a
snapshot and **not** a maximum. So one account at 1.5M/day is roughly **1.7× the largest 24h the
whole system has ever had** — still the wrong shape, but not the 8× that quoting the smaller number
implies. Both figures are `verified: 2026-08-23` and **18 days stale**, past CLAUDE.md's 14-day
rule; re-measure before acting on them.

### The platform cap degrades the product instead of alerting

`assertBudget` throws `BudgetError` (`budget.ts:46`), which **parks** the job — back to `queued`
with `run_at` pushed, default +1h (`jobs/errors.ts:36-43`), no attempt burned.
`docs/05-billing.md:199-200` already states the consequence, in the course of explaining why the
account cap deliberately does the opposite:

> a parked job leaves the wizard spinning forever, because `useJobPoll` only gives up after
> consecutive _failures_ and a parked job never fails.

The customer sees the honest queue copy — a true sentence that will never come true.

### The 6h valve is render-only, and that is now measured

`MAX_BUDGET_PARK_MS` (6h, `janitor.ts:25`) fails and refunds an over-parked render. **It cannot
reach anything else.** `findOverparkedRenders` (`janitor.ts:54-68`) is gated on
`jobs.type IN ('render_video','lipsync')` **and** an inner join to `video_renders` on
`payload->>'videoRenderId'`, and it is the **only** reader of `jobs.error_class = 'budget'` in the
tree.

So a budget-parked `synth_tts` has **no exit at all**: it parks at `tts.ts:234`, _after_ the row is
set `status: "generating"` at `:222-225`, and then re-queues at +1h forever with `audio_renders`
stuck on `generating`. The same is true of every other non-render parker — `composites.ts:105`,
`copy.ts:641`, `demo-analysis.ts:668` and `:990`, `demo-step-plans.ts:1160`, `tts.ts:182`.

(The brief for this session flagged this as unverified and worth checking. It has now been checked,
and the answer is the bad one.)

### `platform_budget_tripped` writes to a table nothing reads

The event row is written at `budget.ts:41-45`, once per **refused attempt**, immediately before the
throw. Then nothing happens:

- `events` has never held a single row ([[events-table-is-empty]]).
- **There is no admin events feed.** `apps/admin` has exactly four surfaces — feedback, hooks,
  personas, users — and nothing anywhere queries `events`.
- The worker's Sentry reporting fires only on **terminal** statuses (`dead`, `failed`)
  ([[0037-the-worker-reports-to-sentry-the-web-apps-do-not]]), and a parked job is not terminal.

So today a platform trip is discovered by **a customer complaining about a stuck wizard**.

## Rules for whoever changes the values

Restated here so they are not missed at the moment they matter:

- **Do it as a MIGRATION, not a hand `UPDATE`.** The precedent is 0022: the live `gpu_seconds` had
  drifted to a hand-set, recorded-nowhere **36,000**, which is why the value now lives in a
  migration (`supabase/migrations/0022_gpu_caps_account_first.sql:18-19`, restated at
  `docs/05-billing.md:204-205`). There is no vault note for that drift — those two paths are the
  record.
- **Verify with a read-back, never with "the `UPDATE` succeeded."** Nothing validates writes to
  `app_config` — the only write in the entire repo is `calibrate.ts:71-76`, and it touches
  `words_per_second` only. `dailyCapsSchema` is a plain `z.object` at both levels
  (`config.ts:39-54`), so it is **strip mode**: an unknown or mistyped key is silently dropped on
  read and the cap never moves.
- ~~`per_account.llm_tokens` already diverges from migration 0027 and a migration is owed
  regardless.~~ **This is no longer true and must not be repeated.**
  `supabase/migrations/0027_llm_caps_account_first.sql:24` seeds `'1500000'`, which matches live
  exactly. It was retro-edited on 2026-08-26 in `f9bb5a7`
  ([[migration-0027-still-seeds-the-old-llm-cap]] is FIXED-sectioned). Two traps remain in the
  sources: that defect note's body still describes the pre-fix 500,000 divergence at its lines 41
  and 58, and 0027's own comment at `:12-13` still explains a 25% sizing that its line 24 no longer
  implements.

## Deferred, not open

**Which non-credit-debited surfaces should cost credits** — deferred by the founder to the payments
conversation. Recorded so it is not re-raised as an open question in the meantime.

The surfaces:

- **`analyze_demo`** — not debited, and automatic exactly once on every demo reaching `ready`
  (`demos.ts:180-190`, idempotency key `analyze:${demoId}`). Cost per clean run is **₪2.04–₪2.56,
  mean ₪2.28 — say ~₪2.30**, over 8–9 Claude calls; the ₪4.35 figure that gets quoted is one job of
  six, 2.1× a clean run, and [[analyze-demo-cost]] attributes that premium to a worker crash and a
  lease sweep, not to analysis. Never quote a single figure without the range.
- **Copy generation**, including `plan_demo_steps` retry rounds.
- **Audio previews** — free, capped at ~~20/24h~~ **50/24h** (`audio_preview_daily_limit`, an
  `app_config` row, not a code constant), counting **attempts** in `audio_renders` over 24h and keyed
  on the **owner account** rather than the business, because business creation is self-serve and
  unlimited. **AMENDED 2026-09-13**: the cap moved to 50 —
  `supabase/migrations/0038_audio_preview_limit_50.sql`, written and **applied to production** that
  same day, read back through the code's own parse as the number 50. The credit question this section defers
  was also answered for this one surface: **charging credits per preview was considered and
  rejected**, reasoned not measured. Both in
  [[0047-audio-preview-attempt-cap-moves-to-50]]. The other two surfaces stay deferred.

The founder's stated intent is to go through every one of them at payments time, and will probably
charge for `analyze_demo`.

## Related

- [[token-and-money-budgets]] — the cap table and the read-back rule.
- [[per-account-cap-blind-spot]] — the per-account cap cannot see 36% of recorded LLM spend.
- [[events-table-is-empty]] — why the event trail is not an alerting mechanism.
- [[analyze-demo-cost]] — the range, and why the outlier is an outlier.
- [[no-self-serve-credit-grant-path]] — the other half of the billing picture.
- [[0047-audio-preview-attempt-cap-moves-to-50]] — the preview cap is 50, and previews stay free.
