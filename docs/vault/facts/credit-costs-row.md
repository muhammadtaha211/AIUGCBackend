---
type: fact
status: verified
verified: 2026-08-23
method: "select value from app_config where key='credit_costs'; then grep -rn <each key> packages/core/src apps/*/src"
source: db
---

# The `credit_costs` row, decoded

```json
{
  "a_assembly_flat": 3,
  "a_demo_per_second": 0.15,
  "a_outro_per_second": 1,
  "a_minimum_credits": 5,
  "b_per_second": 1,
  "b_minimum_credits": 0,
  "a_ending_reroll_per_second": 1,
  "a_remix_assembly_credits": 2,
  "a_steps_credits": 5
}
```

**No unread keys** — all nine are read by `packages/core/src/pricing.ts` and nothing else touches
them (grepped one key at a time across `packages/core/src`, `apps/*/src`, `packages/remotion/src`).

**But two are unreachable in production.** `a_ending_reroll_per_second` is priced only by
`quoteEndingReroll`, whose sole caller is `quoteRerollForRender`
(`packages/core/src/pipelines/sets.ts:533`) — which has **no callers at all** outside its own
export. `a_remix_assembly_credits` is priced only by `quoteAssemblyRemix`, called from nothing but
`packages/core/test/pricing.test.ts`. Tuning either key today changes nothing a customer can
reach.

| key                          | priced by            | what it buys                                           |
| ---------------------------- | -------------------- | ------------------------------------------------------ |
| `a_assembly_flat`            | `pricing.ts:98`      | full-format Service A, per render                      |
| `a_demo_per_second`          | `pricing.ts:99-103`  | full-format Service A, × the **uploaded** demo seconds |
| `a_outro_per_second`         | `pricing.ts:104-108` | avatar ending only; 0 when the ending is a freeze      |
| `a_minimum_credits`          | `pricing.ts:110`     | floor on the full-format quote                         |
| `b_per_second`               | `pricing.ts:118`     | Service B, × the approved VO's measured seconds        |
| `b_minimum_credits`          | `pricing.ts:119`     | floor on Service B — `0`, i.e. inactive                |
| `a_ending_reroll_per_second` | `pricing.ts:129-136` | ending re-roll; floor-exempt                           |
| `a_remix_assembly_credits`   | `pricing.ts:162`     | hook / hook-line / rect remix; floor-exempt            |
| `a_steps_credits`            | `pricing.ts:151`     | **the whole steps-format price**; floor-exempt         |

## A steps render is a flat 5 credits

`quoteServiceASteps` (`packages/core/src/pricing.ts:150-152`) returns one component and passes `0`
as the floor, so demo length changes nothing. That is deliberate and the comment above it says why:
the full-format quote bills the **uploaded** duration, so a 3-minute recording would price ~31
credits for a ~20s output.

The debit is written at `packages/core/src/pipelines/sets.ts:240-247`, inside `createSet`'s per-cell
loop — one ledger row per render, never per set, because refunds key on the render id. The wizard
only ever sends a 1×1 grid, so per-set and per-render coincide today. A multi-cell steps grid would
be 5×N.

**Observed, not just derived.** Joining `credit_ledger.ref_id` to `video_renders`, all ten
`debit_render` rows in production resolve, and the split is exactly what the code predicts:

| when                        | delta              | `params->>'format'`                   |
| --------------------------- | ------------------ | ------------------------------------- |
| 2026-08-06 → 2026-08-09 (4) | −10, −29, −23, −23 | `(none)` — full format, length-priced |
| 2026-08-18 → 2026-08-22 (6) | **−5 every time**  | `steps`                               |

Six steps renders, six −5 debits, no exceptions. The length-priced rows above them are the reason
the flat exists.

## Three traps

**`creditCostsSchema` is a plain `z.object`** (`packages/core/src/pricing.ts:24-36`) — strip mode,
not strict. Two things follow, and both are commonly stated backwards:

- **Stripping happens on READ, not on write.** Nothing validates writes to `app_config` at all. A
  mistyped or misplaced key survives in the row forever; the code simply never sees it.
- **A plain `z.object` strips; a `.strict()` object would throw.** "Closed object, silently
  stripped" cannot both be true. What _does_ throw is the reverse case — every key is required, so
  removing one makes the parse fail and every price read in the product errors.

**This has already bitten.** `supabase/migrations/0028_split_legibility_gate.sql` (rationale at
`:26-30`, the strip at `:63-67`) exists
partly to strip `a_analysis_legibility_threshold` out of this exact row — a non-price key that had
been written into `credit_costs` and that nothing read there. It landed silently precisely because
the schema strips.

Verify with a read-back, never with "the UPDATE succeeded". Same hazard as `daily_caps.per_account`,
see [[token-and-money-budgets]].

**Before proposing `.strict()` as the fix, note that `pricing.ts` is deliberately client-bundled**
(its own header comment at `pricing.ts:6-9`, and `config.ts:63`). That is why `creditCostsSchema`
lives there rather than in `config.ts`, and it constrains what the module may import.

**Admin accounts pay nothing.** `packages/core/src/pipelines/sets.ts:745` (re-read 2026-09-11;
was `:483`) sets
`chargeable = !(await isAdminOwned(db, businessId))`, and `sets.ts:240` skips the debit when
`chargeable` is false. Flipping a customer account to admin would zero its render debits and
corrupt the ledger.

`isAdminOwned` is consulted on a second, unrelated path too — `apps/web/src/lib/wizard-gate.ts:24`,
which gates the wizard itself — so the blast radius of a role flip is wider than the ledger.

**A hand-edit that drops a key breaks every format at once.** `getConfigValue`
(`appConfig.ts:8-10`) throws when the _row_ is missing; the schema parse throws when a _key_ is
missing. Both happen inside `quoteContext` (`sets.ts:484`), which every quote path shares — steps,
full, silent and Service B all stop together. Given that production rows are edited by hand in the
SQL editor, that is the failure to expect.

## Related

- [[credit-ledger-is-keyed-to-the-account]] — why a per-business sum is not a balance
- [[app-config-live-state]]
