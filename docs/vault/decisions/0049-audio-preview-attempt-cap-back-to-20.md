---
type: decision
status: verified
verified: 2026-09-16
method: "Founder decision in chat, 2026-09-16. Reasoned, explicitly NOT measured — no query was run against audio_renders or usage_events, and no account has ever been observed hitting 20 or 50. Written as supabase/migrations/0040_audio_preview_cap_back_to_20.sql and APPLIED to production 2026-09-16 on the founder's explicit instruction for that one push; read-back through getConfigValue(db,'audio_preview_daily_limit',z.number().int()) returned 50 BEFORE (proving the guard's precondition) and 20 AFTER, ledger 41 rows 0000-0040 no gaps, no repair needed. Money arithmetic read from supabase/migrations/0018_per_account_caps.sql:11-13 (25000 chars/24h = ~7.50 ILS/day at 30 agorot/1k chars) and packages/core/src/pipelines/tts.ts:26-32, which carries TTS_COST_AGOROT_PER_1K_CHARS = 30 and reconciles it against ElevenLabs' $0.10/1k at USD/ILS 3.00 (founder-confirmed 2026-08). The ~375-char script length is the founder's estimate and is NOT measured; no average-script-length fact exists in the vault. Code read at 8624ab1: packages/core/src/pipelines/tts.ts:75-94 (the two ceilings, both keyed on the owner account); supabase/migrations/0001_extras_and_seed.sql:47 (the '20' seed a fresh database replays); supabase/migrations/0038_audio_preview_limit_50.sql (the unconditional UPDATE this one guards against); supabase/migrations/0031_seed_unseeded_config.sql (the guard pattern copied); packages/core/test/migrations.test.ts and test/helpers/pglite.ts (the PGlite replay that proves the chain lands on 20)."
source: founder + code
supersedes: "[[0047-audio-preview-attempt-cap-moves-to-50]]"
---

# 0049 — The audio-preview attempt cap goes back to 20

## The decision

`app_config.audio_preview_daily_limit` goes from **50 back to 20**, three days after
[[0047-audio-preview-attempt-cap-moves-to-50]] raised it. Everything else about the cap is unchanged:
it is still a **count of attempts**, still free, still keyed on the owner account, and previews are
still **not credit-debited**. Ruling 2 of 0047 — previews are not priced in credits — stands
untouched.

## Why, in the founder's terms

Three reasons, given in chat 2026-09-16:

1. **Service B is an occasional format.** Nobody spams talking heads. The queue-flood scenario 50 was
   sized against is not the traffic this product gets.
2. **The voice is good.** A perfectionist needs **2–3 retries** on a script, not 50. A ceiling nobody
   approaches is not a ceiling, it is decoration — and 20 already leaves an order of magnitude over
   the retry count a careful customer actually uses.
3. **The 50 was reasoned, not measured.** 0047 says so itself, in bold, twice. An argument that was
   never checked against traffic does not outrank the founder's read of his own product.

**Revisit only with measured data** — real `audio_renders` / `usage_events` counts, once billing is
wired and there is traffic to count. That instruction is unchanged from 0047; what changed is which
guess we sit on while we wait, and the founder's call is that the tighter one is the honest default.

## The money arithmetic — and it is not this row

`requestAudio` (`packages/core/src/pipelines/tts.ts:75-94`) checks two ceilings in a row, both keyed
on the owner account, and they bound different things:

| ceiling                            | counts                      | what it protects                                     |
| ---------------------------------- | --------------------------- | ---------------------------------------------------- |
| `audio_preview_daily_limit` (this) | `audio_renders` rows in 24h | the **TTS queue** — never debited, absorbed cost     |
| `per_account.tts_chars` = 25000    | characters synthesized      | **the money** — **UNCHANGED**, and untouched by 0040 |

The money bound is `per_account.tts_chars`, it is **25,000 chars/24h**, and this decision does not
move it. `0018_per_account_caps.sql:11-13` — the file that set it — prices that at **30 agorot per
1k chars ⇒ ~₪7.50/account/day** of exposure.

At **20 attempts** and a **~375-char** script, 7,500 chars ⇒ **~₪2.25/day**, so the attempt cap binds
first, by roughly 3.3×. That is exactly the asymmetry 0047 set out to remove, and it is now the
intended state: when the expensive ceiling protects nothing anybody is approaching, the cheap one
should be the one that trips.

**Label: REASONED.** The ~375 chars is the founder's estimate of a B script; no measured
average-script-length fact exists in the vault. `0018`'s own estimate implies **~500** (it calls
25,000 chars "roughly 50 full-length previews"). The conclusion survives either: at 500 chars,
20 attempts is ~₪3.00/day, still comfortably inside ₪7.50. Nothing here was measured.

### The rate is not in doubt, and the ratio does not depend on it

Two things worth pinning down, because an earlier draft of this note got both wrong.

**The rate.** `docs/05-billing.md` used to carry TTS at "~₪0.10/1k chars", which looks like it
contradicts 0018's 30 agorot. It does not. `packages/core/src/pipelines/tts.ts:26-32` sets
`TTS_COST_AGOROT_PER_1K_CHARS = 30` and shows the working: ElevenLabs bills **$0.10/1k chars**, and
at **USD/ILS 3.00** (founder-confirmed 2026-08) that **is** 30 agorot. The `₪0.10` was a dollar
figure written with a shekel sign — one rate, two currencies, not two competing numbers. The billing
bullet is corrected to say so in this same commit rather than having the figure quietly deleted.

