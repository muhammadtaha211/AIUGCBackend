---
type: fact
status: verified
verified: 2026-09-07
method: "select key, value from app_config order by key — via packages/core/.work/vault-app-config-recheck-2026-09-07.ts (a narrower, app_config-only copy of vault-facts-probe.ts, gitignored, not part of the repo), run from repo root"
source: db
---

# app_config holds exactly 13 rows

Every operational knob is a DB row, but only these 13 exist in production. Anything else the code
reads through `getConfigValueOr` falls back to its code constant — see
[[steps-format-defaults-are-code-constants]].

| key                         | value                                                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `audio_preview_daily_limit` | `20`                                                                                                                 |
| `auto_release_b`            | `true`                                                                                                               |
| `credit_costs`              | see [[credit-costs-row]]                                                                                             |
| `daily_caps`                | see [[token-and-money-budgets]]                                                                                      |
| `dunning`                   | `{"retry_days":[2,5],"suspend_after_days":7}`                                                                        |
| `imagegen_cost_agorot`      | `15`                                                                                                                 |
| `lipsync_expressiveness`    | `"medium"`                                                                                                           |
| `lipsync_motion_prompt`     | `"Speaks naturally to the camera with a warm, relaxed expression, small natural head movements, steady eye contact"` |
| `lipsync_resolution`        | `"1080p"`                                                                                                            |
| `poll_deadline_seconds`     | `900`                                                                                                                |
| `retention_days`            | `{"audio_previews":30,"released_renders":90,"raw_after_normalize":30,"watermarked_samples":14}`                      |
| `tts_enhance`               | `false` — was `true` at this note's own measurement; see the correction below                                        |
| `words_per_second`          | `{"default":2.1}`                                                                                                    |

## Correction — `tts_enhance` is `false` again (2026-09-08)

Re-measured **2026-09-08** with
`select key, value from app_config where key in ('tts_enhance','tts_stability','words_per_second')`
(read-only, `packages/core/.work/latin-check.ts`, run from repo root): `tts_enhance` is **`false`**,
`words_per_second` is still `{"default":2.1}`, and `tts_stability` is still absent. So the flag was
`true` for at most a day. Nothing in the repo flips it — `app_config` rows are hand-edited in the
SQL editor and carry no `updated_at` trigger, so when it went back is not recoverable.

Consequence, and the reason this was re-measured: with the flag off, `handleSynthTts`
(`packages/core/src/pipelines/tts.ts:235-241`) skips `enhanceWithAudioTags` entirely, so the string
`applyPronunciationMap` and ElevenLabs receive is `scripts.text` verbatim — no injected bracketed
English audio tags. Only the **other 12 rows** in the table below are still as of 2026-09-07; this
one row is as of 2026-09-08.

## Correction — `audio_preview_daily_limit` is back to `20` (2026-09-16)

Founder decision 2026-09-16 reversed the raise below: the cap goes back from 50 to **20**
([[../decisions/0049-audio-preview-attempt-cap-back-to-20]], superseding
[[../decisions/0047-audio-preview-attempt-cap-moves-to-50]]). Service B is an occasional format, a
good voice needs 2–3 retries rather than 50, and the 50 was reasoned rather than measured.
`supabase/migrations/0040_audio_preview_cap_back_to_20.sql` was applied to production the same day on
the founder's explicit instruction for that one push, and the table above is updated **because it was
re-measured, not because the migration says so**:

```
apps/cli/node_modules/.bin/tsx packages/core/.work/readback-0040.ts 20   # throwaway, gitignored
```

which calls `getConfigValue(db, "audio_preview_daily_limit", z.number().int())` — the exact call
`packages/core/src/pipelines/tts.ts:76` makes — and got **20** back, parsed as a number.

**The same script was run BEFORE the push and returned 50.** That matters more here than it did for
0038: 0040's `UPDATE` is guarded on `value = '50'::jsonb`, so a row that had drifted would have left
the migration a silent no-op that still exits 0 and still records its version in the ledger. The
before-read is what proves the guard matched rather than skipped — and, incidentally, that nobody had
hand-edited this row between 2026-09-13 and 2026-09-16. Only **this one row** is as of 2026-09-16;
the rest of the table is still as of 2026-09-07, except `tts_enhance` (2026-09-08, above).

## Superseded correction — it was `50` between 2026-09-13 and 2026-09-16

Founder decision 2026-09-13 raised the free-preview attempt cap from 20 to **50**
([[0047-audio-preview-attempt-cap-moves-to-50]]). `supabase/migrations/0038_audio_preview_limit_50.sql`
was applied to production the same day on the founder's explicit instruction for that one push, and
the table above is updated **because it was re-measured, not because the migration says so**:

```
apps/cli/node_modules/.bin/tsx packages/core/.work/verify-0038.ts   # throwaway, gitignored
```

which calls `getConfigValue(db, "audio_preview_daily_limit", z.number().int())` — the exact call
`packages/core/src/pipelines/tts.ts:76` makes — and got **50** back. Going through the code's parse
rather than a raw `SELECT` is the point for a bare jsonb scalar: a row holding the JSON string `"50"`
prints identically to the number `50` in most SQL output and then throws at the next customer
preview. Only **this one row** is as of 2026-09-13; the rest of the table is still as of 2026-09-07,
except `tts_enhance` (2026-09-08, above).

Noted in the same pass: the "only `daily_caps` is read the throwing way"
sentence further down is **incomplete**. `audio_preview_daily_limit` is read with the throwing
`getConfigValue` too (`packages/core/src/pipelines/tts.ts:76`, with `z.number().int()`), so a missing
row — or a row holding a JSON string instead of a number — fails the customer's preview rather than
falling back to a constant.

## What changed since the last check (2026-08-23)

- **`tts_enhance` flipped `false` → `true`** — founder, in chat, 2026-09-07. (And back to `false` by
  2026-09-08 — see the correction above.)
- **`tts_stability` (was `0.5`) is gone from the table.** `pipelines/tts.ts:229` reads it through
  `getConfigValueOr(..., undefined)`, so an absent row is not an error: `voice_settings` is simply
  omitted from the ElevenLabs request and the provider default applies. Nothing in this pass
  established when or why the row was removed — recorded as observed, not explained.
- **`lipsync_expressiveness` is new** (`"medium"`), and `lipsync_motion_prompt`'s value changed —
  both seeded by migration 0034 and founder-set since, per
  [vault 0022](../decisions/0022-heygen-expressiveness-medium-generic-motion-prompt.md).
- The row count is still 13 — one dropped (`tts_stability`), one added (`lipsync_expressiveness`).

## What the reader has to know

**A missing row is not an error.** `getConfigValueOr` (`packages/core/src/appConfig.ts:24`) returns
the caller's default when the row is absent; `getConfigValue`
(`packages/core/src/appConfig.ts:8`) throws. Only `daily_caps` is read the throwing way, by
`getDailyCaps` (`packages/core/src/budget.ts:136-138`).

**`words_per_second.default` is 2.1, not the 2.2 the seed comment describes.**
`packages/core/src/pipelines/calibrate.ts:9` calls 2.2 "the seed value ... a guess"; the live row
says 2.1. `calibrate.ts:73-75` is an UPDATE on this row, so the divergence is expected — it is
calibration output, not drift.

**`auto_release_b` is `true`.** Settled permanently 2026-09-09 —
[[0036-auto-release-b-is-always-on]] — not a standing instruction awaiting a revamp any more. Do
not flip it. Consequence recorded in [[events-table-is-empty]].

## Re-measure with

```
apps/cli/node_modules/.bin/tsx packages/core/.work/vault-facts-probe.ts
```
