---
type: decision
status: verified
verified: 2026-10-09
method: "Founder rulings 1–11 of the task prompt 'גוש טקסט, phase 2 (the customer wizard)' (from his planning chats of 2026-10-07 and 2026-10-08), its planning defaults (the planning assistant's, struck or kept at plan approval), and four rulings in this task's planning chat of 2026-10-09 (R1–R4, answers to the session's questions). MEASURED in the tree at feat/service-c-phase-2: supabase/migrations/0053–0056, packages/core/src/pricing.ts, packages/core/src/text-block.ts, packages/core/src/pipelines/{copy,text-blocks,sets,bank}.ts, prompts/text_block/v3.md, apps/web/src/lib/persona-catalog.ts, apps/web/src/app/api/{personas,text-block-clips}/**, apps/web/src/app/api/businesses/[businessId]/text-blocks/**, apps/web/src/app/home/c/new/**, apps/web/src/components/c-wizard/**, apps/admin/src/app/(admin)/text-blocks/**. The R4 paid check MEASURED with one real call on his OK (₪0.5 cap): packages/core/.work/text-block/v3-check.ts, output .work/text-block/v3-check.md (gitignored)."
source: founder
---

# 0099 — גוש טקסט phase 2: every customer with credits, characters first, a stored batch served one text at a time

Phase 2 of Service C, the customer wizard. It supersedes CLAUDE.md's "Phase 2 … do not start it"
and [[0089-service-c-text-block-exists-admin-only-phase-1]] §3's stop. Tags as in 0089:
**FOUNDER-REPORTED** (his ruling or statement), **MEASURED** (read in the tree or run),
**REASONED** (inference from what is cited), **PLANNING DEFAULT** (assumed by the planning
assistant, kept at his plan approval and not otherwise ruled).

## 1. It opens to every customer with credits

**FOUNDER-REPORTED.** His reason, one post: his first Service C post on 2026-10-07 reached about
200 views within a few hours, where his posts usually take a day, with an average watch time of
6 s on the 10 s clip. 0089 §3 made his own posts the trigger for phase 2.

**MEASURED:** `createTextBlockRender` no longer refuses a business that is not admin-owned. The
wizard lives at `/home/c/new` (PLANNING DEFAULT), behind A and B's entry gate: a zero balance sees
`NoCreditsCard` (`wizardGate`). The admin console keeps the old refusal itself: its render route
refuses a business that is not admin-owned before it reaches core, so the founder's console can
never debit a customer (REASONED, the generate route already did).

## 2. Characters come first, like A and B

**FOUNDER-REPORTED:** the wizard opens on the characters and picking one shows only that
character's clips (0012's persona-first rule). A character appears only if it has at least one
active גוש טקסט clip. A character may belong to this format alone, with no hook clips and no
selfie, and then never appears in A's or B's pickers.

**R1, FOUNDER-REPORTED (2026-10-09): such a character has no voice.** `personas.voice_id` drops
NOT NULL (0055), and B's picker also requires a voice, so the B wizard never offers a voiceless
character even if it later gets a selfie (the picker is the guard, as it already was for a persona
with no selfie: the B render route does not tie the render's persona to the script's). The options offered: nullable (chosen), or every
character keeps a voice id it never uses.

