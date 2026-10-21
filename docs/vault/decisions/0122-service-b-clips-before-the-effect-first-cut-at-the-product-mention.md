---
type: decision
status: verified
verified: 2026-10-21
method: "Founder rulings in the 2026-10-21 task prompt 'cutaway relayout' (§2 Decided, from the planning chat the same day, after he used the merged 0121 step), his approval of the plan the same day, and the planning defaults in that prompt. MEASURED on feat/b-cutaway-relayout: the draft on his 17 real B audios (facts/cutaway-mention-positions-2026-10-21, pinned in packages/core/test/cutaway-structure.test.ts), the local render (facts/cutaway-local-render-check-2026-10-21), and a walk on his own Pixel 6a and a desktop Chrome window."
source: founder
supersedes: "0121's step order and first-cut rule (dated pointer there)"
---

# 0122 — Service B cutaways: clips before the effect, the first cut at the product mention, free edits

Amends [[0121-service-b-demo-cutaways-and-no-sway]]. 0121 is still what the cutaway composition,
the demo source, the no-sway rule, the money and the plan row are; this note changes the step
order, the draft's first cut, and what a customer may do with the clips.

## What he decided (FOUNDER-REPORTED, planning chat 2026-10-21, after using the merged step)

Where no reason is given he gave none.

1. **Order:** the box on the audio card, then the clips, then the effect, last before the render.
   This reverses 0121's "after the effect step". The layout uses the hook text as the script step
   extracted it. If the effect step's edit lengthens the hook text into the first clip, that clip
   moves to the next phrase after the hook text and the effect step says so in one line. Nothing
   the customer placed is deleted.
2. **The draft never cuts before the script starts talking about the product.** From the product
   mention to the end it keeps head runs to about 5 s and ends on the character; before it, the
   character talks alone however long the intro runs. His reason: cutting to a demo of a product
   the script hasn't mentioned has no context and "feels off"; and since his motion-prompt changes
   the head holds 8 s or so without trouble, so the 5 s idea matters after the mention, not at the
   open. This replaces 0121 rule 4's "a few seconds in" and the amendment's "first cut ≥ 3000 ms".
3. **Free movement.** The customer moves a clip by tapping the phrase where it should start,
   anywhere after the hook text. The clip's length stays the structure's 4–6 s. Clips never
   overlap each other in the script and never reuse footage.
4. **Add and remove.** Any clip can be removed; a clip can be added at any phrase, taking the next
   unused stretch of the demo, changeable in the picker. Zero clips renders today's ad.
5. **Inform, never restrict.** A head run over about 5 s after the product mention gets a one-line
   note and goes through. The draft obeys the rule; the customer may break it on purpose.
6. **Identity.** One label and one colour per clip on the script highlight, the card and the
   picker. The small numbers go.
7. **Size.** A clip card is big enough to judge without squinting: on a phone one per row, full
   width, tap to play the window; the picker's filmstrip grows with it.
8. **The drag.** Dragging the window selected the page like text. It's a defect: a drag never
   selects and never scrolls.
9. **Not doing:** changing a clip's length, a second structure, reviving the matcher.

FOUNDER-REPORTED context: the 0121 branch is merged; the step works and he likes it; on his test the
draft put a clip at ~4 s during the intro, before the product came up (render `cbd62014`: the clip
at VO 2.8 s, the name at VO 11.4 s).

## Planning defaults (PLANNING DEFAULT — his, not ruled) and what was built

| Default                                                                                                                                                                                                                                                                          | Built                                                                                                         | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Find the mention with no new paid call: a reveal word index from `generateBScript` if its output can carry one; else the first phrase holding the product or business name from the questionnaire; else 40% of the voice. A model call as the only reliable way would be a stop. | **The name, then 40%.** No reveal index, no model call.                                                       | Put to him as a deviation in the plan, which he approved (2026-10-21). An index needs a v18 of the live b_script prompt (and paid generations to prove it); a script-text index is not an index into the audio's timing words (the pronunciation map, ElevenLabs' normalisation); a script edit leaves it stale (`updateScriptText` copies params); none of his audios carries one; and v17 already says `product_name` "exactly as written, once, and late", so the name on the spoken words IS the reveal. The business name is `businesses.name` (not a questionnaire field). |
| Adding a clip never calls a model.                                                                                                                                                                                                                                               | Kept: the next unused stretch after the footage of the clip before it in the script, else the first free one. |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| When no phrase after a lengthened hook text can hold the first clip, the step says so and the clip is dropped — the one case "nothing deleted" yields.                                                                                                                           | Kept, for any clip the line reaches (one line per clip).                                                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Interpretations, flagged (mine; his to overrule)

- **The mention is a phrase:** the start of the caption chunk holding the name — his "first phrase
  containing the … name". The earliest of the product and business name wins. A spoken word may
  carry up to two Hebrew prefix letters (`לעולא` → `עולא`); the name is never stripped, and a
  business-name match or a name of three letters or fewer must be exact.
- **The first cut** is the earliest chunk start within 5 s of the floor (the mention, or the hook
  text leaving if later) that lays out — "heads ≤ ~5 s from the mention" — within the old tiers.
