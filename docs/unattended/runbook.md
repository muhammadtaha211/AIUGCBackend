# Runbook: unattended runs in a cloud session

For the founder. Running a spec takes two stops: you approve the plan, and you merge (plus whatever
comes after the merge). The run itself follows `protocol.md`.

## Once, before the first run

1. **Merge** the PR that added this runbook. Cloud sessions start from main, and the pre-push hook
   only exists there after the merge.
2. **Edit the `tavnit-unattended` environment** in claude.ai/code:
   - **Setup script:** paste this. It installs ffmpeg and the libraries headless Chrome needs (the
     same list as `docs/07-worker-box.md` §4).

     ```bash
     #!/bin/bash
     apt-get update && apt-get install -y ffmpeg libnss3 libdbus-1-3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64
     ```

   - **Network access:** choose **Custom**, add `remotion.media`, and tick **Also include default
     list of common package managers**. The Remotion render test downloads Chrome from that host.
   - **Environment variables:** keep exactly one, `PAID_CHECK_ANTHROPIC_KEY`. Never add a database
     URL, a Supabase key, an ssh key or any other credential. `db push`, `migration repair` and ssh
     are unreachable from a cloud run only because the environment holds none (vault 0097).
3. **Check the desktop app's terminal once.** In the Terminal panel beside a session, run
   `$env:CLAUDECODE`.
   - If it prints `1`, a push to main that Claude types into that panel is refused like any other.
   - If it prints nothing, that panel is the one local route the pre-push hook doesn't cover. Your
     own pushes from it are untouched either way.

## Each run

1. **Write the spec** from `spec-template.md`. Set the paid-check cap: 0 means no paid call at all.
2. **Start a cloud session** (claude.ai/code, or the desktop app's new-session menu, choosing Cloud):
   - environment **tavnit-unattended**;
   - repository **muhammadtaha211/AIUGCBackend**, and only that one. A session with two repositories
     loads no repo hooks, so the pre-push hook would not be installed;
   - branch **main**;
   - permission mode **Plan**;
   - model **Opus 5.5**.
3. **Paste the spec** as the first message and send it.
4. **Stop 1, the plan.** The session reads, confirms the spec's Unverified claims, and presents a
   plan. Check that:
   - every List-1 criterion has a step and a proof;
   - paid checks fit your cap;
   - there is a list of what will be owed;
   - the shipping order matches your understanding.

   Then **approve it and choose Auto mode**. Accept edits would stop at every command. If the plan is
   wrong, reply with your changes instead.

5. **While it runs,** it only asks you something for a reason in `protocol.md` §Stop and ask. Answer
   in the session. An unanswered question waits until the session's environment expires; the
   conversation survives that.
6. **The report.** At the top you get:
   - what only you can test;
   - whether a migration or the box is needed, and in what order relative to the merge;
   - spend against the cap;
   - each reviewer gap and how it closed;
   - what is owed, with commands;
   - the PR link. If the run couldn't open the PR, click **Create PR** in the session's diff view.
7. **Stop 2, the merge and after.** In order:
   1. Test the List-2 items.
   2. Run the owed commands locally. If a migration is waiting, run its `db push --dry-run` from a
      local session and authorise the push per `.claude/rules/migrations.md`.
   3. Merge on GitHub. Only you merge.
   4. Do the box steps, in the order the report gives.

## If something goes wrong

- **The SessionStart line doesn't say "cloud mode", or the run stops on `--check`.** The pre-push
  hook isn't in place. Check that the session has one repository and started from main, then start a
  new session.
- **The session never starts.** The setup script exited non-zero. Fix it in the environment and
  start again.
- **The session expired mid-run.** Everything up to the last finished step is pushed, and the
  branch's `log.md` says where it stopped. To continue, start a new session on that branch and say:
  "Continue the run in `docs/unattended/runs/<date>-<slug>/log.md`."
- **`PAID_CHECK_ANTHROPIC_KEY` appeared in any output.** Replace the key in the Console, then update
  the environment variable. The key's workspace has a $20/month spend limit, as you reported on
  2026-10-08.
- **A refusal looks wrong to you too.** Hooks and settings change in a local session only, through a
  normal reviewed branch.

## First run: what is still unproven

Check these on the first run, and tell a local session what you saw, so it can update
`docs/vault/state-of-play.md`:

1. The SessionStart line says cloud mode, and `--check` passes.
2. Which branch the session starts on, and that the task branch is created from `origin/main`.
3. ffmpeg is present, and the Remotion test downloads Chrome from `remotion.media`.
4. The seven gate commands are green: note each one's duration, and whether the 30-minute limit on
   backgrounded commands is hit.
5. A settings edit is refused by the freeze, and switching the model in the UI still works.
6. There is no PowerShell tool, and test-runner runs on Bash.
7. `spec-reviewer` loads as an agent type in the cloud, with only Read, Grep and Glob. It did
   locally on 2026-10-08.
8. The built-in GitHub tools' names, and whether one of them can merge.
9. `gh api repos/{owner}/{repo}/pulls` opens the PR.
10. Which identity `gh api user` shows: you, or an app. This decides whether a GitHub ruleset could
    ever tell a cloud session apart from you.
11. Auto mode can be chosen when you approve the plan.
12. A paused VM keeps uncommitted files.
