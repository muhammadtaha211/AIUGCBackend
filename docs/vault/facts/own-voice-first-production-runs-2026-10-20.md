---
type: fact
status: verified
verified: 2026-10-20
method: "Read-only scripts in packages/core/.work against production, run 2026-10-20: own-voice-watch.ts (5 s polls of voice_recordings, jobs, scripts + audio_renders, video_renders, usage_events and credit_ledger for tavnit.support's business c1c99ab0; log own-voice-watch.log), own-voice-analysis.ts and own-voice-analysis-2.ts (the rows below, every Scribe word with its times, the caption chunks, the spend), own-voice-jobs.ts (the queued job and the box's claims), own-voice-fetch.ts (the released render, the stored mp3 and the approved copy, then ffprobe, ffmpeg ebur128 and cmp on them). The box's branch and restart time are the founder's paste of git branch --show-current, git log -1 and systemctl show aiugc-worker -p ActiveEnterTimestamp."
source: db
---

# The own-voice chain ran end to end on production twice, on 2026-10-20

Branch `feat/b-own-voice` at `9ef1547`, with migrations 0066/0067 applied and the `raw` bucket
widened ([[raw-bucket-allows-audio-2026-10-20]]). The box ran the branch, so this was the first run
of the chain on the box's ffmpeg 6.1 and on a live Scribe call with a human recording. The founder
recorded both takes himself, in a desktop browser on the branch's Vercel preview, signed in as the
founder-owned customer account tavnit.support. Decision [[0118-service-b-own-voice]].

## The box was on main at first

- The first recording (`fd24300a`) was registered at 23:36:28 UTC. Its `transcribe_recording` job
  sat `queued` with 0 attempts.
- At 23:38:42 the box's light lane claimed a later `synth_tts` job instead. `claim()` takes the
  oldest runnable job of the lane's own types, and main registers no `transcribe_recording`.
- The founder's paste: `main`, `2817133`, worker restarted `Mon 2026-10-19 23:25:34 UTC`.
- He moved the box to the branch. Its light lane claimed the waiting job at 23:58:11 and it
  succeeded at 23:58:18. The open transcript tab filled in by itself: the step keeps polling under
  its "stuck" line.

## The two takes

|                                     | take 1                                | take 2                                                 |
| ----------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| recording                           | `fd24300a`, `upload.webm`             | `ba1596d2`, `upload.webm`                              |
| read from                           | his own words                         | the teleprompter script                                |
| upload → ready                      | job ran in 7 s                        | 00:21:41 → 00:21:48                                    |
| source length                       | 38,040 ms                             | 16,200 ms                                              |
| stored (the cut)                    | 33,593 ms (ffprobe 33.560 s)          | 14,681 ms                                              |
| Scribe words                        | 42, one filler `אה,` at 31,090–31,130 | 34                                                     |
| first word starts                   | 190 ms                                | 190 ms                                                 |
| corrections                         | dropped index 38 (`אה,`), no respell  | none                                                   |
| hook line (`hook_text@v3`, derived) | `אני רוצה להגיד שדברים כאלה`          | `חשבתי שכל אפליקציה כזאת זה אותו סיפור`                |
| approved pair                       | script `c50658d3`, audio `246bfc4a`   | script `6e29a787`, audio `2f69a4cf`                    |
| render                              | `7681c44c`, zoom, released 00:08:28   | `5dc9264c`, zoom, released 00:26:14                    |
| credits debited                     | 168 (33.593 s × 5)                    | 75 (14.681 s × 5 = 73.4, under `b_minimum_credits` 75) |
| HeyGen                              | `gpu_seconds` 35, 875 agorot          | `gpu_seconds` 16, 400 agorot                           |

- **The first word starts at 190 ms** in both stored files: `RECORDING_LEAD_MS`, as built.
- **Take 1's stored length** is the last word's end (33,410) plus the 150 ms tail, 33,560 ms, by
  ffprobe.
- **Approval debited nothing.** The balance held at 975 from approval (00:04:09) until the render
  debit (00:04:43).
- **The approved pair:**
  - `voice_id` NULL, `alignment_source` `scribe`;
  - `scripts.prompt_version` NULL, `structure_id` NULL, `user_edited` false,
    `params.source` `recording`;
  - `params.heardText` equals `voice_recordings.heard_text`;
  - `scripts.created_at` equals `audio_renders.created_at`, so `pointerMoved` is false;
  - its mp3 is its own copy under `audio/<audioRenderId>/`, byte-identical to the recording's
    stored file (`cmp`).
- **Loudness:** the stored mp3 is 44.1 kHz mono at **−20.4 LUFS**. The released render's sound is
  −20.3 LUFS, the level of the TTS files ([[tts-mp3-format-and-loudness-2026-10-19]]).
- **The render:** 1080×1920 H.264, 33.877 s. HeyGen's clip is 25 fps, 34.36 s: the 800 ms lead-in
  plus the stored audio.

## Spend, from `usage_events` (the whole walk, 22:42 → 00:26 UTC)

- `llm_tokens`, 6 calls, 17 agorot: two teleprompter or AI scripts, two hook derivations, two
  content-policy checks.
- `tts_chars` 156, 5 agorot: one AI-door preview, never approved.
- `stt_seconds` 39 + 17, 2 agorot.
- `gpu_seconds` 35 + 16, 1,275 agorot.
- **Total ₪12.99**, against the task's ₪25 cap. tavnit.support's credits went 975 → 732.

## Related

- [[own-voice-captions-at-pauses-2026-10-20]] — what the captions did at the pauses and the drop.
- [[service-b-render-audio-sits-60ms-after-its-timeline-2026-10-20]] — the sync measurement.
- [[migrations-0066-0067-applied-but-only-on-a-parked-branch]] — what the parked branch leaves
  behind.
