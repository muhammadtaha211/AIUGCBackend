---
type: fact
status: verified
verified: 2026-10-20
method: "packages/core/.work/cutaways/local-render.ts: the stored HeyGen take of video_renders ab7e3837 + its approved audio, through the shipped buildServiceBProps -> renderVideo (DRY_RUN=0, local Remotion), inside a READ ONLY transaction on production, with and without cutaways onto demo 3915c8e2; then packages/core/.work/cutaways/measure.ts (ffprobe/ffmpeg) and sway-control.ts. No HeyGen, no Claude, no credits."
source: code
---

# The cutaway composition, measured on a real take

The take: video_renders `ab7e3837` (whip hook, hook text "אנשים כבר לא מחכים לעורך וידאו",
lead-in 800, voice 16.27 s). The demo: the founder's B-flow recording `3915c8e2` (89.6 s). The plan
was laid out by the shipped rules ([[0121-service-b-demo-cutaways-and-no-sway]]):

- **Tier:** strict.
- **Hook text** leaves at 2.21 s.
- **Cutaway 1:** VO 4080–9440 ms, covering "זה יקר ואיטי. האתר הזה, קוראים לו Tavnit.ai, נותן".
  - Draft: state 22 (the script screen, demo 26.2 s); kept.
- **Cutaway 2:** VO 10960–15080 ms, covering "שחקרו מה באמת עובד בסושיאל, וגם בלי ניסיון. אין".
  - Draft: state 39 (the effect step, demo 57.2 s).
  - Moved, as the picker would, to state 49 (the finished ad playing, demo 79.0 s).

Renders: off 98 s, on 117 s of wall clock on the founder's desktop.

| Check                         | Measured                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Streams                       | One h264 1080×1920 30/1 video and one AAC track in both files. A full `-xerror` decode is clean. 496 frames, equal to totalMs 16 524.                                  |
| Cut frames                    | Demo runs are frames 130–291 and 337–460, **exactly** `voBoundaryFrame` of the slots. Both are caption-chunk boundaries.                                               |
| First cut                     | Frame 130 = **4.33 s**, after the hook text left (2.21 s, frame 67).                                                                                                   |
| Cutaway lengths               | 161 and 123 frames (5.37 s and 4.10 s).                                                                                                                                |
| Head runs after the first cut | 46 and 36 frames (1.53 s and 1.20 s). The ad ends on the head (frames 460–496).                                                                                        |
| Hook unchanged                | Every head frame, the hook effect and hook text included, matches the head-only render: max mean abs diff 0.32 (demo frames ≥ 53.8).                                   |
| Right footage                 | Each cutaway opens on its window's first frame (diff 1.8 and 2.9, against 76 and 69 to the head).                                                                      |
| VO continuous, demo silent    | The audio is **sample-identical** to the head-only render's (731 001 samples, max diff 0). The demo's own audio over those windows was −46.1 and −42.9 dB mean, muted. |
| No sway                       | The best-matching shift of the head-only render against the source clip (scaled 1.06) is (0, 0) on 7 sampled frames. The control finds an 8×6 px move as (−8, −6).     |
| Captions                      | A contact sheet of every cut shows the karaoke line carried straight across each cut, over the demo.                                                                   |

The windows were valid, so nothing was clamped. A first attempt that read the render row with raw
SQL (snake_case fields) dropped the cutaways at the business check, and the read-only transaction
refused the degraded-event write. That was a script bug, not the product's.
