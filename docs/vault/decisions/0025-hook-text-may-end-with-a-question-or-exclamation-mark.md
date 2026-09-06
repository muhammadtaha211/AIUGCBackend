---
type: decision
status: verified
verified: 2026-09-06
method: "founder in chat, 2026-09-06: 'i cant put a question mark at the end of the opening text hook when i manually edit it, is there a technical reason why? id like to add support for that', plus 'just go with whatever you recommend' on the scope. Cause read off packages/core/src/hook-text.ts TRAILING_PUNCTUATION."
source: founder
---

# A burned hook line may end with `?` or `!`, and still may not end with `.` `,` `;` `:` `…`

`hookTextError` rejected **every** trailing punctuation mark
(`/[.,!?;:…]$/`), so the wizard's hook-text field refused
`למה אף אחד לא סיפר לי?` — a Hebrew hook is very often a question, and the step
invites the customer to edit the line freely. There was no technical reason: `?`
is U+003F, inside the burnable ASCII range, the RTL line renders it correctly by
bidi, and `hookHandoffMs`'s word matcher strips it before comparing.

Now: `/[.,;:…]$/`. A full stop, comma, colon, semicolon or ellipsis on one big
centred line still reads as a sentence that was cut off rather than as a hook.

## Options considered

- **Allow `?` only** — exactly what was asked. Rejected as arbitrary: `!` is the
  same class of terminal, expressive mark, equally natural in a Hebrew hook, and
  a field that takes one and refuses the other is a second surprise.
- **Allow all trailing punctuation.** Rejected: a burned `…` or `,` is a
  generation defect, and the check is the only thing that catches it.
- **Leave it and tell the founder to drop the mark.** Rejected — he asked for
  the opposite.

## What did NOT change, deliberately

`prompts/b_script/v9.md:154` and `prompts/hook_text/v1.md:18` still instruct the
model: "No trailing punctuation — no full stop, question mark or exclamation
mark at the end." A generator stricter than its validator is safe, so the drafts
keep arriving bare and the customer can now add a mark. Relaxing the prompt is a
prompt-version bump, which belongs with the script-generation revamp the founder
scheduled for 2026-09-07 — not with a validator fix.

## Where it lives

- `packages/core/src/hook-text.ts` — `TRAILING_PUNCTUATION`, the one rule.
- `apps/web/src/lib/service-b-ui.ts` — the Hebrew line the customer reads.
- `apps/cli/src/index.ts` — `render-b --hook-text` help.
- `packages/core/test/hook-text.test.ts`, `apps/web/test/service-b-ui.test.ts`.

## Related

- [[0024-hook-effect-is-a-render-param-the-customer-picks]]
