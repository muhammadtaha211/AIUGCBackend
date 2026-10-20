---
type: defect
status: verified
verified: 2026-10-20
method: "Two eleven_v4 with-timestamps calls ([[eleven-v4-paid-check-2026-10-20]]): the last alignment end time against the decoded file (`ffmpeg -af astats=measure_overall=Number_of_samples` ÷ 44,100), and the same on the stored v3 file of each script. Code read at feat/tts-eleven-v4: packages/core/src/pipelines/tts.ts (handleSynthTts, durationMs), packages/core/src/pricing.ts (quoteServiceB, settle), packages/core/src/pipelines/sets.ts (quoteBRender), packages/core/src/service-b-timeline.ts (totalMs), packages/core/src/pipelines/renders.ts (the lipsync hop's audioMs)."
source: code
---

# On eleven_v4, `audio_renders.duration_ms` is 80 ms longer than the audio file — FIXED 2026-10-20 on `feat/tts-eleven-v4` (not merged)

## FIXED 2026-10-20, on the founder's ruling

He chose the clamp in chat: "Do this task here: 'Clamp v4 duration_ms to the audio file'"
([[0119-tts-is-eleven-v4-plain-text]] §5).

**What changed in code (MEASURED in the diff):**

- `handleSynthTts` stores `duration_ms` as the shorter of the alignment's last end time and the
  probed file (`measureDurationMs`, ffprobe's format duration).
- DRY_RUN keeps the alignment end, because its fake buffer is not an mp3.
- The karaoke chunks keep ElevenLabs' times, so the last word may end up to 80 ms past
  `duration_ms`. Three readers see that ordering. They are MEASURED in code; the effects below are
  REASONED, and none breaks:
  - **`service-b-timeline.ts` `hookHandoffMs`.** When the hook covers the whole script, or its read
    time outlasts the speech, `hookTextMs` can exceed `totalMs` by up to 80 ms (check 1: 250 +
    18,320 against a VO end of 18,490). Remotion clips the longer Sequence, and no caption shows,
    as before. The "never outlives the ad" assertion in `service-b-timeline.test.ts` covers only a
    partial hook, so it stays green.
  - **remotion `timing.ts` `activeChunkIndex`.** The last caption may hold into the ad's last ~2
    frames. This is cosmetic.
  - **`captions.ts` `snapToWordGap`,** read only by the retired avatar-outro path. The slice comes
    out negative instead of 0, which is the same "VO slice is empty" `PermanentError`.

  Clamping the caption times too would restore the ordering. That goes past his ruling, so it is
  not done.

- Tests in `packages/core/test/tts-plain-text.test.ts` use a real one-second mp3:
  - the alignment runs 80 ms past the file → `duration_ms` is the file's length;
  - the alignment stops 200 ms inside it → `duration_ms` is the alignment's end.

**MEASURED on the two real v4 files** (free, `packages/core/.work/eleven-v4/clamp-replay.ts`,
gitignored): `measureDurationMs` gives 18,240 and 21,040, so the clamp stores exactly the decoded
lengths below. Their quotes are 92 and 106 credits either way: neither crossed a boundary.

The production preview row `997a5ec7` was written before the fix and keeps 21,120. That is the same
106 credits, and it is left alone.

The text below is the defect as it stood.

## The defect (MEASURED)

`handleSynthTts` takes `durationMs` from the alignment's last character end time whenever an
alignment exists, and probes the file only when there is none. On eleven_v3 the two agree: the
stored files `87a39c86` and `014e98dc` decode to exactly their `duration_ms` (19,680 and 20,800).
On eleven_v4 the alignment runs past the audio by exactly **80 ms** on both calls measured:

| call                 | last alignment end = `duration_ms` | decoded file |
| -------------------- | ---------------------------------- | ------------ |
| check 1 (`8e252ccc`) | 18,320                             | 18,240       |
| `997a5ec7`           | 21,120                             | 21,040       |

So once the box runs v4, every new `duration_ms` is about 80 ms longer than its audio. That breaks
the "`duration_ms` equals the file's real length" property [[b-audio-renders-have-no-tail-silence]]
recorded on v3. Two samples; whether it is always 80 ms is not known.

## What reads `duration_ms` (MEASURED in code; the effects are REASONED)

- **The customer's Service B quote.** `quoteBRender` → `quoteServiceB` charges
  `seconds × b_per_second`, then `settle` rounds up with `Math.ceil`. At 5 credits a second the extra 0.08 s
  adds 0.4 credit before rounding. **A quote above the floor therefore goes up by one credit
  whenever its subtotal was a whole number or its fractional part was over 0.6** — about two
  renders in five, by the uniform arithmetic. A whole number is common: `duration_ms` in steps of
  200 gives one, e.g. `014e98dc`'s 20,800 ms is 104.0 credits, and 104.4 would bill 105. Neither
  measured v4 preview crossed a boundary (91.6 and 105.6 both ceil as 91.2 and 105.2 do). This
  touches credits, so it is the founder's call, and merging as it is changes those quotes.
- **The B timeline.** `totalMs = max(lipsyncEndMs, voEndMs)` with
  `voEndMs = captionOffsetMs + voDurationMs`. HeyGen generates to the padded file, so the video runs about 80 ms past the clip.
  The composition holds the clip's last frame under the VO tail, so that is 2–3 extra still
  frames at the end. On v3 the hold was the ~15 ms by which the clip runs short.
- **The lipsync hop's cost estimate and runaway guard** use `duration_ms + leadInMs`. The usage
  row's `gpu_seconds` is `Math.ceil(audioMs / 1000)` (`renders.ts`), so the row goes up by one
  second (25 agorot) only when the extra 80 ms crosses a whole second: about one render in twelve,
  an average of 2 agorot. Neither measured call crossed one (19,120 vs 19,040 and 21,920 vs 21,840
  with the 800 ms lead-in). HeyGen itself bills the file it is sent.
- The karaoke chunks: the last word ends at 18,320 / 21,120, inside the timeline either way.

## The fix, as it stood before his ruling

Take `durationMs` as the smaller of the alignment end and the probed file length
(`measureDurationMs`, which the WhisperX branch already calls). That would restore v3's equality.
It was not built in the v4 task: the goal there was "nothing else about the audio path changes",
and the quote is a credit question. **His call.** He made it the same day (the FIXED section
above).

## Related

- [[0119-tts-is-eleven-v4-plain-text]], [[eleven-v4-paid-check-2026-10-20]].
- [[emphasis-signal-in-word-timestamps]] — on v3 the last word ended exactly at `duration_ms`.
