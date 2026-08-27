---
type: state
status: current
updated: 2026-08-27
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

The Supabase rebuild is complete, the old project is deleted, and **the worker box is
live**. It has processed a real customer render end to end through the wizard — demo
through to a finished MP4, claimed by `hetzner:heavy` with the desktop worker stopped,
quality confirmed by eye. `jobs.locked_by` now holds a value that is neither `local:*`
nor `cli:*` for the first time.

The pipeline no longer depends on the founder's desktop being awake. What it still
depends on is the founder, because **nothing is deployed**: `apps/web` and `apps/admin`
exist only on localhost and `tavnit.ai` does not resolve. The machine that does the work
is ready; the product has no front door.

## External state — not in the repo

**Supabase.** Project `hyaqydcmwbnbaiqqufow`, `eu-central-1` (Frankfurt), Pro plan, Micro
compute. Migrations 0000–0031 applied, ledger 32 rows, no gaps, no repair. Auth: Email
provider on, "Confirm email" OFF. Google enabled. Redirect allowlist includes
`http://localhost:3000/auth/callback`. **The old project is deleted** — org is back to
$25/month.

**Hetzner.** New account, one project, one server `tavnit-worker`. CPX32 (4 shared AMD
vCPU, 8 GB, 160 GB NVMe, 20 TB traffic), Nuremberg, Ubuntu 24.04. ~$41/month plus ~$0.72
for the primary IPv4, which bills whether or not it is attached to a server. Reasoning,
options rejected, and the rescale rules are in [[0007-worker-box-instance]]. **A
powered-off server still bills in full — only deletion stops the meter.**

**The box itself.** `aiugc-worker.service` enabled, `Restart=always`, `WORKER_ID=hetzner`.
`ufw` active, OpenSSH only. SSH is key-only from the founder's Windows desktop and no
second key pair exists, so losing that key means a console root reset. Logs:
`journalctl -u aiugc-worker -o cat`. Deploys are the whole of `docs/07-worker-box.md` §11
— `cd ~/AIUGCBackend && git pull && pnpm install && sudo systemctl restart aiugc-worker`.
The §9 cron for the remotion temp-dir leak is installed.

**GitHub.** A fine-grained PAT with **no expiration**, scoped to `AIUGCBackend`, Contents:
read-only, stored in plaintext at `~/.git-credentials` on the box. Nothing on the box will
ever remind anyone it exists; GitHub is the only place it can be revoked (Settings →
Developer settings → Fine-grained tokens). The deploy-key alternative was considered and
dropped — [[0008-github-pat-over-deploy-key]].

**The desktop worker must stay stopped.** Both workers can safely claim from the same
queue — `SKIP LOCKED` handles it — but the desktop's `.env` carries `DRY_RUN=1` and the
box's deliberately does not. A desktop worker claiming a real customer job reports success
and writes placeholder files. Start it only deliberately.

**Google OAuth is in Testing mode.** Works for accounts on the test-user list only. Scopes
are `openid`, `email`, `profile` — all non-sensitive, so publishing is a form, not a
review. Publishing requires `tavnit.ai` live plus `/privacy` and `/terms` routes, which do
not exist. Do NOT upload a custom app logo: it triggers Google's brand review even with
non-sensitive scopes.

**Vercel.** Env vars set. `NEXT_PUBLIC_*` variables must be type Config, not Secret —
Vercel blocks Secret on public-prefixed names, correctly, since they're inlined into the
browser bundle regardless of label. Function region still needs setting to `fra1`.

## The queue

1. **Deploy `apps/web` and `apps/admin` to Vercel, point `tavnit.ai`.** Add
   `https://tavnit.ai` to Supabase Site URL + redirects, and as an authorized origin in
   Google Console. Set the function region to `fra1` while in there. First because
   everything below either depends on it or is housekeeping.
2. **Write `/privacy` and `/terms`, then publish the Google OAuth app.** Depends on 1 —
   Google needs the live domain. Until publishing status reads *In production*, any
   address not on the test-user list is refused at the account chooser and returned with
   `error=access_denied`, which this app does not read: the user lands back on `/start`
   with no session and no message.
3. **2026-09-03 — count the drops.**
   `journalctl -u aiugc-worker -o cat | grep -c '"claim failed'`. That number, not the
   desktop's ~2/day, decides whether `DATABASE_URL` moves off port 6543.
   `docs/07-worker-box.md` deliberately leaves this open pending a week of datacenter
   uptime. The clock started 2026-08-27. Do not change the port before then.
4. **Take one Hetzner snapshot.** §12 has passed against committed code; capture a
   known-good image before the box drifts. One-off, not the +20%/month backup plan.
5. **Correct `docs/02-jobs.md`.** "Hetzner CPX41-class, ~€30/mo flat" predates Hetzner's
   15 June 2026 price rise and now understates by roughly half. Still wrong in the file as
   of this writing. One line, but other sizing was derived from it.
