---
type: decision
status: verified
verified: 2026-09-10
method: "Founder answered three questions in chat on 2026-09-10 during the .gitattributes task. Result verified by `pnpm lint` -> exit 0, 'All matched files use Prettier code style!'"
source: founder
---

# `pnpm lint` is green, and three things were fenced off to keep it that way

`pnpm lint` (`prettier --check .`) had never passed on the Windows desktop. It does now.
Getting there took more than the line-ending fix everyone assumed was the whole story
([[crlf-was-masking-46-prettier-failures]] has the numbers), so the founder made three calls.

## 1. The working tree was converted in place, not re-checked-out

A root `.gitattributes` with `* text=auto eol=lf` fixes every future checkout and clone, but it
does **not** touch files already on disk, and `git add --renormalize .` produced zero index
changes because the blobs were already LF. The 286 CRLF files had to be rewritten.

Offered: an in-place CR strip, or stop and let the founder refresh the tree himself. Chosen: the
in-place strip. It was provably lossless here — the repo contains **no lone CR bytes**, so
deleting every `\r` is byte-identical to what git's own clean filter does, and every one of the
286 files was fingerprinted content-minus-CR before and raw after (all 286 identical).

The alternative the audit agents kept recommending — `git rm --cached -r . && git reset --hard` —
was rejected outright: it would have destroyed the uncommitted `CLAUDE.md` edit belonging to a
concurrent session ([[checkout-is-shared-with-concurrent-sessions]]).

## 2. `prompts/` and `docs/vault/.obsidian/` are prettier-ignored, not formatted

Of the 46 files that still failed prettier once the line endings were LF, 9 were versioned prompt
files under `prompts/plan_demo_steps/`. Prettier wanted to rewrite `*similar*` to `_similar_` and
re-pad tables inside `v9.md`. **The bytes of a prompt file are what that version means** — a
formatter editing them is a behavioural change to a paid pipeline wearing a cosmetic disguise.

Offered: format all 46 including the prompts; ignore `prompts/` and format the other 37; format
nothing. Chosen: ignore `prompts/`, and `docs/vault/.obsidian/` with it — Obsidian rewrites its
own state files without a trailing newline every time the vault is opened, so formatting them
would go red again on the founder's next Obsidian session and take the stop condition with it.

The remaining 32 were formatted. Every change is line wrapping, a trailing comma, markdown
emphasis style or table padding, plus one paren pair prettier added around a ternary arrow body
(`=> a ? b : c` became `=> (a ? b : c)`). Nothing semantic: verified by stripping whitespace and
commas from all 32 and comparing against the committed versions, then by 911 passing tests.

## 3. `.claude/worktrees/` is prettier-ignored

436 of the original 718 failures were not repo files at all — they were inside a sibling session's
nested git worktree. Prettier reads `.prettierignore` and never `.gitignore`, so it walked
straight into it. Without the entry, "lint green" would depend on whether another session happens
to have a worktree open, which is exactly what [[prettier-709-is-not-a-stable-baseline]] was
written about.

## What this closes

Any task may now use "lint green" as a stop condition. It is a real signal for the first time.
