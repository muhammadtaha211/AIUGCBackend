---
type: state
status: current
updated: 2026-09-01
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

**The product has a front door.** `apps/web` is deployed to Vercel and survived a founder
smoke test on every path tried — except hook-line generation, which ENOENT'd on the
prompts directory. That bug is root-caused and fixed in `4f85ae9` (committed by the
founder 2026-09-01, pushed; working tree clean): computed-path file reads are invisible
to Vercel's tracer, so `prompts/` was never packaged. The fix is config-only —
`outputFileTracingRoot` + `outputFileTracingIncludes` in `apps/web/next.config.ts`;
`packages/core/src/paths.ts` untouched. Full story, route audit, and residual hazards:
[[computed-path-reads-are-invisible-to-vercel-tracing]]. **The fix is proven against
Windows build traces only. Vercel builds on Linux, so the deployed hook-lines route is
the outstanding proof — queue item 1.**

`apps/admin` is also deployed and publicly reachable on its vercel.app URL, gated only
by `requireAdmin` (the basic-auth second wall is believed unset — queue item 3).

`tavnit.ai` **is owned** — the earlier ambiguity is settled. Whether it is attached in
Vercel and DNS-pointed is unconfirmed; the domain may or may not resolve.

The worker box is live and has processed a real customer render end to end
(`hetzner:heavy`, quality confirmed by eye). The pipeline does not depend on the
founder's desktop being awake.

Also in `4f85ae9`: unmapped route errors now log `"api route failed"` — the old
`"service B route failed"` label fired for Service A routes too (it's the shared
`coreErrorResponse`).

## External state — not in the repo

**Supabase.** Project `hyaqydcmwbnbaiqqufow`, `eu-central-1` (Frankfurt), Pro plan, Micro
compute. Migrations 0000–0031 applied, ledger clean. Auth: Email provider on, "Confirm
email" OFF, Google enabled. **Site URL is now `https://tavnit.ai`** and
`https://tavnit.ai/auth/callback` was added to the redirect allowlist; the localhost
entry was kept (verified by founder 2026-09-01). The old project is deleted — org back
to $25/month.

**Vercel.** An `apps/web` project exists off this monorepo: Root Directory `apps/web`,
Next.js preset, no build/output/install overrides (defaults are correct — core ships as
TS source via `transpilePackages`), function region `fra1`, `ANTHROPIC_API_KEY` added.
First deploy succeeded to its `*.vercel.app` URL (all verified by founder 2026-09-01).
Still useful: `NEXT_PUBLIC_*` variables must be type Config, not Secret — Vercel blocks
Secret on public-prefixed names. **Unverified:** whether `SUPABASE_SERVICE_ROLE_KEY` is
in the web project's env (see open decisions), and whether the pre-existing admin
project has `fra1` set.

**Hetzner.** One server `tavnit-worker`, CPX32 (4 shared AMD vCPU, 8 GB, 160 GB NVMe),
Nuremberg, Ubuntu 24.04. ~$41/month plus ~$0.72 for the primary IPv4, which bills
whether or not attached. Reasoning and rescale rules: [[0007-worker-box-instance]]. **A
powered-off server still bills in full — only deletion stops the meter.**

**The box itself.** `aiugc-worker.service` enabled, `Restart=always`,
`WORKER_ID=hetzner`. `ufw` active, OpenSSH only. SSH is key-only from the founder's
Windows desktop and no second key pair exists — losing that key means a console root
reset. Logs: `journalctl -u aiugc-worker -o cat`. Deploys: `docs/07-worker-box.md` §11.
The §9 cron for the remotion temp-dir leak is installed.

**GitHub.** A fine-grained PAT with **no expiration**, scoped to `AIUGCBackend`,
Contents: read-only, plaintext in `~/.git-credentials` on the box. Nothing will ever
remind anyone it exists; revocable only at GitHub (Settings → Developer settings →
Fine-grained tokens). Deploy-key alternative rejected: [[0008-github-pat-over-deploy-key]].

