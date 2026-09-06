---
type: fact
status: verified
verified: 2026-09-06
method: "apps/cli/node_modules/.bin/tsx packages/core/.work/beat-signal.ts — reads every audio_renders row whose word_timestamps is not null (2 rows in prod), flattens the chunks to words, and reports Pearson r(word duration, letter count), the inter-word gap distribution, and whether the longest-BY-DURATION word of each chunk is also the longest-BY-LETTERS one"
source: db
---

# Word duration is mostly letter count; the gap BEFORE a word is the prosodic signal

The stored `word_timestamps` carry no stress marks, so a camera punch on an
"emphasis word" ([[service-b-hook-animation-mocks-2026-09-06]], mock D) has to
infer one. The obvious pick — the longest-spoken word of each caption chunk —
is largely a spelling artifact.

| audio_renders | words | r(duration, letters) | ms/letter | longest-by-duration == longest-by-letters |
| ------------- | ----- | -------------------- | --------- | ----------------------------------------- |
| fc3ffa7b…     | 27    | **0.758**            | 72.9      | 3 of 9 chunks                             |
| 27b9853e…     | 27    | **0.838**            | 77.7      | 6 of 9 chunks                             |

Both rows are the same Hebrew script at two ElevenLabs draws, so this is one
script measured twice, not two independent samples.

## The rival signal, in the same JSON

The gap between a word's start and the previous word's end. It is bimodal and
the threshold is not a judgement call:

| audio_renders | median gap | max gap | gaps ≥ 200ms |
| ------------- | ---------- | ------- | ------------ |
| fc3ffa7b…     | 40ms       | 720ms   | **4**        |
| 27b9853e…     | 53ms       | 800ms   | **4**        |

A ~40ms median against a 720–800ms max means 200ms is an outlier cut, not a
tuned constant, and both rows give exactly four beats. On 27b9853e… those land
at VO 2520 / 4880 / 8640 / 11040ms — each one a silence→onset a viewer hears.
Duration-picking gave nine, one every ~1.2s.

## One more artifact worth knowing

**The last word of every VO ends exactly at `duration_ms`** — 11520/11520 and
12000/12000. ElevenLabs' character alignment hands the file's trailing silence
to the final word, so the last word's duration is inflated by construction and
any duration-ranked pick is biased toward it.

## Not measured

Whether a gap ≥200ms tracks emphasis in the sense a viewer would name (it
tracks a pause, which is not the same thing), and whether either signal holds
on a different script or a different voice. n=2 rows, one script.

## Related

- [[service-b-hook-animation-mocks-2026-09-06]] — the mock this decided
- [[0023-hook-is-a-remotion-animation-opener-clips-retired]]
