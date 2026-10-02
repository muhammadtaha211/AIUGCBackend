---
type: fact
status: verified
verified: 2026-10-02
method: "2026-10-02, later: expected.sourceIndexes re-taken from the paid v16 check (facts/v16-paid-check-2026-10-02.md, one live run per fixture). 2026-10-02 (0084/0087): the DRY_RUN regress over all five on feat/steps-fixed-2s-clips (packages/core/test/demo-step-plans.test.ts runs runPlanRegression) and placeClips + findAccessMoment over the six-word and tavnit fixtures for the pin. 2026-10-01 (0074): timelineClipMs and planPromptTimeline over each fixture by inline tsx from packages/core (cap 4000, sample 200, the file's recordingMs), against expected.sourceIndexes, expected.dryRunSourceIndexes and every actionType result state. 2026-10-01: the DRY_RUN regress over all five (runPlanRegression) and node over each file's expected block after the screen-change re-pin. Earlier: node -e over each file for state counts and expected block; git show b60b5b6 -- fixtures/timelines/ for the last change; each file's own _comment quoted verbatim"
source: code
---

# The four timeline fixtures: three red on purpose, one green two different ways

`fixtures/timelines/*.json`. Every file carries a `_comment` array explaining its own colour — read
it before touching `expected`.

**RED/GREEN is per-mode, not per-fixture.** The "RED ON PURPOSE" prose in each file describes the
**live, paid** path only. Under `DRY_RUN` — which is what `pnpm test` runs — the assertion at
`packages/core/test/demo-step-plans.test.ts:1729` is
`for (const r of results) expect(r.pass).toBe(true);`, so **all four must be green**. They are: the
core suite passed 339/339 on 2026-08-23 at commit `b60b5b6` ([[gate-results]]).

`runPlanRegression` picks the key by mode — `demo-step-plans.ts:1392-1393` prefers
`dryRunSourceIndexes` when `getEnv().DRY_RUN` is set and the key is present, and falls back to
`sourceIndexes` otherwise. The column below is the **live** colour.

| file                                  | bytes  | states | expectation                                            | live colour          |
| ------------------------------------- | ------ | ------ | ------------------------------------------------------ | -------------------- |
| `dry-run-campaign-app.json`           | 7,049  | 12     | `sourceIndexes` + `dryRunSourceIndexes`                | **RED** since `@v11` |
| `real-botteacher-file-routing.json`   | 64,754 | 61     | `sourceIndexes` + `dryRunSourceIndexes`                | **RED** since `@v11` |
| `real-botteacher-six-word-label.json` | 81,311 | 80     | `sourceIndexes` (placeholder) + `dryRunSourceIndexes`  | **RED** from birth   |
| `real-botteacher-study-app.json`      | 80,726 | 80     | `sourceIndexes` + `allowNotes` + `dryRunSourceIndexes` | GREEN                |

## Pinned values, as of 2026-10-01 (the screen-change re-pin)

[[0072-step-cap-no-padding-cut-early]] made steps end at their screen's end, so every mechanical pin
moved. There are five fixtures since `real-tavnit-system-opening.json` landed on 2026-09-23. Each
now carries an optional `recordingMs`, the last step's ceiling:

| file           | `recordingMs` (source)            | `sourceIndexes` (live)                           | `dryRunSourceIndexes`   |
| -------------- | --------------------------------- | ------------------------------------------------ | ----------------------- |
| campaign-app   | 20000 (the DRY_RUN stub length)   | `[3,5,6,7,10,11]`                                | `[1,3,5,8]`             |
| file-routing   | absent (last state + one sample)  | `[1,2,3,12,36]`                                  | `[3,11,12,16,39,44,58]` |
| six-word-label | 122561 (CARRIED, deleted project) | `[3,42,47,48,60,74,79]` (pin 2→3)                | `[3,9,42,48,60]`        |
| study-app      | 122561 (CARRIED)                  | `[1,13,36,42,49,56,78,79]` (+`allowNotes: true`) | `[1,5,20,43,52,61,78]`  |
| tavnit         | 89582 (MEASURED, demo 29c5ed05)   | `[1,7,16,23,26,44,49]` (pin 2→1)                 | `[1,14,26,29,47,49]`    |

