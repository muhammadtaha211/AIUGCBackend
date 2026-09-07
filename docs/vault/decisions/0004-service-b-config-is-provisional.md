---
type: decision
status: superseded
verified: 2026-08-26
method: "founder instruction in chat, 2026-08-26 session, given while directing the 0031 apply"
source: founder
---

# Service B config keys are provisional until the post-A revamp

> **Superseded 2026-09-04 by [[0017-service-b-single-setting-selfie-talking-head]]** — the revamp
> this note deferred to now has a shape: a single-setting selfie talking head — one HeyGen clip with a
> Remotion animation hook ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]); the optional opener clip 0017 first
> described is retired 2026-09-06. Kept verbatim below, because **the operative instruction has not expired**:
>
> - **The engine landed 2026-09-05 and `lipsync_motion_prompt` is founder-chosen since 2026-09-06** —
>   with the new `lipsync_expressiveness`, migration 0034
>   ([[0022-heygen-expressiveness-medium-generic-motion-prompt]]). Only `lipsync_resolution` and
>   `auto_release_b` are still "whatever was lying around when Service B was parked" — do not treat
>   those two as tuned.
> - **`auto_release_b` still may not be flipped by a session.** 0017 changes nothing about it.
>
> What 0017 _does_ retire is the open-endedness: "expect the revamp to replace them wholesale" now
> has a note saying what the revamp is.

Service B is getting a full revamp after Service A is finished. Until then its `app_config`
settings are **placeholders, not decisions**:

- `lipsync_motion_prompt`
- `lipsync_resolution`
- `auto_release_b`

These can be whatever until the revamp. Do not treat them as tuned values, do not spend care
defending their exact contents, and do not cite them as calibration output. They are carried in
`0031_seed_unseeded_config.sql` only so a rebuild reproduces the running state by construction.

The keys that **do** matter right now:

- `poll_deadline_seconds` (900)
- `words_per_second` (`default` 2.1, calibration output — see [[app-config-live-state]]). **Amended
  2026-09-07**: written when Service A's voiced format was still live and priced the word budget
  it needed. That format is retired ([[0020-service-a-is-hook-and-steps-only]]) — its
  `generateVoScript` caller survives only in the CLI's retired `format: "full"` path — so this is
  now a Service B key (`generateBScript`'s word budget), not a Service A one.

## What this does and does not change

- **Does not change `0031`** — it stays as written; the seeds still apply. The founder's exact
  words: "This does not change 0031 — it stays as written. It changes how much care the next
  session should spend on those three keys."
- **Does not lift the standing `auto_release_b` instruction** (CLAUDE.md decision #8 amendment,
  2026-08-09): the value stays `true` until the founder says otherwise in chat. Provisional means
  the value is a placeholder pending the revamp, not that a session may flip it.
- A future session finding these three keys should read them as "whatever was lying around when
  Service B was parked", and expect the revamp to replace them wholesale.
