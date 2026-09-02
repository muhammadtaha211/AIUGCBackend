---
type: decision
status: verified
verified: 2026-09-02
method: "founder instruction in chat 2026-09-02; bank state read from the live DB with packages/core/.work/persona-bank-probe.ts (select from personas, persona_images, hook_clips)"
source: founder + db
supersedes: "[[0001-five-step-steps-wizard]]"
---

# 0012 — The steps wizard is persona-first, and the hook bank is a strict persona × clip matrix

## The decision

The founder's words: _"in the service A flow itself, I should first let the user choose the
character and only then we display only the hook clips that are connected to that chosen
character and no other hooks, right now its jumping straight into the hooks which is not
correct. I will essentially have a character x hook clip matrix."_

- `aWizardSteps("steps")` → `persona → hook → hookStudio → demo → plan → render`.
- `GET /api/hooks?personaId=` returns only rows with `persona_id = <persona>`. Generic clips
  (`persona_id IS NULL`) are shown to **nobody**. Without `personaId` the route still returns
  generic-only, but no shipped flow calls it that way any more.
- The A picker lists only personas with at least one active clip
  (`loadPersonaCatalog({ withHookClips: true })`, served as `/api/personas?withHookClips=1`),
  so a customer cannot pick a persona and land on an empty gallery.
- Admin fresh hook uploads require a persona; the card flags active clips that have none.

## Options considered

- **Persona-first, persona clips + generic clips** — the v2 predicate from `89ae028`
  (`generic OR persona`). Rejected by "and no other hooks".
- **Persona-first, strict** — chosen.
- **Keep five steps ([[0001-five-step-steps-wizard]])** — the decisive measurement behind it
  ("the hook bank contains exactly one clip, and it is generic") describes the bank as it was,
  not the matrix the founder is building. Its own "What it costs later" clause named this
  moment: _"If persona-swapped clips are ever added to the bank, the steps wizard won't surface
  them without reintroducing a picker."_

## What does not change

The render path. `buildServiceAStepsProps` still consumes no persona; the steps create/quote
routes take none. The persona scopes the gallery and is the first-person speaker of the hook
lines (`StepHookStudio` already forwarded `personaId` to the hook-lines route; now it always
has one). Persona and hook stay session-local: a reload lands on the persona step unless the
demo is ready, in which case it lands on the plan step.

## The bank at decision time (probe, 2026-09-02)

| table            | rows                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `personas`       | 2 — Test (`f871ab6c…`, female), Tala (`b9853ad6…`, female)                                      |
| `persona_images` | 1 usable, on Test (after the repair in [[../defects/persona-image-upload-strands-pending-rows]]) |
| `hook_clips`     | 2 — `a165cc7c…` inactive generic; `465f73c1…` **active and generic**                            |

Consequence the founder must act on: **until `465f73c1…` is assigned to a persona in
`/hooks`, the wizard shows no hooks for any persona**, and Tala does not appear in the picker
at all because she has no reference image (the card needs a face — `loadPersonaCatalog`
inner-joins `persona_images`).

## Related

[[../defects/admin-hook-upload-persona-footgun]] — the model flipped: the invisible clip is now
the one _without_ a persona.
