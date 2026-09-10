---
type: state
status: current
updated: 2026-09-10
source: founder
note: >
  Mutable working state, NOT a fact note. The 14-day staleness rule in CONVENTIONS.md
  does not apply — this file is meant to be edited in place whenever the queue moves.
  Anything here that becomes a durable, verified fact should graduate into
  docs/vault/facts/ or decisions/ and be removed from this file.
---

# State of play

Read this first in a new session. It holds what the repo cannot: external state,
decisions made in conversation, and the ordered queue.

## Where things stand

**The product is live end to end.** `tavnit.ai` is owned, attached in Vercel, resolving,
and serving `apps/web` (founder-verified 2026-09-01). A **full Service A wizard run was
completed against the live deployed app** the same night — demo upload through to a
finished MP4, rendered on the Hetzner box, quality confirmed by eye. That run closes the
old queue item 1: the Vercel-tracing fix (`4f85ae9`) is proven on Linux in production —
a full run to MP4 necessarily exercised hook-line generation (inference from "full run";
the route was not hit in isolation). Full story of that bug:
[[computed-path-reads-are-invisible-to-vercel-tracing]].

The night also surfaced an outage that was **not** closed that night, though this file
said it was: **every box render since 2026-08-27 was dead** — the §9 `/tmp` cron was
deleting the live worker's memoized webpack bundle ([[tmp-cron-deletes-live-worker-bundle]],
cause-verified via `crontab -l`; fixed in the repo by a repo-owned `outDir` + re-bundle
heal, commit `9543cc3`).

**Corrected 2026-09-02: the fix did not reach the box on 09-01.** A fourth render died the
same death on 09-02 with a fresh `/tmp` bundle path, which `9543cc3` cannot produce. The
box was sitting at `48584e7` — the merge's _other_ parent, which does not contain the fix
— and the 09-01 "proof" render succeeded only because the restart made the OLD code
mkdtemp a fresh `/tmp` bundle, which the cron then ate ~19h later. Full autopsy:
[[bundle-fix-reached-the-worker-box]]. **A real §11 deploy ran 2026-09-02** (`48584e7 →
af158cb`, `packages/remotion/src/render.ts` +35 and `bundle-heal.test.ts` created — those
files arriving is itself the proof the box never had them), worker restarted, three renders
released, and the bundle verified living outside `/tmp`. **Closed.**

The rule this cost two incidents to learn: **verify the deployed artifact, not the
symptom.** `git log -1 --oneline` on the box, not "a render worked afterwards" — a restart
alone produces that. §11 now carries the check.

All four deaths surfaced only because the founder happened to be running a wizard test —
that is the Sentry argument (queue item 7), now with four data points instead of two.

`apps/admin` is deployed on its vercel.app URL and now sits behind HTTP Basic Auth in front
of `requireAdmin` — closed 2026-09-09, old queue item 2. Verified from outside the browser
session: `GET /login` with no credentials -> 401 carrying `www-authenticate: Basic
realm="admin"`; the same request with credentials -> the login page; `GET
/api/admin/personas` with no credentials -> 401, not 403 — proof the Basic wall fires ahead
of the Supabase gate, not behind it.

**Render progress is now visible to the customer** (2026-09-02). The A wizard's render
step has a real bar with the percentage on it; `/home` shows a live chip plus the percent
inside the in-flight tile, and deliberately no bar. Shape and the three rounds that
produced it: [[0010-where-render-progress-is-shown]]. The retry-backoff copy that used to
appear mid-render is gone on purpose: [[0009-retry-backoff-is-invisible-to-the-customer]].
The `/home` content pane also renders at `zoom: 0.95`
([[0011-dashboard-content-renders-at-95-percent]] — including the coordinate-space hazard
that creates for any future pointer math under `/home`). Whether 0.95 is the right constant
is still unmeasured against the founder's own viewport.

The worker box is live; the pipeline does not depend on the founder's desktop being awake.

**Google sign-in is live to the public** (2026-09-03) — old queue item 1, closed. `/privacy`
and `/terms` shipped, `tavnit.ai` is verified in Search Console, and the founder published
the OAuth app; status reads _In production_ with no review, and a Google account that is
**not** on the test-user list signed in on `tavnit.ai` the same day. That lifts the hard gate
the 0006 amendment put on ANY traffic.

That first stranger sign-in also exposed two holes in what happens _after_ Google returns.
Both are fixed, merged to `main` (fast-forward, tip `c4cbf60`), and deployed to production by
Vercel on 2026-09-03. Founder-smoke-tested there the same day:
`/auth/callback?error=access_denied&error_description=test` -> `/login` with the Hebrew message;
a Google sign-in with a zero-business account -> `/home/new-business`; the finished-wizard path ->
`/home`. Not exercised: a genuine failed `exchangeCodeForSession` (as opposed to GoTrue returning
error params with no code) — see the callback note's Fixed section.

- A signed-in user with **no business** had no way off the public wizard: the middleware
  forwards only owners, so they sat on `/start` with nothing saying they were signed in.
  They now go to `/home/new-business` —
  [[0015-signed-in-without-business-lands-on-new-business]].
- A **failed** round-trip still died silently at `/auth/callback`, which discarded the
  exchange result and ignored provider error params. It now lands on `/login` with a Hebrew
  message — [[auth-round-trips-that-miss-the-callback-die-silently]].

## External state — not in the repo

**Supabase.** Project `hyaqydcmwbnbaiqqufow`, `eu-central-1` (Frankfurt), Pro plan, Micro
compute. Migrations 0000–0033 applied (0032 and 0033 by the founder in the dashboard on
2026-09-05, then `supabase migration repair --status applied 0032 0033`), ledger clean —
24 true + 0020 NULL on the structural layer. Auth: Email provider on, "Confirm
email" OFF, Google enabled. Site URL is `https://tavnit.ai`;
`https://tavnit.ai/auth/callback` is on the redirect allowlist; the localhost entry was
kept (founder-verified 2026-09-01). The old project is deleted — org back to $25/month.

