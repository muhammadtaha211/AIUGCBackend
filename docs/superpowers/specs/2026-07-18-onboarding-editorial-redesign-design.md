# Onboarding editorial redesign — design spec

Date: 2026-07-18
Status: approved direction (print editorial, light) — design-only pass, not wired to backend.

## Goals

1. Remove the "vibecoded" look: no gradients, glassmorphism, neon purple, glow shadows,
   confetti, shimmer, floating emoji avatars, pill buttons, or gamified percent bar.
2. Remove the "design your profile" step (emoji/color/avatar). Business name moves into
   the following step.
3. Give existing-account users a clear, persistent path to sign in from every onboarding screen.
4. Replace email-only signup with email + password + repeat password, plus a
   "Continue with Google" option (visual only for now).

## Out of scope

- Landing page (`/`) and dashboard keep their current look; legacy CSS classes stay untouched.
- Backend wiring: signup/login forms are not connected to the API in this pass.

## Visual direction — print editorial, light

- Palette (flat, no gradients): paper `#FAF9F6`, white panels `#FFFFFF`, ink `#141414`,
  warm gray text `#57524A`, hairline `#E2DED4` / `#C9C4B8`, single accent brick `#B33A2B`
  (used only for the current step marker, focus, and errors).
- Type: Frank Ruhl Libre (Hebrew serif) for display headlines; IBM Plex Sans Hebrew for UI.
  Heebo stays loaded for legacy pages.
- Shape: 2px corner radius, 1px rules, no shadows, no scale/float animations.
- All emoji removed from onboarding copy and controls. No icon fonts. The only graphic is
  the Google "G" brand mark on the OAuth button.

## Layout — asymmetric two-column (RTL)

Desktop: grid `[240px rail | content]` — the rail sits on the right (RTL start side) like a
magazine table of contents: numbered steps 01–05, current step in accent, completed in ink,
upcoming in warm gray. Content column is start-aligned (never centered), max-width ~36rem,
leaving deliberate whitespace on the left. Mobile: rail collapses to a one-line strip
("שלב 02 / 05 — פרטי העסק") under the masthead.

Masthead on every onboarding screen: wordmark on the right, and on the left the
existing-account link "כבר יש לך חשבון? כניסה" (flipped to a signup link on /login).

## Flow (was 7 screens, now 6)

0. תחום — category as flat text rows in a 2-col grid with hairline borders (no emoji tiles).
1. העסק — business name (moved here from deleted profile step), product/service name,
   what-it-does textarea. No emoji picker, no brand color picker.
2. יתרונות — flat toggle tags (selected = solid ink on paper text), custom add input.
3. קהל וסגנון — audience tags, tone as radio-style rows without emoji, optional link field.
4. חשבון — email, password, repeat password (inline match validation), primary
   "יצירת חשבון" button, hairline "או" divider, outlined "המשך עם Google" button,
   plus the sign-in link. Submit advances to the done screen without a network call.
5. סיום — serif headline, hairline rule, colophon-style summary of the answers
   (business, category, features count, audience, tone), button to the dashboard. No confetti.

State: `WizardState` drops `emoji`/`color` (payload derives them from category defaults so the
shared zod schema still validates). localStorage draft key bumps to `aiugc.onboarding.v2`
because step numbering changed. `PROGRESS_BY_STEP` is deleted along with the ProgressBar
and Confetti components (onboarding was their only consumer).

## /login redesign

Same editorial frame: masthead + narrow start-aligned column. Email + password fields,
"כניסה" button, "או" divider, Google button, link to /start. Form is design-only
(the old email-OTP flow no longer matches the UI and the backend isn't wired yet).

## Files touched

- `apps/web/src/app/layout.tsx` — add Frank Ruhl Libre + IBM Plex Sans Hebrew to the font link.
- `apps/web/src/app/globals.css` — new `.ed-*` editorial layer; legacy classes untouched.
- `apps/web/src/lib/onboarding.ts` — storage key v2, remove PROGRESS_BY_STEP.
- `apps/web/src/components/onboarding/Wizard.tsx` — new flow, rail layout, no OTP stage.
- `apps/web/src/components/onboarding/steps.tsx` — all steps rewritten per above.
- `apps/web/src/app/start/page.tsx`, `apps/web/src/app/login/page.tsx` — editorial frames.
- Deleted: `ProgressBar.tsx`, `Confetti.tsx`.
