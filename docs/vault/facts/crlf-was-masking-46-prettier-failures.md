---
type: fact
status: verified
verified: 2026-09-10
method: "`git ls-files --eol | awk '{print $1,$2}' | sort | uniq -c` -> 348 i/lf w/lf, 286 i/lf w/crlf, 8 i/-text, 2 i/none. Post-LF failure count measured by mirroring all 644 tracked files into a scratch dir with `tr -d '\r'` (binaries copied verbatim), copying .prettierrc.json and .prettierignore alongside, and running `prettier --check .` there -> 'Code style issues found in 46 files'. Independently reproduced by a separate agent via prettier's Node API: `prettier.check(raw.replace(/\r\n/g,'\n'), {filepath})` over all 282 real-repo failures -> checked=282, still_failing_after_LF=46."
source: code
supersedes: "[[prettier-709-is-not-a-stable-baseline]]"
---

# The line endings were 274 of the failures; 46 more were hiding behind them

Before the fix, `pnpm lint` reported **718 files**. The split:

| Bucket                               | Count | Cause                               |
| ------------------------------------ | ----: | ----------------------------------- |
| `.claude/worktrees/…`                |   436 | a sibling session's nested worktree |
| real repo, CRLF only                 |   236 | `core.autocrlf=true`                |
| real repo, CRLF **and** misformatted |    38 | both                                |
| real repo, misformatted only         |     8 | genuine prettier violations         |

**274 of the 282 real-repo failures involved CRLF, but only 236 were CRLF alone.** Prettier
reports one failure per file, so a file that is both CRLF and badly formatted looks exactly like
a file that is merely CRLF. Fixing the line endings therefore did not drop the real-repo count
from 282 to 8 — it dropped it to **46**.

That is the trap: "the tree is CRLF, so lint is red for line endings" was true and still
understated the work by a factor of six.

## Supporting measurements

- **The committed blobs were already LF.** `git ls-files --eol` showed `i/lf` for all 634
  tracked text files, before any change. `git add --renormalize .` produced zero index changes,
  exactly as that predicts.
- **No lone CR bytes exist anywhere.** Scanned every tracked text file for a `0d` not followed by
  `0a`: zero hits. This is what made an in-place `tr -d '\r'` safe — see
  [[0038-lint-is-a-real-stop-condition-again]].
- **`file(1)` under-reports CRLF on JSON.** It calls `.json` files "JSON text data" with no
  terminator clause, so a `file`-based census missed 7 CRLF files that `git ls-files --eol`
  caught. Use `git ls-files --eol`, not `file`, for this question.
- **A working-tree conversion needs a second `git add --renormalize .`** to settle. After
  rewriting the files, `git status` listed all 286 as modified while `git diff` listed one; the
  index still held the pre-conversion `size` (README.md: 2919 on disk, 2979 cached — exactly its
  60 CRs). `git update-index --really-refresh` did **not** clear it. Re-running
  `git add --renormalize .` did.
- **8 files are binary and git already detected all 8** without any `.gitattributes`: 3 `.png`,
  1 `.ico`, 2 `.wav`, 2 `.mp4`. No tracked text file contains a NUL byte, so `text=auto` has
  nothing to misclassify. `.jpg`, `.webp` and `.mp3` exist in bulk only under gitignored `.work/`
  and are pinned as forward insurance. No `.svg` exists anywhere — it must never be pinned.

## Aftermath

`pnpm lint` exits 0. `pnpm typecheck` passes on all 6 projects. 911 tests pass across 59 files
(core 500, web 328, remotion 76, worker 7).
