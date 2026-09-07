---
type: defect
status: verified
verified: 2026-09-07
method: "grep -n 'משהו|הדבר הזה|מוצר אחד|המוצר הזה' packages/core/src/hook-templates.ts — two hits, :8 (the pool's stated design rule) and :53 (a template). Pool size counted at 25; HOOK_OPTIONS_PER_GENERATION is 3, so a given template is offered in 12% of generations."
source: code
---

# The hook-template bank still teaches the generic dodge that `b_script@v11` bans

[[0027-product-kind-is-an-optional-questionnaire-field]] rewrote the reveal rule:
name the product's KIND, never `משהו` / `הדבר הזה` / `מוצר אחד`. It changed the
prompt. It did **not** change `packages/core/src/hook-templates.ts`, whose
contents `pickHookTemplates()` injects into the same prompt as
`{{hook_options}}` — so one rendered prompt can now argue both sides:

- **`hook-templates.ts:53`** — `"ממש מפחיד כמה שהמוצר הזה טוב"`. This is the exact
  sentence v11 rewrote into `"ממש מפחיד כמה שהקרם הזה טוב"` to demonstrate the new
  rule. The prompt shows the kind form as the worked example; the bank offers the
  generic form as a founder-curated opener, in 12% of generations (3 drawn of 25).
  `המוצר הזה` is not on v11's never-list, and the templates are injected under
  "A shape to fill, not text to copy … rewrite it in the persona's voice" — so this
  is a tension the model is told to resolve, not a contradiction it is trapped in.
- **`hook-templates.ts:8`** — the doc comment states the pool's design principle as
  "The product is referred to obliquely — זה, המוצר הזה, משהו — and the name lands
  late". `משהו` **is** on the never-list. The comment now documents a policy the
  prompt reverses, which is how a later session talks itself into re-adding a dodge
  template.

## Why it was not fixed

`HOOK_TEMPLATES` is founder-curated ad copy ("Founder-curated hook openers", the
file's first line), and the v11 change was scoped by the founder to the
questionnaire field and the prompt. Rewriting a curated opener — or the comment
that explains the curation — is his call, not a session's.

## The fix, when wanted

One template line and one comment sentence. `:53` becomes kind-shaped or generic
in a way v11 endorses; `:8` restates the rule as "referred to by its KIND, never
by a placeholder word". Both belong in the same commit, or the file becomes
internally inconsistent instead of externally stale.

Note that the pool's many bare-`זה` templates (`לא ציפיתי שזה יהיה ככה טוב`,
`תראי רגע את זה`) are **not** implicated: v11 bans three specific phrases and does
not ban `זה`.
