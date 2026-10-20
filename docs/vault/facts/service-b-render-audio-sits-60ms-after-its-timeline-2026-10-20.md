---
type: fact
status: verified
verified: 2026-10-20
method: "Audio cross-correlation, packages/core/.work/own-voice-xcorr.cjs (normalised correlation of 8 kHz mono s16 tracks decoded by ffmpeg, 4 s windows at 3, 10, 18 and 26 s, lags searched ±300 ms in 0.5 ms steps). Files downloaded read-only from production storage: video_renders 7681c44c (own voice, 2026-10-20) with its HeyGen clip (params.lipsyncPath) and its audio_renders 246bfc4a mp3 (packages/core/.work/own-voice-fetch.ts, own-voice-fetch-lipsync.ts); video_renders 55d3b109 (AI voice, created 2026-09-23T14:25Z) with its audio mp3 (own-voice-fetch-ai.ts). Expected offsets from serviceBTimeline: leadInMs 800, GAP_MS 250 → lipsyncStartFromMs 550, captionOffsetMs 250."
source: db
---

# In released Service B renders, the voice sits 59.5 ms later than the timeline places it, on both doors

| tracks compared                                  | expected               | measured (all windows)        | r         |
| ------------------------------------------------ | ---------------------- | ----------------------------- | --------- |
| HeyGen clip vs the approved mp3 (7681c44c)       | clip = mp3 + 800 ms    | **0 ms** off                  | 0.999     |
| render vs the approved mp3 (7681c44c, own voice) | render = mp3 + 250 ms  | **+59.5 ms** (mp3 + 309.5)    | 0.89–0.91 |
| render vs the HeyGen clip (7681c44c)             | clip = render + 550 ms | **−59.5 ms** (render + 490.5) | 0.89–0.91 |
| render vs the approved mp3 (55d3b109, AI voice)  | render = mp3 + 250 ms  | **+59.5 ms**                  | 0.77–0.79 |

- **HeyGen returns exactly the audio it was given**, at the 800 ms lead-in, with no shift.
- **Our render places that audio 59.5 ms later than `captionOffsetMs`.** The offset is the same
  on an AI-voice render from 2026-09-23 as on the own-voice render. It is not specific to own voice.
- **Measured: the sound only.** The picture's own placement is NOT measured. Remotion seeks the
  clip from 550 ms, and at 30 fps that rounds to a frame (533 or 567 ms). So whether the picture
  shares the 59.5 ms, leads it, or lags it is unknown. The mouth-to-sound offset a viewer sees is
  therefore not established here.
- **REASONED, not measured:** an encoder's priming samples on the render's AAC track would produce a
  constant shift like this. Published thresholds (ITU-R BT.1359) put the detectability of late
  audio at about 125 ms. If the picture sits where the timeline says, 59.5 ms of late audio is
  below that.

Found while judging the first own-voice render, whose lip sync the founder called off
([[0118-service-b-own-voice]], "Parked"). This measurement says our timing is the same on both
doors. It does not explain the difference he saw.

## Related

- [[own-voice-first-production-runs-2026-10-20]]
- [[service-b-timeline-constants]]