**MEASURED:** `loadPersonaCatalog("c")` lists an active persona with an active, uploaded clip of
its own and a usable image (A's thumbnail order: preview, then default, then newest), so a
character with no image is not listed (PLANNING DEFAULT). `"a"` still needs an active hook clip;
`"b"` now needs a usable selfie AND a voice. `/api/personas` is three-way
(`withSelfie` → b, `withTextBlocks` → c, else a).

## 3. Every clip belongs to a character

**FOUNDER-REPORTED:** registering a clip asks for its character; the card flags an active clip
that has none (0012's hook pattern); a clip's speaker gender is its character's gender.

**MEASURED:** `text_block_clips.persona_id` (0054, nullable like `hook_clips.persona_id`). The
admin register route requires a character and refuses one with no gender; the clip's
`speaker_gender` is written from the character at register, at a reassign, and by
`updatePersona` when a character's gender changes (one transaction). The card's own gender select
is gone and a PATCH that names `speakerGender` is refused. The clips registered in phase 1 have no
character until the founder assigns them, and no customer sees them until then.

## 4. One text at a time, rotating — served from a stored batch (R2 replaces the default)

**FOUNDER-REPORTED, ruling 4:** each "another text" brings the next structure, least-recently-used
per business, wrapping (0031's rotation); the admin page keeps generating every structure at once.

**R2, FOUNDER-REPORTED (2026-10-09), replacing the planning default "one call per text":** one
call writes all fitting structures, the way A's hook lines come as a batch and are shown a few at
a time. The wizard shows them one at a time. "Another text" shows the next stored one and calls the
model again only when this business has none left unseen for this speaker gender, or its
questionnaire changed after that batch. The rotation runs across visits: the next text is the
structure this business has gone longest without seeing. His reason: about 14 agorot for ten texts
against about 85, and one call per text uses up the per-account daily token cap about six times
faster.

**MEASURED:** `serveNextTextBlock` (`pipelines/text-blocks.ts`):

- **The stock** is the business's text_block rows that are unseen (`scripts.shown_at` NULL, 0056),
  not edited, in the clip's speaker gender, stamped with the questionnaire's current
  `questionnaire_updated_at` (`params.questionnaireUpdatedAt`, written by `generateTextBlocks`),
  for a skeleton that still fits, and not a placeholder.
- **An empty stock** buys one batch (`generateTextBlocks`), with both `llm_tokens` caps asserted
  first — a text served from stock asserts nothing and calls nothing (PLANNING DEFAULT: generation
  is free and bounded by the per-account and platform caps; usage is recorded under the business).
- **The pick:** the skeleton with the oldest `max(shown_at)` over every text_block row the business
  was served (never seen first), then bank order, then the older row. Serving stamps `shown_at`.

**REASONED, why a column:** a batch is one INSERT, so its rows share one `created_at`; 0031's
created-at LRU cannot order the structures of one batch. `shown_at` is the one column on `scripts`
written after insert; text rows are still never edited in place.

## 5. A structure that doesn't fit is skipped

**FOUNDER-REPORTED, ruling 5 (2026-10-08):** `discovery` is never requested when the questionnaire
has no `wow` — admin batch and wizard alike — after the thinking test found 7 of 8 no-wow batches
storing a placeholder as a text ([[text-block-thinking-low-test-2026-10-08]]). In the wizard, a
structure the model declines or answers with a placeholder is passed over; the customer never sees
a placeholder or a skipped structure.

**R3, FOUNDER-REPORTED (2026-10-09): both batches move to `text_block` v3**, which is v2 byte for
byte except two hunks — the bank heading (v2 line 164) and the Output block (v2 lines 346–349) —
that name the requested skeletons through `{{skeletons}}`. Every rule and example is identical,
including "Skip `discovery` when the questionnaire has no `wow`". The options offered: v3 (chosen,
with R4), or v2 unchanged with the discovery text dropped in code, which would not meet "never
requested".

**MEASURED:**

- `fittingTextBlockSkeletons(questionnaire)` is the ten, less `discovery` when `wow` is missing or
  blank. Without a `wow`, `generateTextBlocks` lists `discovery` in `skipped` with the reason
  `אין wow בשאלון`, so the admin page still shows why.
- Before storing, a batch drops an entry for a skeleton it did not request and any skeleton the
  model also listed in `skipped` (REASONED: a hedged answer is a skip). An unknown id still gets
  the one re-request.
- `isTextBlockPlaceholder` (no Hebrew letter) keeps `skip`, `skipped` and a bare skeleton id out of
  the stock; the admin batch still stores what the model wrote.

**R4, FOUNDER-REPORTED (2026-10-09): one small paid check**, one real v3 batch for the Excel course
(no `wow`), cap ₪0.5. **MEASURED, 2026-10-09:** one call, 13 agorot on the `usage_events`
estimate, 20 s; the request named nine skeletons without `discovery`; nine texts were stored and
served in bank order with no further call; no placeholder, no `discovery`. The texts are in
`packages/core/.work/text-block/v3-check.md` (gitignored).

## 6. The customer moves and resizes the box

**FOUNDER-REPORTED:** as in A's placement editor; the box starts on the clip's own area; the colour
stays the clip's, never the customer's (0073). **MEASURED:** the wizard's studio uses A's
`PlacementEditor` with an optional children slot (A and B pass none) drawing the text in the burned
look; `createTextBlockRender` takes `textSafeArea`, validates it with `textSafeAreaSchema` (inside
the frame, whole pixels) and pins it on `params.textSafeArea`, where the worker already read the
rect from (no worker change). The colour is still read off the clip row at render.

## 7. The price: 25 credits flat, on the button

**FOUNDER-REPORTED, rulings 7 and 8:** the confirm button shows the price on the button itself,
read from the quote and never a literal (0048); 25 credits flat per render under its own key
(0089 §4). One render per confirm (PLANNING DEFAULT).

**MEASURED:** `c_text_block_credits: 25` (0053, pushed BEFORE the merge — rule 9's order, because
`creditCostsSchema` requires it); `quoteServiceC` (flat, floor-exempt); `quoteTextBlockRender`;
the quote route `GET …/text-blocks/renders/quote`. `createTextBlockRender` is the **third debit
site** beside `createSet` and `createBRender`, with all their properties: one `debit_render` row
per render inside the render's transaction, the row lock on the owner (`debitRender`), the typed
`InsufficientCreditsError` (402), and the refund from the handler and the reaper through
`failRenderAndRefund`, which already covered a `c` render. `docs/05-billing.md` says three.

## 8. The edit is free; the content-policy gate runs at render

**FOUNDER-REPORTED, ruling 9** (0091 decision 11): only the render rules apply to the customer's
edit — the character set and the cap. The content-policy gate runs at render on the questionnaire
and the final text, after every free gate and before the debit; admin-owned businesses skip it
(0042). **MEASURED:** `POST /api/scripts/[id]/text` gained a `text_block` branch
(`normalizeTextBlockText` + `textBlockTextError`, 400 with its message, no dash rule).
`createTextBlockRender` runs the free gates (clip, script, gender, text, rect), then the quote and
`assertAffordable`, then `assertContentPolicy`, then the transaction — `createBRender`'s order.

## 9. Landing, `/pricing` and the legal pages stay untouched

**FOUNDER-REPORTED, ruling 10** (0089 §5). This supersedes 0089 §3's REASONED list item "the
landing, `/pricing` and the legal pages" as a phase-2 need. **MEASURED:** none of them changed.

_(Lifted for the landing only, 2026-10-10, by the founder:
[[0100-home-cards-show-example-clips-landing-sells-three]] §5. `/pricing` and the legal pages stay
untouched.)_

## 10. What else was decided while building it

- **PLANNING DEFAULTS kept:** a change to a character of the other gender clears the texts already
  shown (A's hook studio); each text shows its structure's Hebrew label (the admin headings in
  `TEXT_BLOCK_SKELETONS`, now customer-facing); a third dashboard card beside A and B.
- **REASONED, the session's:**
  - **No SELECT policy on `text_block_clips`.** 0089 §3 listed one; no browser client reads the
    table (every reader is the server over `DATABASE_URL`), and `USING (active)` would expose
    unassigned clips' paths through the Data API for no feature. RLS stays on with no policy,
    0050's shape. The founder could strike this at plan approval and did not.
  - **A sidebar entry** beside A's and B's, which the defaults did not name.
  - **No AI-labelling line** on the result step: neither A's nor B's has one, and no new legal copy
    was written.

## Not verified

- No customer render has run in production; the wizard's screenshots come from a fetch-mock
  harness at 375 px, not a signed-in walk.
- The box must already be on PR #80 (the `c` handler) for a customer render to succeed; whether it
  is is not recorded in the repo.

## Related

- [[0089-service-c-text-block-exists-admin-only-phase-1]], [[0090-text-block-format-clip-once-with-its-own-sound]], [[0091-text-block-texts-ten-skeletons-truth-rules-free-edit]].
- [[0031-the-structure-bank-rotates-least-recently-used-per-business]] — the rotation this one follows.
- [[0012-persona-first-steps-wizard]] — characters first, and the unassigned-clip flag.
- [[0042-content-policy-is-wired-at-both-choke-points]] — the third choke point, now customer-reachable.
- [[0048-the-demo-analysis-is-charged-once-per-demo]] — price on the button, and the deploy order a new key carries.
- [[text-block-thinking-low-test-2026-10-08]] — the placeholders this phase keeps from a customer.