**Vercel.** `apps/web` project off this monorepo: Root Directory `apps/web`, Next.js
preset, no build/output/install overrides (defaults are correct — core ships as TS
source via `transpilePackages`), function region `fra1`, `ANTHROPIC_API_KEY` added,
`tavnit.ai` attached and resolving (all founder-verified 2026-09-01). Still useful:
`NEXT_PUBLIC_*` variables must be type Config, not Secret. **Unverified:** whether
`SUPABASE_SERVICE_ROLE_KEY` is in the web project's env (see open decisions), and
whether the pre-existing admin project has `fra1` set.

**Hetzner.** One server `tavnit-worker`, CPX32 (4 shared AMD vCPU, 8 GB, 160 GB NVMe),
Nuremberg, Ubuntu 24.04. ~$41/month plus ~$0.72 for the primary IPv4, which bills
whether or not attached. Reasoning and rescale rules: [[0007-worker-box-instance]]. **A
powered-off server still bills in full — only deletion stops the meter.**

**The box itself.** `aiugc-worker.service` enabled, `Restart=always`,
`WORKER_ID=hetzner`. At `af158cb` after the 2026-09-02 §11 deploy — the one that actually
carried the bundle fix; the 09-01 deploy did not (see above). Worker restarted and
claiming. **Rendering re-verified on this build:** three live wizard renders released
2026-09-02 between 02:36 and 03:02, 0 retries each, ~65s
([[service-a-render-wall-clock-on-the-box]]). **The bundle outage is closed** — verified on
the box the same night by where the bundle physically is, not by a render succeeding:
`.work/remotion-bundle` exists and `/tmp/remotion-webpack-bundle-*` is empty, so the §9
cron cannot reach it ([[tmp-cron-deletes-live-worker-bundle]]). `ufw` active, OpenSSH only. SSH is
key-only from the founder's Windows desktop and no second key pair exists — losing that
key means a console root reset. Logs: `journalctl -u aiugc-worker -o cat`. Deploys:
`docs/07-worker-box.md` §11. The §9 cron is **verified** via `crontab -l` (exact line in
[[tmp-cron-deletes-live-worker-bundle]]) and stays — as a backstop for
`remotion-v4.0.499-assets*` shells only; the bundle is out of its blast radius now.

**GitHub.** A fine-grained PAT with **no expiration**, scoped to `AIUGCBackend`,
Contents: read-only, plaintext in `~/.git-credentials` on the box. Nothing will ever
remind anyone it exists; revocable only at GitHub (Settings → Developer settings →
Fine-grained tokens). Deploy-key alternative rejected: [[0008-github-pat-over-deploy-key]].

**The desktop worker must stay stopped.** Both workers can safely claim from one queue
(`SKIP LOCKED`), but the desktop's `.env` carries `DRY_RUN=1` and the box's deliberately
does not. A desktop worker claiming a real customer job reports success and writes
placeholder files. Start it only deliberately. (Whether it briefly did exactly that
around 2026-08-27 is an open check — queue item 6.) Two of them were found alive on
2026-09-06 (started 07:49 and 07:54, `DRY_RUN=1`, polling the production queue beside the
live box) and were stopped; nothing was claimed at the time.

**The box does not deploy itself, and nothing says when it is behind.** Verified
2026-09-06: it sat on `4e000e3` while `origin/main` was 14 commits ahead through PRs #21
and #22, so the wizard stored `hookEffect: "zoom"` and the worker rendered an ad with no
effect at all — no error, no failed job, just a wrong video
([[worker-box-was-14-commits-behind-2026-09-06]]). Vercel redeploys on push; the box is
`git pull` + restart by hand. **After any merge that touches `packages/core`,
`packages/remotion` or `apps/worker`, deploy the box and check `git log -1 --oneline` on
it.** Note for the next deploy: `sudo` on the box needs a password, so an unattended
session cannot run `systemctl restart`; `kill -TERM $(systemctl show aiugc-worker -p
MainPID --value)` is equivalent because the unit is `User=aiugc` with `Restart=always`.
Measured 2026-09-06: the stop took ~80s (systemd's stop timeout — the worker never calls
`closeDb()` or `process.exit(0)`, so its postgres sockets hold the process open), then it
came back on a fresh PID.

**Google OAuth is published — status _In production_.** The founder published it
2026-09-03, having verified `tavnit.ai` in Search Console a few days earlier (exact date
not recorded) and shipped `/privacy` and `/terms`. Scopes `openid`/`email`/`profile` —
all non-sensitive, so publishing was a form, not a review, exactly as
[[0006-google-oauth-is-in-scope-for-launch]] said. **Measured 2026-09-03:** a Google
account **not** on the test-user list signed in on `tavnit.ai` — it ended on `/start`
looking signed out, and `/home` → `/home/new-business` is what proved the session
existed. Do NOT upload a custom app logo: it triggers Google's brand review even with
non-sensitive scopes.

## Decisions made in conversation — not yet fully in the repo

1. **`GOOGLE_SIGN_IN_ENABLED` stays `true`** — recorded 2026-09-01 as an amendment in
   [[0006-google-oauth-is-in-scope-for-launch]]. Its consequence, that **OAuth publishing
   was a hard gate on ANY traffic**, is spent: the app is published.
   `docs/08-supabase-project-rebuild.md` §8B now points at the amendment instead of
   advising the flag be set `false` for a public window.
2. **Where `apps/admin` lives — proposed `admin.tavnit.ai`, never decided.** Admin is
   deployed and publicly reachable on its vercel.app URL today. Should live:
   `decisions/` when settled.
