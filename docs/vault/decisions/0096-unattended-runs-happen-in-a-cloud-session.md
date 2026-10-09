---
type: decision
status: verified
verified: 2026-10-08
method: "The founder's task prompt of 2026-10-08 (§2 'Decided', items 1–6, 9 and 10), amended by him in that task's plan-mode chat (a run starts in Plan mode; the spec is saved after approval) and his answer there on the cloud gate. The environment's settings are founder-reported. Claude Code's cloud behaviour is from the docs at code.claude.com, read 2026-10-08 and untested in a cloud session: the first-run checklist in docs/unattended/runbook.md proves or kills each claim."
source: founder
---

# 0096 — Unattended feature runs happen in a cloud session

**FOUNDER, 2026-10-08.** He hands one spec to a cloud Claude Code session and gets back a pushed
branch, an open PR and a closing report. He is asked only to approve the plan. In between, the
session:

- implements;
- runs the gate;
- has its work checked against the spec by an agent that wrote none of it, round after round, until
  every criterion a command can prove is proven.

The run follows `docs/unattended/protocol.md`. He uses `docs/unattended/runbook.md`, and specs are
written from `docs/unattended/spec-template.md`. Items 7 and 8 of the same prompt are
[[0097-push-to-main-refused-by-a-git-hook-the-rest-instruction-only]] and
[[0098-paid-claude-calls-pre-approved-up-to-the-specs-cap]].

## The decisions

1. **Unattended runs happen in a cloud session**, in the environment `tavnit-unattended`.
   - **Reason (his):** it runs with his machine off and holds no production credential.
   - **The environment, FOUNDER-REPORTED 2026-10-08:** Trusted network access, no setup script, and
     one variable, `PAID_CHECK_ANTHROPIC_KEY`.
   - **His ruling in the plan chat:** a setup script installs ffmpeg and headless Chrome's libraries,
     and the network moves to Custom (the defaults plus `remotion.media`). Without them the gate
     cannot go green there:
     - 8 core test files spawn ffmpeg;
     - `packages/remotion/test/frame-delivery.test.ts` downloads Chrome Headless Shell from
       `remotion.media`, which the Trusted list does not include.

     He applies this himself (state-of-play, Owed founder actions).
2. **Two stops stay his:** approving the plan before any code is written, and the merge with
   everything after it (migration push, box).
   - **Reason (his):** those are the irreversible and live axes.
3. **The spec arrives as the session's first message**, in the template's shape:
   - goal, decided, unverified, limits;
   - the acceptance criteria in two lists: those a command or test proves, each naming its proof,
     and those only he can judge;
   - the paid-check cap for the run in ₪, where 0 means none.

   **Reason (planning's):** the spec replaces the planning chat as what the work is checked against.
   - **Amended by him, 2026-10-08.** A run starts in Plan mode: reading only, then the plan. Only
     after he approves does it bootstrap, branch, save the spec verbatim to
     `docs/unattended/runs/<date>-<slug>/spec.md` (prettier-ignored, so the bytes stay his), and
     push.
     - The original said the spec is saved "before planning".
     - His amendment also opened with a canary check. The canary belonged to the PreToolUse guard and
       went with it (0097).

4. **A reviewer agent that wrote none of the code reads the diff against the spec and returns the
   gaps.** It edits nothing.
   - The agent is `.claude/agents/spec-reviewer.md`, with only Read, Grep and Glob.
   - The run ends when the gate is green and the reviewer finds no gap in the first list.
   - The same gap surviving three rounds is a stop: ask him.
   - **Reason (planning's):** an independent read against the decisions is what pasting reports into
     the planning chat provided.
   - **Its trial run, 2026-10-08,** was on commit `ca2f816`, against a scratch spec with four made-up
     criteria, one deliberately unmet.
     - It found the unmet one.
     - It also found a gap nobody planted: a typecheck proof that could not tell the old signature
       from the new.
     - It ran twice on the same inputs, with the same verdict, GAPS(2), and the same untraced
       change. First, before the new file had loaded, as a read-only Explore agent following the
       file's instructions. Then as its own agent type, which the session listed with only Read,
       Grep and Glob.
     - Whether it loads the same way in a cloud session is on the first-run checklist.
5. **When it needs him, it stops and asks in the session.** No other channel is built now.
   - It asks for what CLAUDE.md's "When unsure" lists, for a spec that contradicts the repo, and for
     anything irreversible.
   - Under 0097 it also stops for a merge, for skipping the pre-push hook, for the key appearing in
     output, and for a refusal it believes is wrong.
6. **It pushes the branch after every finished step.**
   - **Reason (planning's):** an idle cloud VM can be reclaimed, and uncommitted work, background
     commands and subagents are not restored.
7. **What the cloud cannot produce is reported as owed, with the command to run.** The
   `db push --dry-run` output and every production read-back are the known cases. Owed work is never
   written as measured and never skipped silently. (This is item 9 of his §2.)
8. **The closing report** is CLAUDE.md's end-of-task block plus these. (This is item 10 of his §2.)
   - what only he can test;
   - whether shipping needs a migration or the box, and in which order relative to the merge
     ([[0039-three-deploy-axes-and-the-box-is-the-one-that-forgets]]);
   - spend against the cap;
   - each reviewer gap and how it closed;
   - what is owed.

## What the docs say, untested here (read 2026-10-08)

- **What a session loads.** A cloud session with one repository loads that repo's CLAUDE.md,
  `.claude/settings.json` (hooks included), `.claude/rules/` and `.claude/agents/`. It loads nothing
  from `~/.claude`.
  - **A session with several repositories loads no repo hooks.** So the runbook says one repository.
- **The cloud flag.** `CLAUDE_CODE_REMOTE` is `true` in the VM and never locally. Measured locally:
  unset.
- **GitHub.** `gh` is pre-installed and authenticated through the GitHub proxy.
  - Its GraphQL subcommands (`gh pr create`, `gh pr merge`) get 403, and REST `gh api` works. So
    the protocol opens the PR through `gh api`.
  - The proxy does not limit which branch a push updates.
- **Permission modes.** Cloud sessions offer Accept edits, Plan and Auto. Auto mode allows pushes to
  the default branch by default.
- **Time limits.**
  - A foreground command gets 2 minutes by default and 10 at most, then moves to the background.
  - A backgrounded command in a cloud session has a 30-minute limit.
- **Idle VMs.** An idle VM pauses and may be reclaimed. The conversation is restored; background
  work is not.
- **Setup scripts.** A setup script runs as root before Claude Code launches. Its result is cached for
  about seven days. A non-zero exit stops the session from starting.
