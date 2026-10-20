---
type: fact
status: verified
verified: 2026-10-20
method: "Three paid scripts on feat/tts-eleven-v4, run from repo root with apps/cli/node_modules/.bin/tsx (gitignored, packages/core/.work/eleven-v4/): `$env:DRY_RUN='0'; tsx check1-direct.ts 8e252ccc` (one call through the branch's synthesize(), no DB write, request body recorded by a fetch wrapper that never reads a request header); `tsx check-cost-header.ts` (one 42-character line on eleven_v3 then eleven_v4, the `character-cost` response header only); `$env:DRY_RUN='0'; tsx check2-pipeline.ts af00027b` (one preview through handleSynthTts, production rows written). Measured free with `tsx measure.ts <mp3> ar:<audio_render>` (ffprobe; silencedetect at -45/-35/-30 dB, d=0.3 as [[b-audio-renders-have-no-tail-silence]] and d=0.02 for the edges; astats RMS) and `ffmpeg -af astats=measure_overall=Number_of_samples` for the exact length, `ffmpeg -af loudnorm=print_format=json` for integrated loudness. Price: elevenlabs.io/pricing/api read 2026-10-20."
source: code
---

# Eleven v4 paid check, 2026-10-20: with-timestamps accepts it, the chunker is unchanged, the file is 1–2 LU quieter and 80 ms shorter than its alignment

The checks behind [[0119-tts-is-eleven-v4-plain-text]]. Every number below was measured by this
session on 2026-10-20; nothing is carried.

## The endpoint: TTS with-timestamps takes eleven_v4

`POST /v1/text-to-speech/{voice}/with-timestamps?output_format=mp3_44100_128` answered **200** to
`model_id: "eleven_v4"`, with audio and a character alignment. The text-to-dialogue fallback the
task named was not needed and was not called. ElevenLabs' docs name only Create speech and Stream
speech for v4 and are silent on with-timestamps, so this call is the evidence.

The body as sent (check 1, the text elided to its length):

```
{"text":"<190 chars>","model_id":"eleven_v4","voice_settings":{"stability":1,"similarity_boost":1}}
```

No `language_code`, `style`, `speed` or `use_speaker_boost`. The text had no `[` or `]` and was the
sent text exactly.

## The chunker, on the real alignment

| check                 | script (Tavnit, `b_script@v17`) | voice     | chars | words | chunks         | captions = spoken words |
| --------------------- | ------------------------------- | --------- | ----- | ----- | -------------- | ----------------------- |
| 1, direct, no row     | `8e252ccc`                      | עומרי (m) | 190   | 33    | 11 × 3         | yes                     |
| 2, pipeline, prod row | `af00027b`                      | שירה (f)  | 267   | 50    | 16 × 3, then 2 | yes                     |