3. **The orphaned a-sets routes were deleted, not guarded** (`497fc24`, in git).
   Reasoning worth keeping: the base route predated the BalanceProvider design and
   returned no post-debit balance, so a future voiced flow has to rewrite it regardless
   — it was a stale draft, not a reusable asset.
4. **`debitRender`'s non-positive-cost hole: deliberately not fixed.** The note is in
   the tree ([[debit-render-accepts-non-positive-cost]]); the decision is that it stays
   a note for now.
5. **The Service B format is decided** — recorded 2026-09-04 in
   [[0017-service-b-single-setting-selfie-talking-head]]. Single-setting selfie talking
   head, no image or composite step, physical products out; the optional founder-made opener clip was retired 2026-09-06 — the hook is a Remotion animation over the one HeyGen clip ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]). **The engine is now built to it** (2026-09-05, queue item 14, commits
   `2d446e6..b6c652a` on `main`, merged via PR #21 (`704ad25`, 2026-09-06) and pushed —
   confirmed 2026-09-09): b_script v9 + `hook_text`,
   the lead-in, hook text on render params with the selfie guard, `serviceBTimeline` and the CLI — plus the opener half (opener on render params, the opener composition, `bank add-opener`), **retired 2026-09-06** and still in the tree ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]). **The B wizard (16) is built too**
   (2026-09-05, branch `service-b-wizard`, merged to `main` via PR #21, `704ad25`,
   2026-09-06, and pushed — confirmed 2026-09-09).
   **Built 2026-09-06** ([[0024-hook-effect-is-a-render-param-the-customer-picks]]): the animation-effects step replacing the opener step (none/zoom/focus/whip, Hebrew labels), the speech-tied caption handoff in `serviceBTimeline`, and the `hookEffect` name on the render route, `createBRender`, `buildServiceBProps` and `render-b --hook-effect`. Still NOT built: nothing on 0023's list. Admin registration (15) is retired with the opener bank. Three engine decisions were made in the chat
   that built it, all in the code and its comments: the talking head stays muted and the
   approved mp3 plays from `captionOffsetMs` (the repo's measured glitch reason won over
   the brief); the `kind='selfie'` guard applies to any render resolved from a persona
   DEFAULT, opener or not (explicit image / composite bypass); a non-selfie default throws
   a plain Hebrew `Error`.
6. **HeyGen Avatar IV needs leading silence to start on a still frame** — recorded in
   [[heygen-avatar-iv-idles-on-leading-silence]]. Founder hand test, ~800ms, one persona,
   by eye. **Now in the repo** (2026-09-05): `handleLipsync` prepends
   `app_config.lipsync_lead_in_ms` (code default 800, no seed) and pins it on
   `params.leadInMs`. Measured 2026-09-06 at three expressiveness levels: the head is still only to 0.56s and moves from 0.60s, before speech, so 800ms buys a 0.56s still window ([[heygen-head-moves-before-speech-onset]]) — the window the zoom hook now opens on ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]). `GAP_MS = 250` was the reveal-to-speech gap of the retired cut.
7. **[[0004-service-b-config-is-provisional]] is superseded by 0017** — but only on the
   open-endedness. `lipsync_motion_prompt` and the new `lipsync_expressiveness` are
   founder-chosen since 2026-09-06 (migration 0034,
   [[0022-heygen-expressiveness-medium-generic-motion-prompt]]), and **`auto_release_b` came out
   of the placeholder list entirely on 2026-09-09** — ON is the founder's final decision,
   [[0036-auto-release-b-is-always-on]]. `lipsync_resolution` is the only key still genuinely
   provisional. The note is marked `status: superseded` and kept, not deleted.
8. **Four stale provider references corrected 2026-09-04**, all in git: the
   `motion_prompt`/`expressiveness` caveat in `docs/04-integrations.md` (HeyGen's pages do
   **not** disagree — `developers.heygen.com/avatar-iv`, read 2026-09-04, says both apply to
   arbitrary images; the new limit recorded there is that gesture **timing** is not
   promptable), the "only InfiniteTalk source" wording in
   `packages/core/src/db/schema.ts` and `docs/01-schema.md` (provider renamed, image+audio-only
   constraint kept), and the 30s comment in `b-wizard.tsx` (the frame ceiling is gone; 30s
   stays off **pending the founder**, not because it would fail). 30s was **not** re-enabled.

## The queue

