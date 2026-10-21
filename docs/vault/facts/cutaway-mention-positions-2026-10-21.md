---
type: fact
status: verified
verified: 2026-10-21
method: "packages/core/.work/cutaways/dump-fixture-0122.ts (READ ONLY transaction on production: the founder's admin-owned B renders with a lipsync take, one per distinct audio, their scripts' hook text and the business's product and business names) -> productMention on each audio's real words; then .work/cutaways/mention-table.ts lays out the shipped cutawayLayout on the committed fixture (packages/core/test/data/b-cutaway-timings.json, words stripped) at his shortest demo's capacity (84889b25, 49 466 ms). Names and words are never written to the fixture or here."
source: db
---

# Where the product mention lands on the founder's 17 B audios

[[0122-service-b-clips-before-the-effect-first-cut-at-the-product-mention]] makes the draft's first
cut wait for the phrase where the script first names the product (`productMention`:
`product_name`, else the business name, else the first phrase at 40% of the voice). All 17 audios
are one business (Tavnit; `product_name` "Tavnit.ai", business name "Tavnit").

| Audio      | VO s  | Hook leaves s | Mention s (% VO) | 40% point s | Method       | Name count | Brand spoken s | Draft           | First cut s | Heads after it s |
| ---------- | ----- | ------------- | ---------------- | ----------- | ------------ | ---------- | -------------- | --------------- | ----------- | ---------------- |
| `cbd62014` | 20.04 | 2.80          | 11.36 (57%)      | 8.01        | product_name | 1          | 11.80          | strict, 1 clip  | 11.36       | 0.0, 4.2         |
| `a2f93d2d` | 15.23 | 2.52          | 7.92 (52%)       | 6.09        | product_name | 1          | 8.16           | strict, 1 clip  | 7.92        | 0.0, 2.1         |
| `5c0a100f` | 17.01 | 2.72          | 8.16 (48%)       | 6.80        | product_name | 1          | 8.72           | strict, 1 clip  | 8.16        | 0.0, 3.8         |
| `bc3a3cb3` | 17.87 | 4.44          | 9.68 (54%)       | 7.15        | product_name | 1          | 10.24          | strict, 1 clip  | 9.68        | 0.0, 3.5         |
| `ab7e3837` | 16.27 | 1.96          | 6.96 (43%)       | 6.51        | product_name | 1          | 7.20           | strict, 1 clip  | 6.96        | 0.0, 4.1         |
| `6093f62a` | 16.93 | 2.16          | 6.80 (40%)       | 6.77        | product_name | 1          | 6.80           | strict, 1 clip  | 6.80        | 0.0, 4.4         |
| `86cef649` | 17.40 | 3.80          | 9.52 (55%)       | 6.96        | product_name | 1          | 10.00          | strict, 1 clip  | 9.52        | 0.0, 3.2         |
| `55d3b109` | 18.72 | 1.26          | 8.16 (44%)       | 7.49        | share        | 0          | 12.00          | strict, 1 clip  | 9.00        | 0.8, 3.8         |
| `f76fff01` | 28.32 | 2.68          | 12.80 (45%)      | 11.33       | share        | 0          | 22.64          | strict, 2 clips | 12.80       | 0.0, 3.2, 3.3    |
| `75d5aed2` | 18.72 | 2.00          | 8.72 (47%)       | 7.49        | share        | 0          | 10.64          | strict, 1 clip  | 8.72        | 0.0, 5.0         |
| `d975af92` | 16.88 | 2.24          | 7.04 (42%)       | 6.75        | share        | 0          | 10.80          | strict, 1 clip  | 7.04        | 0.0, 4.7         |
| `7854ea9a` | 14.64 | 2.07          | 11.36 (78%)      | 5.86        | product_name | 1          | 11.64          | vo_too_short    | —           | —                |
| `a8b4ea4e` | 19.20 | 2.22          | 8.24 (43%)       | 7.68        | share        | 0          | 17.04          | strict, 1 clip  | 9.64        | 1.4, 3.7         |
| `7796ac70` | 19.76 | 2.16          | 8.84 (45%)       | 7.90        | share        | 0          | 17.76          | strict, 1 clip  | 11.00       | 2.2, 2.8         |
| `190ef323` | 6.32  | 3.04          | 3.04 (48%)       | 2.53        | share        | 0          | —              | vo_too_short    | —           | —                |
| `4f0d448a` | 14.00 | 3.20          | 10.84 (77%)      | 5.60        | product_name | 1          | 10.84          | vo_too_short    | —           | —                |
| `d3fbdd4e` | 12.00 | 1.72          | 4.88 (41%)       | 4.80        | share        | 0          | —              | strict, 1 clip  | 4.88        | 0.0, 2.3         |

Columns: "Hook leaves" is the script's own drafted hook text (what the draft lays out from), in VO
time. "Mention" is the start of the caption phrase holding the name (or, for `share`, the first
phrase at or after 40%). "Brand spoken" is the first word holding `tavnit` or `תבנית` in any
spelling, for the report only. "Heads after it" runs from the mention to the first cut, between
cuts, and to the end.

**What it shows.**

- The 9 audios whose words carry "Tavnit.ai" are matched by `product_name`, each spoken once: at
  40–57% of the voice on the 7 v17 scripts and at 77–78% on two older ones, which leaves no room
  for a clip and a final head after it (`vo_too_short`).
- The 8 `share` audios are older scripts. 6 say the brand in Hebrew letters ("תבנית"), which a
  Latin `product_name` does not match; on those the 40% point lands **1.9–9.8 s before** the name
  is spoken. 2 never say it. Since b_script v15 a Latin brand is written as the brand writes it
  (vault 0033), so a current script is matched by name.
- Every draft that lays out keeps the rule: no cut before the mention, heads after it ≤ 5.0 s, the
  ad ending on the character. All are the strict tier: with the first cut at the mention, the
  word-start tiers that 3 audios needed under 0121's 3 s rule are no longer reached on these.
- The same 17 layouts at an unbounded demo are identical (packages/core/test/cutaway-structure.test.ts pins both).
