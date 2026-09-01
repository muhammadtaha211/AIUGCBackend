---
type: defect
status: verified
verified: 2026-08-31
method: "code read: packages/core/src/pipelines/credits.ts:54-75 (balance < cost is the only check), packages/core/src/pricing.ts:24-36 (creditCostsSchema is all bare z.number()) and :68-77 (settle); packages/core/test/pricing.test.ts:46-55 and every debitRender test checked for sign coverage — none exists"
source: code
---

# `debitRender` accepts a non-positive cost — a mistyped `credit_costs` row makes renders free, or turns debits into grants

`creditCostsSchema` (`packages/core/src/pricing.ts:24-36`) is bare `z.number()` on every key — no
`.positive()`, no `.nonnegative()`. `debitRender` (`credits.ts:54-75`) guards only
`balance < cost`. Neither layer asserts `cost > 0`, so a mistyped `credit_costs` config row flows
through unchallenged. Two grades, because `settle` (`pricing.ts:68-77`) clamps differently per
format:

- **One mistyped key → free renders.** The floor-exempt flats — `quoteServiceASteps` and
  `quoteAssemblyRemix` settle with minimum 0 (`pricing.ts:151, :162`) — clamp a negative or zero
  flat to a charge of **0**. `assertAffordable` passes at any balance, `balance < 0` is false, and
  `debitRender` writes a delta-0 row: every steps render (the live self-serve format) becomes free
  for a zero-balance customer.
- **Floor mistyped too → debits become grants.** On the full/B formats the charge is
  `ceil(max(minimum, subtotal))`, so going negative needs the subtotal **and** the matching
  `*_minimum_credits` key below zero. Then `balance < cost` is trivially false and the insert is
  `delta: -cost` — a **positive** row. Each render grows the balance.

## Reachability

SQL-only, not customer-reachable: nothing in `apps/web`, `apps/admin`, or `apps/cli` writes the
`credit_costs` row (the CLI's one `app_config` write is calibrate-wps into `words_per_second`,
`apps/cli/src/index.ts:420-438`); the row moves only via the SQL editor or a migration. The
trigger is a founder typo, not an attacker.

## Not fixed, and no test would catch it today

`pricing.test.ts:46-55` checks key shape and accepts fractional values, and its fixtures (`:18-44`)
do feed zero rates and floors — but never a combination that produces a non-positive CHARGE, and
nothing anywhere asserts sign rejection. Every direct `debitRender` test (`credit-ledger.test.ts`,
`billing.test.ts`) uses positive costs.

## Fix shape

Three small pieces: `.positive()` on the rate and flat keys (the two `*_minimum_credits` floors are
documented "0 = inactive" at `pricing.ts:21-22`, so they get `.nonnegative()`); an explicit
`cost > 0` assertion in `debitRender` (deciding first whether a deliberately-zero flat should mean
"skip the ledger row" or be refused); a test for each. Until then the schema's own comment — rates
tunable without a deploy — is exactly what makes the typo reachable.

## Related

- [[no-self-serve-credit-grant-path]] — the wall this is the one crack in