1. ~~**Copy the auth cookies onto the middleware's redirects.**~~ — **fixed 2026-09-03** in
   `c925d4a` (web, guarded by `apps/web/test/middleware.test.ts`) and `ad6d5ce` (the same drop
   in admin's `deny()`); defect note updated:
   [[middleware-redirects-drop-refreshed-auth-cookies]]. Both exits now copy the rotated
   cookies onto the redirect they return. Still **code-read, never observed** — the test proves
   the cookies are carried, not that anyone was ever signed out.
2. ~~**Second wall on admin.**~~ — **closed 2026-09-09**: `ADMIN_BASIC_USER`/`ADMIN_BASIC_PASS`
   set on the admin Vercel project (Production and Preview), redeployed. Verified from
   outside the browser session: `GET /login` with no credentials -> 401 carrying
   `www-authenticate: Basic realm="admin"`; the same request with credentials -> the login
   page; `GET /api/admin/personas` with no credentials -> 401, not 403 — proof the Basic
   wall fires ahead of the Supabase gate, not behind it. Credentials themselves were never
   written down (CLAUDE.md's credential rule). **Still open: whether the admin project's
   function region is `fra1`** — not confirmed this session.
3. **`setAll` drops the no-store headers `@supabase/ssr` passes with rotated cookies.** All four
   hooks — `apps/web/src/middleware.ts:27`, `apps/admin/src/middleware.ts:45`, and both
   `lib/supabase/server.ts:17` — declare one parameter, so the `Cache-Control: private, no-store`
   / `Expires: 0` / `Pragma: no-cache` map the library passes alongside a rotated session is
   discarded; TypeScript cannot catch it, because a shorter function is assignable. The library's
   stated risk is a cached auth response serving one user's session token to another. Believed
   inert today — Next marks cookie-reading routes dynamic, and Vercel is not believed to cache
   middleware responses — but that mitigation is **inference, never measured**, and `c925d4a` /
   `ad6d5ce` just put `Set-Cookie` on four more exits than before. Read a deployed response header
   before deciding how much this is worth.
   [[supabase-ssr-setall-cache-headers-are-ignored]].
4. ~~**A failed `businesses` query reads as "no businesses".**~~ — **all 7 sites closed
   2026-09-09/10.** `middleware.ts` now reads
   `error` and returns the pass-through (behaviour-preserving — `data: null` already fell
   through; what it buys is that the exit is named, plus two new cases in
   `apps/web/test/middleware.test.ts` — the failed read, and the signed-in-owner-with-no-business
   at `/start` that nothing covered before), and `home/layout.tsx` reads `error` and logs it
   (sidebar still empties, deliberately). The other five —
   `home/page.tsx`, `home/a/new`, `home/b/new`, `home/demos` and `home/renders` (the
   seventh site, added 2026-09-08 in `e33396f`) — **now throw**, through one helper
   (`ownedBusinesses`, `apps/web/src/lib/businesses.ts`) rather than five copies, because the
   copy is how the defect spread. They land on `apps/web/src/app/home/error.tsx`, written
   2026-09-10: Hebrew, pane-scoped so the sidebar survives, retry runs `router.refresh()`
   **and** `reset()` (`reset()` alone is a dead button for a failed server read).
   Reproduced end to end against a **real** PostgREST error — an unauthenticated `businesses`
   read returns `permission denied for table businesses`, not an empty list, which is what made
   this defect reachable on any request whose JWT misses PostgREST.
   **The duplicate-business path is still open and no error-handling fix reaches it**: it runs
   `/start` → `OnboardingFlow` → `/home/new-business` → `allowCreate`, and neither hop
   reads `businesses`. Closing it means either the `OnboardingFlow` target (rejected — founder
   decision [[0015-signed-in-without-business-lands-on-new-business]]) or the `allowCreate` skip
   (deliberate). **That is the only part of this item still open.**
   [[a-failed-businesses-query-reads-as-no-businesses]] carries the boundary measurement.
   **The boundaries the "next move" called for were written 2026-09-10** — see item 4b.
   4b. ~~**A failed `auth.getUser()` reads as "signed out".**~~ — **closed 2026-09-10, 15 of
   17 sites**, together with the two boundaries item 4 asked for:
   `apps/web/src/app/error.tsx` (the root boundary — **dark**, because a page that threw
   rendered no `theme-light` wrapper) and `apps/web/src/app/global-error.tsx` (its own
   `<html lang="he" dir="rtl">`, system fonts, for a ROOT-LAYOUT throw, which skips
   `app/error.tsx` entirely).
   **Read this before touching any `getUser` call:** the obvious fix, `if (error) throw`,
   is WRONG and was caught by measurement before it shipped. auth-js resolves
   `AuthSessionMissingError` for an ordinary signed-out request, so that guard would have
   shown the error card to every logged-out visitor, answered 503 to every unauthenticated
   API call, and logged once per anonymous pageview in the middleware. The measured table is
   [[getuser-resolves-an-error-when-signed-out]]; the predicate that came out of it is
   `authReadFailed` (`apps/web/src/lib/auth-user.ts`, twinned in
   `apps/admin/src/lib/admin.ts`), which throws only on `AuthRetryableFetchError` and
   `AuthUnknownError`.
   The nine `/home` pages and `home/layout.tsx` throw through `authedUser`; both
   middlewares log and do not throw (no boundary above middleware — a throw is a 500 on every
   matched route); the three API sites answer **503** instead of 401/403.
   `redirect()` was re-verified under the new root boundary — still 307, and `notFound()`
   still 404. apps/web is at **328 tests** (was 298), with a convention guard that reddens on
   a new `/home` page carrying the old shape; 18 mutations, 0 survivors. Also fixed in
   passing: apps/web had no vitest config, so `@/` did not resolve in tests.
   Two sites left alone on purpose, both browser clients:
   `components/onboarding/onboarding-flow.tsx:108` (fail-safe) and
   `apps/admin/src/app/login/login-form.tsx:36` (founder-only — but it tells the founder
   "wrong credentials" when the truth is that we could not check).
   [[auth-getuser-errors-read-as-signed-out]]. Two new notes came out of it:
   [[apps-admin-has-no-error-boundary]] (deliberately not fixed — it is why `adminSession`
   still swallows) and [[a-failed-getsession-reads-as-an-expired-reset-link]] (the same shape
   on `/reset-password`, unfixed).
   **Everything above was measured on `next dev` only.** Production masking, digests and
   `global-error`'s appearance without the dev overlay were not exercised.
5. **`/login` wipes a draft the server threw away.** `login-form.tsx:45` calls `clearDraft()`
   on any 200, but `/api/onboarding/complete` is idempotent by **owner, not content**: an
   existing owner who fills the public wizard for a second product gets their old business
   back and their new answers deleted, silently and unrecoverably.
   [[login-clears-a-draft-the-server-never-stored]].
6. **Check the DRY_RUN contamination window.** The desktop worker (DRY_RUN=1) may have
   run briefly alongside the box around 2026-08-27. Any job it claimed reported SUCCESS
   while writing placeholder files. One query settles it:
   `select id, type, status, locked_by, finished_at from jobs where locked_by like
'local:%' order by finished_at desc;` — anything dated after the box went live is
   stub output wearing a success status. An open check, not a known problem.
7. **Sentry DSN on the worker.** ~~Moved out of "someday"~~ — **code landed 2026-09-10, and
   what is left is one env line.** `@sentry/node` is in `apps/worker` (only there), reporting
   a job written `dead` with its `jobs.last_error` and the fatal crash path, the crash event
   flushed before `exit(1)` ([[0037-the-worker-reports-to-sentry-the-web-apps-do-not]],
   [[worker-sentry-reporting]]). It is **off until a DSN exists**: create a Sentry project,
   put `SENTRY_DSN=…` in `~/AIUGCBackend/apps/worker/.env` on the box, and
   `sudo systemctl restart aiugc-worker`; confirm with
   `journalctl -u aiugc-worker -o cat | grep "error reporting"` → `error reporting on`.
   Until that line exists nothing changes: renders went dead 5/5 on 08-28, 09-01 and again on
   09-02, and every one surfaced only because the founder happened to be running a wizard
   test. Vercel logs still show nothing (all render work is on the box); the cause still lives
   in `jobs.last_error`, readable with `packages/core/.work/diag-failed-render.ts` (gitignored,
   session pooler, read-only) and box logs with `journalctl -u aiugc-worker -o cat`.
   Not covered: the lease sweep's deaths, and any external kill.
8. **Grant `aiugc` full journal visibility on the box.** `journalctl` as that user currently
   prints "You are currently not seeing messages from other users and the system" — the worker's
   own stdout is visible (the count in [[0016-worker-stays-on-transaction-pooler-6543]] is valid),
   but systemd's unit lifecycle lines (restarts, OOM kills) are not.
   `sudo usermod -aG systemd-journal aiugc` fixes it (takes effect on next login). Not yet run.
9. **Take one Hetzner snapshot.** Unblocked: `af158cb` is deployed, three renders are
   verified, and the bundle is confirmed outside `/tmp`. This is the known-good image —
   capture it before the box drifts. One-off, not the +20%/month backup plan. One-off, not the
   +20%/month backup plan.
10. **Correct `docs/02-jobs.md:111`.** Two wrong numbers on one line. "Hetzner
    CPX41-class, ~€30/mo flat" predates the June 2026 price rise and understates by
    roughly half (verified 2026-09-01); "~2–6 min wall time per video" is 2–5× too slow
    against three measured renders (verified 2026-09-02,
    [[service-a-render-wall-clock-on-the-box]]). Other sizing was derived from both.
11. **The lint gate is red on the Windows desktop and proves nothing there.**
    `core.autocrlf=true` rewrites the whole tree to CRLF on checkout while prettier defaults to
    `endOfLine: lf`, so `pnpm lint` reports **709 files** on a clean `main` — re-measured
    2026-09-09 (`npx prettier --check .`); it was ~648 on 2026-09-03, and the number only tracks
    how many files exist. **Any task whose stop condition is "lint green" cannot be met here.** Fix with a `.gitattributes` carrying
    `* text=auto eol=lf` (the stored blobs are already LF, so there is no renormalize diff to
    review) or with `endOfLine: "auto"` in `.prettierrc`. Until then `pnpm lint` is not a
    signal on this machine; check a file by running prettier against its LF content.
12. **Docs-only cleanup: the pre-publication OAuth passages.** Found 2026-09-03 and
    deliberately left alone — none of it is load-bearing, all of it misleads a reader:
    - `docs/08` §8B `:495` "Testing mode needs no domain, no privacy policy and no terms",
      `:501` the mode table labelled `**Testing** (today)` on the wrong column, `:514` "up to
      99 other addresses", `:547` "App domain / privacy policy / terms: leave blank for now",
      `:608` step 6 (test-user list, 7-day expiry), `:672` the heading "What still has to be
      written" over a table whose every row now reads Exists or Verified.
    - `docs/08` §8A.1 `:424` asserts `signUp` has **no** `emailRedirectTo` — false
      (`auth.ts:78`) — and `:438` "Code change needed | ... One line (`emailRedirectTo`)"
      contradicts the defect note that records the fix commit `02f58bb`.
    - `0006` `:34` still says `access_denied` is "which this app does not read" (false since
      `5646529`), `:52` and `:54` describe the pre-publish world in the present tense.
      `0005` `:14`, `:30` likewise, including "Google's verification queue", which `0006`
      itself falsified.
    - Drifted line cites: `docs/08:378`, `:424`, `:429` (`auth.ts:42`/`:46`/`:56`), `:476`
      and `0006:44` (`auth.ts:71-74`), `docs/08:600` (`auth.ts:73`), `0005:41`
      (`auth.ts:69-85`), `0005:48` (`auth.ts:78`).

**Items 13–16 are the Service B revamp**, built to
[[0017-service-b-single-setting-selfie-talking-head]]. The planned order was 13 → 14 →
15 → 16; it went 13 → 14 → 16; 15 (admin registration for the opener bank) died with the bank on 2026-09-06 ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]). 0023's list — the animation-effects step, the caption handoff rule, the effect render param — was built on 2026-09-06 ([[0024-hook-effect-is-a-render-param-the-customer-picks]]). They
sit **after** everything above, including the cheap docs-only item 12, because Service B
is explicitly parked until Service A is finished and none of this is on the validation
sequence (pipeline → outreach samples → self-serve app).

