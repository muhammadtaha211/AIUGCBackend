---
type: decision
status: verified
verified: 2026-09-08
method: "founder in chat, 2026-09-08, after reading the Vercel log: 'Item 10 — cause confirmed from the Vercel log: hook_text is 8 words — the cap is 7 (assertHookText). Implement the fix now.' The brief specified the fallback, the params fields, the prompt change and the explicit refusal to trim."
source: founder
---

# 0030 — An over-cap `hook_text` falls back to the extractor; it is still never trimmed

`b_script` emits the burned on-screen line with the script. When that line missed a cap,
`assertHookText` threw and the **whole generation** failed: the customer lost a finished script
because of its hook line and got `משהו השתבש. נסו שוב בעוד רגע.` Confirmed in production on
2026-09-08 — `hook_text is 8 words — the cap is 7` — over a distribution that piles against the
ceiling ([[hook-text-rides-its-caps]]).

## The decision

Three parts, all from the founder's brief:

1. **Fall back, do not fail.** When the model's `hook_text` misses a cap, `generateBScript`
   re-derives the line from the **finished script** with `hook_text` (`prompts/hook_text/v2.md`),
   a verbatim-prefix extractor under the same caps, and asserts that instead. The read-then-hear
   rule holds because the extractor is given the very script that will be spoken. A second
   failure throws exactly as before — the script is not saved with an unburnable line.
2. **Aim below the ceiling.** `prompts/b_script/v14.md` changes the opening's target from
   "first 5–7 words" to "first 4–6 words" in both places that state it (order of operations
   beat 1, and the on-screen hook text section), each adding "7 is the hard ceiling, not the
   target". The cap sentence itself — "At most 7 Hebrew words and at most 40 characters" — is
   unchanged, and nothing else in the prompt moved.
3. **Still never trim.** The founder ruled the trim out explicitly: a burned string is not
   silently shortened (`hook-text.ts`). The fallback replaces the line with one an extractor cut
   on purpose; it never cuts the model's line itself.

## Options and why this shape

- **Fallback over trim.** A trim would produce a line no prompt wrote and no rule governs — the
  cut could land mid-thought or leave a dangling conjunction, and the viewer reads it. The
  extractor already has the cut rules, and it costs one more Claude call (~800 tokens, under the
  same `llm_tokens` cap) only on the rare bad line.
- **Fallback over regenerating the script.** Same reason the length-fit regeneration was removed
  from `handleSynthTts` (locked decision 4, amended 2026-08-08): a regeneration spends a second
  large call and hands the customer text they never saw, to fix something a small deterministic
  step can fix.
- **Prompt aim as well as fallback.** The fallback is a net, not a fix. 23 of 39 production
  hooks sat exactly on the 7-word cap, so the model was aiming at the ceiling; moving the aim to
  4–6 is what should make the net rare.
- **Both new params fields are absent when nothing happened.** `hookTextDerived: true` and
  `hookTextPromptVersion` are spread in only on the fallback path, so their presence is the
  signal — a hook that differs from the b_script draft is explainable later, and traceable to
  the `hook_text` version that cut it.
- **The version is the one used, not one re-resolved.** `deriveHookText` is now a thin wrapper
  over an internal `deriveHookTextWithVersion`, which returns the `promptVersion` its own call
  rendered. The exported signature and its web-route caller are untouched.

## Not fixed here, and worth watching

The **edit route** (`apps/web/src/app/api/scripts/[id]/text/route.ts`) calls `deriveHookText`
directly and still fails the save when the derived line misses a cap. The brief scoped this
change to `generateBScript`, so that path is unchanged.

This matters more than a scope note usually would: `assertHookText` throws that exact message
from **both** routes, and in the 30 days before the fix the only paid call that died without a
script row died in `deriveHookText`, not in `generateBScript` ([[hook-text-rides-its-caps]]).
The logged failure may therefore have been the edit save rather than the generation. If
"try again" persists on the wizard's **save** step, this change will not have touched it —
and the answer there cannot be another fallback, because the extractor is already the last
step. It would have to be a retry, a relaxed cap, or an accepted longer line.

## Where it lives

- `packages/core/src/pipelines/copy.ts` — `hookTextOrDerived` (the fallback and its two warns),
  `deriveHookTextWithVersion`, the conditional params spread in `generateBScript`.
- `prompts/b_script/v14.md`.
- `packages/core/test/hook-text.test.ts` — the three cases: fallback succeeds and marks params,
  double failure throws with no row, in-cap line makes no second call.
  `packages/core/test/hook-templates.test.ts` pins the v14 wording.

## Related

- [[hook-text-rides-its-caps]] — the measurement that motivated both halves.
- [[0017-service-b-single-setting-selfie-talking-head]] — why the line is burned at all.
- [[0025-hook-text-may-end-with-a-question-or-exclamation-mark]] — the last change to these caps.
