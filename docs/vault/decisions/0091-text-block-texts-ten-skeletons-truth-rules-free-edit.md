---
type: decision
status: verified
verified: 2026-10-07
method: "Founder decisions 9–11 of the 2026-10-07 task prompt and its Appendices A (the skeleton bank, deconstructed by him from 12 reference posts) and B (the writing rules); the reasons are his, the Consumer Protection reference is the planning assistant's web read of 2026-10-07 as the prompt states it. MEASURED in the tree at feat/service-c-text-block: prompts/text_block/v1.md, packages/core/src/text-block.ts, packages/core/src/pipelines/copy.ts (generateTextBlocks, textBlockBatchProblem), packages/core/test/text-block-prompt.test.ts, test/text-block-generate.test.ts. Amended 2026-10-07 from the founder's rulings in the planning chat of 2026-10-07/08, relayed by the phase 1b task prompt (rulings 1–3, 5, 6 his; A–C the planning assistant's wording); the fixture run is MEASURED with real calls (packages/core/.work/text-block/fixture-run.ts, gitignored, run once on the founder's spend OK; its output .work/text-block/fixture-texts.md)."
source: founder
---

# 0091 — The texts: ten skeletons, what the generator may write, and the edit is free

Decisions 9–11 of 2026-10-07. Tags as in [[0089-service-c-text-block-exists-admin-only-phase-1]].

## 1. Texts come from a bank of ten skeletons (decision 9)

