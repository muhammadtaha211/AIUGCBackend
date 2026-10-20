---
type: fact
status: verified
verified: 2026-10-20
method: "The released render video_renders 7681c44c (take 1 in [[own-voice-first-production-runs-2026-10-20]]), downloaded read-only by packages/core/.work/own-voice-fetch.ts. Frames by ffmpeg -ss <t> -frames:v 1 at t = 1.0, 2.6, 2.9, 3.1, 3.2, 3.25, 3.3, 3.4, 6.75, 13.05, 31.35 and 32.3 s, read by eye. Word times and chunks are audio_renders 246bfc4a word_timestamps (own-voice-analysis.ts). Video time = audio time + captionOffsetMs 250 (serviceBTimeline, leadInMs 800, GAP_MS 250)."
source: browser
---

# On the first own-voice render, the captions did at pauses and at the dropped filler what 0118 predicted

Decision [[0118-service-b-own-voice]] predicted from the code: `chunkWords` groups by count, a chunk
holds until the next one starts, and the highlight is the last word that started. The released
render matches every prediction. The gaps are Scribe's word times on the stored file.

- **A pause inside a group.** Chunk 3 is `ואני | גם | מופתע`, with 1,820 ms of silence after `גם`.
  At 6.75 s the whole chunk is on screen with `גם` lit, so `מופתע` shows about 1.8 s before it is
  said. The same holds inside chunk 8 after `האפליקציה` (1,300 ms) and inside chunk 12 after
  `עד,` (1,780 ms).
- **A pause between groups.** After `קל.` there are 1,360 ms of silence. At 13.05 s chunk 5,
  `כל כך קל.`, is still on screen with `קל.` lit.
- **The dropped filler.** `אה,` (index 38, 31,090–31,130 ms) was dropped at the transcript step. At
  31.35 s and at 32.3 s chunk 12, `באוקטובר עד, עד`, is on screen with `עד,` lit through the
  dropped word's time and the pause after it. The burned line reads `עד, עד`: he dropped the
  filler, not the repeated word.
- **The hook handoff swallowed a negation.**
  - Chunk 1 is `שדברים | כאלה | לא` (2,010–2,970 ms), and the hook line ends on `כאלה`.
  - The line stayed centred through 3.2 s and was gone at 3.25 s, when chunk 2
    (`קורים בדרך כלל,`) began.
  - `לא`, spoken at 3.10–3.22 s video time, is never on screen. The viewer reads "אני רוצה להגיד
    שדברים כאלה" and then "קורים בדרך כלל,", the opposite of what was said.
  - This is the tail loss `service-b-timeline.ts:48-51` accepts as the founder's rule:
    [[hook-caption-handoff-swallows-an-unmatched-opening]], update of 2026-10-20.

## Related

- [[service-b-timeline-constants]]
