---
type: fact
status: verified
verified: 2026-08-23
method: "read-only SELECTs via packages/core/.work/vault-facts-probe.ts, vault-events-why.ts, vault-plancount.ts and vault-scripts.ts, all run from repo root"
source: db
---

# The whole corpus: 17 demos, 6 analyses, 19 plans, 36 renders

Everything the pipeline has ever processed in production.

## Demos — 17 rows, 16 `ready`, 1 `rejected`

| business     | ready | rejected |
| ------------ | ----- | -------- |
| BotTeacher   | 7     | 0        |
| Matchn       | 6     | 1        |
| MyTor        | 2     | 0        |
| jobnet.co.il | 1     | 0        |

Durations run 9,532 ms to 122,561 ms. The one rejected row (`c1901280`, 2026-08-04) has
`duration_ms = null` — the probe rejected it before a duration was recorded, which is the shape a
free rejection leaves behind.

## Analyses — 6 rows, and the reason it is not 16

`demo_analyses` holds exactly 6 rows, all `ready`, all dated 2026-08-16 or later. That is not a
gap: **`79a1dbc` (2026-08-12, "feat: extend demo duration and enqueue analysis") is the commit that
first enqueued `analyze_demo` from the ingest path.** Every `ready` demo uploaded after it — 6 of
them — has exactly one analysis. The 10 earlier ones predate the enqueue and cost nothing to
analyse because nothing analysed them.

Cost per analysis is in [[analyze-demo-cost]].

## Step plans — 19 rows, 10 `ready`, 9 `failed`, 9 approved

**Sixteen of the nineteen are one demo**, `9553ea19`. The other three are one apiece on
`ba70c3d7`, `ee69edfa` and `3828bab7`. The steps pipeline's whole plan history is essentially one
recording, iterated.

Recorded `prompt_version`: `@v2` ×2, `@v9` ×2, `@v10` ×1, `@v12` ×5 — the newest being `0d1b5f41`,
2026-08-22. **All nine failed rows record `prompt_version = NULL`** and all nine carry the identical
generic string `יצירת תוכנית הצעדים נכשלה — נסו שוב`; only the success path writes the version, and
no row records which rule was broken.

## Renders — 36 rows

| service | status   | count |
| ------- | -------- | ----- |
| a       | released | 13    |
| a       | failed   | 2     |
| b       | released | 15    |
| b       | failed   | 6     |

Of the 13 released Service A renders, **6 carry `params->>'format' = 'steps'`** — the steps format's
entire production history. 15 `sets` rows exist, all `service = 'a'`.

Zero renders are starred, zero are `qc_pending`, zero were regenerated, two were refunded.

## The hook bank is one clip

`hook_clips` holds a single row: `f206ff2b`, 4,086 ms, `active = true`, `persona_id = NULL`, tags
`{"vibe":"מופתעת","energy":"גבוהה","gender":"נקבה"}`. Note the clip is tagged **feminine** — it is
persona-_less_, not gender-neutral, which is the sense in which
[[0001-five-step-steps-wizard]] calls it generic.

## Everything else

`personas` 2, `persona_images` 5, `composites` 1, `structures` 6, `audio_renders` 50, `plans` 3,
`usage_events` 459, `credit_ledger` 16.
Empty: `events`, `sounds`, `orders`, `subscriptions`, `gateway_events`, `pronunciation_entries`.

`scripts` holds **835** rows and is dominated by one kind:

| kind        | rows | versions seen | `user_edited` |
| ----------- | ---- | ------------- | ------------- |
| `hook_line` | 718  | v3–v7         | 2             |
| `b_script`  | 68   | v3–v8         | 17            |
| `vo_script` | 49   | v2–v7         | 10            |

530 of the 718 hook lines are `hook_lines@v7`. One hook-line request returns `n` options
(`packages/core/src/pipelines/copy.ts:163`), so 718 is options generated, not 718 decisions made —
do not read it as customer volume.

`pronunciation_entries` being empty means the find-replace map of locked decision #6 — read by
`packages/core/src/pipelines/pronunciation.ts:16-24` — has never had an entry in production. Every
TTS call to date went out with no respelling applied.

## Related

- [[analyze-demo-cost]], [[events-table-is-empty]], [[timeline-fixtures]]
