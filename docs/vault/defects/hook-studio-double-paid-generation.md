---
type: defect
status: verified
verified: 2026-08-27
method: "founder saw the option set replace itself on every studio entry; mechanism traced in code (StrictMode doubles the mount effect, hookBatch guard reads parent state still null mid-flight); fix confirmed by founder walkthrough same day"
source: browser | code | founder
---

# FIXED 2026-08-27 — hook studio fired the paid generation twice on every entry

Every entry into the A-wizard hook studio in dev fired **two** POSTs to
`/api/businesses/[id]/hook-lines` — each a paid Claude generation minting 10 script rows.
React StrictMode (default-on in Next 15 dev) double-runs the mount effect, and the
`hookBatch === null` guard could not stop the second run: the state lives in the parent and
was still null because the first POST had not resolved. Last-write-wins on `setHookBatch`
replaced the option set the founder was reading (the reported symptom), and `setHookAvoid`
half-filled the 20-slot avoid list with lines the customer never saw.

**Fix:** an in-flight gate (`hookGenInFlight` ref) owned by `AWizard` and checked inside
`generateOptions`. Parent-owned on purpose — an instance-local ref was tried first and the
adversarial review killed it: backing out of the studio and re-entering during the pending
call remounts the component with a fresh ref and double-spends anyway. The gate's lifetime
now matches the state it protects. Reroll and retry-after-error call `generateOptions`
directly and are unaffected.

**Leftover, deliberate:** the same guardless mount-effect pattern exists in `step-hook.tsx`
(GET /api/hooks) and `step-render.tsx` (GET quote). Both are cheap idempotent GETs — a
harmless dev-only double fetch, not worth machinery. If either endpoint ever becomes paid or
write-bearing, it needs this gate.
