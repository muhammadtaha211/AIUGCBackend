---
type: fact
status: verified
verified: 2026-09-05
method: 'constants read off packages/core/src/service-b-timeline.ts (the only place the layout constants are written; the composition receives the layout as props); values chosen by the founder in chat 2026-09-05. First real render measured the same day: Downloads/finalselfie.mp4 (video_renders 1397ffcd…) with `ffprobe -f lavfi -i "movie=finalselfie.mp4,signalstats" -show_entries frame=pts_time:frame_tags=lavfi.signalstats.YAVG` and `ffmpeg -af silencedetect=noise=-45dB:d=0.3 -f null -`'
source: founder + code
---

# The Service B timeline constants — every one reasoned, none measured

`packages/core/src/service-b-timeline.ts` is the one place the layout constants are written.
`buildServiceBProps` computes the layout there and passes it to the `ServiceB` composition,
which only converts milliseconds to frames. `serviceBTimeline` is unit-tested in
`packages/core/test/service-b-timeline.test.ts`; the Remotion preview fixtures mirror its output
as literals and that test pins them. (The look constants that move no millisecond — the
handheld camera — live in the remotion package: [[handheld-sway-constants]].)

| constant                                 | value          | what it does                                                                                                                                                                                                                          | provenance                    |
| ---------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `GAP_MS`                                 | 250            | silence between the clip's first shown frame — the ad's frame 0 since the opener was retired 2026-09-06 ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]) — and the first spoken word; the clip starts `leadInMs − GAP` in | **reasoned** (chosen in chat) |
| `HOOK_TEXT_MIN_MS` (was `HOLD_MIN_MS`)   | 1200           | floor on how long the hook text stays on screen from frame 0 (until 2026-09-05: how long the first frame froze under it — [[0019-hook-text-outlives-the-reveal]])                                                                     | **reasoned** (chosen in chat) |
| `HOOK_TEXT_MAX_MS` (was `HOLD_MAX_MS`)   | 2500           | ceiling on the same; the reveal overrides both bounds — the text never leaves before it                                                                                                                                               | **reasoned** (chosen in chat) |
| ~~`CROSSFADE_FRAMES`~~                   | ~~5~~          | ~~the opener→talking-head dissolve~~ — **deleted 2026-09-05** after the first real render (ghosted the moving hand); the reveal is the hard cut 0017 describes                                                                        | founder, on watching it       |
| ~~`PUNCH_IN_SCALE`~~ / ~~`PUNCH_IN_MS`~~ | ~~1.06 / 300~~ | ~~the talking head's punch-in from the reveal~~ — **deleted 2026-09-05**, read as a jump cut                                                                                                                                          | founder, on watching it       |

## The first real render (2026-09-05) — the second column this note promised

video_renders 1397ffcd…, opener f8f7b2cc… (767ms, reveal tagged 433), hook text
"חייבת לספר לכם על משהו" (5 words → `readTimeMs` 2400):

| what                      | designed | measured                                                                                                                                 |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| hold (frozen first frame) | 2400ms   | frames 0–72 identical (YAVG 148.28 on every one)                                                                                         |
| reveal                    | 2833ms   | luma step 148 → 121 across 2.5–2.9s, no scene cut > 0.25 (the dissolve)                                                                  |
| first spoken word         | 3083ms   | silence ends 3.110s                                                                                                                      |
| founder's verdict         | —        | "2 seconds frozen, no audio no video"; the dissolve + punch-in "a weird fade"; the two shots' lighting differs; the camera is dead still |

What that changed the same day: the dissolve and punch-in deleted; the HeyGen clip's colour
tag corrected ([[heygen-output-is-limited-range]]); a measured colour grade on the talking
head against the opener's reveal frame (`talkingHeadGrade`, a per-channel curve per render —
[[heygen-idle-frame-is-darker-than-its-reference-and-its-talking-frames]]); a
handheld camera path ([[handheld-sway-constants]]); the reveal's definition tightened to "the
first frame whose pose matches the selfie" ([[opener-bank-clip-dup-frames-and-tight-trim]]).
The hold itself went the same day: the founder watched a free re-render of the same take and
said "kill it" — [[0019-hook-text-outlives-the-reveal]]. From that day until the opener was retired on 2026-09-06 ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]) the opener played from frame 0 and the constants bounded the hook text's life; the text's life is now tied to speech.

On the opener path (retired 2026-09-06, code still in the tree) the text's life was `max(clamp(readTimeMs(hookText), HOOK_TEXT_MIN_MS, HOOK_TEXT_MAX_MS), reveal_at_ms)`; under [[0023-hook-is-a-remotion-animation-opener-clips-retired]] it runs until speech passes its last word and the captions take over from the next line. — `readTimeMs` is `plan-format.ts`'s step-label reading-time guess (400ms +
words / 2.5 wps), which its own comment labels "A GUESS ... nobody has measured Israeli viewers
reading these". A 3-word hook text stays 1600ms; 4 words 2000ms; anything from 6 words up hits
the 2500ms ceiling — unless the reveal comes later, in which case the text stays until the cut.

Measured 2026-09-06 on the active opener (reveal 2700 ≥ the 2500 ceiling): `hookTextMs` equals
`revealAbsMs` for **every** hook text, so the glyphs leave on the very frame the picture cuts
(frame 81 in `hardcut-2026-09-06.mp4`: text-band YDIF 31 against 0.7–1.6 on its neighbours;
head box 6.9). Two verifiers judged it not the cause of the perceived jump — the picture cut is
above threshold on its own and the text's removal is the designed event — but it stacks on the
same frame. Moot since 2026-09-06: there is no reveal and 0019 is retired ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]); the text and the captions hand over at the next caption line after the last spoken word.

## What this note does NOT say

- That the surviving values are right. That the surviving values are right. The founder has since watched three paid draws and dozens of free re-renders; `GAP_MS` is still the chat pick, and `HOOK_TEXT_MIN/MAX_MS` govern only the retired opener path — the caption-handoff rule of [[0023-hook-is-a-remotion-animation-opener-clips-retired]] replaces them.
- That `GAP_MS` is the right stretch of still head before speech — since 2026-09-06 it opens the ad (the clip starts `leadInMs − GAP` in at frame 0), there being no reveal ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]). It rests on
  [[heygen-avatar-iv-idles-on-leading-silence]], whose tolerance is unmeasured; the lead-in
  default (800ms, `lipsync_lead_in_ms`) and this gap have never been tuned together. On the
  first real render the VO began 3.110s in against a designed 3.083 — the 27ms is frame
  rounding plus the mp3's own leading silence, not the gap. Measured 2026-09-06: with the 800ms
  lead-in, 250 puts the cut on the last still frame before HeyGen's pre-speech smile
  ([[heygen-head-moves-before-speech-onset]]); a 500ms gap is rendered as a free A/B
  (`.work/seam-handover/gap500/`) and the constant itself is unchanged pending the founder.

## Related

- [[0017-service-b-single-setting-selfie-talking-head]] — the format the timeline implements
- [[heygen-avatar-iv-idles-on-leading-silence]] — why the lead-in and the gap exist