**MEASURED:** the DRY_RUN regress passes all five. **Every live colour is unverified under
`plan_demo_steps@v15` until a paid run.** On tavnit, state 16 has 800 ms to its screen's end and can
no longer carry a caption, so that live pin is expected red. Each fixture's `_comment` gained a
dated paragraph explaining its moves.

## Pinned values, as of 2026-10-02 (fixed 2 s clips)

[[0084-clips-are-placed-from-the-footage-instants]] and [[0087-two-steps-never-share-footage]]
moved every mechanical pin again: each step is its moment's 2 s clip, a plan is 5–10 steps, and no
two steps share footage. No fixture carries footage instants, so every clip starts at its moment.
The table above this section is the 2026-10-01 state.

| file           | `sourceIndexes` (live, one v16 run) | was, under v15             | `dryRunSourceIndexes`             |
| -------------- | ----------------------------------- | -------------------------- | --------------------------------- |
| campaign-app   | `[3,5,7,10,11]`                     | `[3,5,6,7,10,11]`          | `[1,3,5,7,10,11]`                 |
| file-routing   | `[1,3,12,15,36]`                    | `[1,2,3,12,36]`            | `[0,3,15,20,26,36]`               |
| six-word-label | `[4,42,47,48,79]`                   | `[3,42,47,48,60,74,79]`    | `[4,42,47,48,60,74,79]` (pin 3→4) |
| study-app      | `[1,13,51,52,64]` (+`allowNotes`)   | `[1,13,36,42,49,56,78,79]` | `[1,5,19,40,43,49,52,64,79]`      |
| tavnit         | `[2,7,14,23,26,44,49]`              | `[1,7,16,23,26,44,49]`     | `[2,9,14,16,24,26,41,44,47,49]`   |

- **MEASURED:** the DRY_RUN regress passes all five.
- **The pin moved on two fixtures** (six-word 3→4, tavnit 1→2): it is now the latest address-bar
  state whose 2 s clip ends by the address bar's end. Every state before the address bar's end is
  off the table beside the pin, so those two live pins open on a state no plan can hold — expected
  red.
- **The live pins were re-taken on 2026-10-02 from the paid v16 check**
  ([[v16-paid-check-2026-10-02]]): each is one live run that ended ready on its second call with
  nothing repaired. One run each, and the model's selection varies run to run, so a red live
  regress is a prompt to read the plan, not proof of a regression. Each fixture's `_comment` has
  two 2026-10-02 paragraphs.
- The "live colour" column in the first table of this note is older than both re-pins.

## The live pins against the pickable timeline (2026-10-01, decision 0074)

