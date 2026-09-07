---
type: decision
status: verified
verified: 2026-09-07
method: "founder in chat, 2026-09-07: 'B scripts say משהו / הדבר הזה before the name because nothing in the questionnaire says what KIND of thing the product is (category is 4 coarse buckets). Add an optional questionnaire field product_kind — the Hebrew noun a customer would use: אתר, אפליקציה, קרם, קורס, קליניקה, מסעדה.' The optionality, the no-migration/no-backfill scope and the prompt wording were all specified in that brief."
source: founder
---

# 0027 — `product_kind` is an optional questionnaire field, and the prompt derives the noun when it is absent

Service B scripts hold the product name back until beat 4 ("The reveal" — the most
important rule in `b_script`). That means the model needs _some_ word for the product
in beats 1–3, and until now the prompt handed it the worst possible ones:
`b_script/v10.md` said **"Refer to it obliquely — זה, המוצר הזה, משהו, מוצר אחד, הדבר הזה"**.
So the scripts opened with `משהו`.

The prompt offered those words because the questionnaire gave it nothing better.
`category` is the only type signal and it is four coarse buckets
(`app_or_digital`, `physical_product`, `local_service`, `other`) — none of them a noun a
person would say out loud. A questionnaire can describe what the product _does_ in detail
and still never name what it _is_.

## What changed

- **`product_kind`** — optional, free Hebrew text, on `questionnaireSchema`
  (`packages/core/src/pipelines/businesses.ts`). One wizard field, one line in the schema.
- **`b_script/v11.md`** — two edits against v10:
  1. a `product_kind` bullet in "How to read the questionnaire": the word the persona uses
     for the product _before_ the name, with everything around it inflected to that noun's
     gender and number, and a derivation instruction for when the field is absent;
  2. the reveal's oblique-reference sentence becomes **name its KIND** — `הקרם הזה`,
     `האתר הזה`, `האפליקציה הזאת` — and bans `משהו`, `הדבר הזה`, `מוצר אחד` outright.
     One "Good:" example was updated for consistency: `חוץ ממוצר אחד` → `חוץ מקרם אחד`,
     because v11 bans the phrase its own example used.

## Options and why this shape

- **Optional, not required.** Every existing business has no value for it, and a required
  field would mean a backfill plus a new blocking wizard step for something the model can
  usually infer from `what_it_does` + `category`. The prompt's derivation fallback is what
  makes optional safe — the ban on `משהו` holds whether or not the customer answered.
- **A questionnaire field, not a wider `category` enum.** The buckets drive nothing else
  and an enum can never cover קליניקה / קורס / מסעדה / תוסף / אתר without becoming a
  taxonomy to maintain. The customer's own noun is the answer.
- **No migration.** Storage is `businesses.questionnaire jsonb` validated by
  `questionnaireSchema`, so a new optional key is a code change only.
  **The schema line is load-bearing**: `questionnaireSchema` is a plain `z.object`, which
  strips unknown keys — without it, `setQuestionnaire` would silently drop the value the
  wizard sends, with no error anywhere.
- **No backfill.** The prompt fallback covers pre-existing businesses.

## Not verified

No script has been generated with `v11` yet — the claim that the placeholder words stop
appearing is a **prediction, not a measurement**. The first real `aiugc script b` run
against v11 is what would turn it into a `facts/` note, and it has to be
`DRY_RUN=0`: every local `.env` sets `DRY_RUN=1`, and `generateBScript`'s dry-run
branch (`pipelines/copy.ts:463`) renders the v11 template — so `prompt_version` reads
`b_script@v11` — but returns a hardcoded script that opens
`חייבת לספר לכם על משהו…`. A dry run therefore emits the banned word no matter what the
prompt says, and proves nothing about it.

## Where it lives

- `packages/core/src/pipelines/businesses.ts` — `questionnaireSchema.product_kind`.
- `prompts/b_script/v11.md` — the two rules; `packages/core/test/hook-templates.test.ts`
  pins them (v11+).
- `apps/web/src/lib/onboarding.ts` — `OnboardingDraft.productKind`, emitted by
  `draftToQuestionnairePayload` only when non-empty (same shape as `link` and `wow`).
- `apps/web/src/components/onboarding/steps/step-product.tsx` — the optional field,
  placeholder per `businessType`; `apps/web/test/onboarding-payload.test.ts` pins the
  payload.
- Untouched on purpose: `vo_script`, `benefit_captions`, the CLI (`aiugc business
questionnaire --file` takes raw JSON and already accepts the key), and every existing
  `businesses.questionnaire` row.

## Known inconsistency, deliberately left

The hook-template bank injected into the same prompt as `{{hook_options}}` still
carries the old doctrine — `hook-templates.ts:53` offers the generic form of the very
sentence v11 rewrote, and the file's doc comment still names `משהו` as the pool's
design rule. It is founder-curated copy, so it was reported rather than edited:
[[hook-bank-still-teaches-the-generic-dodge]].

The wizard's placeholder for an "other" business is `אתר / מוצר / שירות` (founder-
specified) — it offers `מוצר`, and a customer who types it hands the prompt a generic
noun that the derivation fallback will not override, because the fallback only fires
on an absent or empty value.

## Related

- [[0017-service-b-single-setting-selfie-talking-head]] — the format `b_script` writes for.
- [[0020-service-a-is-hook-and-steps-only]] — Service A's passes read the same
  questionnaire JSON; they see the new key and are told nothing about it.