13. ~~**Schema 0032 for the selfie format.**~~ — **done**: 0032 (`selfie` kind,
    `opener_clips`) and 0033 (its RLS) are in the tree and applied on live (see the
    Supabase paragraph above and item 14). The original brief, kept for the record: a
    `selfie` value
    for `persona_images.kind` (today `'preview' | 'background'`,
    `packages/core/src/db/schema.ts:286` — and **not only a migration**: the two literals
    are enforced at `apps/admin/src/lib/admin.ts:65` and used to filter at
    `apps/web/src/lib/service-b.ts:61,68-69`), and the opener-clip bank — one row per
    (selfie image × effect) carrying the play-ready file path, `reveal_at_ms` and a text
    safe area. Read [[0013-hook-clips-near-9-16-not-exact-1080x1920]] first: the Service A
    bank's registration constraints are the precedent, and its `text_safe_area`-required-at-
    register rule is the one to copy. Reversibility gate applies — the new project is
    production now.
14. ~~**The engine: core + Remotion + CLI.**~~ — **built 2026-09-05**, one commit per step
    (`2d446e6` b_script v9 + hook_text, `cccd5f8` lead-in, `9635c7d` render params +
    selfie guard, `cf4a3ad` timeline + composition, `3996446` CLI, `c925898` docs; then `0d7a19e` prettier over the new
    lines and `b6c652a` the six-lens review's fixes).
    `b_script` parses with its own `bScriptOutput`; `scriptOutput` stays shared with
    `vo_script` untouched. The FINAL hook text is copied into `video_renders.params` at
    enqueue. Verified: core suite + `render:sample:b-opener` rendered for real and its
    frames checked by eye (hold, cut, caption onset). **Not verified**: any CLI command
    against the live DB. 0032 and 0033 **are applied** there — the founder ran them in the
    dashboard on 2026-09-05, the ledger reads 24 true + 0020 NULL on the structural layer,
    and `supabase migration repair --status applied 0032 0033` was run — so
    `bank add-opener` ran against live on 2026-09-05 (opener f8f7b2cc…, rendered by the wizard as video_renders 1397ffcd…); both commands are **retired 2026-09-06** with the opener bank ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]).
