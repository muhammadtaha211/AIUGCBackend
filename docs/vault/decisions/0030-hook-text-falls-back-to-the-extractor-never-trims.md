---
type: decision
status: verified
verified: 2026-09-08
method: "founder in chat, 2026-09-08, after reading the Vercel log: 'Item 10 — cause confirmed from the Vercel log: hook_text is 8 words — the cap is 7 (assertHookText). Implement the fix now.' The brief specified the fallback, the params fields, the prompt change and the explicit refusal to trim. Amended 2026-09-08 from a second founder brief the same day, after the same message reappeared from the edit route: the word cap becomes 8, the character cap stays 40, the prompts keep aiming below it."
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

## Amended 2026-09-08 — the word cap is 8; the aim stays 7

The failure came back the same day, and the section above called it: `hook_text is 8 words — the
cap is 7` was thrown from the **edit route** (`POST /api/scripts/[id]/text` → `deriveHookText`),
the one path the fallback never covered. Founder ruling in chat, 2026-09-08:

- **`HOOK_TEXT_MAX_WORDS` 7 → 8.** The word cap is a readability proxy, not a physical limit.
- **`HOOK_TEXT_MAX_CHARS` stays 40.** That one _is_ the physical limit — what fits on one centred
  burned row — so it does not move.
- **The aim does not move.** `b_script` (v14+, live at v15) and the new `prompts/hook_text/v3.md`
  both state "the first 4–6 words" and "7 is the hard ceiling, not the target" twice each, and
  both keep the cap sentence "At most 7 Hebrew words and at most 40 characters" **verbatim**.
  The validator is therefore one word looser than the generators — the principle `hook-text.ts`
  already ran on for trailing punctuation: a generator stricter than its validator is safe.

**Why a looser cap rather than another fallback.** On the generation path an over-cap line has
somewhere to go — `generateBScript` re-derives it with the extractor. On the edit path the
extractor **is** the step: `deriveHookText` is the last thing that runs, so there is nothing left
to fall back _to_. That left exactly the three options this note named — a retry, a relaxed cap,
or an accepted longer line. A retry re-rolls the same prompt against the same distribution that
produced the failure ([[hook-text-rides-its-caps]]: 23 of 39 hooks sat exactly on the cap), and
the trim was ruled out at the top of this note. The relaxed cap is the only one of the three that
adds no call, no latency and no line that no rule governs.

The generation-path fallback from the original decision is untouched and still runs; raising the
cap only makes it rarer.

## Where it lives

- `packages/core/src/pipelines/copy.ts` — `hookTextOrDerived` (the fallback and its two warns),
  `deriveHookTextWithVersion`, the conditional params spread in `generateBScript`.
- `prompts/b_script/v14.md`.
- `packages/core/test/hook-text.test.ts` — the three cases: fallback succeeds and marks params,
  double failure throws with no row, in-cap line makes no second call.
  `packages/core/test/hook-templates.test.ts` pins the v14 wording.

The 2026-09-08 amendment:

- `packages/core/src/hook-text.ts` — `HOOK_TEXT_MAX_WORDS = 8`, and the header comment that now
  explains the split between the physical character cap and the proxy word cap.
- `prompts/hook_text/v3.md` — v2 plus the b_script v14 aim language; the cap sentence unchanged.
- `packages/core/test/hook-text.test.ts` — the 9th word is now the rejected one, and the
  `OVER_CAP` fixture is nine words at 37 characters so the word cap is the only rule it breaks
  (the old fixture was 8 words at exactly 40, which the raised cap would have made legal).
  `packages/core/test/hook-templates.test.ts` pins the v3 wording the same way it pins v14's.
- `packages/core/test/lipsync-chain.test.ts` and `apps/web/test/service-b-ui.test.ts` — the two
  other places an 8-word fixture asserted a rejection. Both were 8-word lines **under** 40
  characters, so the raised cap made them legal and the assertion stopped holding; both now use
  a nine-word line. `lipsync-chain` is the one that failed rather than passing vacuously —
  `createBRender` refuses an over-cap `hookText` at enqueue (`pipelines/sets.ts`).
- `docs/04-integrations.md` — the prompt inventory's `≤7` stays (it describes what `b_script`
  states); the note that the validator is one word looser sits with the constants instead.
  `docs/06-cli-first.md` — the `render-b --hook-text` annotation goes to `≤8`, matching what
  `aiugc render-b --help` already prints from the constant.

## Related

- [[hook-text-rides-its-caps]] — the measurement that motivated both halves.
- [[0017-service-b-single-setting-selfie-talking-head]] — why the line is burned at all.
- [[0025-hook-text-may-end-with-a-question-or-exclamation-mark]] — the last change to these caps.