**The desktop worker must stay stopped.** Both workers can safely claim from one queue
(`SKIP LOCKED`), but the desktop's `.env` carries `DRY_RUN=1` and the box's deliberately
does not. A desktop worker claiming a real customer job reports success and writes
placeholder files. Start it only deliberately.

**Google OAuth is in Testing mode.** Works for test-list accounts only. Scopes
`openid`/`email`/`profile` — all non-sensitive, so publishing is a form, not a review.
Publishing requires `tavnit.ai` live plus `/privacy` and `/terms` routes, which do not
exist. Do NOT upload a custom app logo: it triggers Google's brand review even with
non-sensitive scopes.

## Decisions made in conversation — not yet in the repo

A new session cannot recover these from the tree. Each names where it should live.

1. **`GOOGLE_SIGN_IN_ENABLED` stays `true`.** The planned flip to `false` for the
   public-domain window is cancelled. Founder's reasoning: the site will not be
   advertised at all until Google sign-in works properly. The consequence matters more
   than the switch — **queue item 2 is now a hard gate on ANY traffic, not just Google
   users.** The constant is already `true` in `apps/web/src/lib/auth.ts:25`, so no code
   change — the decision is that it does not move. Should live: `decisions/`, as an
   amendment to [[0006-google-oauth-is-in-scope-for-launch]] (or a new numbered note).
   When written, it must also reconcile `docs/08-supabase-project-rebuild.md` §8B
   (~line 685), which still advises keeping the flag `false` for any public window —
   that recommendation is now overridden.
2. **Where `apps/admin` lives — proposed `admin.tavnit.ai`, never decided.** Admin is
   deployed and publicly reachable on its vercel.app URL today. Should live:
   `decisions/` when settled.

## The queue

1. **Prove the tracing fix on the deployed route, then finish the domain.** Redeploy
   `apps/web` (picks up `4f85ae9`) and hit hook-line generation on the deployment — the
   fix is verified against Windows build traces only, and Vercel builds on Linux. Then
   confirm `tavnit.ai` is actually attached in Vercel and DNS pointed (instructions were
   given 2026-09-01; completion unconfirmed). In Google Console, touch **nothing** yet —
   see the newest correction below: origins stay empty; the domain goes under
   *Authorized domains* at publish (queue item 2).
2. **Write `/privacy` and `/terms`, then publish the Google OAuth app** — adding
   `tavnit.ai` under **Authorized domains** (docs/08 §8B step 7). Hard gate on ANY
   traffic per decision 1. Until publishing status reads *In production*, any address
   not on the test-user list is refused at the account chooser with
   `error=access_denied`, which this app does not read: the user lands on `/start` with
   no session and no message.
3. **Second wall on admin.** Set `ADMIN_BASIC_USER`/`ADMIN_BASIC_PASS` on the admin
   Vercel project (`apps/admin/src/middleware.ts` supports it; `.env.example` calls it
   production-recommended; believed unset) and verify `fra1` there while in the
   dashboard. Cheap, and admin is publicly reachable today behind `requireAdmin` alone.
4. **2026-09-03 — count the drops.** `journalctl -u aiugc-worker -o cat | grep -c
   '"claim failed'`. That number decides whether `DATABASE_URL` moves off port 6543.
   Clock started 2026-08-27; fires on its date regardless of queue position. Do not
   change the port before then.
5. **Take one Hetzner snapshot.** §12 has passed against committed code; capture a
   known-good image before the box drifts. One-off, not the +20%/month backup plan.
6. **Correct `docs/02-jobs.md:111`.** "Hetzner CPX41-class, ~€30/mo flat" predates the
   June 2026 price rise and understates by roughly half. Verified still wrong
   2026-09-01. One line, but other sizing was derived from it.

## Open decisions

