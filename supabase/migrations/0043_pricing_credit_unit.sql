-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- The credit gets a PRICE, and the three plans stop being placeholders.
--
-- Founder decision 2026-09-16, recorded in
-- docs/vault/decisions/0051-the-credit-unit-and-the-three-credit-only-plans.md.
--
-- THE UNIT
-- 1000 credits = 150 ILS, i.e. 0.15 ILS per credit on the base tier. The old
-- rule -- "1 credit = 1 second" -- is RETIRED. Nothing in code ever depended on
-- it (grep: it appears only in comments and docs); it was a mnemonic from
-- 0017's per-second rework, and it stopped being true the moment the steps
-- format priced a render as a flat. A credit is now a unit of money, and the
-- rates below say how many of them each thing costs.
--
-- SEVEN of the ten rates are multiplied by 5 -- a pure re-denomination into
-- the 0.15 ILS credit. THREE ARE NOT, and all three are deliberate:
--   b_minimum_credits      0 -> 75   a floor where there was none
--   a_steps_credits        3 -> 25   x8.33, where a x5 would be 15
--   a_demo_analysis_credits 2 -> 20  x10,   where a x5 would be 10
-- So this file re-denominates AND re-balances, and the re-balance lands on the
-- only two Service A charges a customer can reach today. Measured against
-- b_per_second, which IS x5 and is therefore the yardstick that survives the
-- change of unit: a steps render goes from 3 seconds-of-Service-B to 5
-- (+67%), the analysis from 2 to 4 (+100%), and a first ad off a new recording
-- from 5 to 9 (+80%). The first-render-to-later-render ratio moves 5/3 = 1.67
-- to 45/25 = 1.80. That is a price rise, stated here so nobody later reads
-- this file as a unit conversion and is surprised.
--
-- ---------------------------------------------------------------------------
-- (a) credit_costs
-- ---------------------------------------------------------------------------
-- BEFORE (the 0017 + 0026 + 0039 row):
--   a_assembly_flat 3      a_demo_per_second 0.15   a_outro_per_second 1
--   a_minimum_credits 5    b_per_second 1           b_minimum_credits 0
--   a_ending_reroll_per_second 1   a_remix_assembly_credits 2
--   a_steps_credits 3      a_demo_analysis_credits 2
--
-- AFTER:
--   a_assembly_flat 15     a_demo_per_second 0.75   a_outro_per_second 5
--   a_minimum_credits 25   b_per_second 5           b_minimum_credits 75
--   a_ending_reroll_per_second 5   a_remix_assembly_credits 10
--   a_steps_credits 25     a_demo_analysis_credits 20
--
-- THE NEW FLOOR -- b_minimum_credits, 0 -> 75, first of the three non-x5 keys.
-- It was 0, which pricing.ts documents as "inactive" -- Service B had no floor
-- at all. 75 credits is 15 seconds at the new b_per_second, so the floor binds
-- only below 15s. It exists because the per-ad costs that do NOT scale with
-- seconds -- the script call, the audio previews, the composite when there is
-- one -- are the same for a 6-second ad as for a 30-second one, and a
-- seconds-only price hands those away free at the short end.
--
-- THE FOUR LIVE KEYS -- four of the ten; the other six are below.
--   b_per_second 5           Service B, per second of APPROVED VO. Per-second
--                            pricing stands (founder, 2026-09-16); only the
--                            floor is new.
--   b_minimum_credits 75     the new floor, described above.
--   a_steps_credits 25       one steps-format render.
--   a_demo_analysis_credits 20  the demo analysis, still ONCE per demo. 0048
--                            stands unchanged -- this file moves its number,
--                            not its mechanism. First ad off a new recording
--                            is 45; every later ad off the same one is 25.
--
-- THE SIX DORMANT KEYS ARE SCALED ANYWAY, ON PURPOSE.
-- a_assembly_flat, a_demo_per_second, a_outro_per_second and a_minimum_credits
-- (the floor on that same retired quote) price the "full" Service A format,
-- retired 2026-09-05 and reachable only from the CLI's `format: "full"`. a_ending_reroll_per_second is priced by
-- quoteEndingReroll, whose only caller has no callers; a_remix_assembly_credits
-- is priced by quoteAssemblyRemix, called from nothing but a test
-- (docs/vault/facts/credit-costs-row.md, "two are unreachable in production").
-- Leaving them at the old scale would be leaving six under-quotes armed: the
-- day any of those paths is re-enabled it would price at a fifth of cost, and
-- it would do it silently, because nothing compares one rate against another.
-- Scaling them costs nothing today and removes that.
--
-- EVERY KEY STAYS PRESENT. creditCostsSchema (packages/core/src/pricing.ts)
-- makes all ten REQUIRED, and quoteContext parses the whole row on every quote
-- path -- steps, full, silent and Service B. A row missing one key does not
-- mis-price, it THROWS, and all four stop together
-- (docs/vault/facts/credit-costs-row.md, "a hand-edit that drops a key breaks
-- every format at once"). That is why this file restates all ten rather than
-- touching the four that matter.
--
-- NO DEPLOY ORDER, unlike 0039. 0039 ADDED a key the schema made required, so
-- it had to land before the build that knew about it. This file adds nothing
-- and removes nothing -- it moves ten numbers the deployed code already reads
-- live on every quote. Migration and deploy are independent, in either order.
-- The only window is the obvious one: between this UPDATE and the docs, the
-- product quotes the new prices, which is the intent.
--
-- `||` MERGE, NOT A REWRITE, following 0039 rather than 0017. Since all ten
-- keys are named, the two are identical for everything creditCostsSchema can
-- see. They differ only on a key nobody knows about, and a merge cannot destroy
-- one. Stripping a stray key is a deliberate act with its own migration when it
-- is needed -- that is what 0028 is.
--
-- GUARDED on the 0039 state, following 0040's pattern rather than 0039's
-- unconditional one, and for both of 0040's reasons:
--   * A rebuild replays 0017 -> 0026 -> 0039 -> here and lands on the new row
--     BY CONSTRUCTION. No seed is retro-edited; 0017's and 0026's and 0039's
--     literals stay exactly as they were applied
--     (docs/vault/defects/migration-0027-still-seeds-the-old-llm-cap.md --
--     rewriting an applied migration is a founder call).
--   * If the founder has hand-tuned a_steps_credits or a_demo_analysis_credits
--     away from 3 and 2 by the time this replays, the new scale is not silently
--     stamped over his number. The guard misses and the read-back below is how
--     you find out.
--
-- THE TWO STATEMENTS ARE GUARDED INDEPENDENTLY, SO THIS FILE CAN HALF-APPLY,
-- and one half is worse than either endpoint. If (a) misses and (b) lands, the
-- new credit VOLUMES sit against the OLD rates: 1000 credits at
-- a_steps_credits 3 buys 333 steps renders for 150 ILS instead of 40, and
-- 1000 seconds of Service B at b_per_second 1 costs the customer 150 ILS
-- against ~250 ILS of GPU. That specific state -- new plans, old rates -- is
-- what the before-read and the after-read below are looking for. Check BOTH
-- rows, not just credit_costs.
--
-- The guard is `@>` containment and not `->>`, deliberately: `@>` is
-- type-aware, so a hand-pasted '"3"' -- a JSON string, which every text
-- comparison accepts and z.number() then rejects at the next customer quote --
-- does NOT match, and this file correctly refuses to run on a row that is
-- already broken.
UPDATE "app_config"
SET "value" = "value" || '{
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
}'::jsonb,
    "updated_at" = now()
