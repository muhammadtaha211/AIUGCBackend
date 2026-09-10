---
type: fact
status: verified
verified: 2026-09-10
method: "`npx prettier --check .` from the repo root reports 709 files. Split with `npx prettier --check . 2>&1 | grep -c '^\\[warn\\] .claude/worktrees/'` — 436 of the 709 are inside a nested git worktree that .prettierignore does not exclude, leaving 273 real repo files. The same split measured ~90 minutes earlier in the same session gave 427 / 282: the total held at 709 while both halves moved by nine, because another session was working in that worktree. `git worktree list` confirms .claude/worktrees/inspiring-mcclintock-411e2f is a live worktree at 9543cc3."
source: code
---

# The repo-wide prettier count is 709, and that number is not a baseline

`pnpm lint` (`prettier --check .`) can never be green here — `core.autocrlf=true` means
hundreds of files fail on line endings alone, which CLAUDE.md already records. What is new
is that **the total is not a usable regression check**, and a session that treats "still 709"
as proof it changed nothing is fooling itself in both directions.

Two reasons:

- **436 of the 709 are not repo files.** They are inside
  `.claude/worktrees/inspiring-mcclintock-411e2f`, a nested git worktree that
  `.prettierignore` does not exclude. Concurrent sessions create, work in and delete those
  ([[checkout-is-shared-with-concurrent-sessions]] is the same hazard from the git side), so
  the count moves without anyone touching the repo.
- **The halves can move in opposite directions and cancel.** Measured twice in one session:
  427 worktree / 282 repo, then 436 / 273. Total 709 both times. A real regression of nine
  repo files would have been invisible.

## What to check instead

Check only the files the task touched, and check them EOL-agnostically so CRLF noise does not
mask a real formatting error:

```
git status --porcelain | sed 's/^...//' | while read -r f; do
  npx prettier --check --end-of-line auto "$f"
done
```

That is not a nicety. Closing [[auth-getuser-errors-read-as-signed-out]] produced one file
with a genuine formatting fault (`apps/web/test/auth-user.test.ts` — an over-long line, LF
throughout, so nothing to do with CRLF). The repo-wide total said **709 → 710**, a one-file
delta indistinguishable from the worktree drifting by one; the per-file check named it
immediately.