- **Service-role key in `apps/web`.** Root `.env.example` (line 9) says to copy the
  public keys plus `DATABASE_URL` into `apps/web/.env.local` and "never the service role
  key" — but the wizard signs storage URLs server-side (analysis thumbs, twelve per
  page), and the dev machine's `apps/web/.env.local` **does** contain
  `SUPABASE_SERVICE_ROLE_KEY` (variable names checked 2026-09-01, values not read). The
  comment is stale against how web actually runs locally. Open: whether the Vercel web
  env has the key — if any smoke-tested page rendered signed thumbnails, it must. Do
  not fix the `.env.example` comment until it's decided which way is intended.
- **`DATABASE_URL` port 6543.** Deliberately undecided in `docs/07-worker-box.md`;
  queue item 4 produces the number that settles it.
- **Content policy.** Nothing reviews customer copy before an MP4 exists —
  `defects/content-policy-classifier-never-runs.md`. Acceptable while the founder is the
  only user; needed before strangers, i.e. before queue item 2 lands.
- **`daily_caps` for stranger traffic.** An `app_config` UPDATE, not a deploy.
- **Sentry DSN.** Wired in the worker, unset. `status='dead'` is the alert condition,
  and the worker runs on a machine nobody is looking at.
- **The `users`/`auth.users` casing gap.** `ensureUser` is guarded; confirm the casing
  fix closed the silent variant for every writer, not just the CLI.
- **The remotion temp-dir leak has a manual cron on two machines.** A workaround on two
  machines is becoming the design. Fix in code or accept explicitly —
  `defects/remotion-temp-dirs-are-never-cleaned-up.md`.

## Service B

Getting a full revamp after Service A is finished. `lipsync_motion_prompt`,
`lipsync_resolution`, and `auto_release_b` are placeholders, not tuned values — do not
spend care on them. `poll_deadline_seconds` and `words_per_second` are the live Service A
keys that matter.

## Unfinished measurement

Neither blocks anything; both get more expensive to recover later.

- **The wizard render's duration was never captured.** Recoverable from that `jobs`
  row's `started_at`/`finished_at`. It is the only figure that speaks to
  `docs/02-jobs.md`'s 2–6 minute sizing; the 45s in [[box-render-timing]] is a 17s
  fixture and explicitly does not extrapolate.
- **No cold render has been measured on the box** — one including the ~92 MB Chrome
  Headless Shell download. Matters only if the box is rebuilt from scratch rather than
  from the queue-item-5 snapshot.

## Corrections worth not repeating

Recorded because each cost real time, and each came from asserting rather than checking.

- **"Add `tavnit.ai` as an authorized origin in Google Console" — wrong field, wrong
  time.** This file's own previous queue item 1 said it. `docs/08` §8B step 3 is
  explicit that *Authorized JavaScript origins* stays **empty** (server-side code flow);
  the field that needs `tavnit.ai` is *Authorized **domains***, at step 7, at publish,
  alongside the privacy and terms URLs. Pasting into origins is a box that does nothing.
- **An acceptance gate passed against code that existed nowhere but that box.**
  `docs/07-worker-box.md` §12 step 3 was first cleared with an uncommitted `sed` edit.
  When a gate passes, confirm the tree is clean before believing the result.
- **A number reported without its conditions gets attached to the wrong ones.** The 45s
  render figure was assumed to come from concurrency 2; it was 4. Record the conditions
  in the same breath as the number.
- **A constant tuned on the founder's hardware silently became a system requirement.**
  `RENDER_CONCURRENCY = 6` — see [[render-concurrency-hardcoded-above-core-count]].
- **`docs/07-worker-box.md` §5's `pnpm --version` check could not do what it claimed** —
  it preceded the clone, so no `packageManager` was in scope. Moved to §6.
- **§12 step 3's "expect a few minutes on a small instance" was wrong several times
  over.** Measured 45s. Corrected in the file.
- The worker box was assumed to exist because `docs/00-overview.md` describes one. Docs
  describing a plan read identically to docs describing reality.
- `words_per_second`: old project 2.1 (calibration output), migration seed 2.2 (a
  guess). 2.1 is correct.
- There are **31** migrations, 0000–0030, plus 0031. Not 29.
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
  balance is the bound and it is *tighter* because billing is unwired. See
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
