---
type: defect
status: verified
verified: 2026-09-11
method: "Founder-run, reported in chat and recorded in scripts/verify-migration-ledger.sql:458-465. Pre-flight `npx -y supabase migration list` showed 36 rows 0000-0035 with NO 0036 row and no gaps; `apps/cli/node_modules/.bin/tsx packages/core/scripts/verify-daily-caps.ts` returned PASS on all seven values BEFORE `db push` ran. Migration literals read from supabase/migrations/0036_daily_caps_runaway_detector.sql at 2828fd3."
source: founder
---

# `daily_caps` was hand-edited in the SQL editor before 0036 recorded it

Migration `0036_daily_caps_runaway_detector.sql` was pushed to production on 2026-09-11. **It was a
DATA no-op.** The seven values it sets were already live when it ran.

The proof is that two things were true at the same moment, both measured the same day:

- `verify-daily-caps.ts` returned **PASS on all seven values, before the push**, with no
  stripped-key warning.
- The ledger held **no `0036` row** — 36 rows, `0000`–`0035`, no gaps.

A value that is live while its migration is unrecorded was not put there by a migration. The caps
were changed **by hand in the Supabase SQL editor**, at a time nobody recorded.

## Why this is a defect and not a shrug

The values are correct. The **lineage** was not, and lineage is the whole point:

- It is exactly the drift `0022`'s header exists to prevent — the precedent where live `gpu_seconds`
  had drifted to a hand-set, recorded-nowhere `36000`.
- It is exactly what `0040`'s own "Rules for whoever changes the values" told whoever changed them
  not to do ([[0040-the-hard-ceiling-moves-to-the-providers]]).
- A rebuilt database replays migrations. Until `0036` landed, a rebuild would have come up on the
  **old** caps — `llm_tokens` 2,000,000 platform / 1,500,000 per account — with nothing anywhere
  saying the live project disagreed. The `docs/08` rebuild recipe would have silently produced a
  differently-budgeted product.

The push changed no value. What it changed is that the lineage now records them.

## The values, and the rule behind them

Live and ledger-recorded since 2026-09-11:

| key                       | value     |
| ------------------------- | --------- |
| `images`                  | 400       |
| `tts_chars`               | 400,000   |
| `llm_tokens`              | 8,000,000 |
| `gpu_seconds`             | 32,000    |
| `per_account.tts_chars`   | 25,000    |
| `per_account.llm_tokens`  | 500,000   |
| `per_account.gpu_seconds` | 2,000     |

**The 16× rule — REASONED, not measured.** Every platform cap that has a per-account pair is exactly
16× it, so it takes sixteen simultaneously-maxed accounts to trip a breaker whose failure mode is
parking jobs forever. `images` has no pair and is raised 4× instead, only so it does not become the
effective ceiling on its own. `per_account.llm_tokens` is the only per-account value that moved
(1,500,000 → 500,000) because [[0040-the-hard-ceiling-moves-to-the-providers]] named it the outlier.

## How this was caught, and the check that catches it next time

Not by the push — by running the read-back **before** it. `verify-daily-caps.ts` reads the row and
parses it through `dailyCapsSchema` the way the product does, which is the only way to see a value
the schema silently strips. Running it before a migration as well as after is what turned "the push
worked" into "the push was a no-op, so someone else already did this."

**Do this on every future `app_config` migration:** read back before pushing, not only after. A PASS
before the push is not reassurance — it is evidence the ledger is behind.

## Not established

- **When** the hand edit happened, or by whom. `app_config` has no `ON UPDATE` trigger, so
  `updated_at` is unreliable; `xmin` ordering was not consulted.
- Whether any other `app_config` key was hand-edited in the same sitting. Only `daily_caps` was
  read back.

## Related

- [[0040-the-hard-ceiling-moves-to-the-providers]] — the decision 0036 implements, and the rules the
  hand edit broke.
- [[token-and-money-budgets]] — the caps table, updated to these values.
- [[migration-0027-still-seeds-the-old-llm-cap]] — 0027 still seeds 1,500,000 and runs _before_
  0036, so replay lands correctly; that is deliberate, not a second defect.
- [[per-account-cap-blind-spot]] — why no `per_account.images` key was added.
- [[events-table-is-empty]] — its `platform_budget_tripped` section quotes a utilisation percentage
  against the **old** 2,000,000 cap; corrected there on 2026-09-11.
