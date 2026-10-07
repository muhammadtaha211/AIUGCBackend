---
type: decision
status: verified
verified: 2026-10-07
method: "Founder decisions 9–11 of the 2026-10-07 task prompt and its Appendices A (the skeleton bank, deconstructed by him from 12 reference posts) and B (the writing rules); the reasons are his, the Consumer Protection reference is the planning assistant's web read of 2026-10-07 as the prompt states it. MEASURED in the tree at feat/service-c-text-block: prompts/text_block/v1.md, packages/core/src/text-block.ts, packages/core/src/pipelines/copy.ts (generateTextBlocks, textBlockBatchProblem), packages/core/test/text-block-prompt.test.ts, test/text-block-generate.test.ts. Amended 2026-10-07 from the founder's rulings in the planning chat of 2026-10-07/08, relayed by the phase 1b task prompt (rulings 1–3, 5, 6 his; A–C the planning assistant's wording); the fixture run is MEASURED with real calls (packages/core/.work/text-block/fixture-run.ts, gitignored, run once on the founder's spend OK; its output .work/text-block/fixture-texts.md). Amended again 2026-10-07 for text_block v2 from the founder's planning chat of 2026-10-07, relayed by the v2 task prompt (rulings 1–13; reasons his unless marked planning's); MEASURED in the tree at feat/text-block-v2: prompts/text_block/v2.md, v1.md's SHA-256, packages/core/src/text-block.ts, packages/core/test/text-block-prompt.test.ts; the v2 examples derived from v1's bytes by packages/core/.work/text-block/v2-examples.mjs (gitignored); the v2 fixture run MEASURED with real calls on the founder's OK (₪3 cap) by the same fixture-run.ts, its output .work/text-block/fixture-texts-v2.md and fixture-findings-v2.md (packages/core/.work/text-block/fixture-phrases.mjs for the shared phrases)."
source: founder
---

# 0091 — The texts: ten skeletons, what the generator may write, and the edit is free

Decisions 9–11 of 2026-10-07. Tags as in [[0089-service-c-text-block-exists-admin-only-phase-1]].

## 1. Texts come from a bank of ten skeletons (decision 9)

~~Deconstructed by the founder from 12 reference posts he supplied~~ (a third-party collection; the
view counts are that site's — **FOUNDER-REPORTED**). One text per skeleton that fits the business;
a skeleton that does not fit is skipped, never forced. The ids: `reframe`, `instead`,
`shoutout_hack`, `wish_more_knew`, `founder_ask`, `relatable_observation`, `quiz`, `discovery`,
`envy_portrait`, `cautionary_confession`. An eleventh — a POV windfall with an exact sum — was
~~dropped by him~~: an income claim that depends on the clip. The Hebrew examples are his
founder-read starting copy and are ~~not to be rewritten~~.

_(Corrected 2026-10-07, from the `text_block` v2 task prompt. **The provenance:** the planning
assistant, not the founder, deconstructed the skeletons from the 12 screenshots he supplied, and
the planning assistant dropped the POV windfall. He rewrote the Hebrew examples. **The examples
are now changed only on his approval:** five were changed and two added on 2026-10-07, see the v2
amendment below.)_

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

## Amended 2026-10-07, `text_block` v2 (founder, planning chat of 2026-10-07, relayed by the v2 task prompt)

Tags as above. The reasons are his unless marked **PLANNING'S**.

**FOUNDER-REPORTED, where the rulings came from:** Tavnit's questionnaire was fixed to describe
video ads, its batch was regenerated on 2026-10-07, and he reviewed all ten texts. Not
repo-verified. The planning assistant read the batch alongside eleven new reference posts.

**FOUNDER-REPORTED, the rulings (not up for relitigation):**

1. **A closing line on its own.**
   - **Which skeletons:** `reframe`, `shoutout_hack`, `envy_portrait` and `cautionary_confession`
     end on a short line of their own, after a blank line.
   - **What it is:** a reaction, the writer's own response. His examples were `תודו לי אחר כך`
     and `איךךך זההה הגיוניייייי`. It is never a lesson or a moral, and its wording is new every
     time.
   - **PLANNING'S reason, adopted by him "for now":** none of the eleven new reference posts ends
     on a lesson. A lesson restates the product's pitch (Tavnit's `לא תמיד כדאי להתחיל מאפס`) and
     reads as a tagline. He will adjust it when there is more data.
