---
type: decision
status: verified
verified: 2026-09-11
method: "founder ruling in chat, 2026-09-11, in answer to a question that offered two fixes and got a third: 'The ban was never about the word. It was about the HESITATION TICK… Fix the rule, not the libraries.' Diffs verified with `git diff --no-index prompts/b_script/v16.md prompts/b_script/v17.md` and the vo_script v8/v9 pair — one hunk, one bullet, each. Collision arithmetic re-derived from packages/core/src/hook-templates.ts:22-65 (25 entries) and :68 (HOOK_OPTIONS_PER_GENERATION = 3)."
source: founder
---

# 0046 — the `רגע` ban targets the hesitation tick, not the word

v16's output rule said, flatly:

```
- **Never `רגע`** as a filler, a restart, or an aside — it must not appear in a script.
```

and `vo_script` v8:168 said the same. Meanwhile two founder-curated banks offered the model copy
containing the word: the hook bank (`hook-templates.ts:25`, `תראי רגע את זה`, drawn 3-of-25 into
`{{hook_options}}`) and the structure bank (`show-and-react.json`, `תראו רגע את זה` — the **hook
beat** of the structure named "show and react"). The two could not both be obeyed: the banks
invited the word and the output rule forbade it.

This surfaced as a **test** flake — `hook-templates.test.ts:125` counted `רגע` in the _rendered_
prompt and failed on 12.0% of runs, exactly when the offending opener was drawn
([[ban-rule-test-collides-with-a-curated-hook]]). The flake was the symptom. The defect was in the
rule.

## Decided

**The rule was wrong, not the libraries.** The ban targets the **hesitation tick** — the filler
insertion that in Hebrew almost always surfaces as `רגע`, used to fake casualness, which reads as
fake. `רגע` occurring naturally, carrying its own meaning in the sentence, is legitimate and always
was. v16's trailing clause overshot the intent; **it was never a token ban.**

That matters beyond the test: v16 has been telling the model "never `רגע`" full stop on **every
live generation since `f40bc72` (2026-09-08)**, suppressing legitimate copy. This is a production
copy-quality bug that a red test happened to expose.

`prompts/b_script/v17.md` is `v16.md` with that one bullet replaced:

```
- **Never `רגע` as a hesitation tick** — dropped in to fake casualness, as a filler, a restart or
  an aside: `זה, רגע, זה פשוט עובד`. The tick is what is banned, not the word. `רגע` used
  naturally, carrying its own meaning in the sentence, is fine: `תראי את זה רגע`.
```

`prompts/vo_script/v9.md` carries the **identical** wording, plus its existing "that is why it is
not on the slang list above". The founder's instruction was explicit: _"I am not leaving the two
prompts stating different rules."_ One example of each use is mandatory — without both, the model
over-applies the ban, which is how it has been behaving.

Nothing else changes in either file. Same `{{vars}}` as v16/v8, so the prompt half needs no restart
([[prompt-versions-on-disk]]).

## The curated copy keeps the word, and is reordered

Both banks stay, both get the same reorder — `רגע` at the end of the clause is more natural Hebrew
than mid-sentence, and under the corrected rule both are legal:

- `packages/core/src/hook-templates.ts:25` — `תראי רגע את זה` → `תראי את זה רגע`
- `seed/structures/show-and-react.json:6` — `תראו רגע את זה` → `תראו את זה רגע` (plural preserved)

The structure example is load-bearing and was **not** a candidate for deletion: "look at this a
sec" _is_ that structure's thesis.

## The test asserts the rule, not the word

Counting occurrences of `רגע` was only ever meaningful while the word was banned outright. Now it
would measure the hook draw, not the rule. Both tests drop the `/רגע/g` count and assert the **rule
text** instead — a real signal (the rule went missing) in place of a fake one (the word appeared).
The 12.0% flake ends as a side effect, not as the goal.

Rejected explicitly by the founder: scoping the assertion to the prompt file, which would have kept
a meaningless count and chosen a reading by omission — "which is precisely how `f40bc72` got here".

## Rejected

- **Scope the assertion to the prompt file and keep everything else** (the defect note's fix (a)).
  Accepts by omission that the ban does not bind curated copy, silences the only signal that would
  notice a future curated entry, and leaves the live prompt arguing both sides.
- **Reword or retire the curated openers** (the defect note's fix (b)). Treats the copy as the
  offender when the rule was. Would also have cost the "show and react" hook beat its thesis.
- **Carve an exception into the prompt** ("may appear among the openers offered to you, must not
  appear in the script you write"). This was offered as the 0033-shaped option and the founder took
  its _method_ but not its framing: not an exception to a correct rule, but a **correction of a rule
  that was wrong**.

## 0033's pattern, applied a second time

[[0033-b-script-may-write-an-allowed-brand-name-in-latin]] is the same shape one step removed: a v14
output rule ("No English") contradicted by copy the same prompt allowed elsewhere, resolved by
editing the rule to say what it meant rather than letting the model arbitrate. The founder's
reasoning there — that leaving a model to resolve a self-contradiction "is the failure mode this
fixes" — is the reasoning here. The difference worth recording: 0033 **carved an exception** into a
rule that was right; 0046 **corrects a rule that was wrong**. When a ban and a curated library
disagree, check which one misstates the intent before assuming it is the library.

## Deploy — what this needs, and what the founder does himself

- **A box deploy and a worker restart.** Not for the prompts (same vars), but because
  `packages/core/src/hook-templates.ts` is compiled into the worker and web bundles.
- **The structure bank needs a production CLI run, which is the founder's to make.** Per
  [[0028-scripts-end-on-a-closer-from-a-curated-bank]] the seed file is **not** the live source —
  editing the JSON alone is cosmetic. The live `structures` row is updated by
  `aiugc bank seed-structures --update`. **Not run by this branch.**

  **Read this before running it.** `--update` is not scoped to the file that changed:
  `seedStructures` (`packages/core/src/pipelines/bank.ts`) loops every `seed/structures/*.json`
  and, for each title already in the bank, does
  `db.update(structures).set({ skeleton }).where(eq(structures.title, title))`. All **six** seeded
  structures are rewritten from disk. If any live `skeleton` has been hand-edited in the SQL editor
  since it was seeded, that edit is silently overwritten — and this project has a recorded habit of
  hand-editing production rows ([[prod-rows-hand-edited]] via `updated_at` being unreliable). Worth
  reading the six live skeletons back before running it, and comparing them to the files.

## Touched

- `prompts/b_script/v17.md`, `prompts/vo_script/v9.md` — new, one bullet different from v16/v8.
- `packages/core/src/hook-templates.ts:25`, `seed/structures/show-and-react.json:6` — reordered.
- `packages/core/test/hook-templates.test.ts`, `packages/core/test/vo-prompt.test.ts` — the count
  assertion replaced by a rule-text assertion.
- [[prompt-versions-on-disk]] — v17 and v9 added.
- [[ban-rule-test-collides-with-a-curated-hook]] — FIXED block; it framed this as a choice between
  two fixes and the founder chose neither.

## Related

- [[0033-b-script-may-write-an-allowed-brand-name-in-latin]] — the same pattern, one step removed
- [[0028-scripts-end-on-a-closer-from-a-curated-bank]] — why the seed file is not the live source
