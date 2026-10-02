---
type: defect
status: verified
verified: 2026-10-02
method: "Read in packages/core/src/pipelines/demo-step-plans.ts dryRunPlan: the caption is the first non-empty visibleText entry (after stripping '!'), cut to MAX_LABEL_WORDS whitespace words, with no check that a word survives normalizeWord and no cut to MAX_LABEL_CHARS. Probed 2026-10-02 by the diff review of feat/steps-fixed-2s-clips with a six-state synthetic timeline under DRY_RUN=1 and a stub db: a first entry of '+' threw 'dry-run plan violates its own rules: step 0: label is empty'; a 70-character unbroken token threw '... label is over 60 characters'. git show origin/main has the same expression, so it predates that branch."
source: code
---

# The canned DRY_RUN plan can fail its own validation on the caption it lifts

Found 2026-10-02 by the diff review of the 2 s clip build. **NOT FIXED.** Not introduced by that
build.

## What happens

Under `DRY_RUN` the plan is canned: each step's caption is the first non-empty text on its screen,
cut to four words. Two shapes of that text fail the validator the canned plan is then held to:

- **Punctuation only** (for example a lone "+"): no word is left once it is normalized, so the
  caption counts as empty.
- **One very long unbroken token** (a long URL): four "words" can still be over 60 characters.

`generateStepPlan` then throws "dry-run plan violates its own rules".

## Who it reaches

- A local DRY_RUN worker or CLI run on an analysis whose picked state leads with such text.
  Production never runs the canned planner.
- **MEASURED:** none of the five fixtures under `fixtures/timelines/` has a legal state whose
  canned caption would be empty or over 60 characters, so the regress does not hit it.

## The fix, when wanted

Pick the first entry that keeps at least one normalized word, fall back to the product name, and
cut the result to `MAX_LABEL_CHARS`.
