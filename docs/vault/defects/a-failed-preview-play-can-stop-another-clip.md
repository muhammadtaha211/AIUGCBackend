---
type: defect
status: verified
verified: 2026-10-02
method: "Read in apps/web/src/components/a-wizard/clip-player.tsx: `void el.play().catch(() => player.stop())` in ClipVideo's onLoadedMetadata; stop is `() => setActive(null)` with no check of which clip is active. git show origin/main has the same line. Found 2026-10-02 by the diff review of feat/steps-fixed-2s-clips, by reading; not reproduced in a browser."
source: code + inference
---

# A preview whose play() is rejected can stop a different clip

Found 2026-10-02 by the diff review of the 2 s clip build. **NOT FIXED.** Not introduced by that
build. **REASONED from the code, not reproduced.**

## What happens

The wizard has one preview player. When a clip's `<video>` is removed while its `play()` is still
pending (the customer moved to another tile or step), the browser rejects that promise, and the
handler stops the player — whichever clip is active by then. The clip just started goes back to
its still until the pointer leaves and re-enters or the customer taps again.

The same shape existed in the end-of-clip timer added by the build and was fixed there (it now
checks that its own element is still on the page).

## The fix, when wanted

The same guard: stop only when the element is still connected.
