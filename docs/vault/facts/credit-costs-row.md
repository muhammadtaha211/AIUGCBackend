---
type: fact
status: verified
verified: 2026-09-17
method: "Re-measured 2026-09-17 right after migration 0043 was pushed to production: packages/core/scripts/verify-credit-costs.ts (read-only, 18 checks, PASS) read the row through getConfigValue(db,'credit_costs',creditCostsSchema) — the exact call every quote path makes — and asserted all ten rates, that the row holds exactly the ten known keys with nothing stray, that every value is jsonb_typeof number, the two steps quotes (25 and 45) and both sides of the new Service B floor. A before-read the same day, through the same call (packages/core/.work/preflight-0043.ts), returned the 0039 row with all four of 0043's guards matching — so the move is measured at both ends, not inferred from an exit code. Key reachability is the older measurement: grep -rn <each key> packages/core/src apps/*/src packages/remotion/src, 2026-08-23, plus the tenth key added 2026-09-13."
source: db
---

# The `credit_costs` row, decoded

```json
{
  "a_assembly_flat": 15,
  "a_demo_per_second": 0.75,
  "a_outro_per_second": 5,
  "a_minimum_credits": 25,
  "b_per_second": 5,
  "b_minimum_credits": 75,
  "a_ending_reroll_per_second": 5,
  "a_remix_assembly_credits": 10,
  "a_steps_credits": 25,
  "a_demo_analysis_credits": 20
}
```

> **Changed 2026-09-17, applied and read back the same day.** Every rate above was written by
> `supabase/migrations/0043_pricing_credit_unit.sql`
> ([[0051-the-credit-unit-and-the-three-credit-only-plans]]), pushed to production on the founder's
> explicit instruction for that one push. A credit is now **₪0.15** on the base tier; the
> "1 credit = 1 second" rule is retired. **Seven of the ten rates are a straight ×5. Three are
> not**, and those three are the change rather than the conversion: `b_minimum_credits` **0 → 75**
> (a Service B floor where there was none — it binds under 15s), `a_steps_credits` **3 → 25**
> (×8.33) and `a_demo_analysis_credits` **2 → 20** (×10). Measured against `b_per_second`, which is
> ×5: a steps render went from 3 seconds-of-Service-B to 5 (+67%) and the analysis from 2 to 4
> (+100%) — a real-terms price rise on the two live Service A charges.
>
> Both of 0043's statements are guarded, so the row was read at **both** ends: before, through
> `getConfigValue` (`packages/core/.work/preflight-0043.ts`), returning the 0039 row with all four
> guards matching; after, through the same call, returning the block above with all ten values
> `jsonb_typeof` = `number` and nothing stray. Proof is
> `packages/core/scripts/verify-credit-costs.ts` (read-only, **18 checks**, PASS) and
> `scripts/verify-migration-ledger.sql`. Ledger **44 rows, 0000–0043**, recorded by `db push`
> itself — ninth time running with no `migration repair`. No restart or deploy was needed:
> `getConfigValue` reads the row on every quote. Re-read at any time with
> `select value from app_config where key = 'credit_costs';`
>
> **The previous era, for the record:** 0039 (2026-09-13) split the steps flat 5 → 3 + 2
> ([[0048-the-demo-analysis-is-charged-once-per-demo]]); 0017 seeded the eight rates before that.
> 0048's mechanism is untouched by 0043 — only its numbers moved.

**No unread keys** — all ten are read by `packages/core/src/pricing.ts` and nothing else touches
them (grepped one key at a time across `packages/core/src`, `apps/*/src`, `packages/remotion/src`;
the tenth was added 2026-09-13 and is read at `quoteServiceASteps`).

**But two are unreachable in production.** `a_ending_reroll_per_second` is priced only by
`quoteEndingReroll`, whose sole caller is `quoteRerollForRender`
(`packages/core/src/pipelines/sets.ts:898`, re-measured 2026-09-13; it has been cited at `:533`)
— which has **no callers at all** outside its own export. `a_remix_assembly_credits` is priced only by `quoteAssemblyRemix`, called from nothing but
`packages/core/test/pricing.test.ts`. Tuning either key today changes nothing a customer can
reach.

Cites re-measured 2026-09-13 against `packages/core/src/pricing.ts` — the whole table shifted when
0048 added the tenth key, which is the normal fate of a line cite in this repo.