The alignment's characters equal the sent text character for character (check 1). Chunks keep
today's shape: `{text, startMs, endMs, words: [{word, startMs, endMs}]}`. Check 2 is
`audio_renders` **`997a5ec7-17e6-4488-94bb-14a8eb8a8fb2`**: `ready`,
`alignment_source = elevenlabs`, `stretch_ratio` 1, `rendered_text` equal to the script byte for byte, one
`usage_events` row `tts_chars` 267, 9 agorot, `job_id` null (the handler was called directly, not
claimed from the queue; see the script's header). It is not approved, and nothing renders from it.

## The files, against v3 on the same script and voice

Each v4 file beside the stored v3 file of the same script (`87a39c86` and `014e98dc`, both
`alignment_source = elevenlabs`, `tts_enhance` off, so plain text).

| file               | model | file length | `duration_ms` | words/s (`duration_ms`) | lead silence −45/−35/−30 dB | tail silence −45/−35/−30 dB | RMS whole / last 3 s / last 1 s / first 1 s |
| ------------------ | ----- | ----------- | ------------- | ----------------------- | --------------------------- | --------------------------- | ------------------------------------------- |
| check 1 (8e252ccc) | v4    | 18,240 ms   | 18,320        | 1.80                    | 23 / 39 / 40 ms             | 206 / 217 / 251 ms          | −23.7 / −24.8 / −24.4 / −21.9 dB            |
| `87a39c86`         | v3    | 19,680 ms   | 19,680        | 1.68                    | 54 / 56 / 61 ms             | 0 / 23 / 31 ms              | −21.8 / −22.9 / −24.0 / −19.1 dB            |
| `997a5ec7`         | v4    | 21,040 ms   | 21,120        | 2.37                    | 51 / 53 / 55 ms             | 154 / 174 / 215 ms          | −22.6 / −20.7 / −20.8 / −21.8 dB            |
| `014e98dc`         | v3    | 20,800 ms   | 20,800        | 2.40                    | 56 / 70 / 72 ms             | 0 / 0 / 0 ms                | −20.5 / −21.4 / −21.0 / −19.9 dB            |

File length is decoded samples ÷ 44,100 (804,384 / 867,888 / 927,864 / 917,280); all four are mp3,
44.1 kHz, mono, 128 kb/s. Silence columns are `silencedetect` at d = 0.02 s. At the older note's
d = 0.3 s, all four files have **no** leading or trailing silence at any threshold.

What follows:

- **Words per second: 2.10 pooled on v4** (83 words over 39.44 s of `duration_ms`; 2.11 over the
  files' 39.28 s), against the live `words_per_second.default` of **2.1**. v3 on the same two
  scripts pooled 2.05. Per script v4 ran 1.80 and 2.37, so the spread is the script, not the
  model. Two samples; the key was not changed.
- **RMS: v4 is 1.9 and 2.1 dB quieter than v3** on the same script and voice: −23.7 and −22.6 dB
  whole-file, against −21.8 and −20.5 on v3. That is 4.2 and 3.1 dB under the −19.5 dB of
  [[b-audio-renders-have-no-tail-silence]] (other scripts, other voices, v3).
- **Integrated loudness** (`ffmpeg -af loudnorm=print_format=json`, `input_i` / `input_tp`):
  - v4: −23.05 LUFS / −3.95 dBTP (check 1) and −21.65 / −1.99 (`997a5ec7`);
  - v3: −20.88 / −0.88 (`87a39c86`) and −20.50 / −2.45 (`014e98dc`).

  So v4 is 2.2 and 1.2 LU quieter. Own voice, on its unmerged branch (`feat/b-own-voice`, decision
  0118 there), normalises a recording to −20 LUFS because the v3 TTS files sit there. Its
  measurement of `014e98dc` is the same −20.50. These v4 files fall 1.7–3.1 LU under that target.

- **Lead-in:** v4 starts speaking 23–55 ms in, v3 54–72 ms. No leading silence reaches 0.3 s on
  either. HeyGen's 800 ms lead-in is added downstream, after this file
  ([[heygen-avatar-iv-idles-on-leading-silence]]).
- **Tail:** v4 ends on 154–251 ms of near-silence (under −30 dB), where v3 ends on speech. None of
  it reaches 0.3 s.
- **`duration_ms` overshoots the file by exactly 80 ms on both v4 calls.** The last character's
  alignment end time (which `handleSynthTts` stores as `duration_ms`) is 18,320 and 21,120, while
  the files decode to 18,240 and 21,040. On v3 the two are equal. The consequences are in
  [[eleven-v4-alignment-ends-80ms-past-its-audio]].

## Price

- **The live API price page lists v4 and v3 at the same rate: $0.08 per 1k characters**, the same on
  every plan row (`elevenlabs.io/pricing/api`, read 2026-10-20; v4 Turbo and v3 Conversational are
  $0.04). So there is no price reason against v4, as the task expected.
- **This account bills the two the same:** the same 42-character line came back with
  `character-cost: 17` on eleven_v3 and `17` on eleven_v4. Check 1's 190 characters returned 76.
- **The code's estimate is stale for both models.** `TTS_COST_AGOROT_PER_1K_CHARS = 30`
  (`pipelines/tts.ts`) prices $0.10 per 1k at USD/ILS 3.00. At $0.08 it would be 24 agorot. Third
  parties report that v3 was cut from $0.10 to $0.08 at v4's launch (around 2026-10-05). The
  estimate was left unchanged: it is a cost question, and the founder's.

## Spend

541 characters synthesized in all: check 1 190, the header check 84 (42 × 2), check 2 267. At the
code's 30 agorot per 1k that is **16 agorot** (5.7 + 2.5 + 8.0; check 2's own usage row rounds up
to 9). At the live $0.08 it is 13 agorot. The task's cap was ₪10. Two free reads both failed:
`GET /v1/user/subscription` answered 401, because the key has no user-read access, and
`GET /v1/models` returned no list. So the account's character counter was not read.

## Not measured

- Whether v4 reads a stray bracket aloud or as a direction. The code never sends one
  ([[0119-tts-is-eleven-v4-plain-text]] §2), so no call tried it.
- Any voice other than עומרי and שירה, and run-to-run spread (one call per script).
- A v4 audio rendered through HeyGen and the B composition. Nothing was rendered.