[[0074-unpickable-moments-and-the-last-round-repair]] stops showing the model any state whose own
clip is under 1 600 ms. **MEASURED** (`timelineClipMs` and `planPromptTimeline` over each file, cap
4000, sample 200, the file's `recordingMs`; inline tsx from `packages/core`):

| file           | offered / states | live pins the model is no longer shown (index:clip ms) | `result` states offered |
| -------------- | ---------------- | ------------------------------------------------------ | ----------------------- |
| campaign-app   | 4 / 12           | 6:200, 7:200, 10:200, 11:1500                          | none (11 hidden)        |
| file-routing   | 27 / 61          | 1:200, 2:200, 36:200                                   | none (15, 36 hidden)    |
| six-word-label | 28 / 80          | 47:200, 74:200, 79:1000                                | none (79 hidden)        |
| study-app      | 36 / 80          | 13:1400, 42:200, 49:200, 79:1000                       | none (41, 45, 79)       |
| tavnit         | 32 / 53          | 7:1200, 16:800, 44:200                                 | 26, 36, 49 (44 hidden)  |

- **Every live `sourceIndexes` set is now unreachable**, not only tavnit's. A paid
  `aiugc plan regress` cannot set-match four of them; study-app can still pass through `allowNotes`.
  Re-pinning needs a live plan the founder has reviewed. The files' `expected` blocks and
  `_comment`s were not touched.
- **No `dryRunSourceIndexes` entry is hidden**, and the DRY_RUN branch returns before the model's
  timeline is built, so the keyless regress is unchanged and still passes all five.
- On four of the five, **no `result` state is offered**. Prompt `v15` then tells the model to end
  on its best journey and write the customer-visible "no clear finish" note. On production the
  same day, all 14 ready analyses keep at least one
  ([[screens-with-no-pickable-moment-2026-10-01]]).

## Pinned values, as of `b60b5b6`

| file           | `sourceIndexes` (live)                           | `dryRunSourceIndexes` (mechanical) |
| -------------- | ------------------------------------------------ | ---------------------------------- |
| campaign-app   | `[3,5,6,7,10,11]`                                | `[1,3,5,7,11]`                     |
| file-routing   | `[1,2,3,12,36]`                                  | `[0,12,20,29,36]`                  |
| six-word-label | `[42,47,48,60,74,79]`                            | `[42,47,48,60,74,79]`              |
| study-app      | `[1,13,36,42,49,56,78,79]` (+`allowNotes: true`) | `[1,16,40,45,51,79]`               |

The two keys are separate worlds and must not be conflated: `sourceIndexes` is what a **live, paid**
`aiugc plan regress` run is measured against; `dryRunSourceIndexes` is what the keyless canned
planner returns and what `pnpm test` asserts. `allowNotes` is a third, live-only escape.

## `b60b5b6` re-pinned every mechanical expectation

The `readTimeMs` and step-duration changes moved what the canned planner produces, so the commit
rewrote all three existing `dryRunSourceIndexes` and **added one to `study-app` that had never had
one**:

- campaign-app: `[1,2,3,5,6,7,10,11]` → `[1,3,5,7,11]`
- file-routing: `[3,11,15,16,36]` → `[0,12,20,29,36]`
- study-app: _(absent)_ → `[1,16,40,45,51,79]`

No `sourceIndexes` changed. `six-word-label` was untouched.

## Only three of the four were documented together

Commit `e40e0e6` (2026-08-20, "docs: say in each fixture why it is red") wrote the prose for three
files. `real-botteacher-six-word-label.json` did not exist yet — it landed a day later in `1b48bb3`
(2026-08-21) with its own separately written "RED ON PURPOSE from birth" comment.

`b60b5b6` did **not** re-pin `six-word-label`, so it still carries the pre-change
`dryRunSourceIndexes` from `1b48bb3` while the other three were rewritten. Its own comment calls that
pin "LOAD-BEARING … Changing it turns the core suite red". The suite is green, so the new mechanical
planner still returns that exact set — but it is the one fixture whose pin was not re-derived, and
that is worth knowing before touching the planner again.

## `study-app`'s `_comment` is now false

Its comment still says, of the DRY_RUN path:

> "There is no dryRunSourceIndexes to absorb a difference either."

There is one, as of `b60b5b6`: `dryRunSourceIndexes: [1,16,40,45,51,79]`. The comment's follow-on
claim — that the pinned `sourceIndexes` are "the ONLY pass condition" under `DRY_RUN` — is false for
the same reason, because `demo-step-plans.ts:1392-1393` prefers the dry-run key when it exists.

The prose contradicts the data in the same file. Recorded as a defect when `defects/` is written;
noted here so nobody trusts the sentence.

## A cosmetic oddity

`dry-run-campaign-app.json`'s comment announces "two independent reasons" and then labels them
**(b)** and **(c)**. There is no (a) and there never was — checked every revision of the file back
to `02842ea`. It was born mislabelled in `e40e0e6`.

## Cost of a live run

`aiugc plan regress` runs **every** file in the directory — there is no `--fixture` flag. The
`six-word-label` file alone documents its own cost as ~2 paid Claude calls, ~40k tokens, ~₪0.50 per
run, for a row guaranteed red until its placeholder pin is replaced.

## Related

- [[v10-is-the-last-working-prompt]] — the runs these fixtures produced
- [[first-call-violation-rate]]
