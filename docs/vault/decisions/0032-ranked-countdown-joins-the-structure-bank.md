---
type: decision
status: verified
verified: 2026-09-08
method: "founder brief in chat, 2026-09-08, supplying the skeleton JSON verbatim (four beats, the honesty rule for the two lower places, and the notes field). Implementation verified by `pnpm --filter @aiugc/core exec vitest run --fileParallelism=false test/seed-structures.test.ts` — 5 tests green with SEED_TITLES at six; word counts and the closer tail checked with node against packages/core/src/closer-templates.ts."
source: founder
---

# 0032 — `ranked-countdown` joins the structure bank, and honesty lives in the losing places

The bank held five skeletons ([[0028-scripts-end-on-a-closer-from-a-curated-bank]]), all of them
first-person testimony: a before/after, an objection, a pain, a product held up, a list of tips.
None of them puts the product in a field of alternatives. `ranked-countdown` is that shape — a
three-place countdown where the customer's product wins.

`seed/structures/ranked-countdown.json`, four beats:

| beat           | carries                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| `hook`         | the numbered promise, agreeing with `דרכים`, no product name                 |
| `third_place`  | a way people get this result today, comma, its one downside                  |
| `second_place` | a different way, a **different** downside, the same clause shape             |
| `first_place`  | the product name, the advantages that answer both downsides, then the closer |

## The rule that makes it shippable

The countdown only works if the two lower places are real, and a real alternative named on camera
is a legal and reputational surface. The skeleton constrains it twice:

- **Every downside must be the inverse of an advantage in the questionnaire.** Not a free-form
  criticism — the thing this customer's own advantages already negate. That keeps the beat inside
  the prompt's existing honesty rule ("only claim what the questionnaire or pointers support").
- **Every downside is phrased as an ABSENCE, never a defect** — _does not do X_, _costs_, _takes
  time_. Never that the alternative is broken, unsafe or dishonest. This is the same line b_script
  already draws: "Never assert that a named company's product is defective, unsafe, illegal or
  fraudulent."

The `notes` field states both, plus the format's own identity: it is a countdown, **not** a tips
list — `three-things` already owns that shape — and at ~31 words each place is one clause with no
connectives.

## Word budget: ~31, and the number is right

`notes` says "~31 words at 15s". Measured 2026-09-08: `pickStructure`'s caller computes
`Math.floor(durationPreset * wps)` (`packages/core/src/pipelines/copy.ts:528`) and live
`app_config.words_per_second` is `{"default":2.1}` ([[app-config-live-state]]), so a 15 s B render
budgets **31** words, not the 33 the seed constant 2.2 would give. The prompt injects the real
number as `{{word_budget}}` either way; the seed's figure is orientation for whoever edits the file.

The four example lines total **40** words — illustrative, not a script, and the lightest of the
four-beat seeds bar one (`objection-flip` 37, `before-after` 44, `problem-agitate-solve` 47,
`three-things` 59).

## One deviation from the founder's text, and why

The brief's `first_place` intent ended "then the closer from the offered bank". That phrasing fails
`seed-structures.test.ts`, which asserts every seed's last beat says **"closers offered in the
prompt"** verbatim — the guard added by [[0028-scripts-end-on-a-closer-from-a-curated-bank]] so a
skeleton cannot quietly stop routing through the closer bank. The beat now reads, matching the
other five files word for word:

> then ONE of the closers offered in the prompt, copied with its punctuation. The example shows one
> closer; use whichever the prompt offers this time. Nothing after the closer.

The second sentence is house convention rather than a test requirement, and it earns its place: the
example ends on `אין על זה, אין.`, and `pickClosers` offers only three of the eleven per generation,
so without it the model copies a closer it was not offered.

## Known exposure, accepted

`second_place`'s example names **ChatGPT** for a customer (תבנית) that generates ad scripts. The
prompt's naming policy allows household names by a size test and forbids "any direct competitor of
this customer" by a relationship test, with no precedence line between them — and for an
`app_or_digital` customer those two sets can overlap. The example resolves it the way the founder
intends: ChatGPT is the reference point the speaker moves on from ("writes you a great script, but
who films it"), not a substitute for the product. Since [[0031-the-structure-bank-rotates-least-recently-used-per-business]]
the wizard rotates LRU, so **every** business reaches this skeleton once every six generations
regardless of category — the exposure is not opt-in. Flagged to the founder, left as written.

## Touched

- `seed/structures/ranked-countdown.json` — new.
- `packages/core/test/seed-structures.test.ts` — `"ranked-countdown"` in `SEED_TITLES` (which JS
  default sort already orders correctly, between `problem-agitate-solve` and `show-and-react`); the
  first `it()` title says "six" rather than "five".
- `docs/08-supabase-project-rebuild.md` — the rebuild runbook's seed count.
- [[0031-the-structure-bank-rotates-least-recently-used-per-business]] — the rotation is six long now.

## Related

- [[0033-b-script-may-write-an-allowed-brand-name-in-latin]] — the prompt change this skeleton needs
  to make its own example legal. The two ship together.
- [[0028-scripts-end-on-a-closer-from-a-curated-bank]]
