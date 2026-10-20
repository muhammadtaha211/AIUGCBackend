---
type: decision
status: verified
verified: 2026-10-20
method: "Founder decisions in §2 ('Also record, no code, as DECIDED NOT YET BUILT') of the 2026-10-20 task prompt 'Every voiced Tavnit render speaks on Eleven v4', from the planning chat the same day. MEASURED in the tree at feat/tts-eleven-v4 (= origin/main 033a420 plus that task), for what exists today: persona_images.kind='selfie' and personaSelfie (apps/web/src/lib/service-b.ts), the handheld camera path (packages/remotion/src/timing.ts handheld, used in ServiceB.tsx), the demo inventory (demo_analyses, demo_analysis_footage, 0077/0084), hook effects as named data (packages/core/src/hook-effect.ts)."
source: founder
---

# 0120 — Service B keeps the talking head, moves to a propped-phone look, and gains opt-in demo cutaways — DECIDED, NOT YET BUILT

Every ruling here is **FOUNDER-REPORTED** (planning chat, 2026-10-20). **Nothing in it is built.**
The look task and the cutaway task will point at this note. Until they land, the tree still renders
the selfie with the handheld sway, and CLAUDE.md and `.claude/rules/service-b.md` describe that
code, correctly.

## 1. The default stays the single talking head; the look moves to a propped phone

Service B's default render is still one talking-head clip. The look changes: a **propped-phone
workspace image per character** replaces the selfie.

His reason, from his HeyGen tests on 2026-10-20: the selfie image limits the hands and never reads
as handheld.

## 2. The handheld sway goes off for every B render

This is the seeded camera path, `handheld(frame, seed)` in `packages/remotion/src/timing.ts`
([[handheld-sway-constants]]). His reason: it wasn't good on the selfie either, and a propped
phone doesn't sway.

## 3. "Selfie" is retired as a concept; settings are numbered

- Settings are **numbered**.
- They are uploaded in admin **without a code change**.
- **Setting 1 renders.**
- **Every new setting is made for every character.**

Today the concept is `persona_images.kind = 'selfie'`, the `personaSelfie` resolver and a render
route that refuses any other kind ([[0017-service-b-single-setting-selfie-talking-head]]).

## 4. Cutaways to the customer's demo: opt-in, never the default

- **Source:** the existing demo inventory, analysed once and reused free.
- **A cutaway is a stretch of the demo from a picked moment, not a 2 s clip.**
- **Slots come pre-filled as a draft** and are corrected in a window-picker.
- **Structures are data**, as hook effects are. v1 has one structure plus "none".

## 5. Not doing

- Hyperframes as an engine.
- Generated B-roll: parked.
- Short uploads for non-software: out of v1.
- **The physical-product category stays a demand signal with nothing built for it.** This
  reaffirms [[0061-landing-positioning-two-services-no-results-claims]] §5.

## 6. 0092's "Open, not ruled" is ruled

Service B stays. It is revamped by the look (§1–§3) and by opt-in cutaways (§4). Parking it and
adding backgrounds, the other options
[[0092-service-b-revamp-tests-overlay-and-resync-routes-are-dead]] left open, are not taken. 0092
carries a dated pointer here.

## What the build tasks will meet (REASONED, from the tree; not his ruling)

- **Locked #12** (single reference image + audio through HeyGen) holds for §1. A propped-phone
  image is still one reference image.
- **CLAUDE.md's Service B line,** "one clip, start to finish; nothing is ever stitched in front of
  it", forbids a stitched opener. A cutaway cuts away from the clip mid-ad and back. The cutaway
  task will need that line amended, so it is the founder's to word.
- "Selfie" is a load-bearing word in the schema (`persona_images.kind`), the web resolver, the
  render route's refusal and three vault decisions. Retiring the concept (§3) is a schema-level
  task, not a rename.

## Related

- [[0119-tts-is-eleven-v4-plain-text]] — the same chat's TTS ruling, built.
- [[0024-hook-effect-is-a-render-param-the-customer-picks]] — "structures are data, like hook effects".
- [[0084-clips-are-placed-from-the-footage-instants]] — the inventory the cutaways draw from.
