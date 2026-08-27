---
type: decision
status: verified
verified: 2026-08-27
method: "founder chose at the GitHub token creation screen while working through docs/07-worker-box.md §6"
source: founder
---

# The box authenticates to GitHub with a no-expiration PAT, not a deploy key

`state-of-play` carried a queued item to replace §6's fine-grained PAT with an
SSH deploy key. That item is cancelled; §6 stands as written, with the token set
to **No expiration**.

The case for the deploy key was that PATs expire, and the failure mode is quiet:
`git pull` starts failing on a forgotten box, nobody notices, and the worker runs
stale code for weeks. GitHub's "No expiration" option removes that mode entirely,
which was the whole argument.

What remains, and was judged not to matter at this scale: `credential.helper store`
writes the token in plaintext to `~/.git-credentials`, where an SSH private key
would sit at mode 600 and be refused by ssh if looser. Both credentials are
scoped to read `AIUGCBackend` and nothing else, so a leak of either has the same
blast radius.

Consequence: the token is a credential with no expiry date and no reminder. It
exists on the worker box and in the founder's GitHub account, revocable at
github.com → Settings → Developer settings → Fine-grained tokens.
