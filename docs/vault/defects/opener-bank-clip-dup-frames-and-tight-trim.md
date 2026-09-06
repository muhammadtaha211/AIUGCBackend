---
type: defect
status: verified
verified: 2026-09-05
method: 'opener_clips f8f7b2cc-854e-42a5-9940-1a99ed578f9d downloaded from storage; `ffprobe -show_entries stream=r_frame_rate,nb_frames,duration` and `ffprobe -f lavfi -i "movie=opener.mp4,signalstats" -show_entries frame=pts_time:frame_tags=lavfi.signalstats.YDIF`; frames tiled with ffmpeg hstack and looked at'
source: code
---

# The first real opener clip repeats every third frame, is tagged too early, and ends mid-motion

Retired 2026-09-06 with the opener bank ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]); kept for the record. The first opener in the bank (`hand_cover`, persona image 8aeddf29…, registered 2026-09-05 05:04) was 767ms / 23 frames in a 30fps container, `reveal_at_ms` 433.

- **Duplicated frames.** Frame-to-frame luma difference (YDIF) is 4–13 on moving frames and
  0.03–0.31 at frames 1, 5, 8, 12, 14, 18 and 21 — seven of 23 frames repeat the previous one.
  The source was a lower rate (≈21fps) conformed to 30 by duplication. Invisible behind the
  2.4s freeze the old timeline put in front of it; visible as a stutter once the clip plays.
- **Reveal tagged on a moving hand.** At 433ms the face is clear but the hand is still over the
  chest, moving 6–37px per frame; it leaves the frame at ~633–700ms. The clip's LAST frame
  (733ms) is the one whose pose matches the selfie and HeyGen's idle. A hard cut at 433 is a
  jump cut. `reveal_at_ms` is now documented as "the first frame whose pose matches the
  selfie" (`bank.ts`, the CLI help, `db/schema.ts`, `docs/01-schema.md`); this row predates
  that wording.
- **Ends as the hand exits.** The last frame still has motion in the bottom-right (YDIF 4.2);
  there is no settled tail to cut from.

## Not fixed, by decision

Moot since 2026-09-06: the opener bank and `aiugc bank add-opener` are retired ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]) — no render cuts against an opener, so no re-export or re-registration is owed. As it stood: 0017 stored clips play-ready, so the fix was founder-side. at a
true 30fps cadence with ~0.5s of settled, hand-free tail, and re-register with `aiugc bank
add-opener --reveal-at-ms` on the settled frame (a re-registration supersedes; the released
render's params keep the old row by id). **Done 2026-09-05, in part:** the founder re-exported
(`Downloads/0905.mp4`, 2740ms, 82 video frames at 30fps, tv/bt709, with a 1.4s covered phase
and a settled hand-free tail) and it is registered as opener `9721de19-8bef-43b7-905a-73a02a25c0af`
with `reveal_at_ms` 2700, the last frame; row f8f7b2cc… is `active=false`. The duplicate-frame
cadence is unchanged in the new file (YDIF < 0.3 on every third frame), so the source is still
~20fps conformed to 30. Before that, re-registering the same file
with `--reveal-at-ms 733` moves the cut onto the matching pose.

**Measured 2026-09-06 — the re-export's tail settles only on its last three frames.** Tracked
on a face crop at 1px (workflow finder, reproduced by an independent verifier): the face drifts
(−5, −9)px from frame 60 (2.0s) and comes to rest at (0, 0) on frames 79–81, decelerating over
the last 0.7s (per-frame face MAD 2.7–5.5 while moving, 1.11 on 79→80, 0.47 on 80→81). So
"settled, hand-free tail" above means settled for ~100ms, not 0.5s: the reveal at 2700 lands on
the first fully still frame, and HeyGen's head begins its pre-speech motion one source frame
later ([[heygen-head-moves-before-speech-onset]]) — a stop-and-restart across the cut. A tail
with ≥0.3s at rest after frame 79 is still the founder-side fix.

## Related

- [[0017-service-b-single-setting-selfie-talking-head]]
- [[service-b-timeline-constants]] — the first real render this was found in
