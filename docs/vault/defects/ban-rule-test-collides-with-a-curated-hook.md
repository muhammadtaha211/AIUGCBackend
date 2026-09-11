---
type: defect
status: verified
verified: 2026-09-08
method: "pnpm --filter @aiugc/core exec vitest run --fileParallelism=false test/hook-templates.test.ts, three consecutive runs at the same commit: exit 0, exit 1 (1 failed), exit 0. Cause located by grep: packages/core/src/hook-templates.ts:25"
source: code
---

# `bans רגע as a filler` fails on ~1 draw in N — the ban rule and a curated hook share the word

`packages/core/test/hook-templates.test.ts:125` asserts the rendered `b_script` prompt contains the
string `רגע` **exactly once** — the ban rule at `prompts/b_script/v16.md:134`:

```ts
expect(text).toContain("Never `רגע`");
expect(text.match(/רגע/g)).toHaveLength(1);
```

But the same test renders the prompt with `hooks = pickHookTemplates()` (line 68), a **random**
handful of curated openers injected as `{{hook_options}}` — and one of them is
`packages/core/src/hook-templates.ts:25`:

```ts
"תראי רגע את זה",
```

When that template is drawn, `רגע` appears twice and the assertion fails with `expected 1, received
2`. Three consecutive runs of the file at the same commit gave exit 0, exit 1, exit 0.

## The rate is exactly 12%, not "~1 in N" — derived 2026-09-11

`pickHookTemplates` (`hook-templates.ts:75-85`) is an unbiased Fisher-Yates shuffle over a 25-entry
pool (`hook-templates.ts:22-65`) sliced to `HOOK_OPTIONS_PER_GENERATION = 3`, so every 3-subset is
equally likely and exactly one entry offends:

```
P(fail) = 1 − C(24,3)/C(25,3) = 1 − 2024/2300 = 3/25 = 0.12
```

**12.0% per run of the file**, not per test — `const hooks = pickHookTemplates()` sits at
`hook-templates.test.ts:68`, in the `describe` body, so one draw serves the whole file. The other
tests in that describe pass on a bad draw; only `:125` fails. `Math.random` is unseeded and
unstubbed, and `packages/core` has no `vitest.config.*` and no `setupFiles`, so nothing can pin it.
REASONED from the pool size and the draw, consistent with the 1-of-3 observed above.

**The `vo_script` twin is NOT flaky.** `packages/core/test/vo-prompt.test.ts:47-57` carries the
identical `toHaveLength(1)` assertion but supplies every variable as a fixed literal
(`hook_line: "(אין)"`), so it is deterministic. Do not "fix" it along with this one.

## "Left the curated opener alone" — an oversight, not a decision

Worth correcting because the two readings imply different fixes. `f40bc72` did not touch
`packages/core/src/hook-templates.ts`, and the opener already existed at that commit — but nothing
shows it was considered. The commit message mentions only the prompts, and the vault note the same
commit added (`facts/prompt-versions-on-disk.md`) states the tests assert the word "appears nowhere
else in either file" — true of the template **file**, false of the **rendered** text the assertion
actually matches, which is where `{{hook_options}}` is interpolated. So the author believed the
assertion was scoped to the prompt file. That is the bug: a wrong belief about scope, not an
exemption granted to the hook.

**Not flaky infrastructure — flaky by construction.** It is a real red `pnpm test` that a clean
checkout reproduces at random, and it will read as "the ban did not land" to whoever hits it next.

**Introduced by** `f40bc72` (_prompts: drop the restart seam, ban רגע_), which added both the rule
and the assertion, on 2026-09-08. The prompt file itself is correct: `v16.md` holds exactly one
occurrence.

## Not fixed here

Found while running the full core suite as the gate for an unrelated change (the in-app feedback
page, `0035`). Left alone: choosing between the two fixes is a copy decision, not a test decision.

- **Count only outside the injected variables** — e.g. assert on the template file's text rather
  than the rendered text. Keeps the curated hook.
- **Retire or reword the hook** `תראי רגע את זה`. Consistent with a rule that says the word "must
  not appear in a script", but it is founder-curated copy and this note is not the place to change it.

The second reading matters: the ban's own wording is "it must not appear in a script", while the
hook library is offering the model a hook containing it. That may be the actual defect, with the red
test being the symptom that surfaced it.