2. **`instead`.**
   - **The order:** the opener stands alone on the first line, then a blank line. The contrast
     names the good outcome first and the bad one last. The bad one is followed at once by a
     concrete human reaction to living it. The ironic "not from experience" aside comes on its
     own last line, and only when that reaction is there.
   - **The product clause stays short.**
   - **His reason for the order:** the Sfarimo example already ran good-then-bad, and his
     2026-10-07 batch reversed it anyway. So the order has to be a rule, not something the example
     only shows.
   - **PLANNING'S reason for the short product clause:** it keeps the text under the cap and reads
     less like an ad.
3. **The cap is 450 hard and 400 asked**, recorded in
   [[0090-text-block-format-clip-once-with-its-own-sound]].
4. **`reframe` may name one widely known tool** the audience already uses, beside the product, as
   the familiar, harder route. His Tavnit edit does this: `אלא אם נעזרים בקלוד או באתר ש…`.
   - **Limits:** never a tool in the advertiser's own category; nothing said about it beyond its
     name; only when one fits.
   - **Reason:** a familiar tool beside the product reads less like an ad. Three of the eleven new
     reference posts do it.
5. **`envy_portrait`.**
   - **(a) The payoff follows from the traits.** The traits show the person getting the job done
     with less effort or money than everyone else, and the product is the trait that replaces the
     slow or expensive way. The last trait is a surprising win that those traits explain, never
     an unrelated perk.
   - **(b) The type's gender** is the likely gender of the viewer's peers in that world, read from
     `target_audience`, separate from the speaker's gender. The same holds for any third person in
     any skeleton.
   - **(c)** It ends on a closing line, as in ruling 1.