WHERE "key" = 'credit_costs'
  AND "value" @> '{"a_steps_credits": 3, "a_demo_analysis_credits": 2}'::jsonb;

-- ---------------------------------------------------------------------------
-- (b) plans
-- ---------------------------------------------------------------------------
-- 0001 seeded three plans with placeholder prices from a subscription model
-- that predates the credit unit -- 299/599/999 ILS against 40/100/200 credits,
-- and Service B locked behind the middle tier. All three numbers were guesses
-- and the row has never been read by a paying customer: billing is dormant and
-- `subscriptions` held 0 rows when 0041 measured it on 2026-09-16.
--
-- BEFORE -> AFTER:
--   starter  29900 -> 15000 agorot   40  -> 1000 credits   service_b f -> t
--   pro      59900 -> 30000 agorot   100 -> 2500 credits   service_b t (same)
--   studio   99900 -> 50000 agorot   200 -> 5000 credits   service_b t (same)
--
-- THE LADDER, and why it is steep:
--   starter  150 ILS / 1000 credits = 0.15 ILS per credit
--   pro      300 ILS / 2500 credits = 0.12 ILS per credit  (-20%)
--   studio   500 ILS / 5000 credits = 0.10 ILS per credit  (-33%)
-- Tiers differ by CREDIT VOLUME ONLY. There is no founder-time benefit, no
-- support level, no priority service and no feature gate on any tier -- all
-- three unlock Service B, which is why `allows_service_b` goes true on starter.
-- The one differentiator that is named and NOT built is queue priority; `jobs`
-- has no priority column and the claim query has no plan awareness, so it is a
-- core change if and when it comes. `config` stays '{}' and is not touched by
-- this file.
--
-- Prices are NET. Billing ships as osek patur
-- (docs/vault/decisions/0046-billing-ships-as-osek-patur.md), so no VAT is
-- added today; on conversion to osek morshe VAT goes ON TOP, per docs/05-billing.md.
--
-- `name` IS DELIBERATELY NOT TOUCHED. The three rows still read 'Starter',
-- 'Pro', 'Studio' in Latin, and the whole product is Hebrew-first. Choosing the
-- Hebrew display names is the founder's call and is still pending; changing
-- them is a one-line UPDATE here when he makes it.
--
-- GUARDED on the placeholder price each UPDATE replaces, same reasoning as (a):
-- a rebuild replays 0001's 29900/59900/99900 and lands on the new prices by
-- construction, and a hand-set price is not silently overwritten. No migration
-- between 0001 and this one touches `plans` at all, so 0001's seed IS the
-- before-state on any fresh database.
UPDATE "plans"
SET "price_agorot" = 15000, "monthly_credits" = 1000, "allows_service_b" = true
WHERE "code" = 'starter' AND "price_agorot" = 29900;

