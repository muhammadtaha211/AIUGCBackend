---
type: defect
status: verified
verified: 2026-08-23
method: "read packages/core/src/pipelines/copy.ts:84-185 and 531-551, and findPlanViolations at demo-step-plans.ts:440-455; then applied the ILLEGAL_HOOK_LINE_CHAR regex to all 835 scripts rows and all 53 stored step labels (read-only, packages/core/.work/vault-charscan.ts)"
source: db
---

# Three of the four burned-text paths have no character validation

## First, the claim this replaces

The handover said an unrenderable character "can still ship, because the code regenerates once and
then gives up". **That is false.** `copy.ts:172-185` regenerates once and then **throws**:

```ts
batch = await generate();
bad = findIllegalHookLineChar(batch.options);
if (bad) throw new Error(`hook lines contain an unrenderable character ${bad.codepoint} …`);
```

Nothing is sanitised and nothing is shipped. The comment above it is explicit about why —
"Reject-and-retry, never sanitise … dropping a character silently would ship text nobody signed off
on". The generated-hook-line path is correct.

## The actual gap

`findIllegalHookLineChar` (`copy.ts:96`) has exactly one production caller: the generation loop
above. Everything else that ends up burned into a frame is unchecked.

| burned text                   | written by                            | character guard  |
| ----------------------------- | ------------------------------------- | ---------------- |
| hook line, model-generated    | `copy.ts:172-185`                     | **yes** — throws |
| hook line, **customer-typed** | `updateScriptText`, `copy.ts:531-551` | none             |
| step label, model-generated   | `findPlanViolations`                  | none             |
| step label, **human-edited**  | `updatePlanSteps`                     | none             |

`updateScriptText` inserts `text` verbatim. That is the hook studio's free-text editing — the
feature [[0001-five-step-steps-wizard]] leaned on to justify dropping the persona step — reached
from `apps/web/src/components/a-wizard/step-hook-studio.tsx` through
`apps/web/src/app/api/scripts/[id]/text/route.ts`.

The route does validate, but narrowly: `route.ts:28` is
`if (found.script.kind === "b_script" && wordBudget)`, so the only check is a **word budget**, and
it applies **only to `b_script`**. A hook line goes through untouched, and no codepoint is looked at
on any kind.

`findPlanViolations` checks a label's **length** (`MAX_LABEL_CHARS`), **word count**
(`MAX_LABEL_WORDS`) and **provenance** (words must come from `visibleText` or the questionnaire) —
`demo-step-plans.ts:441-452`. It never looks at codepoints. Step labels are burned into the frame
exactly like hook lines.

## What is actually in the database

I applied the same regex to everything stored.

- **835 `scripts` rows → 1 hit.** `07e6bfea`, `hook_lines@v6`, created 2026-08-08 07:19:37Z,
  containing **U+0640 ARABIC TATWEEL** — precisely the incident the code comment describes
  ("A v6 run emitted U+0640 ARABIC TATWEEL inside `לـAI`").
- **53 stored step labels → 0 hits.**
- **0 `user_edited` rows affected.**

And the guard landed in `6f2d070` on 2026-08-08, the same day, in the commit that shipped
`hook_lines@v7`. So that single row **predates the guard**: it is the wound the guard was written
for, not a leak through it. The generated path has been clean since.

## Blast radius

Zero observed. The unguarded paths are the two a _customer_ drives — free-text hook editing and
label editing in the plan editor — and today the customer set is the founder plus two accounts, none
of whom has typed an exotic codepoint.

The realistic trigger is mundane, not exotic: an emoji pasted into a hook line, a zero-width joiner
carried in from a copy-paste, or a bidi override character. The existing test suite already pins
those cases as illegal — `hook-line-chars.test.ts:54-59` covers U+200B, U+202B and an emoji — so the
detector recognises them; nothing calls it on these paths.

When it happens the failure is silent and terminal: a stray glyph or a corrupted line, burned into
an MP4, unfixable after the render.

## Fix shape

Call the function that already exists, in two more places:

1. `updateScriptText` (`copy.ts:531`) — reject before the insert, same error shape as the generation
   path. This one matters most, because it is customer-supplied text.
2. `findPlanViolations` — add a codepoint violation alongside the length and word checks. It already
   has a retry channel, so the model gets a chance to fix itself, exactly like hook lines. Pair it
   with the same check in `updatePlanSteps`, which has no retry channel and should simply refuse.

`ILLEGAL_HOOK_LINE_CHAR` is currently private to `copy.ts`; `findIllegalHookLineChar` is exported
and is all either call site needs.
