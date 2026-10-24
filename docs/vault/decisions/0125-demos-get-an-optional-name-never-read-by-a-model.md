---
type: decision
status: verified
verified: 2026-10-24
method: "Founder brief in chat, 2026-10-23 (four decisions, the fourth a PLANNING DEFAULT he did not strike), and his approval of the plan, which named the 403 and the B save point. Built on feat/demo-names. Read back in the tree: migration supabase/migrations/0069_demos_name.sql, packages/core/src/db/schema.ts (demos.name), packages/core/src/pipelines/demos.ts (MAX_DEMO_NAME_CHARS, setDemoName), apps/web/src/app/api/demos/[id]/route.ts (GET name, PATCH demoPatchRequestSchema), apps/web/src/app/api/businesses/[businessId]/demos/route.ts (rows and durations), apps/web/src/lib/service-a-ui.ts (demoNamePatch, restoredDemo), apps/web/src/components/a-wizard/step-demo.tsx, apps/web/src/app/home/demos/demo-library.tsx, apps/web/src/app/home/demos/[demoId]/demo-plan-editor.tsx. Pinned by apps/web/test/demo-name-route.test.ts (7 cases, PGlite, the real routes), packages/core/test/demo-name-model-inputs.test.ts (2 cases, mocked Claude; both fail when the name is leaked into the plan's description input, checked 2026-10-24 and reverted), apps/web/test/service-a-ui.test.ts and service-a.test.ts (the save rule and the cap), packages/core/test/migrations.test.ts (0069). Browser: a throwaway harness page mounting the real StepDemo and DemoLibrary behind a fetch mock, headless Chrome at 1280 and 375 px; NOT a signed-in walk."
source: founder + code
---

# 0125 — Demos get an optional name, never read by a model

## The decision

The founder's brief, 2026-10-23. Each item is his, with his reason:

1. **Demos get a name, shown wherever a demo is picked.** He forgets which recording shows what
   and has to guess from the upload date. The next task, the Instagram autopilot, needs him to pick
   demos by what they show.
2. **The name is optional but hard to miss.** In his words: don't force it, but make it clear that
   it's possible.
3. **The name is its own field, not the description.** The description feeds the step plan and its
   captions, and a name must not change what gets generated. Planning's recommendation; he
   accepted it.
4. **A demo without a name keeps today's fallback**: thumbnail, length, upload date, description
   snippet, exactly as before. PLANNING DEFAULT he did not strike.

Two calls came with his approval of the plan, which put both to him with a recommendation:

5. **Another account's demo answers 403, not the brief's 404.** That is the project's ownership
   gate for every by-id route (`requireBusiness` in `apps/web/src/lib/api.ts`: 403 on someone
   else's row, 404 on a missing one). Answering 404 here would mean changing the gate everywhere,
   a task of its own.
6. **Service B saves the name the moment ingest reaches ready.** B's demo step has no continue
   button: `StepCutaways` unmounts it the instant the demo is ready. A reused demo is renamed on
   `/home/demos`. Built one step further after the review (below): the name is also saved when the
   customer leaves the step before ready.

Not built, by the brief's limits: any change to analysis, planning, captions, copy, rendering, the
worker, admin or the autopilot. The register route is unchanged.

## How it works

**The column.** `demos.name`, text, nullable, no default, no backfill (0069). The cap is code, like
the description's: `MAX_DEMO_NAME_CHARS = 40` in core, mirrored in `service-a-ui.ts` for the client
and pinned equal by a test.

**One write path.** `PATCH /api/demos/[id]` takes `description` and `name`, both optional, and at
least one is required. Each key sent calls its own setter, and a key left out is untouched. `name`
is trimmed, then capped at 40 characters by the schema (a 41-character name is a 400). Blank clears.
`setDemoName` **does not touch `updated_at`**, unlike `setDemoDescription`. The janitor deletes the
raw upload `retention_days.raw_after_normalize` days after `demos.updated_at`
(`pipelines/janitor.ts`), and renaming a recording must not keep its raw file longer. The
register route stays as it was.

**Where it shows.** `GET /api/demos/[id]` and both shapes of `GET /api/businesses/[id]/demos`
(the rows and the duplicate brake's `durations`) carry `name` when there is one.

| Surface                                     | What it does                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A demo step, upload, ingest and ready cards | Name field, the first field on the card, prefilled on a reuse or a restore.                                                                                                     |
| B's cutaway step, upload and ingest cards   | The same field, in the same component.                                                                                                                                          |
| Reuse picker rows, A and B                  | The name on its own first line, truncated to one line so rows keep their height.                                                                                                |
| Duplicate-upload card                       | The name on its own line.                                                                                                                                                       |
| `/home/demos` rows                          | The saved name as the row's first line, wrapping. Ready rows get the name field with "שמירת השם", which appears when the value changes; emptied and saved, the name is cleared. |
| `/home/demos/[demoId]`                      | A line under the fixed "סרטון המוצר" title, so the title never swaps text when the GET lands.                                                                                   |

An unnamed demo renders exactly as before on every one of them. Left as is, by choice: the A
wizard's structure strip and B's cutaway slots show a demo already held, not a list or a picker.

**Saving without wiping.** `demoNamePatch(draft, saved)` sends `name` only when the trimmed field
differs from the demo's saved name.

- Every path that holds a demo fills the field and `demo.name` from the same value: the picker,
  the duplicate card's "use existing", and the `?demo=` restore. A new file resets the field.
- An untouched continue on a named demo never writes, and a skipped field on a new upload never
  names it.
- The field's state lives in the wizard shell, `AWizard` beside the note and `BWizard` beside the
  cutaway demo, so leaving the step mid-upload and coming back keeps what was typed.
- A saves on continue, and A's continue still always sends the description. B saves from an
  effect in `BWizard`: when the cutaway demo turns ready, or when the customer leaves the step
  first (back, a rail jump, skipping the clips), since the row exists from registration on.
- B sends `name` alone, never `description`, which would clear a note saved for A. A failed B save
  leaves the demo unnamed and the wizard goes on, because the name is a convenience.
- The library's save moves only the saved value, so text typed while it runs stays in the field.

The review of the diff (four lenses, each finding put to a skeptic) found the first B version
saving from inside `StepDemo`'s ingest poll. That version lost a name typed before the customer
left the step, and could save the value from the poll's render rather than the last keystrokes.
Both were confirmed and replaced by the effect above. It also confirmed the library save
rewriting the field, and the truncation case below.

**Bidi.** The name always sits on a line of its own, whose RTL is its base, the same base as the
RTL field it was typed in. A `<bdi>` was tried first and MEASURED wrong in the harness (2026-10-24).
`<bdi>` takes its direction from the first strong letter, so `Tavnit — אשף הוק + דמו` read
`אשף הוק + דמו — Tavnit` in the list while the field showed it the other way round. One exception,
on the two lines that truncate (the picker rows and the duplicate card): a name with no Hebrew
letter is set LTR (`demoNameDir`). In an RTL line a Latin-only name overflows at its beginning, and
the ellipsis would eat the words that identify it.

**No model reads it.** The description reaches a model through the step-plan job (the
`plan_demo_steps` prompt and the label-highlight vocabulary,
[[0049-the-label-provenance-rule-is-a-highlight-not-a-gate]]) and the retired VO script
(`generateVoScript`). Every reader of the demo row picks fields by name, and no prompt
stringifies a row. The test runs both generators on one demo, unnamed and then named:

- the prompts are identical and contain no part of the name, with the note filled in and with it
  blank (where a fallback to the name would most likely creep in);
- the stored plans and the script params are identical;
- a label word found only in the name stays flagged off-screen.

## The strings — COPY PENDING FOUNDER REVIEW

- The field's label: `שם לסרטון (לא חובה)`
- Its placeholder: `לדוגמה: הזמנה באפליקציה`
- The line under it: `שם קצר שיעזור לכם לזהות את הסרטון ברשימה. אפשר לשנות אותו בכל זמן בעמוד
סרטוני המוצר.`
- The library's save button: `שמירת השם`
- The legal definitions document's demos line: `שם שהלקוח נתן לסרטון, לא חובה (`name`)`

## Unverified

- **No signed-in walk.** The screenshots are from a throwaway harness, deleted before the commit,
  that mounted the real `StepDemo` and `DemoLibrary` behind a fetch mock. The routes are pinned by
  the PGlite tests, not by a browser.
- **The wizards' save call sites are not exercised by any test or browser run**: A's continue
  body and `BWizard`'s effect. The repo has no component-test setup. The rule they call is pinned
  (`demoNamePatch`), and so is the route they call; the call sites are read in the code only.
- Not seen on a real phone.

## Related

- [[0061-landing-positioning-two-services-no-results-claims]] — its 2026-09-23 amendment is where
  "the description feeds the captions" was last written down. Its line cites
  (`demo-step-plans.ts:1149`, `copy.ts:322`) are stale; they are `:1724`/`:1979` and `:534`/`:557`
  now.
- [[0121-service-b-demo-cutaways-and-no-sway]] — B's demo step, which shares the component.
- [[0124-the-next-version-is-taught-at-the-finished-video]] — the `?demo=` restore that carries
  the name.
