# Hook-animation SFX

Two short sound effects the Service B compositions play under a hook animation
(`hookEffect` — vault decision 0023). Resolved by `SFX_DIR` in
`packages/core/src/paths.ts` and passed to `renderServiceB` as local file
paths, which serves them on loopback for the render.

| file                   | used by            | length | plays                           |
| ---------------------- | ------------------ | ------ | ------------------------------- |
| `hook-zoom-whoosh.wav` | `hookEffect: zoom` | 0.80s  | two frames before the pull-back |
| `hook-whip-swish.wav`  | `hookEffect: whip` | 0.45s  | from frame 0, with the move     |

Locked decision #7 forbids **music** in organic exports. The founder ruled on
2026-09-06 that an SFX is not music, so these ship.

## They are placeholders

Both are **synthesized**, not recorded — the `.cjs` beside each one generates
it deterministically (`node hook-zoom-whoosh.cjs out.wav`). They are the exact
files the founder judged the mocks with, which is why they are here rather
than something better. A real recorded whoosh replaces them by overwriting the
`.wav` in place: nothing reads the generators at runtime, and no code knows
the difference. An earlier harsher swept-noise version was rejected by ear —
keep the soft wind character.
