---
type: state
status: current
updated: 2026-09-04
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

`apps/admin` is also deployed and publicly reachable on its vercel.app URL, gated only
by `requireAdmin` (the basic-auth second wall is believed unset — queue item 2).

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
compute. Migrations 0000–0031 applied, ledger clean. Auth: Email provider on, "Confirm
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
around 2026-08-27 is an open check — queue item 6.)

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
   head, optional founder-made opener clip, no image or composite step, physical products
   out. **What is not in the repo is all of it**: nothing has been built to this note. The
   tree still holds the pre-revamp Service B. Queue items 13–16 are the build.
6. **HeyGen Avatar IV needs leading silence to start on a still frame** — recorded in
   [[heygen-avatar-iv-idles-on-leading-silence]]. Founder hand test, ~800ms, one persona,
   by eye. **Not in the repo**: no code prepends silence today, and the tolerance is
   unmeasured — 800ms was the only value tried. Re-measure before the opener ships.
7. **[[0004-service-b-config-is-provisional]] is superseded by 0017** — but only on the
   open-endedness. The three keys stay placeholders until the engine work lands and
   `auto_release_b` still may not be flipped by a session. The note is marked
   `status: superseded` and kept, not deleted.
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
2. **Second wall on admin.** Set `ADMIN_BASIC_USER`/`ADMIN_BASIC_PASS` on the admin
   Vercel project (`apps/admin/src/middleware.ts` supports it; `.env.example` calls it
   production-recommended; believed unset) and verify `fra1` there while in the
   dashboard. Cheap, and admin is publicly reachable today behind `requireAdmin` alone.
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
4. **A failed `businesses` query reads as "no businesses".** `middleware.ts:49` and
   `home/page.tsx:71` both drop the query's `error`, so a transient PostgREST failure makes a
   real owner look business-less. Since `03fc7f9` that lands them in the additional-business
   wizard, whose completion posts `allowCreate` and skips the idempotency guard — a filled-in
   questionnaire then creates a **second** business. Pre-existing class, new consequence.
   [[a-failed-businesses-query-reads-as-no-businesses]] records the two closures considered
   and deferred.
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
7. **Sentry DSN on the worker.** Moved out of "someday": renders went dead 5/5 on
   08-28, 09-01 and again on 09-02, and every one surfaced only because the founder
   happened to be running a wizard test. `status='dead'` is the alert condition, the DSN
   is wired and unset, and the worker runs on a machine nobody is looking at. The
   founder also had no route to the diagnosis — Vercel logs show nothing (all render
   work is on the box) and the real cause lives in `jobs.last_error`. Read it with
   `packages/core/.work/diag-failed-render.ts` (gitignored, session pooler, read-only);
   box logs are `journalctl -u aiugc-worker -o cat`.
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
    `endOfLine: lf`, so `pnpm lint` reports ~648 files on a clean `main` — measured 2026-09-03
    by running it on both `main` and a branch. Fix with a `.gitattributes` carrying
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
[[0017-service-b-single-setting-selfie-talking-head]] and in that order — each is the
input to the next. They sit **after** everything above, including the cheap docs-only
item 12, because Service B is explicitly parked until Service A is finished and none of
this is on the validation sequence (pipeline → outreach samples → self-serve app).

13. **Schema 0032 for the selfie format.** The migration 0017 implies: a `selfie` value
    for `persona_images.kind` (today `'preview' | 'background'`,
    `packages/core/src/db/schema.ts:286` — and **not only a migration**: the two literals
    are enforced at `apps/admin/src/lib/admin.ts:65` and used to filter at
    `apps/web/src/lib/service-b.ts:61,68-69`), and the opener-clip bank — one row per
    (selfie image × effect) carrying the play-ready file path, `reveal_at_ms` and a text
    safe area. Read [[0013-hook-clips-near-9-16-not-exact-1080x1920]] first: the Service A
    bank's registration constraints are the precedent, and its `text_safe_area`-required-at-
    register rule is the one to copy. Reversibility gate applies — the new project is
    production now.
14. **The engine: core + Remotion + CLI.** The `b_script` v9 that emits `hook_text`
    alongside `script` (the output contract is one field today —
    `packages/core/src/pipelines/copy.ts:264` — and that zod schema is **shared with
    `vo_script`**, passed to `callClaude` at both `:349` and `:447`, so `b_script` needs
    its own schema rather than a widened `scriptOutput`), re-derivation on script edit, the opener
    composition in `packages/remotion`, the hard cut at `reveal_at_ms`, and **the final
    hook text copied into render params** rather than pointed at — 0017 §"Why the final
    string is copied, not pointed at" is the reason, and it is the one part of this that
    is a correctness rule rather than a preference. Plus the CLI commands to drive it
    before any UI exists.
15. **Admin registration for the opener bank.** The founder-facing side: upload a
    play-ready clip against a (selfie image × effect) pair, set `reveal_at_ms`, place the
    text safe area. Check [[admin-hook-upload-persona-footgun]] before reusing the Service A
    upload path — it has a known footgun that this would inherit.
16. **The B wizard.** `persona → pointers → script → audio → opener effect → render`.
    Removes today's image and composite steps, adds the effect step with the customer-
    editable hook text. Largest of the four and the only one a customer sees, so it goes
    last.

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

## Service B

Still parked until Service A is finished — but the revamp now has a **shape**, decided
2026-09-03/04: [[0017-service-b-single-setting-selfie-talking-head]]. Read that note before
touching anything Service B; it settles the format (flow, one background per persona, the
opener clip, where the final hook text lives, HeyGen stays) and lists what it deliberately
does **not** settle. The one measurement it rests on is
[[heygen-avatar-iv-idles-on-leading-silence]].

Nothing in the engine has been built to it. What exists in the tree is the pre-revamp Service
B, including the image and composite steps 0017 removes.

`lipsync_motion_prompt`, `lipsync_resolution` and `auto_release_b` are **still placeholders**
— 0017 settles the format, not the engine, so
[[0004-service-b-config-is-provisional]]'s instruction carries forward unchanged and
`auto_release_b` still stays `true`. `poll_deadline_seconds` and `words_per_second` are the
live Service A keys that matter.

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
- There are **32** migrations, 0000–0031.
- `scripts/verify-migration-ledger.sql` cannot fully pass on a fresh database — two
  checks assert old-project row IDs. Structural layer: 22 true and one NULL for 0020;
  the NULL is correct.
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
