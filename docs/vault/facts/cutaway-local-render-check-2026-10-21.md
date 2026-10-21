---
type: fact
status: verified
verified: 2026-10-21
method: "packages/core/.work/cutaways/local-render.ts (laid out from the script's own hook text and productMention since 0122): the stored HeyGen take of video_renders ab7e3837 + its approved audio, through the shipped buildServiceBProps -> renderVideo (DRY_RUN=0, local Remotion), inside a READ ONLY transaction on production, with and without cutaways onto demo 3915c8e2; then packages/core/.work/cutaways/measure.ts (ffprobe/ffmpeg; a new check: the first cut on the mention's frame) and sway-control.ts. No HeyGen, no Claude, no credits. Results in .work/cutaways/render/measure.json (gitignored)."
source: code
---

# The 0122 draft, rendered on a real take: the first cut on the product's phrase

The take: video_renders `ab7e3837` (whip hook, hook text "אנשים כבר לא מחכים לעורך וידאו",
lead-in 800, voice 16.27 s). The demo: `3915c8e2` (89.6 s). The plan is the draft as
[[0122-service-b-clips-before-the-effect-first-cut-at-the-product-mention]] makes it, unedited:

- **Mention:** `product_name`, the phrase "לו Tavnit.ai, נותן" at VO 6960 ms (43% of the voice;
  [[cutaway-mention-positions-2026-10-21]]).
- **Layout:** strict, one cutaway, VO 6960–12 200 ms, covering "לו Tavnit.ai, נותן תבניות שנבחרו
  אחרי שחקרו מה באמת"; the demo in order put it at state 30 (43.2 s into the demo).
- Under 0121 the same take's draft cut at 4.08 s, inside "זה יקר ואיטי", before the name
  ([[cutaway-local-render-check-2026-10-20]]).

Renders: off 103 s, on 86 s of wall clock on the founder's desktop.

| Check                         | Measured                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Streams                       | One h264 1080×1920 30/1 video and one AAC track in both files; a full `-xerror` decode is clean; 496 frames, equal to totalMs. |
| First cut on the mention      | Frame 217 (7.23 s) = `voBoundaryFrame(6960)`, the phrase that names the product.                                               |
| Cuts on chunk boundaries      | The demo run is frames 217–374, exactly the slot's `voBoundaryFrame`s.                                                         |
| Cutaway length                | 157 frames (5.23 s).                                                                                                           |
| Head runs after the first cut | 122 frames (4.07 s), the ad ending on the head.                                                                                |
| Hook unchanged                | Every head frame matches the head-only render: max mean abs diff 0.33 (demo frames ≥ 74.0).                                    |
| Right footage                 | The cutaway opens on its window's first frame (diff 2.72, against 75.66 to the head).                                          |
| Audio                         | **Sample-identical** to the head-only render (731 001 samples, max diff 0).                                                    |
| No sway                       | Best-matching shift against the source clip (0, 0) on 7 sampled frames; the control finds a planted 8×6 px move as (−8, −6).   |
