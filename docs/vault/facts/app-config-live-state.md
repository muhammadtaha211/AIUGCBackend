---
type: fact
status: verified
verified: 2026-08-23
method: "select key, value from app_config order by key — via packages/core/.work/vault-facts-probe.ts, run from repo root"
source: db
---

# app_config holds exactly 13 rows

Every operational knob is a DB row, but only these 13 exist in production. Anything else the code
reads through `getConfigValueOr` falls back to its code constant — see
[[steps-format-defaults-are-code-constants]].

| key                         | value                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `audio_preview_daily_limit` | `20`                                                                                            |
| `auto_release_b`            | `true`                                                                                          |
| `credit_costs`              | see [[credit-costs-row]]                                                                        |
| `daily_caps`                | see [[token-and-money-budgets]]                                                                 |
| `dunning`                   | `{"retry_days":[2,5],"suspend_after_days":7}`                                                   |
| `imagegen_cost_agorot`      | `15`                                                                                            |
| `lipsync_motion_prompt`     | `"gestures casually with one hand while talking, warm smile"`                                   |
| `lipsync_resolution`        | `"1080p"`                                                                                       |
| `poll_deadline_seconds`     | `900`                                                                                           |
| `retention_days`            | `{"audio_previews":30,"released_renders":90,"raw_after_normalize":30,"watermarked_samples":14}` |
| `tts_enhance`               | `false`                                                                                         |
| `tts_stability`             | `0.5`                                                                                           |
| `words_per_second`          | `{"default":2.1}`                                                                               |

## What the reader has to know

**A missing row is not an error.** `getConfigValueOr` (`packages/core/src/appConfig.ts:24`) returns
the caller's default when the row is absent; `getConfigValue`
(`packages/core/src/appConfig.ts:8`) throws. Only `daily_caps` is read the throwing way, by
`getDailyCaps` (`packages/core/src/budget.ts:136-138`).

**`words_per_second.default` is 2.1, not the 2.2 the seed comment describes.**
`packages/core/src/pipelines/calibrate.ts:9` calls 2.2 "the seed value ... a guess"; the live row
says 2.1. `calibrate.ts:73-75` is an UPDATE on this row, so the divergence is expected — it is
calibration output, not drift.

**`auto_release_b` is `true`.** Standing founder instruction; do not flip it. Consequence recorded
in [[events-table-is-empty]].

## Re-measure with

```
apps/cli/node_modules/.bin/tsx packages/core/.work/vault-facts-probe.ts
```
