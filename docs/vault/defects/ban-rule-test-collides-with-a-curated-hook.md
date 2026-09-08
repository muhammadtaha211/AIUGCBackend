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
