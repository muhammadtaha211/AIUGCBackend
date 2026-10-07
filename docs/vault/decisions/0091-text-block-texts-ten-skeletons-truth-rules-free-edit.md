---
type: decision
status: verified
verified: 2026-10-07
method: "Founder decisions 9–11 of the 2026-10-07 task prompt and its Appendices A (the skeleton bank, deconstructed by him from 12 reference posts) and B (the writing rules); the reasons are his, the Consumer Protection reference is the planning assistant's web read of 2026-10-07 as the prompt states it. MEASURED in the tree at feat/service-c-text-block: prompts/text_block/v1.md, packages/core/src/text-block.ts, packages/core/src/pipelines/copy.ts (generateTextBlocks, textBlockBatchProblem), packages/core/test/text-block-prompt.test.ts, test/text-block-generate.test.ts. No paid call for this note; the fixture run with real model calls waits for the founder's spend OK."
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
not only asked.

**Three of the founder's examples sit against the rules above, and the prompt says so under each
rather than rewriting his copy (REASONED, the smallest honest fix):** `shoutout_hack`'s last two
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

- No text has been generated with a real model call: every local `.env` is `DRY_RUN=1`, and the
  fixture run (Tavnit's own business plus two fixture questionnaires, cap ₪15) waits for the
  founder's explicit spend OK. Until then the only measured outputs are the DRY_RUN examples.

## Related

- [[0089-service-c-text-block-exists-admin-only-phase-1]], [[0090-text-block-format-clip-once-with-its-own-sound]].
- [[0046-the-rega-ban-targets-the-hesitation-tick-not-the-word]] — the tick rule, in its wording.
- [[0033-b-script-may-write-an-allowed-brand-name-in-latin]] — Latin brand names, the same stance.
- [[0042-content-policy-is-wired-at-both-choke-points]] — `createTextBlockRender` is the third choke point; it returns early for admin-owned businesses, so in phase 1 the classifier never runs.
