---
type: decision
status: superseded
verified: 2026-08-21
method: "founder edited a hook line in the browser; bank clip count read from DB"
source: founder
---

# 0001 — The steps-format wizard is five steps, not six

**Superseded 2026-09-02 by [[0012-persona-first-steps-wizard]]** — the founder reintroduced the
persona step and made the hook bank a strict persona × clip matrix. Kept verbatim below.

`aWizardSteps("steps")` -> `hook -> hookStudio -> demo -> plan -> render`. No persona step.
`aWizardSteps("full")` still returns the seven-step voiced path, unchanged.

## Options considered

**Six steps, keeping persona.** Matches the voiced wizard and preserves access to persona-swapped
hook clips and gendered hook lines.

**Five steps, dropping persona.** The steps pipeline is persona-free end to end:
`buildServiceAStepsProps` consumes no persona, `RenderServiceAStepsProps` has no persona field, the
CLI steps path takes none, and `hookLinesRequestSchema.personaId` is optional.

## Why five

The decisive measurement: **the hook bank contains exactly one clip, and it is generic.** A
persona-less wizard loses nothing that exists today.

The real cost was not persona-swapped clips — it was that hook lines default to feminine first
person, which would have left the steps wizard unable to produce a masculine or neutral hook. That
was made a blocking condition, and it cleared: the hook studio has free-text line editing, saved as
a new immutable script row. **The founder confirmed this by editing a line in the browser.**

## What it costs later

If persona-swapped clips are ever added to the bank, the steps wizard won't surface them without
reintroducing a picker.

## Related

`StepAScript` and `StepAudio` files stay in the tree — Service B imports them. Voiced Service A
remains CLI-only on the web. Intended.
