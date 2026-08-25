---
type: defect
status: verified
verified: 2026-08-23
method: "read every migration that writes daily_caps (0001, 0004, 0018, 0022, 0027 — the full set from grep -ln daily_caps supabase/migrations/), replayed them by hand, and compared to the live row read read-only"
source: code
---

# A fresh environment comes up with a 500,000 LLM cap; production runs 1,500,000

## The divergence, key by key

Five migrations write `daily_caps`, and `0027` is the last:

| migration | writes                                                                                  |
| --------- | --------------------------------------------------------------------------------------- |
| `0001:36` | `{"tts_chars":100000,"gpu_seconds":300,"llm_tokens":2000000}`                           |
| `0004:7`  | `\|\| {"images":100}`                                                                   |
| `0018:18` | `\|\| {"per_account":{"tts_chars":25000}}`                                              |
| `0022:23` | `jsonb_set(…,'{per_account,gpu_seconds}','2000')`; then platform `gpu_seconds` → `7200` |
| `0027:20` | `jsonb_set(…,'{per_account,llm_tokens}','500000')`                                      |

Replaying those in order gives:

```json
{
  "tts_chars": 100000,
  "gpu_seconds": 7200,
  "llm_tokens": 2000000,
  "images": 100,
  "per_account": { "tts_chars": 25000, "gpu_seconds": 2000, "llm_tokens": 500000 }
}
```

The live row is identical **except one key**:

```
per_account.llm_tokens   migrations: 500,000   production: 1,500,000
```

Raised by hand on 2026-08-21. Every other cap matches, so this is a single-key drift, not general
rot.

## What actually breaks

Nothing today — production is already at 1.5M. The exposure is **the next fresh environment**: a new
Supabase project, a restored branch, or a disaster-recovery rebuild comes up at 500,000, one third
of what the founder decided on.

A re-run against production would also reset it, and the live Supabase ledger genuinely does think
`0027` is unapplied ([[migration-ledger-stops-at-0007]]) — but that path is blocked by accident:
`supabase db push` aborts on `0008`, twenty migrations earlier, because
`ALTER TABLE "personas" ADD COLUMN "gender" text;` has no `IF NOT EXISTS`. So the cap cannot be
silently reset today. Repairing the ledger, which is the right fix for that other defect, is what
would unblock this one — **fix `0027` before repairing the ledger, not after.**

500,000 is roughly three clean demo analyses (measured at 125k–159k each,
[[analyze-demo-cost]]). An account doing a normal day's work would trip a cap that production says
should not trip. And per `budget.ts:87` only admins bypass it, so a customer would be the one to
hit it.

## The fix is cheaper than it looks — no test blocks it

`packages/core/test/migrations.test.ts:23-26` asserts the caps with `toMatchObject`:

```ts
expect(caps[0]?.value).toMatchObject({
  gpu_seconds: 7_200,
  per_account: { tts_chars: 25_000, gpu_seconds: 2_000 },
});
```

`toMatchObject` is a recursive _partial_ match and **`llm_tokens` is not asserted at all**. So
changing the seeded value turns nothing red. `0027` is in `PORTABLE_MIGRATIONS`
(`packages/core/test/helpers/pglite.ts:39`), so it does run in the suite — it just is not checked on
this key.

## Fix shape

Either edit `0027`'s literal from `'500000'` to `'1500000'`, or add an `0029` that sets it — the
second is the honest one, because migrations that have already been applied should not be rewritten.
Add it to `PORTABLE_MIGRATIONS` in the same change (there is no `db:migrate` script; migrations are
applied by hand, and the array is the only index the tests use).

While there, consider asserting `per_account.llm_tokens` in the migrations test, so the next
hand-raise cannot drift silently.

## Deliberately not fixed

**Founder instruction: record it, do not write it.** This note is the record.

## A wording bug the migrations share

`0018:15-16`, `0022:21-22` and `0027:18-19` all say `dailyCapsSchema` is "a CLOSED zod object". It is
a plain `z.object` (`config.ts:49`) — strip mode. The _instruction_ those comments give is right
(the key and the schema must land together, or the read throws on the missing key); only the label
is wrong. See [[token-and-money-budgets]].
