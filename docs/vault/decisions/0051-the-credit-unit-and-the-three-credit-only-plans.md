---
type: decision
status: verified
verified: 2026-09-16
method: "Founder decisions in chat, 2026-09-16, taken together in one sitting: the credit unit (1000 credits = ₪150), Service B stays per-second with a floor, three plans differing by credit volume only, and the copy rule. Written as supabase/migrations/0043_pricing_credit_unit.sql — two guarded UPDATEs, `credit_costs` guarded on the 0039 state (`@>` containment on a_steps_credits 3 + a_demo_analysis_credits 2) and each `plans` row guarded on the 0001 placeholder price it replaces. APPLIED TO PRODUCTION 2026-09-17 on the founder's explicit instruction for that one push, after a read-only `migration list` + `db push --dry-run` pre-flight and a BEFORE-read through getConfigValue that returned the 0039 row with all four guards matching; the AFTER-read through the same call returned the ten new rates and the three new plan rows, and packages/core/scripts/verify-credit-costs.ts (re-pinned in the same change) passes 18 checks against production. Ledger 44 rows, 0000-0043, recorded by db push itself, ninth time running with no migration repair. No restart or deploy was needed - getConfigValue reads app_config on every quote, with no in-process cache. Proved on PGlite only, by `apps/cli/node_modules/.bin/tsx packages/core/.work/verify-0043-replay.ts` (24 checks, PASS: the ten rates, jsonb_typeof number on all ten, the six customer-facing quote assertions including all three sides of the new 75 floor, the three plan rows, a second run of the file as a clean no-op, the `@>` guard refusing a string-typed "3", and the fact that the plans half still applies when it does -- the two guards are independent, so the file can HALF-APPLY) — 0043 is in PORTABLE_MIGRATIONS (packages/core/test/helpers/pglite.ts) and the whole @aiugc/core suite runs against it green, with packages/core/test/credits-wiring.test.ts re-denominated end-to-end (24 cases, quote-equals-debit on every one) and packages/core/test/billing.test.ts asserting the Starter grant is 1000. The MARGIN figures below are REASONED, not measured, and are labelled as such individually."
source: founder
---

# 0051 — The credit is worth ₪0.15, and the three plans differ by credit volume only

## The decision

### 1. The unit

**1000 credits = ₪150. A credit is ₪0.15 on the base tier.**

The old rule — **"1 credit = 1 second" — is retired.** Nothing in code ever depended on it: it
survived only in the header comment of `packages/core/src/pricing.ts` and in `docs/05-billing.md`.
It stopped being true the moment the steps format priced a render as a flat (0026), and 0048's
split made it meaningless. A credit is now a unit of money.

**Seven of the ten rates are multiplied by 5** — a pure re-denomination into the ₪0.15 credit.
**Three are not**, and all three are deliberate:

- `b_minimum_credits` **0 → 75** — a new floor where there was none (§2).
- `a_steps_credits` **3 → 25** (×8.33, where ×5 would be 15) and `a_demo_analysis_credits`
  **2 → 20** (×10, where ×5 would be 10) — a real-terms **price rise** on the only two live
  Service A charges (§3).

So 0043 re-denominates **and** re-balances. Measured against `b_per_second`, which is ×5 and
therefore the one yardstick that survives the change of unit: a steps render goes from 3
seconds-of-Service-B to 5 (**+67%**), the analysis from 2 to 4 (**+100%**), and a first ad off a new
recording from 5 to 9 (**+80%**). The first-render-to-later ratio moves 5/3 = 1.67 → 45/25 = 1.80.

### 2. Service B stays per-second, with a floor

`b_per_second` **5** — ₪0.75 a second at the base tier. Per-second pricing stands: the cost of a
Service B ad genuinely scales with its length, and the price should say so.

**The floor is new and it is 75 credits — 15 seconds.** Its purpose is precisely the costs that do
NOT scale with seconds: the Claude script call, the audio previews the customer burns before
approving one, and the nano-banana composite when there is one. Those are the same for a 6-second
ad as for a 30-second one. A seconds-only price hands them away free at the short end, and the
short end is exactly where a customer optimising for credits ends up.

**The consequence, stated so it is not discovered later**: the wizard offers exactly two duration
presets, 15s and 30s (`apps/web/src/lib/service-b.ts`), and an approved VO almost always lands just
under its preset because the word budget is a cap. 75 is exactly 15 x 5, so **every 15s-preset
render now prices flat at the floor** while the shape summary beside it still reads the real
measured length. `Quote.minimumApplied` exists in `pricing.ts` and is consumed by no UI, so nothing
explains that to the customer today.

### 3. Service A steps is unchanged in mechanism, and re-priced

`a_steps_credits` **25** (×8.33) , `a_demo_analysis_credits` **20** (×10) — the two rates that rise
in real terms, not just in denomination.
[[0048-the-demo-analysis-is-charged-once-per-demo]] **stands unchanged** — 0043 moves its numbers,
not its predicate, its debit site, its lock, or its accepted edge. The first ad off a new recording
is **45**; every later ad off that same recording is **25**.

