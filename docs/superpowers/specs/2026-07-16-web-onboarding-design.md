# apps/web — Self-serve web app: onboarding-first design

Date: 2026-07-16. Status: superseded on 2026-07-23 — the driver pattern below (dev/supabase auth
drivers, HMAC cookie session, PGlite web db, /dashboard, api/auth/\*) was removed when the real
Supabase project came online. apps/web now uses Supabase Auth via @supabase/ssr (cookie sessions),
POST /api/onboarding/complete persists the wizard draft through core (`createBusiness` +
`setQuestionnaire`, owner row resolved by auth uid), and /home replaces /dashboard. The onboarding
UX described here still applies as redesigned in 2026-07-18-onboarding-editorial-redesign-design.md.

## Goal

Ship `apps/web` as the thin Next.js wrapper the docs promised, with the onboarding flow as the
star: frictionless, dopamine-boosting, goal-gradient driven, and **signup-last** — the visitor
designs their business profile and fills the questionnaire before ever being asked for an email.
Everything user-facing is Hebrew, RTL.

## Requirements (from the founder's brief)

1. **Frictionless + dopamine:** pre-fill every field with a "מומלץ" (recommended) default wherever
   possible; the user should mostly tap, not think. Fun, engaging visuals.
2. **Goal gradient:** progress never shows 0%. The first trivial tap (pick a business category)
   immediately counts — the bar starts at ~20% and visibly accelerates toward the end.
3. **Signup last:** profile design → questionnaire → only then account creation. Pre-signup
   answers live in `localStorage` and are written to the database in one transaction when the
   account is created. Every button before signup says **המשך** (never אשר).
4. Works against the real backend (`@aiugc/core`), which is still keyless — so the app must run
   fully without Supabase/API keys.

## Approaches considered

- **A. Supabase-only:** wire Supabase Auth + cloud Postgres now. Rejected: no Supabase project
  exists yet (machine constraint), so nothing would be runnable or verifiable.
- **B. Mock-first:** build the UI against fetch mocks, wire the backend later. Rejected: violates
  the repo's core principle that every surface exercises the production pipeline.
- **C. (Chosen) Driver pattern, mirroring `DRY_RUN`:** the web app talks to `@aiugc/core`
  functions through server routes. The DB handle comes from `DATABASE_URL` (postgres-js →
  Supabase) when set, else a **persistent PGlite** instance at `.dev-pglite/` with the same
  portable migrations the tests use (0000 + 0001). Auth is a signed-cookie session with two
  drivers: `dev` (email → instant account, no password — parity with the planned email-OTP UX)
  and `supabase` (OTP via `signInWithOtp`/`verifyOtp`) selected automatically by env presence.
  When the Supabase project exists, setting env vars flips both drivers with zero code changes.

## Architecture

```
apps/web (Next.js 15 App Router, Node runtime, transpilePackages: @aiugc/core)
  src/app/
    page.tsx                landing (server component, Hebrew hero)
    start/page.tsx          onboarding wizard (client component)
    dashboard/page.tsx      post-signup home (server component, reads via core)
    api/auth/signup         POST — dev driver: create user+business+questionnaire, set session
    api/auth/verify         POST — supabase driver: verifyOtp then same completion path
    api/auth/logout         POST
  src/lib/
    db.ts                   getWebDb(): DATABASE_URL ? core getDb() : persistent PGlite + migrations
    session.ts              HMAC-signed cookie (uid.email.sig), httpOnly
    onboarding.ts           completeOnboarding(db, payload): ensureUser → createBusiness →
                            setQuestionnaire (validated by core questionnaireSchema)
    authDriver.ts           picks dev vs supabase from env
  src/components/           wizard steps, progress bar, chips, confetti
```

- **No pipeline code moves into web** (per docs/06): routes call the same core functions the CLI
  calls (`ensureUser`, `createBusiness`, `setQuestionnaire`, `creditBalance`, reads on
  `video_renders`).
- **Business profile extras** (category, emoji avatar, brand color) that the core questionnaire
  schema doesn't model are stored in the same `businesses.questionnaire` JSONB under a `profile`
  key — additive, no migration. `questionnaireSchema` is a plain `z.object`, which strips unknown
  keys on parse, so every core consumer (`requireQuestionnaire`, copy pipelines) keeps seeing
  exactly the fields it knows; the web layer merges `profile` back in with one UPDATE after the
  core `setQuestionnaire` write.

## Onboarding flow (goal gradient)

| Step | Screen                                                                                    | Progress after | Notes                                                           |
| ---- | ----------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------- |
| 0    | Category pick — one tap ("מה העסק שלך?")                                                  | 20%            | chips w/ emoji; instant jump from 8% baseline shown on load     |
| 1    | Profile design — name, emoji avatar, brand color                                          | 36%            | avatar+color pre-selected per category; name is the only typing |
| 2    | The product — product_name (prefilled = business name), what_it_does                      | 52%            | placeholder examples per category                               |
| 3    | Features — tappable recommended chips per category (3 pre-selected) + free add            | 68%            | min 1 / max 8, matches core schema                              |
| 4    | Audience & tone — audience chips (pre-picked), tone cards w/ "מומלץ" badge, optional link | 84%            |                                                                 |
| 5    | Signup — email only ("כמעט שם! 95%")                                                      | 95%            | dev: instant; supabase: OTP code screen                         |
| ✓    | Confetti + "הפרופיל שלך מוכן" → dashboard                                                 | 100%           |                                                                 |

All forward buttons: **המשך**. Back navigation preserved. State auto-saved to
`localStorage["aiugc.onboarding.v1"]` on every change and restored on reload; cleared after the
server confirms account creation.

## Visual language

Dopamine-forward: deep indigo→fuchsia gradient hero, glassy cards, big rounded chips with
emoji, springy progress bar with glow, micro-bounce on selection, confetti burst on completion.
Heebo (Hebrew Google font) with system fallback. Dark, saturated, mobile-first (the audience
films ads on phones).

## Error handling & edge cases

- Signup with an email that already owns a business → sign the user in and route to dashboard
  (no duplicate business); their in-progress answers stay local and are ignored server-side.
- Questionnaire payload re-validated server-side with `questionnaireSchema`; invalid → 400 with a
  Hebrew message, wizard keeps state.
- Session cookie invalid/absent on /dashboard → redirect to /start.
- PGlite bootstrap is lazily initialized once per process and survives dev restarts on disk.

## Testing / verification

- `pnpm typecheck` across workspace stays green.
- Manual end-to-end drive in the browser: full wizard → signup → dashboard shows the business,
  questionnaire summary, credit balance 0, renders empty state; DB row inspected.