| key                          | priced by            | what it buys                                           |
| ---------------------------- | -------------------- | ------------------------------------------------------ |
| `a_assembly_flat`            | `pricing.ts:104`     | full-format Service A, per render                      |
| `a_demo_per_second`          | `pricing.ts:105-109` | full-format Service A, × the **uploaded** demo seconds |
| `a_outro_per_second`         | `pricing.ts:110-114` | avatar ending only; 0 when the ending is a freeze      |
| `a_minimum_credits`          | `pricing.ts:116`     | floor on the full-format quote                         |
| `b_per_second`               | `pricing.ts:124`     | Service B, × the approved VO's measured seconds        |
| `b_minimum_credits`          | `pricing.ts:125`     | floor on Service B — `75` since 0043, i.e. **active**  |
| `a_ending_reroll_per_second` | `pricing.ts:136-140` | ending re-roll; floor-exempt                           |
| `a_remix_assembly_credits`   | `pricing.ts:185`     | hook / hook-line / rect remix; floor-exempt            |
| `a_steps_credits`            | `pricing.ts:170`     | one steps-format RENDER; floor-exempt                  |
| `a_demo_analysis_credits`    | `pricing.ts:172`     | the demo analysis, ONCE per demo; floor-exempt         |

## A steps render is 25 credits, and the first render of a demo is 45

**Split 2026-09-13** ([[0048-the-demo-analysis-is-charged-once-per-demo]]) from a single flat of 5,
into 3 + 2; **re-priced to 25 + 20 on 2026-09-17** by 0043
([[0051-the-credit-unit-and-the-three-credit-only-plans]]). The six observed production debits
below all predate BOTH changes — they are the 0026 era, when the flat was 5.

`quoteServiceASteps` returns the `steps` component always, adds an `analysis` component when the
caller passes `firstPaidRenderOfDemo: true`, and passes `0` as the floor for both — so demo length
still changes nothing. That is deliberate and the comment above it says why: the full-format quote
bills the **uploaded** duration, so a 3-minute recording would price 150 credits for a ~20s output
(`15 + 180 × 0.75`).

`firstPaidRenderOfDemo` comes from **one** place, `demoHasPaidRender` in
`packages/core/src/pipelines/sets.ts`: a demo has a paid render iff some `video_renders` row of that
demo (through `sets.demo_id`) carries a `debit_render` ledger row with no `refund_failed` row on the
same `ref_id`. The ledger, **not** `video_renders.refunded_at` — an ancestor refund leaves the
row that gave the money back with a null `refunded_at`, so the column would answer this question
wrong. 0048 has the full reasoning.

The debit is still written inside `createSet`'s per-cell loop — one ledger row per render, never per
set, because refunds key on the render id. The once-per-set analysis is **added to the first cell's
row**, which is why that row is larger and no third row appears. The wizard only ever sends a 1×1
grid, so per-set and per-render coincide today; a fresh demo's N-cell steps grid would be
`45, 25, 25, …` and a reused demo's would be `25×N`.

**Observed, not just derived.** Joining `credit_ledger.ref_id` to `video_renders`, all ten
`debit_render` rows in production resolve, and the split is exactly what the code predicts:

| when                        | delta              | `params->>'format'`                   |
| --------------------------- | ------------------ | ------------------------------------- |
| 2026-08-06 → 2026-08-09 (4) | −10, −29, −23, −23 | `(none)` — full format, length-priced |
| 2026-08-18 → 2026-08-22 (6) | **−5 every time**  | `steps`                               |

Six steps renders, six −5 debits, no exceptions. The length-priced rows above them are the reason
the flat exists. **All six predate both the 2026-09-13 split and the 2026-09-17 re-pricing**, so do
not compare them to a live quote. At today's rates the same six renders, off six distinct demos,
would be −45 each; off ONE demo they would be −45 then −25 five times.

## Three traps

**`creditCostsSchema` is a plain `z.object`** (`packages/core/src/pricing.ts`) — strip mode,
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

**Admin accounts pay nothing.** `quoteContext` in `packages/core/src/pipelines/sets.ts` (re-read
2026-09-13; the line has been `:483`, then `:745`, and moves again with every edit above it — grep
the expression, not a number) sets
`chargeable = !(await isAdminOwned(db, businessId))`, and `createSet`'s per-cell loop skips the
debit when `chargeable` is false. Flipping a customer account to admin would zero its render debits and
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
- [[0048-the-demo-analysis-is-charged-once-per-demo]] — why the steps flat split, and the predicate
- [[analyze-demo-cost]] — the ₪2.04–₪2.56 `a_demo_analysis_credits` is reasoned from