6. **Delete `docs/vault/state-of-play (1).md`.** A duplicate of this file, visible in
   `.obsidian/workspace.json`'s recent files. A second copy of the handover is the exact
   drift this vault exists to prevent.

## Open decisions

- **`DATABASE_URL` port 6543.** Deliberately undecided in `docs/07-worker-box.md`. Queue
  item 3 produces the number that settles it.
- **The orphaned `a-sets` route.** `POST /api/businesses/[businessId]/a-sets` is deployed,
  authenticated, has no caller since 269f2ce, and debits credits. Billing is unwired, so
  account caps are the only bound. Investigate before the domain is public — queue item 1
  makes that imminent.
- **Content policy.** Nothing reviews customer copy before an MP4 exists — see
  `defects/content-policy-classifier-never-runs.md`. Acceptable while the founder is the
  only user; a decision is needed before strangers, i.e. before queue item 2 lands.
- **`daily_caps` for stranger traffic.** An `app_config` UPDATE, not a deploy.
- **Sentry DSN.** Wired in the worker, unset. `status='dead'` is the alert condition. Now
  more valuable than it was: the worker runs on a machine nobody is looking at.
- **The `users`/`auth.users` casing gap.** `ensureUser` is guarded and the CLI can no
  longer invent identities, but confirm the casing fix closed the silent variant for every
  writer, not just the CLI.
- **The remotion temp-dir leak has a manual cron on two machines now.** That is the point
  at which a workaround stops being a stopgap and becomes the design. Fix in code or
  accept it explicitly — see `defects/remotion-temp-dirs-are-never-cleaned-up.md`.

## Service B

Getting a full revamp after Service A is finished. `lipsync_motion_prompt`,
`lipsync_resolution`, and `auto_release_b` are placeholders, not tuned values — do not
spend care on them. `poll_deadline_seconds` and `words_per_second` are the live Service A
keys that matter.

## Unfinished measurement

Neither blocks anything; both get more expensive to recover later.

- **The wizard render's duration was never captured.** Still recoverable from that `jobs`
  row's `started_at`/`finished_at`. It is the first real customer-path render on the box
  and the only figure that speaks to `docs/02-jobs.md`'s 2–6 minute sizing. The 45s in
  [[box-render-timing]] is a 17s fixture and explicitly does not extrapolate.
- **No cold render has been measured on the box** — one including the ~92 MB Chrome
  Headless Shell download and the ffmpeg fixture encode. Matters only if the box is ever
  rebuilt from scratch rather than from the snapshot in queue item 4.

## Corrections worth not repeating

Recorded because each cost real time, and each came from asserting rather than checking.

- **An acceptance gate passed against code that existed nowhere but that box.**
  `docs/07-worker-box.md` §12 step 3 was first cleared with an uncommitted `sed` edit to
  `RENDER_CONCURRENCY`. Caught only by running `git status` afterwards. When a gate
  passes, confirm the tree is clean before believing the result.
- **A number reported without its conditions gets attached to the wrong ones.** The 45s
  render figure was assumed to have come from concurrency 2, because that was the first
  value suggested; it was actually 4. It nearly went into a code comment and a vault fact
  note as measured. Record the conditions in the same breath as the number.
- **A constant tuned on the founder's hardware silently became a system requirement.**
  `RENDER_CONCURRENCY = 6` hardcoded "at least 6 cores" into every render path and every
  render test. It survived because no non-desktop machine had ever run a render. See
  [[render-concurrency-hardcoded-above-core-count]].
- **`docs/07-worker-box.md` §5's `pnpm --version` check could not do what it claimed.**
  §5 precedes the clone, so no `packageManager` field was in scope and corepack printed
  its own default — 11.24.0 observed, not the documented 9.15.9. The check has moved to
  §6, after `pnpm install`, where it can actually prove the pin.
- **§12 step 3's "expect a few minutes on a small instance" was wrong several times over.**
  Measured 45s. Corrected in the file.
- The worker box was assumed to exist because `docs/00-overview.md` describes one. It
  lists "(Railway/Fly/Hetzner)" — a choice written down and never closed. Docs describing
  a plan read identically to docs describing reality.
- `words_per_second`: old project 2.1 (calibration output), migration seed 2.2 (a guess,
  per `calibrate.ts:9`). 2.1 is correct.
- There are **31** migrations, 0000–0030, plus 0031. Not 29.
- `scripts/verify-migration-ledger.sql` cannot fully pass on a fresh database — two checks
  assert specific old-project row IDs. Structural layer: 22 true and one NULL for 0020.
  The NULL is correct, not a failure.
- `/start` proves nothing about auth. `route.ts:18` redirects there unconditionally and
  `:15` discards the result of `exchangeCodeForSession`. `/home` is the only real gate,
  because `middleware.ts:34-36` bounces it without a session.
- A credential was echoed in session output three times. The CLAUDE.md rule now covers it:
  verify by connecting, report the outcome, never the value.

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
