---
type: fact
status: verified
verified: 2026-10-19
method: "packages/core/.work/own-voice-step0.ts (read-only; gitignored): the three most recent ready b_script audio_renders with alignment_source = 'elevenlabs' of admin-owned businesses, downloaded with getStorage().download, then `ffprobe -show_streams -show_format` and `ffmpeg -af loudnorm=print_format=json -f null -` (the input_* fields)."
source: code
---

# Stored TTS mp3s: mp3, 44.1 kHz, mono, 128 kb/s, at about −20 LUFS

What the AI branch hands lipsync, measured so the own-voice transcode can match it
([[0118-service-b-own-voice]]).

| audio_render | codec | rate  | channels | bit rate | file ms = db ms | integrated  | true peak  | LRA     |
| ------------ | ----- | ----- | -------- | -------- | --------------- | ----------- | ---------- | ------- |
| 014e98dc     | mp3   | 44100 | 1 (mono) | 128000   | 20800 = 20800   | −20.50 LUFS | −2.45 dBTP | 2.60 LU |
| b97df868     | mp3   | 44100 | 1 (mono) | 128000   | 17600 = 17600   | −20.28 LUFS | −2.03 dBTP | 1.20 LU |
| 0d54d141     | mp3   | 44100 | 1 (mono) | 128000   | 18720 = 18720   | −19.11 LUFS | −2.02 dBTP | 1.10 LU |

- Mean integrated loudness −19.96 LUFS; true peaks −2.0 to −2.5 dBTP. The own-voice target is
  therefore −20 LUFS with a −2 dBFS limiter (`RECORDING_TARGET_LUFS`, `RECORDING_PEAK_DB`,
  `pipelines/recordings.ts`).
- The loudness range is 1–2.6 LU: ElevenLabs output is already compressed. A phone recording is not,
  and a single linear gain will leave it more dynamic than a TTS file. That is the "no cleanup"
  ruling holding, not a defect.
- `duration_ms` equals the file length on all three, as [[b-audio-renders-have-no-tail-silence]]
  measured on six others.
