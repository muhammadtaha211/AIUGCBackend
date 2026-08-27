---
type: defect
status: verified
verified: 2026-08-27
method: "code trace of a-wizard.tsx rail wrapper (lg:sticky lg:top-8) + app/home/layout.tsx scrollport during the 2026-08-27 six-fix review; no live repro"
source: inference
---

# A-wizard rail clips its bottom on short lg viewports

Since the 2026-08-27 overlap fix, the A wizard's rail column (step list + structure strip,
~450px tall together) pins as one sticky unit at `top-8`. On an lg-width scrollport shorter
than ~500px CSS (half-height window, DevTools docked bottom, 1366×768 at high Windows
scaling), the strip's bottom tile is clipped at the viewport edge while pinned; it only
becomes reachable near the end of scroll, when the grid row bottom pushes the wrapper up.

Deliberately not fixed: the candidate fix (`lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto`
on the wrapper) adds an inner scrollbar to the rail for an edge-case viewport. The nested
re-pin overlap that used to accompany this (the inner nav's own sticky re-pinning over the
strip) IS fixed — `WizardNav` takes `sticky={false}` from the A wizard.

The B wizard is unaffected (its nav is the bare grid item with no sibling below).