15. ~~**Admin registration for the opener bank**~~ — **retired 2026-09-06** with the opener bank ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]). Animation effects are code in `packages/remotion` (`hookZoom` first, 'none' an option), not a bank — nothing to register. `persona add-image --kind selfie` stays the way a selfie reaches a persona; `aiugc bank add-opener` is retired.
    The founder-facing side: upload a play-ready clip against a (selfie image × effect)
    pair, set `reveal_at_ms`, place the text safe area. Check
    [[admin-hook-upload-persona-footgun]] before reusing the Service A upload path — it
    has a known footgun that this would inherit. Until it lands, `aiugc bank add-opener`
    (and `persona add-image --kind selfie`) is the only way a clip reaches the bank, and
    the wizard's effect step lists exactly what that registered.
16. ~~**The B wizard.**~~ — **built 2026-09-05** on branch `service-b-wizard` (pushed and merged): `persona → pointers → script → audio → opener effect → render`, one flow
    for every business. Commits, in order: `e4cb08e` this file's 0032 correction;
    `de49627` the six steps, the pointers step, hook text on the script and edit
    responses; `44f4af5` `personaSelfie`, `personaThumbnail(service)`,
    `loadPersonaCatalog(service)`, `?withSelfie=1`, and the `/home` preload (B's card set
    only — both wizards are one click away); `10da873` the effect step and
    `GET /api/personas/[personaId]/openers`; `f6333c9` the render body (`personaImageId`
    required, `compositeId` gone) and the route's selfie and opener checks; `8e37d2c`
    tests; `3832a0b` the removal; `6754f35` prettier. Verified: web typecheck and the 8
    web test files (249 tests); the new routes compile on the dev server (401 JSON
    unauthenticated). **Verified 2026-09-05**: the wizard rendered a real opener end to end (video_renders 1397ffcd…, opener f8f7b2cc… via `bank add-opener`), and further paid HeyGen draws followed on 2026-09-06 ([[heygen-motion-prompt-two-draws]]). The opener step it exercised is retired the same day ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]). (item 15, or `bank add-opener`).
    **Deleted surfaces** (delete, don't guard — the a-sets precedent): `StepImage`,
    `StepComposite`, `POST /api/businesses/[businessId]/composites`,
    `GET|approve|regenerate /api/composites/[id]`, `GET /api/personas/[personaId]/images`,
    `requireComposite`, `canUseComposites` / `photoError` / `PHOTO_EXTENSIONS` /
    `MAX_PHOTO_BYTES` / `backgroundImages`, `PersonaImage` / `CompositeState` /
    `clientPhotoError`, and the two composite lines in `api-errors.ts`, with their tests.
    **Resurrection pointer: `8e37d2c`** is the last commit that carries all of them.
    `packages/core`'s composites pipeline and schema are untouched (a physical-product
    service is parked as its own thing — 0017). One behaviour change outside B:
    `GET /api/personas` without a flag now returns the A catalog (hook-matrix personas),
    not the whole catalog — nothing called it bare.

## Open decisions

- **Service-role key in `apps/web`.** Root `.env.example` (line 9) says "never the
  service role key" for `apps/web/.env.local` — but the wizard signs storage URLs
  server-side (analysis thumbs, twelve per page), and the dev machine's
  `apps/web/.env.local` **does** contain `SUPABASE_SERVICE_ROLE_KEY` (variable names
  checked 2026-09-01, values not read). The comment is stale against how web actually
  runs. Open: whether the Vercel web env has the key — if any smoke-tested page
  rendered signed thumbnails, it must. Check against `apps/web/.env.local` before
  touching anything; do not fix the `.env.example` comment blind.
- **Content policy.** Nothing reviews customer copy before an MP4 exists —
  `defects/content-policy-classifier-never-runs.md`. Acceptable while the founder is
  the only user. Strangers can reach the app now that Google sign-in is published, so
  this no longer waits on a queue item.
- **`daily_caps` for stranger traffic.** An `app_config` UPDATE, not a deploy.
- **Invoice document type before billing ships.** The billing plan issues חשבונית מס;
  the operator is עוסק פטור and cannot —
  [[invoicing-plan-cannot-issue-for-an-osek-patur]]. Either ship billing as
  עוסק פטור (קבלה / חשבונית עסקה) or convert first. No money moves today, so nothing is
  currently wrong; it is a configuration decision the gateway work must not skip.
