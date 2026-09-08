---
type: decision
status: verified
verified: 2026-09-07
method: "founder in chat, 2026-09-07: the brief specified the seven closers, their tones, their conjugation axes and their punctuation, and the new beat order (name → advantages → closer). The punctuation rules come from his own measurement in the ElevenLabs v3 UI (Hebrew, 2026-09-07) — see 'What was measured' below; not re-measured through the API by this session."
source: founder
---

# 0028 — Service B scripts end on a closer from a curated bank, and the closer's punctuation is copied byte for byte

`b_script` v1–v11 ended every script with a fixed verdict close: `ממליצה בחום` as the default,
`הלינק למטה` and `שווה לך לבדוק` as the alternatives, and the seed skeletons repeated the same
three. Every Service B ad therefore closed on one of three lines, and the prompt's own "after the
name, say almost nothing" rule kept the advantages _before_ the name.

## What was measured (founder, ElevenLabs v3 UI, Hebrew, 2026-09-07)

- Audio tags have no audible effect. **Punctuation does.**
- Exclamation marks scale excitement; four is the most that is still useful.
- One trailing dot reads decisive; none reads open-ended.
- Two dots elongate the final sound and do **not** create a pause.

So a closer's punctuation is a tested delivery control, which is why it lives in code next to the
text and the prompt is told to copy it exactly — `..` is two full stops by design, not an ellipsis
to tidy; `!!!!` is deliberate.

## What changed

- **`packages/core/src/closer-templates.ts`** — the twin of `hook-templates.ts`. Seven
  founder-approved closers, each with `punctuation` (`fixed` mark or `exclaim` up to `max`),
  `tones` it fits, `agrees` (which gender axis the text carries — `none` / `speaker` /
  `audience`) and an optional `pluralOnly`. `pickClosers(tone)` filters by tone and draws
  `CLOSER_OPTIONS_PER_GENERATION` (3) at random; `describeCloser` builds the line the prompt
  shows, including what may be conjugated. Three of the seven have `// untested` punctuation
  (fixed `.`: מאז אני רק עם זה, תנסו ותגידו לי, תודו לי אחר כך) — the founder measured the
  other four.
- **`generateBScript`** renders the picked closers as `{{closer_options}}` and records their
  texts on `scripts.params.closers`, next to `hookTemplates`, so a winning closer can be traced.
- **`prompts/b_script/v12.md`** — the reveal's order is now (1) problem or promise, (2) why the
  usual answers fail, (3) **the name**, (4) **the one or two strongest advantages**, (5) the
  closer, nothing after. The fixed close and "after the name, say almost nothing" are gone.
  Conjugation is limited to what each closer's line allows; the exclamation count is chosen
  by how casual the business and audience are (4 → 2, never 0); the hook_lines naming policy
  (ChatGPT / Google / Excel / WhatsApp allowed as reference points, no small or local named
  business, no competitor, no defect claims about a named company) is now in b_script too; the
  stale "emotion is added automatically later" note is dropped.
- **`seed/structures/*.json`** — every skeleton's final beat is a closer from the offered bank.
  `before-after` merged name + close into `name_and_close`; `objection-flip` dropped its
  `close` beat (its "advantages may follow the name" note is now the global rule);
  `problem-agitate-solve` merged `name` into `solution`; `three-things` and `show-and-react`
  rewrote their final beat. Beat examples carry a closer with its exact punctuation.
- **`aiugc bank seed-structures --update`** — `seedStructures({ update: true })` replaces the
  skeleton of titles already in the bank from the file and returns `{ added, updated }`.
  Needed because `addStructure` is insert-only: editing a seed file changed nothing live.

## Options and why this shape

- **A bank in code, not rows in the DB.** Same reasoning as the hook bank and as
  [[0024-hook-effect-is-a-render-param-the-customer-picks]]'s tuned numbers: the punctuation is a
  measured constant, a retune is a deploy, and there is nothing for a customer to edit.
- **Tone-filtered, random subset of three.** The hook bank offers three of twenty-five with no
  filter; closers are fewer and more tone-bound (`חבל על הזמן..` is not professional), so the
  filter runs first and the professional pool is two — the draw is capped at the pool and is
  never empty (under test).
- **Punctuation as a typed field, not baked into `text`.** The exclamation closer has a range,
  not a mark; keeping the mark separate lets `describeCloser` explain the range and keeps
  `params.closers` a clean list of texts for tracing.
- **The prompt conjugates, the bank stays canonical.** One canonical form per closer (female
  speaker; audience closers written plural), with the `agrees` field telling the prompt which
  single axis it may touch. Storing every conjugation would multiply seven entries by six forms.

## Not verified

No script has been generated with `v12` yet — every local `.env` is `DRY_RUN=1`
([[0027-product-kind-is-an-optional-questionnaire-field]] has the same caveat for v11), and the
dry-run script still ends on `תבדקו בעצמכם`, not on a closer. Whether the model obeys "copy
the punctuation exactly" and whether the downstream TTS path preserves `..` and `!!!!` are
both predictions until a `DRY_RUN=0` script is synthesised and listened to.

The production `structures` rows still hold the v11-era skeletons until the founder runs
`aiugc bank seed-structures --update` himself.

## Where it lives

- `packages/core/src/closer-templates.ts`; tests in `packages/core/test/closer-templates.test.ts`.
- `packages/core/src/pipelines/copy.ts` — `generateBScript`: `closer_options`, `params.closers`.
- `prompts/b_script/v12.md`; the closer rules are pinned by `closer-templates.test.ts`, the
  v9–v11 phrases still by `hook-templates.test.ts`.
- `seed/structures/*.json`; `packages/core/test/seed-structures.test.ts` asserts every final
  beat ends on a closer from the bank.
- `packages/core/src/pipelines/bank.ts` — `seedStructures`; `apps/cli/src/index.ts` — `--update`.

## Related

- [[0017-service-b-single-setting-selfie-talking-head]] — the format `b_script` writes for.
- [[0027-product-kind-is-an-optional-questionnaire-field]] — v11, the version v12 was cut from.
- [[hook-bank-still-teaches-the-generic-dodge]] — the hook bank's own stale line, untouched here.
