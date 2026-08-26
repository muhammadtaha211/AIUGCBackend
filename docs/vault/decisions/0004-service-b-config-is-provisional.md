---
type: decision
status: verified
verified: 2026-08-26
method: "founder instruction in chat, 2026-08-26 session, given while directing the 0031 apply"
source: founder
---

# Service B config keys are provisional until the post-A revamp

Service B is getting a full revamp after Service A is finished. Until then its `app_config`
settings are **placeholders, not decisions**:

- `lipsync_motion_prompt`
- `lipsync_resolution`
- `auto_release_b`

These can be whatever until the revamp. Do not treat them as tuned values, do not spend care
defending their exact contents, and do not cite them as calibration output. They are carried in
`0031_seed_unseeded_config.sql` only so a rebuild reproduces the running state by construction.

The keys that **do** matter right now — live Service A settings:

- `poll_deadline_seconds` (900)
- `words_per_second` (`default` 2.1, calibration output — see [[app-config-live-state]])

## What this does and does not change

- **Does not change `0031`** — it stays as written; the seeds still apply. The founder's exact
  words: "This does not change 0031 — it stays as written. It changes how much care the next
  session should spend on those three keys."
- **Does not lift the standing `auto_release_b` instruction** (CLAUDE.md decision #8 amendment,
  2026-08-09): the value stays `true` until the founder says otherwise in chat. Provisional means
  the value is a placeholder pending the revamp, not that a session may flip it.
- A future session finding these three keys should read them as "whatever was lying around when
  Service B was parked", and expect the revamp to replace them wholesale.
