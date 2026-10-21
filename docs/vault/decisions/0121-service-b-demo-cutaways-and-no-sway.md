---
type: decision
status: verified
verified: 2026-10-20
method: "Founder rulings in the 2026-10-20 task prompt 'cutaways' (§2 Decided, from the planning chat the same day) and his amendments when approving the plan (2026-10-20: own-voice migration files (a'), the CLAUDE.md wording, the cutaway step after the effect step with the slots laid out from the actual hook text, 'apply the migrations and merge yourself'). MEASURED on feat/b-demo-cutaways: the layout on his 16 distinct real B audios (packages/core/test/cutaway-structure.test.ts), the matcher test (facts/cutaway-matcher-hit-rate-2026-10-20), the local render (facts/cutaway-local-render-check-2026-10-20)."
source: founder
---

# 0121 — Service B: opt-in demo cutaways, and no sway on any B render

> **2026-10-21 — amended by [[0122-service-b-clips-before-the-effect-first-cut-at-the-product-mention]].**
> The cutaway step now comes before the effect step (box → clips → effect → render). The draft's
> first cut waits for the phrase where the script first names the product — rule 4's "a few
> seconds in" and the amendment's "first cut ≥ 3000 ms" are replaced — and is laid out from the
> script's own hook text. The customer moves, adds and removes clips freely (a long run is noted,
> never blocked), and a longer final hook text moves the clip it reaches. The rest of this note
> stands.

Builds [[0120-service-b-look-propped-phone-and-opt-in-demo-cutaways]] §2 (the sway) and §4 (the
cutaways). §1 and §3 of 0120 (the propped-phone look as numbered settings) are not built here.

## What he decided (FOUNDER-REPORTED, 2026-10-20)

1. Cutaways are **opt-in, never the default**. The head-only ad stays the product.
2. The source is the customer's **existing demo**, the Service A inventory, analysed once and
   reused free ([[0048-the-demo-analysis-is-charged-once-per-demo]]). A customer with no demo uploads one
   and pays the analysis as in A. No second analysis, no generated B-roll, no short uploads.
