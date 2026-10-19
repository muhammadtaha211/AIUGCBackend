---
type: fact
status: verified
verified: 2026-10-19
method: "packages/core/.work/own-voice-step0.ts (read-only DB and storage; three paid Scribe calls): the three most recent ready b_script audio_renders of admin-owned businesses (014e98dc, b97df868, 0d54d141; 20.8, 17.6, 18.72 s), each sent to POST /v1/speech-to-text with model_id=scribe_v2, language_code=heb, timestamps_granularity=word, tag_audio_events=false, no_verbatim=false, diarize=false. Scribe's type=word entries matched in order against the stored word_timestamps words by letters and digits only (lookahead 4). Raw responses in packages/core/.work/own-voice-step0/scribe-{1,2,3}.json (gitignored)."
source: code
---

# Scribe v2 on Hebrew: every word right on TTS speech, starts ~60 ms after the ElevenLabs alignment

The first live calls after the founder granted Speech to Text on the key
([[scribe-key-has-no-speech-to-text-permission-2026-10-19]]), run for his amendment 4 in
[[0118-service-b-own-voice]].

## The calls

- **HTTP 200** on all three, in 7.2, 6.1 and 4.3 s.
- Response keys: `language_code, language_probability, text, words, transcription_id, audio_duration_secs`.
- `language_code = heb`, `language_probability = 1` on all three.
- Words are `{text, start, end, type, logprob}`. Their types are `word` (140) and `spacing` (137),
  with no `audio_event` (tag_audio_events was false) and no null times.
- Times are in seconds, on a 20 ms grid.
- Punctuation rides on the word (`"לבד,"`). A pause sits in the `spacing` entry between two words:
  one ran 4.04–4.48 s, a 440 ms pause.
- Billed audio: 57.1 s, about ₪0.01 at the list price. The lowest word logprob was −0.158.

## Accuracy, on clean TTS speech only

- **140 of 140 words** matched the spoken script's letters and digits.
- 127 of 140 were identical including punctuation. The other 13 differ only in punctuation.

This is ElevenLabs' own synthesized Hebrew, so it is not a measure on a phone recording of a human.
The founder's one sample of his own voice on elevenlabs.io (FOUNDER-REPORTED) is the only human data
point so far.

## Timing against the stored ElevenLabs alignment (ms; positive = Scribe later)

|            | n   | min  | p5   | median | p95     | max |
| ---------- | --- | ---- | ---- | ------ | ------- | --- |
| word start | 140 | −60  | 0    | 60     | **140** | 320 |
| word end   | 140 | −600 | −160 | 60     | 160     | 380 |

- **First word:** Scribe 100, 100 and 60 ms; ElevenLabs 0 ms on all three.
- **Last word's end:** Scribe 40, 100 and 40 ms _earlier_ than ElevenLabs.

The reference is ElevenLabs' character alignment, not a measured acoustic onset, so these are
relative timings. Either clock could be the early one.

## What it decided

Amendment 4: past a p95 lateness of 100 ms, the lead margin becomes the p95 plus 50 ms. So
`RECORDING_LEAD_MS` is **190** (`pipelines/recordings.ts`); it was 100.

The tail margin (150 ms after the last word, the founder's own figure) was not part of amendment 4
and is unchanged. Two numbers bear on it:

- The observed last-word ends ran 40–100 ms early, which 150 covers.
- The pooled word-end p5 is −160 ms, which a last word could exceed.
