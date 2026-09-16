---
type: decision
status: superseded
verified: 2026-09-13
method: "Founder decision in chat, 2026-09-13, reasoned and explicitly NOT measured — no query was run against audio_renders or usage_events, and no account has ever been observed hitting 20. Written as supabase/migrations/0038_audio_preview_limit_50.sql and APPLIED to production 2026-09-13 on the founder's explicit instruction for that one push; post-apply read-back through getConfigValue(db,'audio_preview_daily_limit',z.number().int()) returned 50, ledger 39 rows 0000-0038 no gaps, no repair needed. Code read at 280c4ff: packages/core/src/pipelines/tts.ts:75-94 (the two ceilings, both keyed on the owner account); packages/core/src/appConfig.ts:7-11 (getConfigValue throws on a missing row); supabase/migrations/0001_extras_and_seed.sql:47 (the '20' seed a fresh database still replays); supabase/migrations/0036_daily_caps_runaway_detector.sql (per_account.tts_chars 25000, untouched by 0036); docs/05-billing.md:207-208 (the ~50-previews estimate the number is taken from); packages/core/src/pipelines/sets.ts:786-793 (the two-debit-sites rule); apps/web/src/lib/wizard-gate.ts:27-32 and apps/web/src/app/home/b/new/page.tsx:43 (the zero-balance wizard door); apps/web/src/app/api/scripts/[id]/audio/route.ts (auth + ownership, NO balance check)."
source: founder + code
---

# 0047 — The audio-preview cap stays a count, and the count moves to 50

> **SUPERSEDED 2026-09-16 by [[0049-audio-preview-attempt-cap-back-to-20]].** The founder reversed
> ruling 1: the cap goes back to **20**, because Service B is an occasional format, a good voice
> needs 2–3 retries rather than 50, and the 50 below was reasoned rather than measured — as this
> note says of itself, twice. **Ruling 2 survives intact**: previews are still free and still not
> credit-debited, and the three reasons for that are unchanged. Everything below is kept verbatim as
> the record of what was believed on 2026-09-13 and why. **The live row is 20 again**:
> `supabase/migrations/0040_audio_preview_cap_back_to_20.sql` was applied to production 2026-09-16,
> so the 50 this note argues for stood for three days.

## The decision

`app_config.audio_preview_daily_limit` goes from **20 to 50**. It stays what it is — a **count of
attempts**, free, keyed on the owner account — and previews stay **not credit-debited**.

Two rulings, both taken 2026-09-13, both **reasoned rather than measured**.

## 1. Why 50, and not "no cap"

`requestAudio` (`packages/core/src/pipelines/tts.ts:75-94`) checks two ceilings in a row, and they
bound different things:

| ceiling                                | counts                          | what it protects                                                    |
| -------------------------------------- | ------------------------------- | ------------------------------------------------------------------- |
| `audio_preview_daily_limit`            | `audio_renders` rows in 24h     | **the TTS queue** — one account must not flood it for everyone else |
| `per_account.tts_chars` = 25000 (0036) | characters actually synthesized | **the money** — TTS is absorbed cost of sale at ~₪0.10/1k chars     |

So the attempt count is not the money bound and was never meant to be. `docs/05-billing.md:207-208`
puts 25,000 characters at roughly **50 full previews a day**. At 20 the attempt count therefore
binds about **2.5× earlier** than the ceiling that actually costs something: a customer regenerating
one script to get the wording right hits it on a day they are spending 150+ credits on renders, and
learns nothing from it except that the number was set too low. At 50 the two meet in roughly the
same place, which is where a queue bound and a money bound belong — whichever trips should mean
something.

Removing the cap entirely was not on the table: the char cap is per-account and per-day, but the
queue is shared, and a single account synthesizing 25,000 characters as 200 tiny previews is a
different load on the worker than as 50 ordinary ones. The count is the only thing that sees that.

**This is an argument, not a measurement.** No usage data was consulted. The ~50 it is calibrated
against is itself an estimate in `docs/05-billing.md`, not a measured figure. Revisit with real
`audio_renders` / `usage_events` counts once billing is wired and there is traffic to count.

## 2. Charging credits for previews — considered and rejected

The obvious alternative to raising a cap is to price the thing. Rejected, for three reasons:

