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

The Supabase rebuild is complete and the app works end to end locally. Auth, admin,
password recovery, and Storage are all verified against the new project. Nothing is
deployed. The worker still runs only on the founder's Windows desktop.

## External state — not in the repo

**Supabase.** Project `hyaqydcmwbnbaiqqufow`, `eu-central-1` (Frankfurt), Pro plan,
Micro compute. Migrations 0000–0031 applied, ledger 32 rows, no gaps, no repair. Auth:
Email provider on, "Confirm email" OFF. Google enabled. Redirect allowlist includes
`http://localhost:3000/auth/callback`.

**The old Supabase project still exists and still bills.** ~$10/month. It holds nothing —
no data, no Google credentials, no unmigrated config. Deletion checklist is at
`docs/08-supabase-project-rebuild.md` §10. Deleting it returns the org to $25/month.

**Google OAuth is in Testing mode.** Works for accounts on the test-user list only.
Scopes are `openid`, `email`, `profile` — all non-sensitive, so publishing is a form, not
a review. Publishing requires `tavnit.ai` live plus `/privacy` and `/terms` routes, which
do not exist. Do NOT upload a custom app logo: it triggers Google's brand review even with
non-sensitive scopes.

**Vercel.** Env vars set. `NEXT_PUBLIC_*` variables must be type Config, not Secret —
Vercel blocks Secret on public-prefixed names, correctly, since they're inlined into the
browser bundle regardless of label. Function region still needs setting to `fra1`.

**No worker box exists.** Never provisioned. `jobs.locked_by` has only ever held
`local:*` and `cli:*`.

## The queue

1. Delete the old Supabase project (§10). Back to $25/month.
2. Provision Hetzner — **Nuremberg or Falkenstein**, x86 not ARM, CPX31 to start.
   Region is load-bearing: ~5ms to `eu-central-1`, and Hetzner cannot move a server
   between regions.
3. Follow `docs/07-worker-box.md`. Two changes are pending and unwritten:
   - Replace the read-only PAT with a GitHub deploy key (PATs expire; the failure mode is
     `git pull` silently breaking months later on a forgotten box).
   - Extend §12 with a real `render_video` job through the heavy lane. The current
     acceptance test proves Remotion+ffmpeg+fonts and proves Postgres, but nothing proves
     the two together — no test exercises a Storage write from the box's new IP with
     freshly pasted credentials. That gap fails AFTER paying for a render.
4. Deploy `apps/web` and `apps/admin` to Vercel, point `tavnit.ai`.
   Add `https://tavnit.ai` to Supabase Site URL + redirects, and as an authorized origin
   in Google Console.
5. Write `/privacy` and `/terms`. Then publish the Google OAuth app.
6. Re-run the Storage smoke test **through the web app**, not the CLI — the original was
   purged, and a CLI-created business reintroduces the orphan `users` row.

## Open decisions

- **The orphaned `a-sets` route.** `POST /api/businesses/[businessId]/a-sets` is
  deployed, authenticated, has no caller since 269f2ce, and debits credits. Billing is
  unwired, so account caps are the only bound. Investigate before the domain is public.
- **Content policy.** Nothing reviews customer copy before an MP4 exists — see
  `docs/vault/defects/content-policy-classifier-never-runs.md`. Acceptable while the
  founder is the only user; a decision is needed before strangers.
- **`daily_caps` for stranger traffic.** An `app_config` UPDATE, not a deploy.
- **Sentry DSN.** Wired in the worker, unset. `status='dead'` is the alert condition.
- **The `users`/`auth.users` casing gap.** `ensureUser` is guarded and the CLI can no
  longer invent identities, but confirm the casing fix closed the silent variant for
  every writer, not just the CLI.

## Service B

Getting a full revamp after Service A is finished. `lipsync_motion_prompt`,
`lipsync_resolution`, and `auto_release_b` are placeholders, not tuned values — do not
spend care on them. `poll_deadline_seconds` and `words_per_second` are the live Service A
keys that matter.

## Corrections worth not repeating

Recorded because each cost real time, and each came from asserting rather than checking.

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

