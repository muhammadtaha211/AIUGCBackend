---
type: defect
status: verified
verified: 2026-10-19
method: "Code read: apps/web/src/lib/service-a-ui.ts:37-47 (the aWizardSteps doc comment says it is 'mirroring B's wizardSteps(category)'); apps/web/src/lib/service-b-ui.ts wizardSteps took no argument at 2817133 and takes `voice` since feat/b-own-voice."
source: code
---

# `aWizardSteps`' comment cites a B signature that no longer exists

The comment on `aWizardSteps(format)` says it mirrors "B's `wizardSteps(category)`". B dropped
`category` with the composite step (vault 0017). Since [[0118-service-b-own-voice]], B's parameter
is `voice` (`"ai" | "own"`), which is the closer mirror of A's two lists. The fix is a comment edit,
outside that build's scope.