The six dormant keys — `a_assembly_flat`, `a_demo_per_second`, `a_outro_per_second`,
`a_minimum_credits` (the retired full format), `a_ending_reroll_per_second` and
`a_remix_assembly_credits` (both unreachable, see [[credit-costs-row]]) — were scaled ×5 too. Not
for consistency's sake: leaving them behind leaves six under-quotes armed, and the day any of those
paths is re-enabled it prices at a fifth of cost silently, because nothing in `pricing.ts` compares
one rate against another.

### 4. Three plans, differing by credit volume ONLY

| code      | price      | credits/mo | per credit |      | Service B |
| --------- | ---------- | ---------- | ---------- | ---- | --------- |
| `starter` | ₪150 (net) | 1000       | ₪0.15      |      | ✔         |
| `pro`     | ₪300 (net) | 2500       | ₪0.12      | −20% | ✔         |
| `studio`  | ₪500 (net) | 5000       | ₪0.10      | −33% | ✔         |

**All three unlock Service B** — `allows_service_b` goes true on `starter`, which 0001 had left
false. `plans.config` stays `'{}'` on all three and this file puts nothing in it. Prices are net;
we ship as עוסק פטור ([[0046-billing-ships-as-osek-patur]]) so no VAT is added today.

**The ladder is steep on purpose.** A third off the credit price between the bottom and the top
tier is the whole pull upward — it is the only reason to move, because nothing else differs.

**Tiers differ by credit volume only — brand-first: the founder is not a product surface.**

That is the decision. There is no founder-time benefit, no support level, no onboarding call and no
priority service on any tier, and none will be added.

**Queue priority for higher tiers is the one named future differentiator, and it is not built.**
`jobs` has no priority column and the claim query (`jobs_claim_idx` on `status, run_at`) has no plan
awareness at all, so it is a core change when it comes — schema, claim query and the renewal path
together. Named here so that it is a decision deferred rather than an idea rediscovered.

### 5. The copy rule

**Never print "N videos per month" — anywhere.** Not in Hebrew customer copy, not on a pricing page,
not in a doc, not in this vault. Credits and worked examples only. A 30-second Service B ad and a
reused-recording steps ad are not the same product and cannot share a count, so any such number is
one we would immediately have to qualify away.

Worked examples are the sanctioned form, and they are per-ad, never per-month:

- Service B, 20s of approved VO — **100 credits**, ₪15 at the base tier.
- Service B, 8s — **75 credits** (the floor), ₪11.25. So is 12s.
- Service A steps, first ad off a new recording — **45 credits**, ₪6.75.
- Service A steps, every later ad off that same recording — **25 credits**, ₪3.75.

The customer-facing Hebrew for the last two is already generated from config and needed no edit
(`apps/web/src/lib/quote-ui.ts`, interpolated from the quote, per 0048): it reads
`45 קרדיטים: 25 לסרטון + 20 על ניתוח ההקלטה. כל מודעה נוספת מאותה הקלטה תעלה 25.`

## The margins — REASONED, not measured, every one

No pricing telemetry exists. Nothing below was measured for this decision, and one input is past
the 14-day rule. Recorded so the arithmetic is on the record and can be falsified later.

**Service B — ~60%, at any length.** REASONED. Against
`GPU_COST_AGOROT_PER_SECOND = 25` (`packages/core/src/pipelines/renders.ts:69`, HeyGen
$0.0667/s at both 720p and 1080p, verified 2026-08): ₪0.75/s revenue on the base tier against
₪0.25/s of GPU is 67%; on `studio` at ₪0.50/s it is 50%. Because both sides are per-second the
margin is flat in length, which is the property that made per-second pricing the right shape — and
below 15s the floor makes it better, not worse. It ignores the per-ad costs the floor exists to
cover, which is why the honest summary is "~60%" and not "67%".

**Service A steps — ~73–96% on every render after the first.** REASONED, founder's figures. The
marginal cost of a later ad off an already-analysed recording is a Remotion render on a box we pay
for monthly either way, so the margin is high and its width is the uncertainty about how to
apportion the box.

**The first ad off a new recording — 45 credits = ₪6.75 against ~₪3–3.5.** REASONED. Roughly
50%, the thinnest point in the product, and deliberately so: it is the charge that carries the
analysis, and the format's whole argument is that the customer does not pay it again.

**The analysis itself — 20 credits = ₪3 against ₪2.04–₪2.56, mean ₪2.28.** That is four clean runs
in [[analyze-demo-cost]], **measured 2026-08-23 and now stale** past [[CONVENTIONS]]'s 14-day rule;
it was already stale when 0048 leaned on it and it has not been re-measured since. Six jobs is not
a distribution. This is the single weakest number in the sheet.

## The consequence nobody rescales: existing balances

`credit_ledger` holds credits, not shekels, and nothing re-denominates a stored balance. Because
`a_steps_credits` moved ×8.33 rather than ×5, every credit already granted bought roughly an eighth
of the ads it was granted to buy the moment 0043 landed.