UPDATE "plans"
SET "price_agorot" = 30000, "monthly_credits" = 2500, "allows_service_b" = true
WHERE "code" = 'pro' AND "price_agorot" = 59900;

UPDATE "plans"
SET "price_agorot" = 50000, "monthly_credits" = 5000, "allows_service_b" = true
WHERE "code" = 'studio' AND "price_agorot" = 99900;

-- ---------------------------------------------------------------------------
-- VERIFY BY READ-BACK, BEFORE AND AFTER. Both statements are GUARDED, and a
-- guard that matches nothing exits 0, prints the same output and still records
-- its version -- so the ledger would say applied while nothing had moved. The
-- before-read is not optional on a guarded migration (the lesson of 0040).
--
--   select value from app_config where key = 'credit_costs';
--   select code, name, price_agorot, monthly_credits, allows_service_b from plans order by code;
--
-- BEFORE expect a_steps_credits 3 / a_demo_analysis_credits 2, and prices
-- 29900 / 59900 / 99900. AFTER expect the ten rates above, all bare jsonb
-- numbers, and 15000 / 30000 / 50000 with 1000 / 2500 / 5000 credits and
-- allows_service_b true on all three.
--
-- Read credit_costs through the code's own parse, never a raw SELECT:
-- creditCostsSchema is a plain z.object and STRIPS on read, so a misplaced key
-- survives in the row forever unseen -- that is what 0028 had to clean up.
--   apps/cli/node_modules/.bin/tsx packages/core/scripts/verify-credit-costs.ts
-- (that script's EXPECTED block pins the 0039 row and must be moved to these
-- ten values in the same change that pushes this file).
-- ---------------------------------------------------------------------------