**The ratio.** The 3.3× gap between the two ceilings does not depend on the rate at all. Both are
denominated in **characters** — 25,000 against 20 × 375 = 7,500 — so agorot/1k cancels out of the
comparison entirely. Only the absolute shekel figures move with the rate. So no plausible rate
correction can change which ceiling binds first, which is the only thing this decision turns on.

## What 0040 does, and why it is guarded when 0038 was not

`supabase/migrations/0040_audio_preview_cap_back_to_20.sql`:

```sql
UPDATE "app_config"
SET "value" = '20'::jsonb, "updated_at" = now()
WHERE "key" = 'audio_preview_daily_limit' AND "value" = '50'::jsonb;
```

0038's UPDATE is **unconditional**, and its header says why: 50 _was_ the decision, so a row that had
drifted to some third value should still have become 50. 0040 takes the opposite rule — 0031's
pattern, guarded on the old value — for two reasons:

1. **A rebuild lands on 20 by construction.** `0001_extras_and_seed.sql:47` seeds `'20'`, 0038 lifts
   it to 50, 0040 puts it back. The chain replays 20 → 50 → 20 with no retro-edit of an applied
   migration, which is a founder call and stays one
   ([[../defects/migration-0027-still-seeds-the-old-llm-cap]]). 0001's literal is right again by
   coincidence; nothing here relies on that.
2. **A later deliberate flip is not silently undone.** If the founder moves this row again before
   0040 is applied, 0040 becomes a no-op rather than dragging it back to 20 behind his back. That is
   the whole point of 0031's guard, and it is why the migration header insists on a **read-back**:
   with a guard, "the UPDATE succeeded" and "zero rows matched" look identical.

The PGlite test path replays the full chain and pins the end of it
(`packages/core/test/migrations.test.ts`), so the guard firing on 0038's 50 is proved on every test
run rather than assumed.

## Options considered

- **Leave it at 50.** Rejected: the founder judged both halves of 0047's argument wrong for this
  product's actual traffic, and 0047 was never measured to begin with.
- **Something between, say 30.** Not offered. There is no data to locate a middle, so a third
  invented number would have all of 50's weakness and none of 20's provenance — 20 is at least the
  value the product ran on from `0001` until 2026-09-13 without a single observed complaint.
- **Wait for measured data before moving anything.** Rejected: that leaves the reasoned-but-wrong 50
  live in the meantime. Going back to 20 costs one guarded UPDATE and is itself reversible.
- **Back to 20, guarded, in a migration.** Chosen — and applied to production the same day.
- **Retro-edit 0038 or delete it.** Never on the table. 0038 is applied to production; the record of
  what was believed on 2026-09-13 and why is the thing the vault exists to keep.

## Status — APPLIED 2026-09-16

The migration was **applied to production the same day**, on the founder's explicit instruction for
that one push (the CLAUDE.md migration gate). Ledger: **41 rows, 0000–0040, no gaps, nothing
unapplied, no repair needed** — `db push` recorded the version itself, the seventh time running.

**A guarded UPDATE needs a before-read, and that is new for this project.** The six previous pushes
were unconditional, so "it applied" and "the value moved" were the same statement. 0040's
`AND value = '50'::jsonb` breaks that: had the row drifted, the migration would have matched nothing,
exited 0, printed the same output and still recorded its version — the ledger would say applied and
the cap would still be 50. So the row was read **before** the push through
`getConfigValue(db, "audio_preview_daily_limit", z.number().int())` and returned **50**, the guard's
precondition exactly; and **after**, the same way, returning **20**. Both via
`packages/core/.work/readback-0040.ts`. A raw `SELECT` would not have separated the number `20` from
the JSON string `"20"` — the one way this row can be wrong, and it only surfaces at a customer's next
preview.

That before-read also settles something the repo could not otherwise know: **nobody had hand-edited
this row between 2026-09-13 and 2026-09-16**, which is a live risk on this project
([[prod-rows-hand-edited]]).

**No worker restart and no deploy were needed** — `requestAudio` reads the row live on every call, so
the cap was 20 for the next customer preview the moment the push exited.

One limit on the ledger row worth stating: `scripts/verify-migration-ledger.sql`'s `0038+0040` row
asserts the value is 20, and **0001 seeds 20 as well** — so it reads true both on a database where
the pair ran and on one where neither did. `migration list` is what distinguishes those; the
before-read above is what closes the gap for this database.

## Related

- [[0047-audio-preview-attempt-cap-moves-to-50]] — superseded by this note; its ruling 2 (no credit
  charge for previews) survives intact
- [[0040-the-hard-ceiling-moves-to-the-providers]] — the cap design this sits inside; its cap table
  is back to 20 and carries both amendments
- [[app-config-live-state]] — the live row, re-measured at **20** and updated in this commit
- [[token-and-money-budgets]] — the cap table and the read-back rule
- [`docs/05-billing.md`](../../05-billing.md) §"Quotas and caps" — amended in the same commit
