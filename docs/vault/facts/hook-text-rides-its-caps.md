---
type: fact
status: verified
verified: 2026-09-08
method: "Read-only query over production (packages/core/.work/b-script-failure-forensics.ts, gitignored): select s.created_at, s.prompt_version, length(s.params->>'hookText') as chars, array_length(regexp_split_to_array(trim(s.params->>'hookText'), '\\s+'), 1) as words from scripts s where s.kind = 'b_script' and s.created_at > now() - make_interval(days => 30) — 39 rows, 2026-09-08 03:30 UTC. The generation-route failure itself is the founder's read of the Vercel log, quoted below."
source: db
---

# `hook_text` does not approach its caps, it lands exactly on them

The on-screen hook line is capped at 7 words and 40 characters
(`packages/core/src/hook-text.ts`), and until 2026-09-08 an over-cap line threw away the whole
generation. It turns out the model treats those caps as the target.

## The distribution, 39 production `b_script` rows over 30 days

| measure                        | value                                      |
| ------------------------------ | ------------------------------------------ |
| rows                           | 39 (v12 19, v10 8, v9 12)                  |
| hook_text words = 7 (the cap)  | 23 of 39                                   |
| hook_text chars = 40 (the cap) | 9 of 39                                    |
| chars ≥ 38                     | 15 of 39                                   |
| chars ≥ 36                     | 18 of 39                                   |
| max words / max chars          | 7 / 40 — never over, in rows that survived |

Rows that exist are the survivors: an over-cap line threw before the insert, so the 39 are
censored at the cap by construction. That is exactly why the "=7 words" share matters — 59% of
saved hooks sit on the ceiling, so the ones that missed it missed by one word from a
distribution piled against the wall.

Word counts here are whitespace tokens (the SQL above), not `hookTextWordCount`, which ignores
tokens carrying no letter or digit. The two differ only on a line containing a spaced dash.

## The failure it caused

The founder read the Vercel log and reported the message: **`hook_text is 8 words — the cap is
7`** — `assertHookText`'s wording (`hook-text.ts:73`). The customer's request failed and they
saw `משהו השתבש. נסו שוב בעוד רגע.`

**Which route threw it is not settled by that line.** `assertHookText` is called from two
places: `generateBScript` (POST `/api/businesses/[id]/scripts`) and `deriveHookText` (POST
`/api/scripts/[id]/text`, the edit save). The founder filed it under the generation route, and
the fix was scoped there. The DB in the queried window points the other way, so one of two
things is true and this note does not claim to know which:

- the generation failure happened **after** 2026-09-08 03:30 UTC, when this query ran; or
- the logged line came from the **edit** route.

What the window does show: of 61 `anthropic`/`llm_tokens` events, exactly one has no script
row within 90 s, no nearby plan and no `job_id` — 1396 tokens, business Tavnit, 2026-09-07
11:04:11 UTC, seven seconds after a successful edit. Its size makes it a `hook_text`
derivation: the other twelve `<2k` events each match an edited `b_script` row, while `b_script`
generations measured 3592–5079 tokens, and every event in that range matched a script row. So
in these 30 days the only paid call that died without a row died in `deriveHookText`, not in
`generateBScript`.

## What was done about it

[[0030-hook-text-falls-back-to-the-extractor-never-trims]] — the fallback and the prompt aim.
No business had `product_kind` set in any of these 39 rows, so the extra opener length that
field adds ([[0027-product-kind-is-an-optional-questionnaire-field]]) has not yet pushed on
these caps at all.

## Related

- [[0028-scripts-end-on-a-closer-from-a-curated-bank]] — the same 39 rows by prompt version.