1. **There is no stranger to defend against at this door.** An account that has never paid cannot
   reach a positive balance at all ([[no-self-serve-credit-grant-path]] — no signup grant, no
   self-serve `credit_ledger` writer), and `wizardGate` (`apps/web/src/lib/wizard-gate.ts:27-32`)
   refuses a zero balance at the wizard entrance before a demo is uploaded or a script is written.
   Whoever reaches the audio step has already paid. Pricing previews would bill the customers who
   are already paying, to deter people who cannot get there.
2. **A per-attempt charge bills the customer for variance the free gate exists to absorb.** The
   audio preview is an **approval gate** (locked decision #5 — no voiced render without one), and a
   second attempt usually means ElevenLabs read a line differently, not that the customer wanted a
   second product. Charging per attempt makes the customer pay for TTS variance and quietly pushes
   them to approve the first take, which is the exact opposite of what the gate is for.
3. **It would be a third debit site.** `createSet` and `createBRender` are deliberately the only
   two, and `packages/core/src/pipelines/sets.ts:786-793` says why in as many words: "adding a third
   is how ledgers start lying." A preview debit would also need its own refund path for a failed
   synthesis, which is a second ledger-correctness surface bought for a free feature.

Revisit only with **measured** `usage_events` data, and only after billing is wired.

## One honest limit on ruling 2's first reason

The zero-balance refusal is on the **wizard page** (an RSC gate), not on the API. `POST
/api/scripts/[id]/audio` checks authentication and script ownership and **does not check the
balance** — nor does the script-creation route. So "a stranger cannot reach the audio step" is true
of the path a customer actually walks, not a hard barrier against a signed-in account driving the
API directly. That is unchanged by this decision and is what the attempt cap is the backstop for;
it is written down here so the reason is not later quoted as stronger than it is.

## Options considered

- **Leave it at 20.** Rejected: it binds 2.5× before the money cap, so the first ceiling a paying
  customer meets is the one that protects nothing they are spending.
- **Remove the count cap and let `tts_chars` be the only ceiling.** Rejected: the char cap is
  per-account, the TTS queue is shared, and 200 short previews and 50 long ones cost the same
  characters but not the same queue.
- **Charge credits per preview.** Rejected — the three reasons above.
- **Raise it to 50 and keep it free.** Chosen. One `UPDATE` in a migration, no code change, and the
  two ceilings end up sized for the same day's work.

## Why a migration and not a hand UPDATE

`0001_extras_and_seed.sql:47` seeds `'20'`, so a rebuilt database still comes up on 20 and
`supabase/migrations/0038_audio_preview_limit_50.sql` is what lifts it. A hand edit in the SQL editor
would move production and leave the lineage behind — precisely the drift recorded in
[[../defects/daily-caps-were-hand-edited-before-0036]], where the caps had already been hand-moved
and the migration landed as a data no-op. 0001's literal is deliberately **not** retro-edited:
rewriting an applied migration is a founder call, and the one time it happened it took the founder's
own reasoning to justify it ([[../defects/migration-0027-still-seeds-the-old-llm-cap]]).

**0038 was applied to production on 2026-09-13**, on the founder's explicit instruction for that one
push (the CLAUDE.md migration gate), the same day it was written. Pre-flight `migration list` showed
0000–0037 local == remote with 0038 the only unapplied row, `db push --dry-run` named that file
alone, and the push exited 0 with the ledger at **39 rows, 0000–0038, no gaps and no repair needed**
— `db push` recorded the version itself, the fifth time running. Read-back went through
`getConfigValue(db, "audio_preview_daily_limit", z.number().int())`, the exact call `tts.ts:76`
makes, and returned **50**; a raw `SELECT` would not have distinguished the number from the JSON
string `"50"`, which is the one way this row can be wrong and only surface at a customer's next
preview. The full ledger file then read **27 true, 1 false, 1 NULL** against production with 0038
true — see [[app-config-live-state]] and `scripts/verify-migration-ledger.sql` §RESULTS. No worker
restart and no deploy were needed: `requestAudio` reads the row live on every call.

## Related

- [[0049-audio-preview-attempt-cap-back-to-20]] — **supersedes this note**; takes the count back to 20
- [[0040-the-hard-ceiling-moves-to-the-providers]] — the cap design this sits inside; its "Deferred,
  not open" section is amended by ruling 2 for this one surface
- [[no-self-serve-credit-grant-path]] — why there is no stranger at this door
- [[app-config-live-state]] — the live row, and the pending marker for this change
- [[token-and-money-budgets]] — the cap table and the read-back rule
- [`docs/05-billing.md`](../../05-billing.md) §"Quotas and caps" — amended in the same commit
