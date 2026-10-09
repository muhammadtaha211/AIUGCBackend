---
type: decision
status: verified
verified: 2026-10-08
method: "The founder's task prompt of 2026-10-08 (§2 item 7), his four changes to plan revision 1 and his ruling after the build stop, all in that task's chat. The enforced group is proven by packages/core/test/unattended-guard.test.ts (a temp bare remote, with the hook installed the cloud way and the local way) and by a live dry run in his checkout on 2026-10-08: a throwaway commit pushed with --dry-run to refs/heads/main was refused by the hook, the same commit to the task branch was not, and git ls-remote showed main still at e3d445b. Cloud facts are from the docs at code.claude.com, read 2026-10-08."
source: founder
---

# 0097 — A push to main is refused by a git hook; merging, --no-verify and the key are instruction only

**FOUNDER, 2026-10-08.**

## As first decided (his §2, item 7)

Refusals are made by the repo's Claude Code configuration, not by instruction.

- **In a cloud session:** any push that updates main, merging a PR by any route, `db push`,
  `migration repair`, ssh and scp.
- **In a local session:** only the push to main. The rest stays as CLAUDE.md has it.

**Reason (his):** main cannot be protected at GitHub (private repo on the free plan, founder-reported),
and a push to main is a production deploy of web and admin.

## As amended: three groups

### 1. Enforced: a push to main, by the git pre-push hook, locally and in the cloud

`.claude/hooks/pre-push` is installed at every session start by `.claude/hooks/session-start.mjs`, the
SessionStart hook in `.claude/settings.json`. git hands the hook the refs it has already resolved, so
every spelling is covered:

- `HEAD:main`, `main`, `refs/heads/main`;
- `-C`, `--all`, `--mirror`;
- forced: `-f`, `+`, `--force-with-lease`;
- deleting `:main`;
- an alias;
- an implicit push from main;
- `--dry-run`, which also runs the hook (git 2.46, measured).

All of these are tested against a temp bare remote, and a task-branch push goes through.

- **Locally** the hook is in the repo's shared `.git/hooks`, so it covers the founder's worktrees too.
  - It refuses only when `CLAUDECODE` is set. Claude Code sets that in its Bash and PowerShell tools
    (measured 2026-10-08), so the founder's own terminal pushes are untouched. His global git config
    is never changed.
  - **Accepted by him:** `--no-verify` gets past it locally.
  - **Not covered:** the desktop app's terminal tool, if its shell lacks `CLAUDECODE`. The runbook
    has him check this once.
- **In the cloud** it refuses every time. It is installed in `~/.config/aiugc/hooks`, with
  `git config --global core.hooksPath` pointing there, so a fresh clone anywhere in the VM is covered.
  It is also installed in the repo's `.git/hooks`. The run's bootstrap runs
  `session-start.mjs --check` and stops if that fails.

### 2. Unreachable in the cloud by construction: `db push`, `migration repair`, ssh

- **There are no credentials to use.** The environment holds no database URL and no ssh key. Its one
  variable is `PAID_CHECK_ANTHROPIC_KEY` (founder-reported).
- **There is no network path either.** Neither the Supabase database nor the box is on the
  environment's network allowlist. That is derived from the docs' default list and not tested.
- **This holds only while the environment stays that way.** The runbook says never to add a
  credential to it.

### 3. Instruction only

- merging a PR by any route;
- `--no-verify`, or any other way of skipping the hook (changing git's hooks path, `GIT_CONFIG_*`,
  `HOME`);
- printing `PAID_CHECK_ANTHROPIC_KEY`.

Each is a stop-and-ask in `docs/unattended/protocol.md`. The proxy refuses GraphQL, so `gh pr merge`
would fail with 403 (docs). But REST `gh api` and the built-in GitHub tools face no obstacle.

### Also kept

- **Settings are frozen in a cloud session.** A ConfigChange hook exits 2 when `CLAUDE_CODE_REMOTE`
  is `true` or `1`, and per the docs a blocked change is not applied to the running session. Locally
  it does nothing.
- **His rulings that stand:**
  - A refusal the run believes is wrong is a stop-and-ask, never a workaround.
  - Hook and settings changes are made in local sessions only.

## Why the guard was not built

**What the plan had.** Revision 2 of the plan had a second layer: a PreToolUse hook. In the cloud
only, it would have read each command and refused:

- merges through the API or a tool;
- `db push`, `migration repair` and ssh;
- `--no-verify` and hooks-path overrides;
- the key's appearance.

**What happened.** During the build, Anthropic's safety classifier stopped the session's step that
wrote the guard's command parser. The session was told not to produce that content again. It offered
three ways forward:

1. build everything else, and leave the guard owed;
2. commit the unrun file for another session;
3. stop.

**What he chose.** Option 1, with changes:

- the guard is not built, and it is not owed either;
- with no guard there is no PreToolUse hook at all;
- the gaps it would have covered are recorded here: group 2 where nothing is reachable anyway, group
  3 where only instruction holds.

**Two facts that bear on it:**

- **Even built, it would only have read command text.** A script file, or a command assembled at
  runtime, gets past any text check. The docs say a Bash permission rule "isn't a security boundary".
- **Its local cost is gone.** Any PreToolUse hook would have charged each matched local tool call one
  Git Bash start, measured at about 100–115 ms on 2026-10-08. He had accepted that floor. With no
  PreToolUse hook, local tool calls now pay nothing; only session start runs the installer.

## What would close the instruction-only gaps

Server-side protection of main: a GitHub ruleset or branch protection. On a private repo that needs
GitHub Pro ($4/month). It is not proposed: locked decision 10.

The first cloud run's `gh api user` shows whether the proxy acts as him. That decides whether a
ruleset could tell a cloud session apart from him.
