---
type: fact
status: verified
verified: 2026-09-08
method: "packages/core/.work/b-audio-tail-probe-2.ts and b-video-tail-probe.ts (read-only; download via getStorage().download, then `ffprobe -show_format`, `ffmpeg -af silencedetect=noise=-45dB:d=0.3` (also -35/-30 dB), and `ffmpeg -af atrim=start=<end-3>,astats` for tail RMS). Six most recent b_script audio_renders (2026-09-08 02:28–02:46 UTC) and five most recent service-B video_renders (2026-09-06 → 2026-09-08)."
source: code
---

# The B audio files, the HeyGen clips and the final videos carry no trailing silence

Checked because the founder reported ~3 s of trailing silence on two of the three most recent
`b_script` audio renders (2026-09-08, `app_config.tts_enhance` false). The stored artifacts do
not show it at any layer.

## Audio renders (the ElevenLabs mp3, `audio_renders.file_path`)

Six most recent `b_script` rows, all `b_script@v12`, all `alignment_source = elevenlabs`,
`stretch_ratio = 1`:

| audio_render | ends on                | duration_ms (db) | ffprobe file | tail silence −45/−35/−30 dB | RMS whole → last 3 s → last 1 s |
| ------------ | ---------------------- | ---------------- | ------------ | --------------------------- | ------------------------------- |
| bf8e299e     | `תנסו ותגידו לי.`      | 19520            | 19520        | 0 / 0 / 0 ms                | −19.7 → −19.6 → −20.0 dB        |
| 12716045     | `הכי ממליצה בעולם!!`   | 19200            | 19200        | 0 / 0 / 0 ms                | −19.9 → −20.3 → −20.8 dB        |
| ddd9b5b1     | `אין על זה, אין.`      | 20321            | 20320        | 0 / 0 / 0 ms                | −19.6 → −19.2 → −23.1 dB        |
| afc4f29a     | `תנסו ותגידו לי.`      | 15760            | 15760        | 0 / 0 / 0 ms                | −19.1 → −19.1 → −18.3 dB        |
| 6571f8ee     | `הכי ממליצה בעולם!!!!` | 20400            | 20400        | 0 / 0 / 0 ms                | −19.5 → −20.2 → −19.1 dB        |
| 73a91c8f     | `תנסו ותגידו לי.`      | 22000            | 22000        | 0 / 0 / 0 ms                | −20.0 → −20.6 → −19.2 dB        |

Three things follow:

- **`duration_ms` equals the file's real length** (±1 ms). `handleSynthTts` takes `durationMs`
  from the last character's alignment end time (`tts.ts:257`), so if ElevenLabs had appended
  silence the file would be longer than `duration_ms`. It is not.
- **The last second is as loud as the whole file.** Speech runs to the final sample; the closer's
  punctuation (`.`, `!!`, `!!!!`) does not produce a silent tail.
- `silencedetect` finds **no silence ≥ 0.3 s anywhere** in any of the six files, at −45, −35 or
  −30 dB — including the internal pauses.

## HeyGen clips and final videos (`video_renders.params.lipsyncPath`, `video_renders.file_path`)

Five most recent service-B renders (all `released`):

| video_render | padded audio (audio + 800) | HeyGen clip | clip − padded | final mp4 | final − padded | final tail silence |
| ------------ | -------------------------- | ----------- | ------------- | --------- | -------------- | ------------------ |
| a8b4ea4e     | 20000                      | 19991       | −9 ms         | 19520     | −480 ms        | 0 ms               |
| 7796ac70     | 20560                      | 20544       | −16 ms        | 20053     | −507 ms        | 0 ms               |
| 190ef323     | 7120                       | 7104        | −16 ms        | 6613      | −507 ms        | 0 ms               |
| 4f0d448a     | 14800                      | 14784       | −16 ms        | 14315     | −485 ms        | 0 ms               |
| d3fbdd4e     | 12800                      | 12780       | −20 ms        | 12331     | −469 ms        | 0 ms               |

HeyGen generates to the padded audio's length minus one frame or so; it never appends a tail.
The final video is ~0.5 s shorter than the padded audio because the layout starts the clip
`leadInMs − GAP_MS = 550 ms` in (`serviceBTimeline`, `lipsyncStartFromMs`) and
`totalMs = max(lipsyncEndMs, voEndMs)` — so the video ends with the speech, not after it.

## What this does not cover

Where the founder heard the silence. The wizard's audio step plays the mp3 straight from a
signed URL (`api/audio/[id]/route.ts` → `<audio src>`), and the render page plays the final
mp4 — both measured clean above. Not measured: a specific player's behaviour with ElevenLabs'
streamed mp3 (no Xing header → some players estimate length from bitrate), and any render
older than the five above. A trailing-silence trim in `handleSynthTts` would have had nothing
to cut on these files.

## Related

- [[eleven-v4-paid-check-2026-10-20]] — these are **v3** files. On v4 (2026-10-20) the same
  method finds no leading or trailing silence ≥ 0.3 s either. Internal pauses ≥ 0.3 s do occur:
  8 / 9 / 10 at −45 / −35 / −30 dB on `8e252ccc`'s v4 file and 0 / 1 / 4 on `997a5ec7`. The v3 twin
  `87a39c86` has 9 / 10 / 10, so the cause is the script, not the model. v4's alignment runs 80 ms
  past the file. `duration_ms` is now clamped to the file (0119 §5), but `997a5ec7` was written
  before the clamp and keeps 21,120 ([[eleven-v4-alignment-ends-80ms-past-its-audio]]). Whole-file RMS is 1.9–2.1 dB
  under the same-script v3 files, and 3.1–4.2 dB under this note's −19.5 dB.

- [[0028-scripts-end-on-a-closer-from-a-curated-bank]] — the closers these files end on.
- [[heygen-avatar-iv-idles-on-leading-silence]] — the _leading_ silence, which is real and by design.
