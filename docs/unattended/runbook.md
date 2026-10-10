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

## Each run

1. **Write the spec** from `spec-template.md`.
   - Set the paid-check cap: 0 means no paid call at all.
   - Fill in the Model and Touches lines.
   - Compare its Touches with every run in flight (§Several runs at once).
   - Until the Remotion fonts failure in the cloud is fixed (vault 0096, amended 2026-10-10), a spec
     that changes `packages/remotion` or how a render looks runs in a local session, not here.
2. **Start a cloud session** (claude.ai/code, or the desktop app's new-session menu, choosing Cloud):
   - environment **tavnit-unattended**;
   - repository **muhammadtaha211/AIUGCBackend**, and only that one. A session with two repositories
     loads no repo hooks, so neither the pre-push hook nor the merge-tool refusal would load;
   - branch **main**;
   - permission mode **Plan**;
   - model: the one the spec's Model line names.
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
   - what is owed, with commands. While the fonts failure stands, that includes the Remotion suite;
   - the PR link. If the run couldn't open the PR, click **Create PR** in the session's diff view.
7. **Stop 2, the merge and after.** In order:
   1. If anything has merged to main since the run's session started, or the report says the branch
      does not contain `origin/main`, say **"bring main in"** in the session. Wait for its report:
      each conflict and how it was resolved, and the gate and one review round on the combined
      branch.
   2. Test the List-2 items.
   3. Run the owed commands locally. If a migration is waiting, run its `db push --dry-run` from a
      local session and authorise the push per `.claude/rules/migrations.md`.
   4. Merge on GitHub. Only you merge, one PR at a time.
   5. Do the box steps, in the order the report gives.

## Several runs at once

You can have several runs in flight, each in its own session on its own branch.

- **Never in flight together:** two runs that each add a migration, or two that each touch credits
  or billing. The specs' Touches lines show it. Migration numbers and the push order to production
  are one sequence.
- **Merge one at a time.** After each merge, every other open run PR is behind main. Before merging
  the next, say "bring main in" in its session (Stop 2, step 1).
- **Expect conflicts** in `docs/vault/state-of-play.md` and `docs/repo-map.md`. The session resolves
  them when it brings main in. A conflict where the two changes want different behaviour comes back
  to you as a question.

## If something goes wrong

- **The SessionStart line doesn't say "cloud mode", or the run stops on `--check`.** The pre-push
  hook isn't in place. Check that the session has one repository and started from main (or from
  the run's branch, for a session that continues a run), then start a new session.
- **The session never starts.** The setup script exited non-zero. Fix it in the environment and
  start again.
- **The session stops before its first commit because main moved while it waited for your
  approval.** Say "fast-forward": it moves its branch to main's head and re-checks the spec's
  Unverified claims. Or start a new session.
- **The session expired mid-run.** Everything up to the last finished step is pushed, and the
  branch's `log.md` says where it stopped. To continue, start a new session as in Each run, step 2,
  but on the run's branch instead of main, and say: "Continue the run in
  `docs/unattended/runs/<date>-<slug>/log.md`."
- **The session expired before you could say "bring main in".** Start a new session the same way
  and say: "Bring main in for the run in `docs/unattended/runs/<date>-<slug>/log.md`."
- **A new session on a run's branch stops because it was assigned a different branch.** It names
  both. Tell it to use the one `log.md` names: the run's commits and its PR are on that branch.
- **`PAID_CHECK_ANTHROPIC_KEY` appeared in any output.** Replace the key in the Console, then update
  the environment variable. You reported a $20/month spend limit on that scoped key on 2026-10-08.
- **A refusal looks wrong to you too.** Hooks and settings change in a local session only, through a
  normal reviewed branch.

## First run: what was proven, and what is left

The first run (2026-10-09) checked items 1–4 and 6–10 itself: its `log.md`, §First-run checklist,
in `docs/unattended/runs/2026-10-09-inventory-first-load-retry/`. You reported item 11 on
2026-10-10: you chose Auto when you approved its plan. What it changed:

- Item 2: the session starts on a branch the cloud assigns, so a run now works on that branch
  (`protocol.md`, §After approval, step 2).
- Items 3 and 4: the gate is 6 of 7 there. The Remotion test downloads Chrome, then fails on the
  fonts certificate, and that one failure is owed rather than a stop.
- Items 8 and 10: two GitHub tools can merge, and the session acts as your own account. The two tools
  are now refused in the cloud by a hook (vault 0097, amended 2026-10-10).

Still open, for you to check on a run and tell a local session:

- **Item 5:** a settings edit is refused by the freeze, and switching the model in the UI still
  works.
- **Item 12:** a paused VM keeps uncommitted files.