Measured 2026-09-17, right after the push: exactly two accounts held a positive balance, both
`role=customer`, at **145** and **81** credits. On the founder's instruction the same day both were
made whole **in ads rather than in credits**, on the marginal steps rate (the second-and-later ad
off one recording, 3 → 25, which is what a standing balance actually gets spent on): grants of
**1055** and **594** to reach **1200** and **675**. One `grant_manual` row each, written by
`grantCredits` — the same function the admin grants route calls.

This is a standing hazard, not a one-off: **any future change to a rate silently re-values every
stored balance**, and `grant_manual` has no unique index to make a corrective grant safe to repeat.
A top-up script must carry its own idempotency tag, as this one did.

## Review trigger

**Sixty days after the first paying customer**: re-run `aiugc costs --from <launch date>` and read
the **median credit use per subscriber**. That is the number this whole sheet is guessing at — it
decides whether 1000 credits is a starter plan or a rounding error, whether the ladder's steepness
actually moves anyone up a tier, and whether the ₪2.28 analysis cost survives contact with real
traffic. Until then, every margin above is arithmetic on an estimate.

## What this file deliberately did NOT do

- **`plans.name` is untouched** — the three rows still read `Starter` / `Pro` / `Studio` in Latin in
  a Hebrew-first product. The Hebrew display names are the founder's call and are **still pending**.
- No priority column, no per-plan cap, no retention setting, nothing in `plans.config`.
- `packages/core/src/pricing.ts` and `apps/web/src/lib/quote-ui.ts` were not touched, and needed no
  **functional** edit: the quote lines read from config, which is the property 0048 built and this
  change is the first real test of. Their **comments** are now stale and that is owed —
  `pricing.ts:11` still asserts "1 credit = 1 second", and its worked examples at `:70` (a 34s demo
  - 6.5s outro "quotes 16 component-wise but 15 correctly", now 74 and 73) and `:151` ("~31 credits"
    for a 3-minute recording, now 150) no longer reproduce. `quote-ui.ts:86`'s JSDoc says the button
    "says 5 and not 3"; it now says 45 and not 25. Comment-only, in files this change was told not to
    touch.

## Mechanics of 0043

**Guarded, both statements**, following 0040's pattern rather than 0039's unconditional one:

- A rebuild replays `0001 → 0017 → 0026 → 0039 → 0043` and lands on the new row and the new prices
  **by construction**. No applied migration is retro-edited
  ([[migration-0027-still-seeds-the-old-llm-cap]] — that is a founder call).
- A founder hand-tune away from the guarded values is not silently stamped over.

The `credit_costs` guard is `@>` containment and not `->>`, deliberately: `@>` is type-aware, so a
hand-pasted `'"3"'` — a JSON string, which every text comparison accepts and `z.number()` then
rejects at the next customer quote — does not match, and the file correctly refuses a broken row.
It uses `||` merge rather than 0017's full rewrite: with all ten keys named the two are identical
for everything `creditCostsSchema` can see, and a merge cannot destroy a key nobody knows about.

**No deploy order, unlike 0039.** 0039 added a key the schema made required, so it had to land
first. 0043 adds nothing and removes nothing — it moves ten numbers the deployed code already reads
live on every quote, so migration and deploy are independent in either order.

**A before-read is mandatory when it is pushed.** Both statements are guarded, and a guard that
matches nothing exits 0, prints the same output and still records its version — the lesson of 0040.
Read `credit_costs` through `getConfigValue(db, 'credit_costs', creditCostsSchema)`, never a raw
`SELECT`. `packages/core/scripts/verify-credit-costs.ts` pins the 0039 row today and its `EXPECTED`
block moves to these ten values in the same change that pushes the file.

## Related

- [[credit-costs-row]] — the row, decoded; its values are the 0039 ones until 0043 is pushed
- [[0048-the-demo-analysis-is-charged-once-per-demo]] — unchanged in mechanism by this file
- [[analyze-demo-cost]] — the ₪2.28, measured 2026-08-23 and stale
- [[0046-billing-ships-as-osek-patur]] — why the prices are net
- [[0050-subscriptions-are-keyed-on-the-account]] — one account, one subscription, one credit pool
- [[no-self-serve-credit-grant-path]] — why the balance is the binding bound on stranger spend

_(Pointer 2026-10-11: scheduling and posting a finished video cost **no credits** and are open on
every tier — the founder's decision 11 of 2026-10-10, "probably not" to a later tier lock. §4's
"tiers differ by credit volume only" stands; no rate and no plan row changes.
[[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]].)_

_(Pointer 2026-10-14: §4's three plans stand unchanged — the ₪5 intro offer is not a fourth plan.
It sells 150 credits once to an account that never paid, valid 30 days, on its own Sumit page; its
"continue" starts an ordinary first month of one of these three at full price. No rate and no plan
row changes; its 150 rests on this note's 45 and 75 and on
[[0099-service-c-phase-2-opens-to-customers]] §7's 25 for a text block. Whether a ₪5 buyer starts this note's
sixty-day review clock is OPEN. [[0109-a-five-shekel-intro-offer]].)_