6. **The Truth block changes on one point.** A recognisable type the viewer knows from their own
   world may end on an exaggerated win, with no number, no earnings and no health or body result.
   It is never the speaker and never a specific person the speaker knows. Every other line stands,
   including "Never write the speaker using, trying, buying or benefiting from the product, in any
   tense".
   - **Reason:** his ruling that a made-up type's exaggerated win is fine. **PLANNING'S** view,
     agreeing: it is puffery, in the same class as v1's Slidy gym line.
   - **Raised and not adopted:** he also argued for first-person results ("I used Tavnit and got
     200 extra users"). The planning assistant declined to build a generator that writes them,
     and he approved the plan that keeps the speaker rule. On record, from the planning
     assistant's web read of 2026-10-07, not legal advice:
     - the Consumer Protection Authority's guidance, already cited in §2;
     - s.7 of חוק הגנת הצרכן makes liable both the advertiser and whoever brought the ad to
       publication. The only defence is for someone who did not know and could not have known
       that it was misleading;
     - `/terms` §6 forbids presenting an AI persona as a real customer or testimonial
       ([[0068-prices-stand-no-free-tier-trials-by-hand]]);
     - [[0061-landing-positioning-two-services-no-results-claims]] removed the invented
       testimonial from the landing.
7. **Copying.** Each skeleton names its signature phrase, which may repeat. Everything else,
   closing lines and asides included, is written fresh and never lifted from an example.
   - **Reason:** the 2026-10-07 fixture run copied whole phrases across batches (the table in the
     first amendment), and his Tavnit batch of the same day did it again.
   - **PLANNING'S list, taken from the reference trends' own openers:**

     | Skeleton                | Signature phrase                                                                                             |
     | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
     | `reframe`               | `… נשמע …, עד שמבינים ש…`                                                                                    |
     | `instead`               | `קחו את זה ממני`                                                                                             |
     | `shoutout_hack`         | `שאפו למי ש… ושאפו כפול למי ש…`                                                                              |
     | `wish_more_knew`        | `הלוואי שיותר … היו יודעים ש…`                                                                               |
     | `founder_ask`           | `רעיון גרוע או גאוני?`                                                                                       |
     | `relatable_observation` | none: the move is the salute itself, and `אין לי מושג איך אתם עושים את זה, אבל שאפו` is how one example ends |
     | `quiz`                  | `רוב ה… לא עונים נכון אפילו על אחת מאלה`                                                                     |
     | `discovery`             | `לא רוצה להלחיץ אף אחד, אבל`, or `ואף אחד לא חשב לספר לי ש…`                                                 |
     | `envy_portrait`         | `יש את ה… הזה/הזאת בכל …`                                                                                    |
     | `cautionary_confession` | `מאוד מפתה ל… אל תעשו את זה, כי תגמרו כמוני`                                                                 |

8. **Two second examples**, one skeleton with two shapes in each case.
   - **`relatable_observation`'s library shape:** a person seen in public, a clipped list of what
     they did without, the product hidden mid-list, and a deadpan ending.
   - **`discovery`'s "nobody was going to tell me" shape:** the name is kept to a bracketed last
     line.
   - **Reason:** a second shape teaches the move rather than the wording. **Sources:** two
     reference posts he supplied, at 500K and 213K views (the third-party site's counts).
9. **Five examples change and two are added.** The planning assistant drafted all seven and he
   approved them verbatim on 2026-10-07. §1's "not to be rewritten" now reads: changed only on his
   approval.
10. **Address and figures are restated more firmly:** the plural address, the audience in the
    general plural (never the feminine plural), and no invented figure. There is no new rule.
    **Evidence:** the first amendment's fixture findings, plus two texts in his Tavnit batch:
    `שלוש שעות` (an invented timeframe) and `שבנית` (singular address).
11. **Stretched letters**, the Hebrew stand-in for capitals, appear at most once per text.
12. **No new skeleton.** "u think u can hurt me" and "Realizing that…" wait for a hand-written test
    post. **PLANNING'S reason:** it is a 2022 meme and no Hebrew version was found. The version
    we might write is the weaker of the two reference posts, and it leans on an invented
    timeframe.
13. **Unchanged apart from ruling 7:** `wish_more_knew`, `founder_ask`, `quiz`.

**MEASURED, what changed in the tree** (branch `feat/text-block-v2`):

- **The prompt.** `prompts/text_block/v2.md` is a new file and `generateTextBlocks` picks it up as
  the latest version, so new rows are stamped `text_block@v2`. `v1.md` is byte for byte as it was,
  and `text-block-prompt.test.ts` pins its SHA-256 (`bb80e178…600052`).
- **The examples.** v2's ten first examples are v1's with exactly the five changes ruled above.
  They were applied by a script to v1's own bytes, each replacement matching exactly once, and the
  two new ones were added as given. `TEXT_BLOCK_EXAMPLES`, the DRY_RUN stand-in, is v2's ten first
  examples. The two second examples live in the prompt only.
- **The examples, measured:** 128 to 396 code points, with no long dash, at most one stretched
  letter, and Latin never among the opening words.
- **The tests.** `text-block-prompt.test.ts` pins:
  - v1's bytes, and that v1 still renders with its ten examples;
  - the twelve v2 examples literally and in order, with exactly five changed from v1;
  - the rules a machine can check on every example;
  - every ruling's wording;
  - the Truth block, equal to v1's with the one bullet inserted;
  - the signature-phrase list exactly as above;
  - the descriptions of `wish_more_knew`, `founder_ask` and `quiz`, equal to v1's apart from the
    signature line;
  - the 400 sentence, and that the prompt never names 450.

**REASONED, choices made writing v2:**

- **His two sample closing lines are not quoted in the prompt.** Ruling 7 says closing lines are
  never lifted from an example, and `איךךך זההה הגיוניייייי` stretches three words, against
  ruling 11. The four closing lines in his changed examples show the move instead, and the prompt
  names one lesson as the thing a closing line is not.
- **The Copying rule lists what the 2026-10-07 run lifted** as the examples' own words, not
  signatures: the five phrases in the first amendment's table, and the small hours as the bad
  moment (five of its eight `instead` and `cautionary_confession` texts used 2 or 3 at night).
- **A short "before you return" check** restates ruling 10 with the batch's own failures, so the
  Truth block keeps its v1 wording. The check repeats Truth's allowance for everyday numbers, so
  it does not widen the rule.
- **The shape rule now lists every line break a skeleton asks for.** v1's "only in `quiz` and
  `founder_ask`" no longer matched the changed examples.
- **An adversarial review of the draft against the rulings and its own examples** found eight
  wording problems. All eight were fixed in the prose and no example changed:
  - The Gender line still allowed a feminine plural for an all-female audience, against
    ruling 10 and the final check. It now says never, whoever the audience is.
  - The final figures check had dropped Truth's everyday-number allowance. It now restates it.
  - The prose's own illustrations reused lifted wording. The dash sample was
    `אין לי מושג - אבל שאפו`, the stretched-letter sample was `התירוציםםם`, and the register sample
    was `ב 3 בבוקר`. They were replaced with neutral ones, and a test now keeps them out of the
    rules.
  - Signature phrases were called "the opener". Several are not openers, so they are now "the
    exact words".
  - `instead` was "the ONLY skeleton with an instruction". `cautionary_confession`'s signature
    phrase is itself an instruction, so the line now reads "whose move is an instruction", as
    v1's call-to-action rule already did.
  - The quote rule allowed `"` only, while two examples type `'`. Both are now allowed.
  - The bank's intro said every skeleton has a signature phrase. `relatable_observation` has
    none.
  - `founder_ask`'s line breaks fall between its three parts, as its example shows, not between
    its three how-it-works beats.

**MEASURED, the v2 fixture run** (2026-10-07, on the founder's spend OK capped at ₪3):

- **How it ran.** `claude-sonnet-4-6`, a throwaway PGlite database, and no production write.
  Tavnit's questionnaire was read once, read-only, from production. The texts are in
  `packages/core/.work/text-block/fixture-texts-v2.md`, and the phrase list and rule findings are
  in `fixture-findings-v2.md`, both gitignored.
- **The batches.** The same four as the v1 run: Tavnit, the Haifa plumber and the Excel course at
  a female speaker, and the course again at a male speaker. Tavnit's questionnaire is now the
  fixed one he reported, so its texts do not have the same input as v1's.
- **Calls and spend.** Five calls, **94 agorot** on the `usage_events` estimate.
- **One retry.** The plumber batch's first answer returned `discovery`'s bracketed name line as
  a skeleton entry of its own. The batch check refused it as an unknown skeleton, and the second
  answer was clean.
- **Coverage.** 40 texts, and no skeleton was skipped.
- **A miss in both runs.** The course questionnaire has no `wow`, so both course batches should
  have skipped `discovery`. They wrote it, in this run and in v1's, and the first amendment missed
  it.
- **Mechanical checks.** 112–376 code points, 22–68 words, median 45; 12 of 40 texts are inside
  25–40 words (v1: 21 of 40, median 40). Every text passes the following:
  - no text over 400 characters and no long dash;
  - the product named once, never in the opening words;
  - every closing-line skeleton has its closing line;
  - every `instead` opens on `קחו את זה ממני` alone;
  - at most one stretched letter.

**MEASURED, copying, v1 run → v2 run** (whole phrases across the four batches):

| Lifted wording                              | v1        | v2                       |
| ------------------------------------------- | --------- | ------------------------ |
| `נו, כן או לא?`                             | 4 of 4    | 4 of 4                   |
| `אוקיי, בכנות` opening `founder_ask`        | 4 of 4    | 4 of 4                   |
| `אין לי מושג איך אתם עושים את זה, אבל שאפו` | 4 of 4    | 2 of 4, and 2 paraphrase |
| `זה לא נשמע מרגש, אבל זה ההבדל בין`         | 3 of 4    | 0 of 4                   |
| the `מניסיון אישי` aside                    | 4 of 4    | 4 of 4                   |
| `נגמרו התירוציםםם`                          | 2 of 4    | 1 of 4                   |
| the small hours as the bad moment           | 5 of 8    | 0 of 8                   |
| `אל תשאלו`, v2's new closing example        | not in v1 | 3 of 4                   |

**Rule breaks, read by eye and checked by a second, adversarial read** (by ruling; the founder's
to rule on, the prompt unchanged):

- **2.1, the closing line:** 6 of 16 break it. Two restate the point:
  - Tavnit `reframe`, `מה שנקרא לקצר תהליכים`;
  - the plumber's `shoutout_hack`, `כי הכיור לא מחכה לאף אחד`.

  Four are lifted from an example: `אל תשאלו` three times, and `נגמרו התירוציםםם` once. The other
  ten are fresh reactions.

- **2.2, `instead`:** no break. All four put the opener alone, the good outcome before the bad, and
  a human reaction right after it.
- **2.4, the familiar tool:** no `reframe` named one, which the ruling allows.
- **2.5, `envy_portrait`:** one break. The plumber's payoff is the product's own features (a fixed
  price, same-day arrival), not a win the traits explain.
- **2.6, Truth:**
  - Tavnit's type wins against companies `פי עשר` larger, a number in the win.
  - The plumber's `quiz` pointer claims the business answers all of it on the phone, which the
    questionnaire does not say.
  - The course's female `reframe` closes `איך עבדנו בכלל לפני שידענו את זה`, which leans toward
    the speaker having learned it.
- **2.7, copying:** the table above. Smaller near-lifts: `עוד לפני שהוא יצא מהבית` (the plumber's
  `discovery`), and `(עוד דברים כאלה ב-ExcelPro)` in both course quizzes.
- **2.10, figures:** five invented figures:
  - `חמש שש נוסחאות` (the course's female `wish_more_knew`);
  - `שלוש פונקציות בסיסיות` and `כמה שעות לימוד … וזה נגמר` (the male one);
  - `חצי שעה` as the fix's length (the plumber's `instead`);
  - `חצי מהיום` (the course's female `reframe`);
  - `שנייה וחצי` (Tavnit's `quiz`).

  The course's `wish_more_knew` invented a count in the v1 run too, before the prompt named one.
  Everyday durations on the problem side (`מחכים שבוע`, `תוך יומיים`, `שלושה ימים בלי מים`) were
  flagged by the second read and are judged here as the everyday numbers Truth allows, as the
  `founder_ask` example's `לחכות שעה` is.

- **2.10, address:** no singular address and no feminine plural (v1: 3 and 1).
- **2.3 and 2.11:** no break.
- **Outside section 2:**
  - both course `discovery` texts were written without a `wow`;
  - the plumber's `wish_more_knew` has no one-line fix;
  - three texts list features in a way that reads as an ad: the plumber's `discovery` and `quiz`
    pointer, and the course's female `discovery`.

## Related

- [[0089-service-c-text-block-exists-admin-only-phase-1]], [[0090-text-block-format-clip-once-with-its-own-sound]].
- [[0046-the-rega-ban-targets-the-hesitation-tick-not-the-word]] — the tick rule, in its wording.
- [[0033-b-script-may-write-an-allowed-brand-name-in-latin]] — Latin brand names, the same stance.
- [[0042-content-policy-is-wired-at-both-choke-points]] — `createTextBlockRender` is the third choke point; it returns early for admin-owned businesses, so in phase 1 the classifier never runs.