3. A cutaway is a **stretch of the demo, 4–6 s long, starting at a picked moment** ("4–6 seconds
   each instead of 2"). Screen changes inside the stretch are fine. A's 2 s rule
   ([[0076-every-step-is-a-fixed-2s-window-inside-its-screen]]) is untouched.
4. **Head segments stay short.** The first cut lands a few seconds in, after the hook text
   leaves; no head segment after it runs past about 5 s. His reason: a seasoned eye tells it's AI
   after about five seconds of the head; cutting before that is the trick.
5. Slots come **pre-filled as a draft** and are corrected in a **window-picker**, never filled
   from empty. Reason: the foolproof path and the low-effort path are the same screen.
6. **Structures are data**, like the hook effects: one plus "none" in v1, no chooser until a
   second exists.
7. **The sway goes off for every B render.** It wasn't good on the selfie either, and a propped
   phone doesn't sway.
8. Own voice is parked (0118, on the parked `feat/b-own-voice` only).

His amendments when he approved the plan (2026-10-20):

- **The cutaway step comes after the effect step.** The slots are laid out from the actual hook
  text: **the first cut is the first caption-chunk start at least 3000 ms into the ad and at or
  after the hook text leaves.** A hook text change invalidates the plan and reruns the draft.
  - Read as written. The other reading, 3 s _after_ the hook leaves, would hold the head past 5 s
    at the open, against rule 4.
- **The 0066/0067 ledger** (production had them from the parked own-voice branch, main did not,
  so every dry-run from main exited 1): this branch carries the two applied SQL files only, option
  (a′).
- **CLAUDE.md's Service B line** takes the wording proposed in the plan.
- "When you're done go ahead and apply the migrations and merge yourself."

## Planning defaults: kept, changed, and why

| Default (the founder's, not ruled)                                                                                                               | What was built             | Why                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The draft is a text-only match of each slot's words against the moment descriptions, one cheap call, tested first (0082's rule); else demo order | **Demo order.**            | The matcher was built and tested on his demos and **missed the bar fixed before the run**: 63.3% vs demo order 43.3%, 79.5% agreement, against ≥70%, ≥ +25 points and ≥80%. Code at `aff4abd`; [[cutaway-matcher-hit-rate-2026-10-20]]. |
| First cut ~3–4 s, head ≤ 5 s, cutaway 4–6 s, end on the head, cuts on caption-chunk boundaries                                                   | As below.                  | His amendment fixes the first cut. Cuts fall on chunk starts. A word-start fallback was added because 3 of his 15 distinct audios have a 2.5–2.8 s caption line exactly where a cut must land.                                          |
| A demo too short gets fewer slots, never repeated footage                                                                                        | Kept.                      |                                                                                                                                                                                                                                         |
| The option sits after the audio gate, before the effect step                                                                                     | **After the effect step.** | His amendment. The opt-in checkbox stays on the audio card.                                                                                                                                                                             |
| Quote unchanged; a cutaway adds no credits                                                                                                       | Kept.                      |                                                                                                                                                                                                                                         |
| The demo plays like A's clips, cover-fit, muted                                                                                                  | Kept.                      |                                                                                                                                                                                                                                         |

## The structure "alternate" (chosen within rule 4, none measured)

The numbers live in `packages/core/src/cutaway-structure.ts`, never in the DB:

- **First cut:** the first chunk start ≥ max(3000 ms composition, the hook text leaving).
- **Cutaway:** 4000 / 5000 / 6000 ms (min / target / max).
- **Head runs:** 1000 / 2500 / 5000 ms, soft max 5500 ms only when no layout fits under 5000.
  1000 because a shorter return reads as a flash, and with 1500 one real audio had no
  chunk-start layout at all.
- **Search:** a memoised search over chunk starts for the layout nearest the targets.
- **Tiers:** chunk starts; then word starts inside a line, with the first cut still on its chunk
  rule; then the demo-capacity tier (the longest fitting prefix, last head any length). Nothing
  fits: no slots, and the step says so with "continue without".
- **Window edges:** a window never starts in the first 367 ms or ends in the last 367 ms of the
  recording (the footage detector's unexamined reach), with 34 ms of frame slack per window.

On his 16 distinct real audios, every one long enough lays out: 12 on chunk starts, 3 on word
starts, and the 6.3 s one is "too short". First cuts land at 3.1–5.0 s.

## How it is built

- **Picks on their own rows.** `cutaway_plans` (migration 0068), server-only RLS.
  - One row per (approved audio, demo analysis, structure, hook text). A new hook text is a new
    row and a fresh draft; going back to an earlier hook text finds its row again, free.
  - Slots are stored in VO time. The draft's pick is kept beside the customer's, so the correction
    rate is a query.
  - `structure` has no CHECK: structures are data in code.
- **Copied, never pointed at.** `createBRender` resolves the plan before any paid call:
  - The plan must match on business, audio, hook text and analysis, and its layout and windows
    must still be valid.
  - It is then copied onto `video_renders.params.cutaways`, so QC regeneration replays it.
  - With the option off, params are byte-identical to before.
  - A B render never gets a `set_id`, which would mark the demo paid and waive A's analysis charge.
- **Render.** `buildServiceBProps` downloads the demo, clamps the windows against the probed
  **video stream** length (the raw-length defect), and drops what cannot play with a
  `cutaway_render_degraded` event. It never throws after HeyGen is paid.
  - `ServiceB` mounts each window as a muted `OffthreadVideo` over the still-running head, outside
    the static overscan (the demo shows 1:1), under the hook text, captions and watermark.
  - Each boundary lands on the frame the captions change on (`voBoundaryFrame`).
- **Sway.** `handheld`, its constants and `cameraSeed` are removed. `OVERSCAN` stays a static
  `scale(1.06)`, so option-off framing and the wizard preview are unchanged, and the focus/whip
  blur keeps 32 px of margin past its 2σ cut ([[handheld-sway-constants]]).
- **Wizard.**
  - An unticked checkbox on B's ready-audio card. Ticked, a "demo" step joins after the effect
    step; off, the steps and the request body are today's.
  - The step reuses A's demo picker and upload, waits for the analysis, drafts, lists each slot
    with its words, and opens the window picker.
  - The picker slides a fixed-length window along the demo, snapping to moments, and never
    overlaps another slot.
  - The wizard is keyed by business.

## Money

- The quote is unchanged and cutaways add no credits.
- B never charges `a_demo_analysis_credits`, so a demo uploaded for B alone is analysed free:
  0048's accepted cost for any demo never rendered from. A later A render of that demo still pays
  the analysis once.
- The draft makes no model call, so a draft costs nothing.

## Related

- [[0120-service-b-look-propped-phone-and-opt-in-demo-cutaways]] (the direction),
  [[0017-service-b-single-setting-selfie-talking-head]],
  [[0023-hook-is-a-remotion-animation-opener-clips-retired]],
  [[0024-hook-effect-is-a-render-param-the-customer-picks]].
- [[0077-moments-keep-their-real-start-and-end]] (the spans windows start on),
  [[0084-clips-are-placed-from-the-footage-instants]].
- [[cutaway-matcher-hit-rate-2026-10-20]], [[cutaway-local-render-check-2026-10-20]].