- **The reg. 2 מסמך הגדרות מאגר.** Privacy §11 now claims compliance with the 2017 Data
  Security Regulations; the document those regulations require has never been written —
  [[database-definitions-document-missing]]. A collation job, not an
  investigation: everything it must describe is already in the privacy policy.
- **The `users`/`auth.users` casing gap.** `ensureUser` is guarded; confirm the casing
  fix closed the silent variant for every writer, not just the CLI.
- **Service B ships unreviewed, by decision.** `auto_release_b` is `true` and stays true —
  founder's final call, [[0036-auto-release-b-is-always-on]] — so every Service B render skips
  `qc_pending` and reaches the customer unreviewed. The flag is settled; what is **not** settled
  is whether anything else should stand in that space at self-serve scale. A founder eyeball pass
  on one render is not evidence for that, and it happens after release, not before. See
  [[content-policy-classifier-never-runs]], which is the other thing not standing there.

## Service B

Still parked until Service A is finished — but the revamp now has a **shape**, decided
2026-09-03/04: [[0017-service-b-single-setting-selfie-talking-head]]. Read that note before
touching anything Service B; it settles the format (flow, one background per persona, where the final hook text lives, HeyGen stays); its opener-clip half is retired 2026-09-06 — read [[0023-hook-is-a-remotion-animation-opener-clips-retired]] with it: the hook is a Remotion animation over the one HeyGen clip. and lists what it deliberately
does **not** settle. The one measurement it rests on is
[[heygen-avatar-iv-idles-on-leading-silence]].

The engine is built to it as of 2026-09-05 (queue item 14), and so is the web wizard (item
16, branch `service-b-wizard`, merged to `main` via PR #21, `704ad25`, 2026-09-06; two
further direct merges from the same branch, `f176066` and `b6df318`, landed the same day).
`main` is pushed — `git log main..origin/main` / `origin/main..main` are both empty. The
wizard never resolves a default: the B catalog
lists only personas with a usable selfie, the card shows that selfie, its id travels with
the render, and `POST /renders` refuses an image that is not that persona's live
`kind='selfie'` row — so core's selfie guard (which covers only a resolved default) is never
the thing standing between a customer and a standing head. **The wizard rendered its first real
opener on 2026-09-05** (video_renders 1397ffcd…, opener f8f7b2cc…, registered through
`bank add-opener`). The founder rejected the result on four counts — the 2.4s frozen hold, the
dissolve + punch-in, a colour step at the cut, a dead-still camera — and the same day the
dissolve and punch-in were deleted, the HeyGen colour tag corrected
([[heygen-output-is-limited-range]]), a measured colour grade and a handheld camera path
added ([[handheld-sway-constants]]), and the opener's own faults recorded
([[opener-bank-clip-dup-frames-and-tight-trim]]). The hold was then killed on the founder's
verdict ([[0019-hook-text-outlives-the-reveal]]); the constants note keeps the measurements
([[service-b-timeline-constants]], first-render section). On 2026-09-06 a per-channel colour-grade
curve and a pixel alignment were added, and a 4-frame soft cut plus a 1.5s alignment ease were
tried and zeroed the same day on the founder's verdict
([[0021-nothing-moves-at-the-service-b-seam]], [[service-b-seam-constants]]). **The seam is gone, not fixed**: on 2026-09-06 the founder retired the opener clip entirely — a Service B ad is one HeyGen clip with a Remotion animation hook (zoom hook first, `hookZoom` in `packages/remotion`, whoosh allowed) — [[0023-hook-is-a-remotion-animation-opener-clips-retired]]. The effects step, the caption handoff and the `hookEffect` param landed 2026-09-06 ([[0024-hook-effect-is-a-render-param-the-customer-picks]]): three animations plus "none". Open: deleting the opener-clip code, and a real recorded SFX to replace the two synthesized placeholders in `assets/sfx/`.

All of the seam work — grade curve, alignment, soft cut — is **retired 2026-09-06** with the opener; the code stays in the tree and the measurements stay true ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]). The limited-range tag and the handheld sway carry over to the single-clip product.

**Founder eyeball verdict, 2026-09-09 (not a measurement):** the founder ran Service B end
to end through the merged wizard and judged the resulting ad good by eye. The report did not
say which persona, hook effect, or business it used, whether the take was a fresh paid HeyGen
draw or a reused one, or whether the render reached a customer-visible release versus sitting
in `qc_pending` — those specifics are unconfirmed. Checked independently this session:
`app_config.auto_release_b = true` (unchanged since 2026-08-26, and settled permanently on
2026-09-09 — [[0036-auto-release-b-is-always-on]]) and `events` holds 0
`qc_release`/`qc_reject` rows, so every Service B render skips the QC queue and
releases straight through — the founder's pass neither exercised nor changed that, and by
decision nothing ever will.

`lipsync_resolution` is the **only** remaining placeholder. `lipsync_motion_prompt` and the
new `lipsync_expressiveness` are founder-chosen since 2026-09-06 (migration 0034,
[[0022-heygen-expressiveness-medium-generic-motion-prompt]]), and `auto_release_b` is settled ON
as of 2026-09-09 — [[0036-auto-release-b-is-always-on]], seeded by
`0031_seed_unseeded_config.sql:75-77` and read at `pipelines/renders.ts:491-493`, the only
consumer. 0017 settles the format, not the engine, so
[[0004-service-b-config-is-provisional]]'s instruction carries forward for `lipsync_resolution`.
`poll_deadline_seconds` and `words_per_second` are the live Service A keys that matter.

## Unfinished measurement

Neither blocks anything; both get more expensive to recover later.