Deconstructed by the founder from 12 reference posts he supplied (a third-party collection; the
view counts are that site's — **FOUNDER-REPORTED**). One text per skeleton that fits the business;
a skeleton that does not fit is skipped, never forced. The ids: `reframe`, `instead`,
`shoutout_hack`, `wish_more_knew`, `founder_ask`, `relatable_observation`, `quiz`, `discovery`,
`envy_portrait`, `cautionary_confession`. An eleventh — a POV windfall with an exact sum — was
dropped by him: an income claim that depends on the clip. The Hebrew examples are his
founder-read starting copy and are not to be rewritten.

**Where the bank lives, REASONED and then MEASURED:** in the prompt file,
`prompts/text_block/v1.md`, as a frame library exactly like `hook_lines/v7.md` — the move, where
the product lands, the binding notes, and the example verbatim in a fence. Only the ids and a
Hebrew label are in code (`TEXT_BLOCK_SKELETONS`, `packages/core/src/text-block.ts`), for the
validator and the admin UI. Not `structures` rows:
[[0046-the-rega-ban-targets-the-hesitation-tick-not-the-word]] records that seeded rows drift
from the files and `--update` overwrites founder edits, and
[[0028-scripts-end-on-a-closer-from-a-curated-bank]] kept the closers out of the DB for the same
reason. Not code for the examples themselves: the model reads them from the prompt, and
iterating the skeletons is a new prompt version, never a code change. The examples are repeated
in code as the DRY_RUN stand-in (`TEXT_BLOCK_EXAMPLES`) and `text-block-prompt.test.ts` asserts
the prompt carries every one verbatim, so the two cannot drift.

**MEASURED, the batch contract:** the model returns every skeleton once, in `texts` or in
`skipped` with a reason; `textBlockBatchProblem` refuses an unknown id, a repeated id, an empty
batch and any text that fails the burn check; one re-request with the same prompt, then the
batch fails (the hook-line pattern). Skipped skeletons come back to the caller and are stored
nowhere. Each text is a `scripts` row of kind `text_block` with `params.skeleton`, the clip id
and the speaker gender, stamped `text_block@v1`.

## 2. What the generator writes (decision 10)

First person is allowed. It never writes the speaker using the product or getting a result from
it, and never invents a figure. A figure or result the business itself supplied may be used,
stated as the business's claim. **FOUNDER-REPORTED, the reason as the prompt records it:** the
founder first ruled that no voice rule should exist; the planning assistant would not write a
generator that invents a speaker's product experience or figures; the founder approved the plan
on that basis. **On record, web-read 2026-10-07 and not legal advice:** the Consumer Protection
Authority's 2021 guidance treats a review from a consumer who does not exist as deception under
s.2 of חוק הגנת הצרכן.

**MEASURED:** the prompt's Truth block ("Never write the speaker using, trying, buying or
benefiting from the product, in any tense"; "Never invent a number, price, statistic, earning,
timeframe or result"; "stated as the business's claim and never as the speaker's experience"; no
health or money promises; nothing negative about a named company) is pinned by
`text-block-prompt.test.ts`. The standing house rules for burned text ride along: the naming
policy, Latin brand names stay Latin, the `רגע` tick rule in 0046's wording (its natural-use
example pluralised to this format's plural audience, `תראו את זה רגע`), the character set with
straight quotes (asked of the model, not refused by the validator — the hook line's stance), no
calendar year, and — new for this format, the founder's rule in Appendix A — never an em or en
dash, a plain hyphen instead; the validator refuses U+2013 and U+2014 so that rule is enforced,
not only asked (amended 2026-10-07: refused in generated text only, an edit may carry them).

_(Superseded 2026-10-07: his ruling made the examples the exemplars and the rules were reworded to
match them; the notes this paragraph describes are gone. See the amendment.)_ **Three of the
founder's examples sat against the rules above, and the prompt said so under each rather than
rewriting his copy (REASONED, the smallest honest fix):** `shoutout_hack`'s last two
sentences have the speaker using the product and reporting a result — the note under it says
not to copy that part; `instead` runs to 396 characters and ends on an aside after a blank line
— the note says yours is one paragraph inside the aim; `cautionary_confession`'s `אל תעשו את
זה` is a warning, which the call-to-action rule now defines as not a call to action. The rules
win over the examples, and the prompt says that too. His ruling on the examples themselves is
owed.

## 3. The customer's edit is free (decision 11)

גוש טקסט adds no content rule to an edited text. **FOUNDER-REPORTED, the reason:** an edit cannot
be policed, and friction buys nothing. **MEASURED:** the edit route
(`POST /api/admin/text-blocks/scripts/[id]/text`) runs `textBlockTextError` — the character set
and the cap, render rules only — and `updateScriptText`, which writes a new row and leaves the
old one for any render pinned on it.

## Not verified

- ~~No text has been generated with a real model call~~ — superseded 2026-10-07: the fixture run
  ran on the founder's spend OK; see the amendment below.

## Amended 2026-10-07 (founder, planning chat of 2026-10-07/08, relayed by the phase 1b task prompt)

Tags as above. **PLANNING'S WORDING** marks what the planning assistant worded following his
rulings, kept apart from what he ruled.

**FOUNDER-REPORTED, the rulings (not up for relitigation):**

1. **His examples are the exemplars.** He rewrote them before phase 1 ran, "to make them more
   natural and less robotic". Nine stay exactly as they were in the tree, casual spelling and
   spacing included (`ב 3 בבוקר`, `ה 60`, a stretched last letter). §1's "not to be rewritten"
   stands; what changed is that the rules are now written to match them, not the reverse.
2. **`shoutout_hack` is replaced** with his text of 2026-10-07/08, verbatim: `שאפו למי שגילה שאם
כותבים את המשימה הכי מעצבנת ראשונה ברשימה, פתאום כל השאר נראות קלות. ושאפו כפול למי שהמציא
את ה-Mesima הזאת, שמזכירה את המשימה בדיוק כשיושבים מול המחשב. נגמרו התירוציםםם`. Reason: the
   earlier version had the speaker using the product and reporting a result, which §2 (decision 10) rules out. §2 stands unchanged.
3. **The governing principle: it never reads as an ad.** His words: "it shouldnt ever feel like im
   trying to sell something to the viewer, it should never come off as an ad", and the text speaks
   "in general as if the person who wrote the text is telling people about it casually". The
   viewer relates to what the person wrote before noticing a product.
4. (The cap, 400 characters: recorded in [[0090-text-block-format-clip-once-with-its-own-sound]].)
5. **No em dash in generated text; a plain hyphen instead.** Reason: "it makes it come off as
   obviously AI".
6. **The fixture run is approved, capped at ₪15.** (Ruling 7, the migration push, is recorded in
   [[0089-service-c-text-block-exists-admin-only-phase-1]].)

**PLANNING'S WORDING, following his rulings:** (A) the en dash (U+2013) is refused with the em dash
(U+2014), for the same reason, and a dash is a plain hyphen with a space on each side; (B) the
dash check applies to the model's output only, through the house reject-and-retry, and an edited
text is not checked for it; (C) the rule rewordings below.

**MEASURED, what changed in the tree.** `text_block` v1 was edited in place, not cut as v2: it had
never generated a text (0051 was unpushed, so no production `scripts` row could carry kind
`text_block`, and phase 1 made no paid call). It froze when the fixture run below stamped its
texts `text_block@v1`.

- **The prompt.** The global "the rules win over the examples, always" and the notes under
  `instead` and `shoutout_hack` are gone, and the call-to-action rule no longer carves out
  `cautionary_confession` by name. The rules were reworded to match the ten examples, with these
  points:
  - A **Never an ad** section quotes ruling 3 and sets the test every text passes: "would a person
    post this with nothing to sell?".
  - **The product is mentioned, not offered.** It is named once, in passing, often as one of
    several (`כמו X או דברים בסגנון`), and the name never opens the text. This replaced "the
    product arrives after the midpoint", which `instead` breaks: its brand sits at 29% of the text.
  - **General phrasing is preferred** over addressing the viewer in the clause that carries the
    product, as a preference, because `instead` and `discovery` address the viewer there.
  - **No call to action for the product.** `instead` is the one skeleton whose move is an
    instruction. Advice or a warning about the problem is not a call to action.
  - **Length:** "Most texts stay short: around 25 to 40 words … 400 is the ceiling, for a text whose
    joke needs the room, never the target". This replaced "two or three sentences at most", which
    `founder_ask` breaks with five.
  - **Line breaks** are allowed in `quiz`, `founder_ask` and before a short bracketed aside on its
    own last line.
  - **Register:** "typed on a phone, unpolished".
  - **The dash rule** is ruling 5, with A and B.
  - **A household reference point may be written in Hebrew** (`אקסל`, `באינסטגרם`), because two of
    his examples do.
  - **The Truth block is byte for byte** as phase 1 wrote it.
  - **Every skeleton description was rewritten from its example.** `relatable_observation`'s move is
    now a salute to the people who still manage by hand without the product, and its admin label is
    his line, `אין לי מושג איך אתם עושים את זה`. `cautionary_confession` lost its stale gender line.
- **The dash split** (A, B), which supersedes §2's "the validator refuses U+2013 and U+2014":
  - `textBlockTextError` (the burn check, run at generation, edit and render) now admits both,
    because its character set is the hook line's plus the newline.
  - `findGeneratedTextBlockDash` refuses them in `textBlockBatchProblem` only.
- **Tests.** A literal copy of the ten texts is pinned against `TEXT_BLOCK_EXAMPLES` and the
  prompt. Other tests pin that:
  - no ignore-this-part note remains;
  - the prompt's own prose carries a long dash only in the dash rule and the verbatim truth line;
  - both dashes on generated text get one retry, then raise;
  - an edited text with `—` renders;
  - every example passes the generation check;
  - the cap is 400.
- **The ten examples checked against every reworded rule, REASONED one by one.** Measured: 128–396
  code points, 24–76 words, no long dash, one brand each, the brand never in the opening words.
  The closest calls, judged not breaks:
  - `cautionary_confession`'s tail (`ואז לא תצטרכו לבכות ב 3 בבוקר…`) and `instead`'s "the
    difference between a calm year-end and…" describe what the category does, not an invented
    figure and not the speaker's experience of the product.
  - `founder_ask` is the business speaking about its own product. It passes "nothing to sell"
    because its move is asking for an opinion, with no price, link or availability line.
  - `discovery` names the thing's existence first, because that is its surprise. The name still
    comes in the second beat.

**MEASURED, the fixture run (2026-10-07, the founder's spend OK; `claude-sonnet-4-6`, throwaway
PGlite, Tavnit's questionnaire read once read-only from production, no production write):**

- **The batches.** One batch per business at the launch clip's gender (female): Tavnit, a Haifa
  plumber (local service) and an Excel course. The course ran once more with a male clip.
- **Calls and spend.** Each batch took 4 model calls in total, one per batch, so **no retry**.
  Spend was **64 agorot** on the `usage_events` estimate (16 per batch), against a 1500 cap.
- **Coverage.** 40 texts, and no skeleton skipped by any batch.
- **Mechanical checks.** 143–350 code points, 26–67 words, median 40, with 21 of 40 inside 25–40
  words. There was no long dash and no illegal character.
- **Truth against the questionnaires.** Tavnit's `discovery` claim that its own marketing content
  was made with Tavnit is the questionnaire's `wow`.
- **Read by eye, not ruled** (findings for the founder, prompt unchanged):
  - **Singular address.** Three texts address the viewer in the singular, against the plural rule:
    Tavnit `reframe` `שבנית`, the course's female `discovery` `אותך … שלך`, and the course's male
    `reframe` `נותן לך`.
  - **Feminine plural.** The course's female `cautionary_confession` uses a feminine plural for
    the audience, `מנסות`.
  - **Phrases copied whole from the examples**, across the four batches:

    | Phrase                                      | Batches                        |
    | ------------------------------------------- | ------------------------------ |
    | `נו, כן או לא?`                             | 4 of 4 `founder_ask`           |
    | `אין לי מושג איך אתם עושים את זה, אבל שאפו` | 4 of 4 `relatable_observation` |
    | `זה לא נשמע מרגש, אבל זה ההבדל בין`         | 3 of 4 `instead`               |
    | the `מניסיון אישי` aside                    | 4 of 4 `instead`               |
    | `נגמרו התירוציםםם`                          | 2 of 4 `shoutout_hack`         |

    This is against "never copy an example's wording".

  - **Invented figures.** One general fact is invented: the course's female `wish_more_knew` says
    most daily Excel use is "five basic functions". The plumber's `shoutout_hack` says a photo
    saves "half a call".

## Related

- [[0089-service-c-text-block-exists-admin-only-phase-1]], [[0090-text-block-format-clip-once-with-its-own-sound]].
- [[0046-the-rega-ban-targets-the-hesitation-tick-not-the-word]] — the tick rule, in its wording.
- [[0033-b-script-may-write-an-allowed-brand-name-in-latin]] — Latin brand names, the same stance.
- [[0042-content-policy-is-wired-at-both-choke-points]] — `createTextBlockRender` is the third choke point; it returns early for admin-owned businesses, so in phase 1 the classifier never runs.
