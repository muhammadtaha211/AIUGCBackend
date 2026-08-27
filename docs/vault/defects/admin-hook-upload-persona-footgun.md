---
type: defect
status: verified
verified: 2026-08-27
method: "select id, persona_id, active from hook_clips + select count(*) from hook_clips where active and persona_id is null — 0 wizard-visible before the fix, 1 after; wizard predicate read from apps/web/src/app/api/hooks/route.ts"
source: db | code
---

# FIXED 2026-08-27 — admin hook upload could make a clip invisible to every customer

The first hook clip ever uploaded (2026-08-27) never appeared in the A wizard. The wizard's
`GET /api/hooks` lists only generic clips (`active AND persona_id IS NULL` — no shipped flow
passes a personaId), but the admin fresh-upload form offered a דמות dropdown and stored the
choice. The founder picked persona "Test"; the clip was saved persona-assigned and the
wizard's predicate matched zero rows. No error anywhere — the wizard truthfully said there
were no hooks.

**Fix, two parts:**

1. Data — cleared `persona_id` on clip `a165cc7c-94cd-4314-8ce2-2902c2ae5551` (was
   `f871ab6c-3dfa-42c0-9ec9-dd45b90c0bcb`, persona "Test"). Wizard-visible count 0 → 1.
2. Code — `apps/admin` upload form now shows the persona dropdown only in the
   שכפול-לדמות (prefill) flow, where the persona is the point. Fresh uploads always
   register generic. The per-clip dropdown on existing cards still reassigns, so the
   capability survives; only the silent foot-gun is gone.

Related standing gap, not a defect: persona-assigned hook clips are unreachable in every
shipped flow today (nothing passes `personaId` to the hook picker) — they are machinery for
a future persona-aware flow.