- ~~The wizard render's duration~~ — **taken 2026-09-02**, three live renders, mean 66.1s:
  [[service-a-render-wall-clock-on-the-box]]. It shows `docs/02-jobs.md:111`'s "~2–6 min
  per video" to be 2–5× too slow, so that line and its stale box price are now one fix
  (queue item 10).
- **No cold render has been measured on the box** — one including the ~92 MB Chrome
  Headless Shell download. Matters only if the box is rebuilt from scratch rather than
  from the queue-item-9 snapshot.

## Corrections worth not repeating

Recorded because each cost real time, and each came from asserting rather than checking.

- **"The Date-param bug never appeared locally because the local worker claims jobs
  near-instantly" — plausible, not established.** The desktop worker was only briefly up
  around 2026-08-27 and no local wizard run has been deliberately tested since; the
  explanation holds at most for that narrow window. The defect note
  ([[raw-sql-date-params-crash-postgres-js]]) was corrected 2026-09-01 to say so. Do
  not state it as fact, and do not invent an alternative.
- **"Add `tavnit.ai` as an authorized origin in Google Console" — wrong field, wrong
  time.** This file's own previous queue said it. `docs/08` §8B step 3 is explicit that
  _Authorized JavaScript origins_ stays **empty** (server-side code flow); the field
  that needs `tavnit.ai` is _Authorized **domains**_, at step 7, at publish, alongside
  the privacy and terms URLs. Pasting into origins is a box that does nothing.
- **An acceptance gate passed against code that existed nowhere but that box.**
  `docs/07-worker-box.md` §12 step 3 was first cleared with an uncommitted `sed` edit.
  When a gate passes, confirm the tree is clean before believing the result.
- **A number reported without its conditions gets attached to the wrong ones.** The 45s
  render figure was assumed to come from concurrency 2; it was 4. Record the conditions
  in the same breath as the number.
- **A constant tuned on the founder's hardware silently became a system requirement.**
  `RENDER_CONCURRENCY = 6` — see [[render-concurrency-hardcoded-above-core-count]].
- **A mitigation became an outage.** The §9 cron written to contain the temp-dir leak
  deleted the live worker's bundle and killed every render for four days —
  [[tmp-cron-deletes-live-worker-bundle]]. Never point a janitor at a directory a
  long-lived process serves from.
- The worker box was assumed to exist because `docs/00-overview.md` describes one. Docs
  describing a plan read identically to docs describing reality.
- `words_per_second`: old project 2.1 (calibration output), migration seed 2.2 (a
  guess). 2.1 is correct.
- There are **35** migration files, 0000–0034. 0000–0033 are applied on live (0032/0033 from the dashboard on 2026-09-05, ledger repaired); 0034 (`lipsync_expressiveness`, [[0022-heygen-expressiveness-medium-generic-motion-prompt]]) landed 2026-09-06 — record whether it has been pushed.: 0032 (`opener_clips`) and
  0033 (its RLS) went in from the dashboard on 2026-09-05 and the ledger was repaired to
  match. This file said "still at 0031 / unapplied" in three places until then — the
  vault-correction commit `e4cb08e` fixed item 14, and the step-7 docs commit the other two.
- `scripts/verify-migration-ledger.sql` cannot fully pass on a fresh database — two
  checks assert old-project row IDs. Structural layer: 24 true and one NULL for 0020;
  the NULL is correct. (It was 22 before the 0032/0033 rows were added.)
- `/start` proves nothing about auth — it redirects unconditionally and discards
  `exchangeCodeForSession`'s result. `/home` is the only real gate.
- A credential was echoed in session output three times. The CLAUDE.md rule now covers
  it: verify by connecting, report the outcome, never the value.
- The a-sets route "is deployed" was wrong — at the time nothing was deployed at all.
  (Both routes deleted 2026-08-31; git keeps them.)
- 269f2ce removed the CALLERS from `step-render.tsx`, not the route files. Right in
  substance, wrong in mechanism.
- "Billing is unwired, so account caps are the only bound" was backwards — the credit
  balance is the bound and it is _tighter_ because billing is unwired. See
  [[no-self-serve-credit-grant-path]].

---

## How to hand over

This file is overwritten in place, never duplicated. `git log --follow` on it is the
history. **If this file and the repo disagree, the repo wins** — treat anything here as
a pointer, not a source of truth.

### Closing a session — paste into the chat that's ending

```
Update docs/vault/state-of-play.md for handover. Rewrite the existing file in place —
don't produce a new version, git history is the versioning.

Cover:
- What actually changed this session: what's done, what's committed, what's still sitting
  in the working tree uncommitted.
- Decisions made in conversation that never reached the repo. This is the main thing a
  new session cannot recover on its own — name each one, and say where it should
  eventually live in the vault.
- Corrections: anything either of us asserted that turned out to be wrong. Keep these.
  They're the cheapest lines in the file and they stop the same mistake twice.
- The queue, reordered if this session changed the order, with reasoning wherever the
  order isn't self-evident.
- External state that changed — dashboards, providers, billing, anything not in git.

Be explicit about what is verified versus assumed. If something in the current file was
true when written and you can't confirm it still holds, mark it rather than repeating it.

Prune as you go. Delete anything now finished, and anything that has graduated into a
proper vault note — tell me which ones graduated so I can confirm they landed. This file
must not grow session over session.

Separately, outside the file: what should I hand to Claude Code before I close this chat,
and is anything still uncommitted or unpushed?
```

### Opening the next session — paste as the first message

```
Read docs/vault/state-of-play.md. It's the handover from my last session — the queue,
external state, and the decisions that never made it into the repo.

I'm working on: [what you're doing]

Search the vault before answering, and tell me if anything in the state file looks out of
date relative to the repo — project knowledge syncs on a delay, so the tree you can see
may be ahead of it.
```