- **"Not changing a clip's length" = no length control.** A moved clip's end re-fits to the cut
  point 4–6 s on nearest its own length, so cuts stay on caption boundaries.
- **The hook-text move is derived, never written:** the stored clips stay where the customer put
  them, so a shorter line brings the clip back. The move goes to the first free phrase at or after
  the line (which may be past another clip).
- **The note** fires on a head run longer than 5.5 s (the draft's soft max, so a draft never trips
  it), counted only from the mention on; a run that began before the mention is named from it.
  **No note with zero clips:** that is today's head-only ad.
- **Removals leave no trace:** the row keeps the draft's window pick beside the customer's on every
  surviving drafted clip; a removed clip, and a position move, are not recorded.
- **At most 8 clips** (one letter and colour each); the draft search is bounded to 8.

## How it is built

- **Core (`cutaway-structure.ts`, client-safe subpath `@aiugc/core/cutaway-structure`):**
  `productMention`, `hookLeaveVoMs`, the mention floor in `cutawayLayout` (`firstCutMinMs` deleted;
  `cutawayLayoutError` deleted), `fitCutawayAt`, `cutawayEditError` (the customer's rules only:
  spoken words, 4–6 s, after the hook text, inside the voice, no overlap, ≤ 8), `cutawayWindowStarts`
  / `snapCutawayStart` (moved from the web), `clearHookText`.
- **Plan row (`pipelines/cutaways.ts`), no migration:** slots gain `id` (1–8) in their jsonb; the
  draft fields are optional. The key's hook text is the script's own (`scripts.params.hookText`,
  read on the server). An edited row is never redrafted; an unedited one is recomputed and written
  only when it changed; a 0121 row (slots without ids, keyed on the effect step's line) is found
  under any line and redrafted with its window picks carried. Writes are conditional on the version
  read (`date_trunc('milliseconds', updated_at)`); a stale edit is a 409.
- **PATCH** takes the whole clip list and `expectedUpdatedAt`. **Enqueue**
  (`resolveCutawaysForRender`) runs `clearHookText` with the final hook text, holds the result to
  `cutawayEditError`, and returns null with no clip left (no `cutaways` key, params byte-identical
  to option-off). `buildServiceBProps`, the clamp and Remotion are unchanged: no worker change.
- **Web:** `wizardSteps` puts `demo` before `effect` (the id unchanged, so analytics' allow-list
  stands); the plan is live for its audio and demo whatever the hook text becomes; the render's
  count is the clips left after `clearHookText`. The clips step: the script tinted per clip with a
  letter chip, one full-width card per clip (a 9:16 preview that plays the window on tap, the
  words, "החלפה / העברה / הסרה"), "הוספת קטע", the phrase list for a move or an add (armed after
  400 ms), the long-run notes, a 409 that reloads the plan, and the step's buttons held while a
  save is in flight. The picker: the drag takes the pointer (primary button, default prevented,
  focus without scroll), images inside the track ignore the pointer, the picker cannot be selected
  or called out; the track shows every clip's window in its colour and letter; the filmstrip is
  taller. The effect step shows one line per clip the hook text reaches.

## Checks

- The draft on his 17 real audios: [[cutaway-mention-positions-2026-10-21]].
- The local render: [[cutaway-local-render-check-2026-10-21]].
- An adversarial review of the diff (4 reviewers, 4 skeptics): the confirmed findings were fixed
  in `0116a16` (the 8-clip cap, version-guarded writes, 0121 rows under any line, the step's buttons
  during a save, the 409 recovery, the note's wording, contrast and tap targets).
- **The walk on his own Pixel 6a** (Chrome 155, the local server over `adb reverse`, real touches
  through `adb shell input`) and **a desktop Chrome 155 window** (CDP mouse input):
  - box → clips (step 5 of 7) → effect (6 of 7) → render, on both;
  - a clip moved to another sentence, one added, one removed;
  - the long-run note on a run after the mention, with "המשך" enabled;
  - a lengthened hook text moving the first clip with its line;
  - one letter and colour per clip on script, card and picker;
  - tap-to-play;
  - a real touch drag (181 moves, the window 21.4 → 42.0 s) and a mouse drag (40 moves) selected
    nothing and scrolled nothing; a long press opened no menu. The control — the same mouse drag
    over the page title — did select it.
  - It found one crash the tests could not: [[scrollintoview-returns-a-promise-in-chrome-155]],
    fixed in `d71027f`.
  - With every clip removed, the render step read head-only.
  - No render was created: a DRY_RUN web's render enqueues a real job the box would pay HeyGen
    for. The zero-clips render is proven by a whole-chain DRY_RUN test instead
    (`lipsync-chain.test.ts`).

## Money

No credit change: the quote is 0121's, the draft and edits make no model call. Checks spent
15 agorot of ElevenLabs (three TTS of the canned script on the box) and ₪0 else.

## Related

[[0121-service-b-demo-cutaways-and-no-sway]], [[0120-service-b-look-propped-phone-and-opt-in-demo-cutaways]],
[[0033-b-script-may-write-an-allowed-brand-name-in-latin]], [[0024-hook-effect-is-a-render-param-the-customer-picks]],
[[cutaway-matcher-hit-rate-2026-10-20]].
