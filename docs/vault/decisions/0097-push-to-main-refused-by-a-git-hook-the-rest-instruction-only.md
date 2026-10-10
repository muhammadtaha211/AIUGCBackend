---
type: decision
status: verified
verified: 2026-10-10
method: "The founder's task prompt of 2026-10-08 (§2 item 7), his four changes to plan revision 1 and his ruling after the build stop, all in that task's chat. The enforced group is proven by packages/core/test/unattended-guard.test.ts (a temp bare remote, with the hook installed the cloud way and the local way) and by a live dry run in his checkout on 2026-10-08: a throwaway commit pushed with --dry-run to refs/heads/main was refused by the hook, the same commit to the task branch was not, and git ls-remote showed main still at e3d445b. Cloud facts are from the docs at code.claude.com, read 2026-10-08. Amended 2026-10-10 from his task prompt of that day (§2 items 3 and 4) and his choice in that session (the docs written in a cloud session, the settings change left to a local one). The tool names and `gh api user` are from the first run's docs/unattended/runs/2026-10-09-inventory-first-load-retry/log.md (Items 8 and 10). The mechanism rests on the hooks, permissions and tools-reference pages at code.claude.com/docs and on the embedded code of Claude Code 2.1.296, both read 2026-10-10."
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

## Amended 2026-10-10: the two merge tools are refused in the cloud; a GitHub rule could not stop a merge

From his task prompt of 2026-10-10, items 3 and 4.

### Item 3: the two GitHub tools that merge are refused in a cloud session

**Decided:** `mcp__github__merge_pull_request` and `mcp__github__enable_pr_auto_merge` are refused in
a cloud session by configuration. Locally nothing changes.

- **The names** are the ones the first run recorded (its `log.md`, Item 8). The same two were in this
  task's cloud session's tool list on 2026-10-10.
- **Merging through the REST API stays instruction only,** as do gh and the web.
- **It is a rule on two tool names.** It is not the command guard ruled out above, and nothing
  parses commands.
- **Reason (planning's):** a tool named "merge" is the most natural route to an accidental merge.

**The mechanism: one PreToolUse hook in `.claude/settings.json`.**

- Its matcher is the two names joined by `|`.
- Its command is the settings freeze's own. When `CLAUDE_CODE_REMOTE` is `true` or `1`, it exits 2
  with a message on stderr. Otherwise it exits 0 with no output.

**Why not a `permissions.deny` rule:** Claude Code loads permission rules from every settings file
with no check on `CLAUDE_CODE_REMOTE`. A deny rule would also refuse the two tools in any local
session that has an MCP server named `github`.

**What it rests on** (read 2026-10-10 in the docs and in Claude Code 2.1.296's embedded code):

- A matcher made only of letters, digits, `_` and `|` is a list of exact tool names. Any other
  character, such as `.`, `*` or `^`, makes it an unanchored regex that can match other tools.
- A PreToolUse exit 2 becomes a deny before the permission mode is consulted, so it holds in Auto
  mode too. The session reads the hook's stderr.
- The hook process starts only for a call whose tool name matches. Every other tool call costs
  in-process string matching only.
- The Windows side effect that turned PowerShell off is keyed on a deny rule naming Bash. This hook
  adds no permission rule at all.

**Local cost:**

- **Every other tool:** none.
- **A local tool named exactly one of the two:** one hook start per call (one Git Bash start, about
  100–115 ms, measured on 2026-10-08 above), and the hook lets the call through.
- **Whether his local sessions have such a tool** can't be seen from the cloud. It is owed:
  `claude mcp list` in a local session.

**What it does not cover:**

- A cloud session with several repositories loads no repo hooks; the runbook says one repository.
- A hook that fails to start, or times out, lets the call through.
- Every other route to a merge.

**Built: not yet.** Hooks and settings change in local sessions only. On 2026-10-10 he chose this:

- the cloud session that took the prompt writes the docs;
- a local session on the same branch, `claude/unattended-cloud-runs-s1en9c`, adds the hook and its
  test in `packages/core/test/unattended-guard.test.ts` before the PR is opened (state-of-play,
  Owed founder actions).

**What this supersedes:** two lines in §Why the guard was not built, "with no guard there is no
PreToolUse hook at all" and "With no PreToolUse hook, local tool calls now pay nothing". There is
now one PreToolUse hook, on two tool names, and every other local tool call still pays nothing.

### Item 4: a GitHub rule on main could not stop a cloud session from merging

The first run measured `gh api user` as `muhammadtaha211 (type: User)` (its `log.md`, Item 10). The
session acts as his own GitHub account, so no rule can tell the two apart.

§What would close the instruction-only gaps holds for pushes only.

### The desktop app's terminal check is dropped

FOUNDER-REPORTED 2026-10-10: he found no Terminal panel in the desktop app. "Not covered: the
desktop app's terminal tool" above stays unmeasured, and the runbook no longer asks him to check it.
