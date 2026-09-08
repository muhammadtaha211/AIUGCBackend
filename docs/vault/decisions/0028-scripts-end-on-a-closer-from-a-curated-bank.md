---
type: decision
status: verified
verified: 2026-09-08
method: "founder in chat, 2026-09-07: the brief specified the seven closers, their tones, their conjugation axes and their punctuation, and the new beat order (name → advantages → closer). The punctuation rules come from his own measurement in the ElevenLabs v3 UI (Hebrew, 2026-09-07) — see 'What was measured' below; not re-measured through the API by this session. Amended 2026-09-08 from the founder's FIX brief in chat; the production counts in the body come from the SQL quoted next to each number, run read-only over DATABASE_URL from packages/core/.work scratch scripts (gitignored)."
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
  other four. _(As of 2026-09-07; since the amendment below it is seven untested of eleven.)_
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
  filter runs first and the professional pool was two (six since the 2026-09-08 amendment) — the
  draw is capped at the pool and is never empty (under test).
- **Punctuation as its own field, not baked into `text`.** Keeping the mark separate lets
  `describeCloser` name it ("two dots", "four exclamation marks") and keeps `params.closers` a
  clean list of texts for tracing. _(On 2026-09-07 the field also carried the exclamation
  closer's 1–4 range; that range is gone since the amendment below.)_
- **The prompt conjugates, the bank stays canonical.** One canonical form per closer (female
  speaker; audience closers written plural), with the `agrees` field telling the prompt which
  single axis it may touch. Storing every conjugation would multiply seven entries by six forms.

## Amended 2026-09-08 (founder, in chat, after reviewing v12 output)

- **Every closer is a fixed string.** `הכי ממליצה בעולם` is always `!!!!` — the "choose the
  count by how casual the business is" range is gone from the prompt (`b_script/v13.md`) and the
  `exclaim` kind is gone from `CloserTemplate`; `punctuation` is now the literal mark string.
- `תנסו ותגידו לי` → `תנסו ותגידו לי בתגובות` (still untested punctuation, still audience-axis).
- **Four closers added**, all `.`, untested, `agrees: none`, for the direct/professional pools:
  `אין מה להתלבט`, `שווה כל שקל`, `מאז, שקט`, `בעיה נפתרה`. The professional pool goes from
  two to six, so a professional business now gets a full draw of three.
- **v13 also ports the imperfections budget** from `vo_script/v7.md`: one or two seams (filler,
  restart, interrupted upgrade, afterthought), never in the first five words, never in the
  closing line, no written-out vocal sounds, no ellipsis; **at most one intense device**
  (unexpected verb, negative commitment, exclusion) — the founder set the ceiling at one where
  `vo_script` allows two; "three is a caricature" is kept.
- Seeds: `show-and-react`'s last beat id `cta` → `close`; `three-things`' example is the
  founder's `למזלך מצאתי אתר שעושה את שלושתם, הוא נקרא תבנית, …`; `objection-flip`'s exception
  example says `חוץ מקרם אחד` (kind form, per v11).
- The DRY_RUN stand-in script now ends on the first offered closer, so a dry run shows one.

Measured the same day (before v13): all three of the most recent v12 scripts ended on an
offered closer with its punctuation intact in `rendered_text` — `תנסו ותגידו לי.`,
`הכי ממליצה בעולם!!` (the model chose two of the then-allowed 1–4), `אין על זה, אין.` — see
[[b-audio-renders-have-no-tail-silence]].

## Not verified

No script has been generated with `v13` yet — every local `.env` is `DRY_RUN=1`
([[0027-product-kind-is-an-optional-questionnaire-field]] has the same caveat for v11), and
the dry-run branch returns a canned script, so only a production or `DRY_RUN=0` run says
anything about the prompt. For `v12` the picture is measured, not predicted: 19 production
scripts by 2026-09-08 03:30 UTC (`select prompt_version, count(*) from scripts where kind =
'b_script' and created_at > now() - interval '30 days' group by 1` → v12 19, v10 8, v9 12),
and the three most recent ones ended on an offered closer
with its punctuation intact all the way into `audio_renders.rendered_text` (see above). Whether
`!!!!` and `..` are _heard_ the way the founder measured them in the ElevenLabs UI is still a
listening test, not a query.

The production `structures` rows hold the round-1 (2026-09-07) seeds — the founder ran
`aiugc bank seed-structures --update` after that commit (checked 2026-09-08 with
`select title, skeleton->'beats'->-1->>'id', skeleton->'beats'->-1->>'example' from structures`:
`problem-agitate-solve` still ends `!!!`, `show-and-react`'s last id is still `cta`). The
2026-09-08 seed changes reach production only when he runs it again.

## Where it lives

- `packages/core/src/closer-templates.ts`; tests in `packages/core/test/closer-templates.test.ts`.
- `packages/core/src/pipelines/copy.ts` — `generateBScript`: `closer_options`, `params.closers`.
- `prompts/b_script/v13.md` (v12 introduced the bank; v13 fixed every closer's punctuation and
  added the imperfections budget); the closer rules are pinned by `closer-templates.test.ts`,
  the v9–v11 phrases still by `hook-templates.test.ts`.
- `seed/structures/*.json`; `packages/core/test/seed-structures.test.ts` asserts every final
  beat ends on a closer from the bank.
- `packages/core/src/pipelines/bank.ts` — `seedStructures`; `apps/cli/src/index.ts` — `--update`.

## Related

- [[0017-service-b-single-setting-selfie-talking-head]] — the format `b_script` writes for.
- [[0027-product-kind-is-an-optional-questionnaire-field]] — v11, the version v12 was cut from.
- [[hook-bank-still-teaches-the-generic-dodge]] — the hook bank's own stale line, untouched here.
